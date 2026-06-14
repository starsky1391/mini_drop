import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ExternalReasonerConfig,
  ExternalReasonerModelConfig,
  ExternalReasonerModelRegistry,
  ReasonerClient,
  ReasonerEvidenceItem,
  ReasonerFinding,
  ReasonerInput,
  ReasonerOutput,
  ReasonerSnapshot,
  ReasonerTaskShape,
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

  return {
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
    ],
  };
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

function buildDisabledReasonerOutput(input: ReasonerInput): ReasonerOutput {
  return {
    mode: 'disabled',
    summary: `LLM reasoner 当前已禁用，本次先保留了 ${input.evidence.length} 条证据，供后续基于证据的归因使用。`,
    findings: [],
    citations: [],
    rejectedCitations: [],
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
  const findings = [
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
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    mode: 'stub',
    summary:
      findings[0]?.detail ??
      '当前保留的证据包还不足以支持更强的基于证据摘要。',
    findings: findings.map((item) => ({
      ...item,
      citations: filterEvidenceCitations(item.citations, input),
    })),
    citations: filterEvidenceCitations(findings.flatMap((item) => item.citations), input),
    rejectedCitations: [],
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
  }>;
  const citations = Array.isArray(candidate.citations)
    ? candidate.citations.filter((item): item is string => typeof item === 'string')
    : [];
  const filteredCitations = filterEvidenceCitations(citations, input);
  const findings = Array.isArray(candidate.findings)
    ? candidate.findings
        .map((item) => normalizeExternalFinding(item))
        .filter((item): item is ReasonerFinding => item !== null)
        .map((item) => ({
          ...item,
          citations: filterEvidenceCitations(item.citations, input),
        }))
        .filter((item) => item.citations.length > 0)
    : [];

  return {
    mode: 'external',
    summary:
      typeof candidate.summary === 'string' && candidate.summary.trim().length > 0
        ? candidate.summary.trim()
        : '外部 reasoner 没有返回基于证据的摘要，因此当前只保留证据包。',
    findings,
    citations: filteredCitations,
    rejectedCitations: citations.filter((citation) => !filteredCitations.includes(citation)),
    generatedAt: new Date().toISOString(),
    guardrailStatus: 'enforced',
    fallbackReason:
      typeof candidate.summary === 'string' && candidate.summary.trim().length > 0
        ? null
        : '外部 reasoner 没有返回基于证据的摘要。',
  };
}

function normalizeExternalFinding(candidate: unknown): ReasonerFinding | null {
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const finding = candidate as Partial<ReasonerFinding>;
  if (typeof finding.title !== 'string' || typeof finding.detail !== 'string' || !Array.isArray(finding.citations)) {
    return null;
  }

  return {
    title: finding.title,
    detail: finding.detail,
    citations: finding.citations.filter((item): item is string => typeof item === 'string'),
  };
}

function buildExternalUnavailableOutput(input: ReasonerInput, detail: string): ReasonerOutput {
  return {
    mode: 'external',
    summary: `当前已配置外部 reasoner，但这次 API 调用没能产出基于证据的摘要。${detail}`,
    findings: [
      {
        title: '外部 reasoner 不可用',
        detail: `外部适配层已安全降级，并保留了 ${input.evidence.length} 条证据供离线复核。`,
        citations: [],
      },
    ],
    citations: [],
    rejectedCitations: [],
    generatedAt: new Date().toISOString(),
    guardrailStatus: 'enforced',
    fallbackReason: detail,
  };
}

export function filterEvidenceCitations(citations: string[], input: Pick<ReasonerInput, 'evidence'>) {
  return citations.filter((citation) => input.evidence.some((item) => item.id === citation));
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
            '你只能根据给定 evidence id 输出结论，不能虚构热点、源码位置、指标或根因。',
            '请始终返回 JSON 对象，格式为 {"summary": string, "findings": [{"title": string, "detail": string, "citations": string[]}], "citations": string[]}。',
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
    };
  }
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
