import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildReasonerToolDefinitions, buildReasonerToolRegistry } from './tool-registry.js';
import type {
  ExternalReasonerConfig,
  ExternalReasonerModelConfig,
  ExternalReasonerModelRegistry,
  ReasonerClient,
  ReasonerEvidenceItem,
  ReasonerFinding,
  ReasonerInput,
  ReasonerOutput,
  ReasonerRejectedCitation,
  ReasonerSnapshot,
  ReasonerTaskShape,
  ReasonerToolDefinition,
  ReasonerToolInvocation,
  ReasonerToolName,
  ReasonerToolRegistryEntry,
} from './types.js';

export async function buildReasonerSnapshot(task: ReasonerTaskShape): Promise<ReasonerSnapshot> {
  const input = buildReasonerInput(task);
  const client = resolveReasonerClient();
  return {
    input,
    output: await client.generate(input),
  };
}

function buildReasonerInput(task: ReasonerTaskShape): ReasonerInput {
  const evidence: ReasonerEvidenceItem[] = [
    metricEvidence('cpu', 'CPU 压力', task.metrics.cpu),
    metricEvidence('blocked', '阻塞时间', task.metrics.blocked),
    metricEvidence('gc', 'GC 压力', task.metrics.gc),
    metricEvidence('syscalls', 'Syscall 占比', task.metrics.syscalls),
  ];

  task.topFunctions.slice(0, 3).forEach((fn, index) => {
    evidence.push({
      id: `hotspot-${index + 1}`,
      kind: 'hotspot',
      label: fn.name,
      detail: `${fn.name} 在 ${fn.module}${fn.locationSummary ? ` 的 ${fn.locationSummary}` : ''} 处占据了 ${fn.percent}% 的采样时间${fn.mappingState ? `（${fn.mappingState} 映射）` : ''}。`,
      value: fn.percent,
    });
  });

  task.findings.slice(0, 3).forEach((finding, index) => {
    evidence.push({
      id: `finding-${index + 1}`,
      kind: 'finding',
      label: finding.title,
      detail: `${finding.evidence} 建议：${finding.recommendation}`,
    });
  });

  if (task.baselineComparison) {
    evidence.push({
      id: 'comparison-baseline',
      kind: 'comparison',
      label: `基线对比 ${comparisonVerdictLabel(task.baselineComparison.verdict)}`,
      detail: `${task.baselineComparison.summary} ${task.baselineComparison.changedHotspot}`,
    });

    task.baselineComparison.compatibility.warnings.forEach((warning, index) => {
      evidence.push({
        id: `comparison-compatibility-${index + 1}`,
        kind: 'comparison',
        label: `可比性提醒 ${index + 1}`,
        detail: warning,
      });
    });
  }

  evidence.push({
    id: 'lifecycle-status',
    kind: 'timeline',
    label: `任务状态 ${task.status}`,
    detail: `当前任务处于 ${task.status}，uploadState=${task.uploadState}，原因：${task.statusReason}`,
  });

  evidence.push({
    id: 'target-context',
    kind: 'timeline',
    label: `目标上下文 ${targetTypeLabel(task.targetContext.targetType)}`,
    detail: buildTargetContextEvidence(task),
  });

  evidence.push({
    id: 'provenance-path',
    kind: 'timeline',
    label: '采集路径与上传状态',
    detail: `本次任务保留了 ${task.sampleCount} 个样本，sampleSource=${task.sampleSource}，任务状态 ${task.status}，uploadState=${task.uploadState}。`,
  });

  evidence.push({
    id: 'symbolization-state',
    kind: 'timeline',
    label: '符号化可读性',
    detail: buildSymbolizationEvidence(task),
  });

  task.artifacts.slice(0, 2).forEach((artifact, index) => {
    evidence.push({
      id: `artifact-${index + 1}`,
      kind: 'artifact',
      label: artifact.label,
      detail: `${artifact.kind} 已保存在 ${artifact.path}。`,
    });
  });

  const latestEvent = task.timeline.at(-1);
  if (latestEvent) {
    evidence.push({
      id: 'timeline-latest',
      kind: 'timeline',
      label: latestEvent.title,
      detail: latestEvent.detail,
    });
  }

  if (task.baselineComparison?.driver) {
    evidence.push({
      id: 'trend-latest-driver',
      kind: 'comparison',
      label: `趋势 driver ${task.baselineComparison.driver.label}`,
      detail: task.baselineComparison.driver.evidence,
    });
  }

  const availableTools = buildReasonerToolDefinitions() as ReasonerToolDefinition[];
  const input: ReasonerInput = {
    taskId: task.id,
    reportTitle: task.reportTitle,
    reportSummary: task.reportSummary,
    target: task.target,
    collector: task.collectorName,
    scenario: task.scenarioName,
    evidence,
    guardrails: [
      '只能引用输入证据包中真实存在的 evidence id。',
      '如果证据不足，必须明确说明结论受限。',
      '不要虚构源码文件、行号或栈帧。',
      '只能使用 availableTools 中声明的只读工具。',
    ],
    availableTools,
    toolContext: [],
  };

  input.toolContext = buildInitialToolContext(input);
  return input;
}

function metricEvidence(id: string, label: string, value: number): ReasonerEvidenceItem {
  return {
    id: `metric-${id}`,
    kind: 'metric',
    label,
    detail: `${label} 为 ${value}%。`,
    value,
  };
}

function buildTargetContextEvidence(task: ReasonerTaskShape) {
  const processInfo = task.targetContext.processInfo;
  const processSummary = processInfo
    ? `PID ${processInfo.pid}${processInfo.name ? ` • ${processInfo.name}` : ''}${processInfo.languageHint ? ` • ${processInfo.languageHint}` : ''}${processInfo.commandSummary ? ` • ${processInfo.commandSummary}` : ''}`
    : '未保留真实进程元数据';
  const comparisonWarning = task.baselineComparison?.compatibility.warnings[0]
    ? ` 可比性提醒：${task.baselineComparison.compatibility.warnings[0]}`
    : '';
  return `目标模式：${targetTypeLabel(task.targetContext.targetType)}；采样路径：${attachSourceLabel(task.targetContext.attachSource)}；${processSummary}。采样决策：${task.targetContext.attachDecision}。${comparisonWarning}`;
}

function buildSymbolizationEvidence(task: ReasonerTaskShape) {
  const full = task.topFunctions.filter((item) => item.mappingState === 'full').length;
  const partial = task.topFunctions.filter(
    (item) => item.mappingState === 'file-only' || item.mappingState === 'module-only',
  ).length;
  const synthetic = task.topFunctions.filter((item) => item.mappingState === 'synthetic').length;

  return `热点映射统计：full=${full}，partial=${partial}，synthetic=${synthetic}。主热点位置 ${task.topFunctions[0]?.locationSummary ?? task.topFunctions[0]?.module ?? 'unknown'}。`;
}

function buildInitialToolContext(input: ReasonerInput): ReasonerToolInvocation[] {
  const toolCalls: Array<{ name: ReasonerToolName; args?: Record<string, unknown> }> = [
    { name: 'get_task_evidence_bundle' },
    { name: 'get_baseline_context' },
  ];
  if (input.evidence.some((item) => item.id.startsWith('artifact-'))) {
    toolCalls.push({ name: 'get_artifact_excerpt', args: { artifactId: 'artifact-1' } });
  }

  return toolCalls.map((call) => runTool(call.name, input, call.args).invocation);
}

function buildDisabledReasonerOutput(input: ReasonerInput): ReasonerOutput {
  return {
    mode: 'disabled',
    summary: `LLM reasoner 当前已禁用，本次先保留了 ${input.evidence.length} 条证据，供后续基于证据的归因使用。`,
    findings: [],
    citations: [],
    rejectedCitations: [],
    rejectedCitationDetails: [],
    toolInvocations: input.toolContext,
    generatedAt: new Date().toISOString(),
    guardrailStatus: 'enforced',
    fallbackReason: 'Reasoner 模式已禁用。',
  };
}

function buildStubReasonerOutput(input: ReasonerInput): ReasonerOutput {
  const hotspot = input.evidence.find((item) => item.kind === 'hotspot');
  const comparison = input.evidence.find((item) => item.kind === 'comparison');
  const cpu = input.evidence.find((item) => item.id === 'metric-cpu');
  const targetContext = input.evidence.find((item) => item.id === 'target-context');

  const draftFindings: Array<{
    title: string;
    detail: string;
    citations: string[];
  }> = [
    hotspot
      ? {
          title: '主热点',
          detail: `${hotspot.label} 是当前证据包里最清晰的热路径。`,
          citations: [hotspot.id],
        }
      : null,
    comparison
      ? {
          title: '基线对比',
          detail: comparison.detail,
          citations: [comparison.id],
        }
      : null,
    cpu
      ? {
          title: 'CPU 上下文',
          detail: cpu.detail,
          citations: [cpu.id],
        }
      : null,
    targetContext
      ? {
          title: '采样来源',
          detail: targetContext.detail,
          citations: [targetContext.id],
        }
      : null,
  ].filter((item): item is { title: string; detail: string; citations: string[] } => item !== null);

  const validation = validateCitationsWithDetails(
    draftFindings.flatMap((item) => item.citations),
    input,
  );
  const validationInvocation = runTool('validate_citations', input, {
    citations: draftFindings.flatMap((item) => item.citations),
  }).invocation;

  const findings = draftFindings.map((item) => ({
    ...item,
    citations: item.citations.filter((citation) => validation.accepted.includes(citation)),
    status: item.citations.every((citation) => validation.accepted.includes(citation)) ? 'verified' : 'context-only',
  })) satisfies ReasonerFinding[];

  return {
    mode: 'stub',
    summary:
      findings[0]?.detail ??
      '当前保留的证据包还不足以支持更强的基于证据摘要。',
    findings,
    citations: validation.accepted,
    rejectedCitations: validation.rejected.map((item) => item.citation),
    rejectedCitationDetails: validation.rejected,
    toolInvocations: [...input.toolContext, validationInvocation],
    generatedAt: new Date().toISOString(),
    guardrailStatus: 'enforced',
    fallbackReason: null,
  };
}

function resolveReasonerClient(): ReasonerClient {
  const mode = process.env.MINI_DROP_REASONER_MODE;
  if (mode === 'external') {
    return createExternalReasonerClient(readExternalReasonerConfig());
  }
  if (mode === 'stub') {
    return createStubReasonerClient();
  }
  return createDisabledReasonerClient();
}

function createDisabledReasonerClient(): ReasonerClient {
  return {
    mode: 'disabled',
    async generate(input: ReasonerInput) {
      return buildDisabledReasonerOutput(input);
    },
  };
}

function createStubReasonerClient(): ReasonerClient {
  return {
    mode: 'stub',
    async generate(input: ReasonerInput) {
      return buildStubReasonerOutput(input);
    },
  };
}

function createExternalReasonerClient(config: ExternalReasonerConfig): ReasonerClient {
  return {
    mode: 'external',
    async generate(input: ReasonerInput) {
      if (!config.endpoint) {
        const configHint = config.configPath
          ? `MINI_DROP_REASONER_ENDPOINT 尚未配置，且 ${config.configPath} 中也没有可用的 url。`
          : 'MINI_DROP_REASONER_ENDPOINT 尚未配置。';
        return buildExternalUnavailableOutput(input, configHint);
      }

      try {
        const response = await fetchWithTimeout(
          config.endpoint,
          {
            method: 'POST',
            headers: buildExternalHeaders(config),
            body: JSON.stringify(buildExternalRequestBody(config, input)),
          },
          config.timeoutMs,
        );

        if (!response.ok) {
          return buildExternalUnavailableOutput(
            input,
            `外部 reasoner 返回了 HTTP ${response.status}。`,
          );
        }

        const payload = (await response.json()) as unknown;
        return normalizeExternalReasonerOutput(input, payload);
      } catch (error) {
        return buildExternalUnavailableOutput(
          input,
          error instanceof Error ? error.message : '外部 reasoner 请求失败。',
        );
      }
    },
  };
}

function readExternalReasonerConfig(): ExternalReasonerConfig {
  const configPath =
    process.env.MINI_DROP_REASONER_CONFIG_PATH?.trim() || path.join(process.cwd(), 'config', 'local-ai-models.json');
  const modelConfig = readExternalReasonerModelConfig(configPath);
  const endpoint = process.env.MINI_DROP_REASONER_ENDPOINT?.trim() || modelConfig?.url?.trim() || null;

  return {
    endpoint,
    apiKey: process.env.MINI_DROP_REASONER_API_KEY?.trim() || modelConfig?.apiKey?.trim() || null,
    model: process.env.MINI_DROP_REASONER_MODEL?.trim() || modelConfig?.id?.trim() || null,
    timeoutMs: Number(process.env.MINI_DROP_REASONER_TIMEOUT_MS || 12000),
    protocol: endpoint?.includes('/chat/completions') ? 'openai-chat' : 'mini-drop',
    configPath: modelConfig ? configPath : null,
  };
}

function buildExternalHeaders(config: ExternalReasonerConfig) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeExternalReasonerOutput(input: ReasonerInput, payload: unknown): ReasonerOutput {
  const chatCompletionPayload = extractOpenAIReasonerPayload(payload);
  if (chatCompletionPayload) {
    return normalizeExternalReasonerCandidate(input, chatCompletionPayload);
  }

  if (!payload || typeof payload !== 'object') {
    return buildExternalUnavailableOutput(input, '外部 reasoner 返回的 payload 不是合法 JSON 对象。');
  }

  return normalizeExternalReasonerCandidate(input, payload);
}

function normalizeExternalReasonerCandidate(input: ReasonerInput, payload: unknown): ReasonerOutput {
  if (!payload || typeof payload !== 'object') {
    return buildExternalUnavailableOutput(input, '外部 reasoner 返回的 payload 不是合法 JSON 对象。');
  }

  const candidate = payload as Partial<{
    summary: unknown;
    findings: unknown;
    citations: unknown;
    toolCalls: unknown;
  }>;

  const requestedToolCalls = normalizeToolCalls(candidate.toolCalls);
  const toolInvocations: ReasonerToolInvocation[] = [...input.toolContext];
  for (const call of requestedToolCalls) {
    toolInvocations.push(runToolCallOrReject(input, call.name, call.args));
  }

  const citations = Array.isArray(candidate.citations)
    ? candidate.citations.filter((item): item is string => typeof item === 'string')
    : [];
  const validation = validateCitationsWithDetails(citations, input);
  const validationInvocation = runTool('validate_citations', input, {
    citations,
  }).invocation;
  toolInvocations.push(validationInvocation);

  const findings = Array.isArray(candidate.findings)
    ? candidate.findings
        .map((item) => normalizeExternalFinding(item, input))
        .filter((item): item is ReasonerFinding => item !== null)
    : [];
  const verifiedFindings = findings.filter((item) => item.status === 'verified');
  const rejectedToolCount = toolInvocations.filter((item) => item.status === 'rejected').length;
  const summary =
    typeof candidate.summary === 'string' && candidate.summary.trim().length > 0
      ? candidate.summary.trim()
      : null;
  const fallbackReasons: string[] = [];

  if (rejectedToolCount > 0) {
    fallbackReasons.push(`拒绝了 ${rejectedToolCount} 个未声明工具请求。`);
  }
  if (validation.rejected.length > 0) {
    fallbackReasons.push(`过滤了 ${validation.rejected.length} 个无法映射回证据包的 citation。`);
  }
  if (!summary) {
    fallbackReasons.push('外部 reasoner 没有返回基于证据的摘要。');
  }
  if (verifiedFindings.length === 0 && validation.accepted.length === 0) {
    fallbackReasons.push('外部 reasoner 没有返回可验证的结论，已自动降级为安全摘要。');
  }

  if (verifiedFindings.length === 0 && validation.accepted.length === 0) {
    return buildExternalUnavailableOutput(
      input,
      fallbackReasons.join(' '),
      {
        toolInvocations,
        rejectedCitationDetails: validation.rejected,
        findings,
      },
    );
  }

  const effectiveSummary = summary ?? buildGroundedSummaryFromFindings(verifiedFindings, input);

  return {
    mode: 'external',
    summary: effectiveSummary,
    findings,
    citations: validation.accepted,
    rejectedCitations: validation.rejected.map((item) => item.citation),
    rejectedCitationDetails: validation.rejected,
    toolInvocations,
    generatedAt: new Date().toISOString(),
    guardrailStatus: 'enforced',
    fallbackReason: fallbackReasons.length > 0 ? fallbackReasons.join(' ') : null,
  };
}

function normalizeExternalFinding(candidate: unknown, input: ReasonerInput): ReasonerFinding | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const finding = candidate as Partial<ReasonerFinding>;
  if (typeof finding.title !== 'string' || typeof finding.detail !== 'string') {
    return null;
  }

  const citations = Array.isArray(finding.citations)
    ? finding.citations.filter((item): item is string => typeof item === 'string')
    : [];
  const validation = validateCitationsWithDetails(citations, input);

  return {
    title: finding.title,
    detail: finding.detail,
    citations: validation.accepted,
    status: validation.accepted.length > 0 ? 'verified' : 'context-only',
  };
}

function buildExternalUnavailableOutput(
  input: ReasonerInput,
  detail: string,
  options?: {
    toolInvocations?: ReasonerToolInvocation[];
    rejectedCitationDetails?: ReasonerRejectedCitation[];
    findings?: ReasonerFinding[];
  },
): ReasonerOutput {
  const safeDetail = detail.trim().length > 0 ? detail.trim() : '外部 reasoner 未返回可验证内容。';
  return {
    mode: 'external',
    summary: `当前已配置外部 reasoner，但这次只拿到了不可验证或不完整的结果。${safeDetail}`,
    findings:
      options?.findings && options.findings.length > 0
        ? options.findings.map((item) => ({
            ...item,
            citations: [],
            status: 'context-only',
          }))
        : [
            {
              title: '外部 reasoner 已安全降级',
              detail: `外部适配层已保留 ${input.evidence.length} 条证据供离线复核，但本次没有足够依据发布已验证结论。`,
              citations: [],
              status: 'context-only',
            },
          ],
    citations: [],
    rejectedCitations: options?.rejectedCitationDetails?.map((item) => item.citation) ?? [],
    rejectedCitationDetails: options?.rejectedCitationDetails ?? [],
    toolInvocations: options?.toolInvocations ?? input.toolContext,
    generatedAt: new Date().toISOString(),
    guardrailStatus: 'enforced',
    fallbackReason: safeDetail,
  };
}

function buildGroundedSummaryFromFindings(findings: ReasonerFinding[], input: ReasonerInput) {
  const primaryFinding = findings.find((item) => item.status === 'verified');
  if (primaryFinding) {
    return primaryFinding.detail;
  }

  return `当前保留了 ${input.evidence.length} 条证据，但外部 reasoner 没有返回可直接发布的基于证据摘要。`;
}

export function filterEvidenceCitations(citations: string[], input: Pick<ReasonerInput, 'evidence'>) {
  return citations.filter((citation) => input.evidence.some((item) => item.id === citation));
}

function validateCitationsWithDetails(citations: string[], input: Pick<ReasonerInput, 'evidence'>): {
  accepted: string[];
  rejected: ReasonerRejectedCitation[];
} {
  const accepted: string[] = [];
  const rejected: ReasonerRejectedCitation[] = [];

  for (const citation of citations) {
    if (input.evidence.some((item) => item.id === citation)) {
      accepted.push(citation);
      continue;
    }
    rejected.push({
      citation,
      reason: 'Citation does not map to the retained evidence bundle.',
    });
  }

  return { accepted, rejected };
}

function buildExternalRequestBody(config: ExternalReasonerConfig, input: ReasonerInput) {
  if (config.protocol === 'openai-chat') {
    return {
      model: config.model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            '你是 Mini-Drop 的 evidence-only reasoner。',
            '你只能根据给定 evidence id 和 availableTools 输出结论，不能虚构热点、源码位置、指标或根因。',
            '你不能请求 availableTools 之外的工具。',
            '请始终返回 JSON 对象，格式为 {"summary": string, "findings": [{"title": string, "detail": string, "citations": string[]}], "citations": string[], "toolCalls": [{"name": string, "args": object}] }。',
            'citations 里的值必须来自输入 evidence 的 id；如果证据不足，就明确说明，并返回空 citations。',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify(input),
        },
      ],
    };
  }

  return {
    model: config.model,
    input,
  };
}

function extractOpenAIReasonerPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Partial<{
    choices: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  }>;
  const firstChoice = Array.isArray(candidate.choices) ? candidate.choices[0] : null;
  const rawContent = firstChoice?.message?.content;
  const content = Array.isArray(rawContent)
    ? rawContent
        .map((item) => (item && typeof item === 'object' && typeof item.text === 'string' ? item.text : ''))
        .join('')
        .trim()
    : typeof rawContent === 'string'
      ? rawContent.trim()
      : '';

  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    return {
      summary: content,
      findings: [],
      citations: [],
      toolCalls: [],
    };
  }
}

function normalizeToolCalls(candidate: unknown): Array<{ name: string; args?: Record<string, unknown> }> {
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .filter((item): item is { name?: unknown; args?: unknown } => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : '',
      args: item.args && typeof item.args === 'object' ? (item.args as Record<string, unknown>) : undefined,
    }))
    .filter((item) => item.name.length > 0);
}

function runToolCallOrReject(
  input: ReasonerInput,
  toolName: string,
  args?: Record<string, unknown>,
): ReasonerToolInvocation {
  if (!isSupportedToolName(toolName)) {
    const invocation: ReasonerToolInvocation = {
      id: randomUUID(),
      tool: 'validate_citations',
      status: 'rejected',
      requestSummary: `unsupported-tool=${toolName}`,
      responseSummary: 'tool request rejected',
      evidenceIds: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: `Unsupported tool request: ${toolName}`,
    };
    return invocation;
  }

  return runTool(toolName, input, args).invocation;
}

function runTool(
  name: ReasonerToolName,
  input: ReasonerInput,
  args?: Record<string, unknown>,
): { invocation: ReasonerToolInvocation; evidenceIds: string[] } {
  const registry = getToolRegistryMap();
  const tool = registry.get(name);
  if (!tool) {
    const invocation: ReasonerToolInvocation = {
      id: randomUUID(),
      tool: name,
      status: 'rejected',
      requestSummary: `tool=${name}`,
      responseSummary: 'tool definition missing',
      evidenceIds: [],
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: 'Tool definition missing.',
    };
    return {
      invocation,
      evidenceIds: [],
    };
  }

  const result = tool.invoke(input, args);
  result.invocation.evidenceIds = result.evidenceIds;
  return result;
}

function getToolRegistryMap() {
  const registry = buildReasonerToolRegistry();
  return new Map<ReasonerToolName, ReasonerToolRegistryEntry>(
    registry.map((entry) => [entry.name, entry]),
  );
}

function isSupportedToolName(value: string): value is ReasonerToolName {
  return buildReasonerToolRegistry().some((entry) => entry.name === value);
}

function readExternalReasonerModelConfig(configPath: string): ExternalReasonerModelConfig | null {
  try {
    const raw = requireJsonFile<ExternalReasonerModelRegistry>(configPath);
    if (!raw || !Array.isArray(raw.models)) {
      return null;
    }
    return raw.models.find((item) => typeof item?.id === 'string' && item.id.trim().length > 0) ?? null;
  } catch {
    return null;
  }
}

function requireJsonFile<T>(filePath: string): T | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function comparisonVerdictLabel(verdict: NonNullable<ReasonerTaskShape['baselineComparison']>['verdict']) {
  switch (verdict) {
    case 'regression':
      return '回退';
    case 'improvement':
      return '改善';
    case 'mixed':
      return '混合';
    default:
      return '持平';
  }
}

function targetTypeLabel(targetType: ReasonerTaskShape['targetContext']['targetType']) {
  switch (targetType) {
    case 'pid':
      return '指定 PID';
    case 'process':
      return '选择进程';
    default:
      return '逻辑目标';
  }
}

function attachSourceLabel(source: ReasonerTaskShape['targetContext']['attachSource']) {
  switch (source) {
    case 'external-pid':
      return '外部 PID attach';
    case 'process-selection':
      return '进程列表 attach';
    case 'managed-fallback':
      return 'managed workload fallback';
    default:
      return 'managed workload';
  }
}
