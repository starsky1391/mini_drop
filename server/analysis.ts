import { randomUUID } from 'node:crypto';
import { getCollector, getScenario } from '../shared/catalog.js';
import type { CollectorOutcome } from './collectors/types.js';
import type {
  TaskAttachSource,
  TaskComparison,
  TaskCreateInput,
  TaskDetail,
  TaskTargetContext,
  TaskSummary,
} from '../shared/types.js';
import { buildAnalysisNarrative, buildQueuedTimeline } from './analysis/narrative.js';
import { normalizeCollectorOutcome } from './analysis/normalize.js';

function nowIso() {
  return new Date().toISOString();
}

function buildSummary(input: TaskCreateInput): TaskSummary {
  const scenario = getScenario(input.scenario);
  const collector = getCollector(input.collector);
  const createdAt = nowIso();

  return {
    id: randomUUID(),
    title: `${scenario.displayNameZh ?? scenario.name} · ${input.target}`,
    target: input.target,
    targetContext: buildTargetContext(input),
    language: input.language,
    collector: collector.id,
    collectorName: collector.displayNameZh ?? collector.name,
    scenario: scenario.id,
    scenarioName: scenario.displayNameZh ?? scenario.name,
    status: 'PENDING',
    statusReason: '任务已经创建，正在等待执行资源。',
    uploadState: 'not_started',
    progress: 8,
    createdAt,
    updatedAt: createdAt,
    signal: scenario.signalZh ?? scenario.signal,
  };
}

function buildTargetContext(input: TaskCreateInput): TaskTargetContext {
  const targetType = input.targetType ?? 'label';
  const attachSource =
    input.attachSource ??
    (targetType === 'pid'
      ? ('external-pid' satisfies TaskAttachSource)
      : targetType === 'process'
        ? ('process-selection' satisfies TaskAttachSource)
        : ('managed-workload' satisfies TaskAttachSource));

  return {
    targetType,
    attachSource,
    processInfo: input.processInfo ?? null,
    attachDecision:
      attachSource === 'managed-workload'
        ? '任务将按 managed workload 路径准备采样。'
        : `任务会优先尝试直接 attach 到 PID ${input.processInfo?.pid ?? input.pid ?? 'unknown'}。`,
  };
}

export function createQueuedTask(input: TaskCreateInput): TaskDetail {
  const scenario = getScenario(input.scenario);
  const summary = buildSummary(input);

  return {
    ...summary,
    reportTitle: `${scenario.displayNameZh ?? scenario.name} 诊断`,
    reportSummary: '等待真实采集结果。',
    primaryFinding: scenario.primaryFinding,
    confidence: scenario.confidence,
    metrics: { cpu: 0, blocked: 0, gc: 0, syscalls: 0 },
    timeline: buildQueuedTimeline(scenario.signalZh ?? scenario.signal),
    findings: [],
    topFunctions: scenario.topFunctions,
    flameGraph: scenario.flameGraph,
    sampleCount: 0,
    sampleSource: 'pending',
    artifacts: [],
    collectorLogs: [],
    analysisSummary: '任务已经入队，正在等待真实采样结果。',
    trendSummary: '首轮运行完成后，这里会出现趋势分析。',
    insights: [],
    baselineComparison: null,
  };
}

export function createTaskDetail(input: TaskCreateInput): TaskDetail {
  const scenario = getScenario(input.scenario);
  const queued = createQueuedTask(input);
  const outcome: CollectorOutcome = {
    status: 'UPLOADING',
    progress: 72,
    artifacts: [],
    sample: {
      sampleCount: 240,
      topFunctions: scenario.topFunctions,
      metrics: {
        cpu: scenario.cpu,
        blocked: scenario.blocked,
        gc: scenario.gc,
        syscalls: scenario.syscalls,
      },
      summary: scenario.summary,
      rawSignal: scenario.id === 'python_hot_loop' ? 'python-stack-sampling' : 'native-stack-sampling',
      workloadReportPath: '',
    },
    report: {
      scenario: input.scenario,
      collector: input.collector,
      target: input.target,
      title: scenario.displayNameZh ?? scenario.name,
      durationMs: 8000,
      result: 1,
      metrics: {
        cpu: scenario.cpu,
        blocked: scenario.blocked,
        gc: scenario.gc,
        syscalls: scenario.syscalls,
      },
      topFunctions: scenario.topFunctions,
      summary: scenario.summary,
    },
    logs: ['已为兼容旧调用方生成 synthetic 任务样本。'],
  };

  return finalizeTask(queued, outcome, null);
}

export function finalizeTask(
  task: TaskDetail,
  outcome: CollectorOutcome,
  baselineComparison: TaskComparison | null,
): TaskDetail {
  const run = normalizeCollectorOutcome(task, outcome);
  const narrative = buildAnalysisNarrative({
    task,
    outcome,
    comparison: baselineComparison,
    run,
  });

  return {
    ...task,
    status: 'DONE',
    statusReason: '采样、上传和分析已经完成。',
    uploadState: 'uploaded',
    progress: 100,
    updatedAt: nowIso(),
    reportTitle: `${run.title} 诊断`,
    reportSummary: run.summary,
    primaryFinding: narrative.primaryFinding,
    confidence: narrative.confidence,
    metrics: run.metrics,
    timeline: narrative.timeline,
    findings: narrative.findings,
    topFunctions: run.hotspots.map((hotspot) => ({
      name: hotspot.name,
      percent: hotspot.percent,
      module: hotspot.module,
      locationSummary: formatHotspotLocation(hotspot.frame),
      file: hotspot.frame.file,
      line: hotspot.frame.line,
      mappingState: hotspot.frame.mappingState,
      mappingSource: hotspot.frame.mappingSource,
      sourceHint: hotspot.frame.sourceHint,
      representativeStack: hotspot.representativeStack.map((frame) => formatHotspotLocation(frame)),
    })),
    flameGraph: narrative.flameGraph,
    sampleCount: run.sampleCount,
    sampleSource: run.sampleSource,
    artifacts: outcome.artifacts,
    collectorLogs: outcome.logs,
    analysisSummary: narrative.analysisSummary,
    trendSummary: narrative.trendSummary,
    insights: narrative.insights,
    baselineComparison,
  };
}

export function summarizeContinuousSlice(task: Pick<TaskDetail, 'target' | 'collector' | 'scenario' | 'sampleCount' | 'status' | 'topFunctions'>) {
  const hotspot = task.topFunctions[0];
  return `${task.target} · ${task.collector} · ${task.scenario} 在 ${task.status} 状态下保留了 ${task.sampleCount} 个样本，主热点为 ${hotspot?.name ?? 'unknown'}。`;
}

function formatHotspotLocation(frame: {
  module: string;
  file: string;
  line: number | null;
  sourceHint: string;
  mappingState: string;
}) {
  if (frame.mappingState === 'full') {
    return `${frame.file}:${frame.line}`;
  }
  if (frame.mappingState === 'file-only') {
    return `${frame.file}（没有行号）`;
  }
  if (frame.mappingState === 'module-only') {
    return `${frame.module}（仅模块级）`;
  }
  if (frame.mappingState === 'synthetic') {
    return `${frame.module}（synthetic fallback）`;
  }
  return `${frame.sourceHint || frame.module}（未映射）`;
}
