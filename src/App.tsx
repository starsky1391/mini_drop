import { useEffect, useMemo, useState } from 'react';
import type {
  AgentListResponse,
  AgentSummary,
  ArtifactPreviewResponse,
  CatalogResponse,
  CollectorRuntimeReadiness,
  CollectorInfo,
  ContinuousProfileWindowResponse,
  ProcessListResponse,
  ScenarioDefinition,
  TaskArtifact,
  TaskArtifactsResponse,
  TaskAuditEvent,
  TaskAuditResponse,
  TaskComparison,
  TaskCreateInput,
  TaskDetail,
  TaskReasonerResponse,
  TaskReasonerSnapshot,
  TaskProcessContextSummary,
  TaskRunStateResponse,
  TaskSymbolizationSummary,
  TaskTrendsResponse,
  TaskSummary,
  FlameGraphViewState,
  FlameNode,
} from '../shared/types';
import {
  buildFlameGraphRows,
  findFlameNodeByPath,
  flameNodeTooltip,
  maxFlameDepth,
  searchFlameGraph,
  truncateFlameLabel,
} from './flamegraph-utils';
import {
  attachSourceLabel,
  collectorDisplayName,
  displayReportTitle,
  displayTaskTitle,
  formatProcessSummary,
  localizeLegacyText,
  normalizeDetailTabSelection,
  scenarioDisplayName,
  scenarioSignalLabel,
  targetTypeLabel,
  visibleDetailTabs,
  type DetailTabId,
} from './ui-model';

type TasksResponse = {
  tasks: TaskDetail[];
};

type ComparisonResponse = {
  comparison: TaskComparison;
};

type AgentsResponse = AgentListResponse;
type ContinuousProfileResponse = ContinuousProfileWindowResponse;

type HotspotMovement = {
  name: string;
  module: string;
  before: number;
  after: number;
  delta: number;
  tone: 'improved' | 'regressed' | 'flat' | 'new';
  summary: string;
  beforeLocation: string;
  afterLocation: string;
  beforeMappingState: TaskDetail['topFunctions'][number]['mappingState'];
  afterMappingState: TaskDetail['topFunctions'][number]['mappingState'];
};

type LocalTrendPoint = {
  taskId: string;
  title: string;
  updatedAt: string;
  status: TaskSummary['status'];
  sampleCount: number;
  confidence: number;
  totalPressure: number;
  pressureDelta: number | null;
  verdictToPrevious: TaskComparison['verdict'] | 'initial';
  metrics: TaskDetail['metrics'];
  topHotspot: string | null;
  topHotspotPercent: number | null;
  topHotspotLocationSummary: string | null;
  topHotspotMappingState?: TaskDetail['topFunctions'][number]['mappingState'];
  processContext: TaskProcessContextSummary;
  summary: string;
  driverLabel: string | null;
  driverEvidence: string | null;
};

type LocalMetricTrendPoint = {
  taskId: string;
  updatedAt: string;
  value: number;
  delta: number | null;
  trend: 'regressed' | 'improved' | 'flat' | 'initial';
};

type LocalTaskMetricSeries = {
  metric: keyof TaskDetail['metrics'];
  label: string;
  points: LocalMetricTrendPoint[];
};

type LocalTaskHotspotChange = {
  baselineId: string;
  currentId: string;
  updatedAt: string;
  verdict: TaskComparison['verdict'];
  pressureDelta: number;
  kind: TaskComparison['hotspotShift']['kind'];
  driverLabel: string | null;
  driverEvidence: string | null;
  baselineHotspot: TaskComparison['hotspotShift']['baselineTop'];
  currentHotspot: TaskComparison['hotspotShift']['currentTop'];
  summary: string;
};

type LocalTrendBundle = {
  taskId: string;
  scope: {
    target: string;
    collector: TaskDetail['collector'];
    scenario: TaskDetail['scenario'];
  };
  summary: string;
  points: LocalTrendPoint[];
  metricSeries: LocalTaskMetricSeries[];
  hotspotChanges: LocalTaskHotspotChange[];
};

type EvidenceCitation = {
  label: string;
  evidence: string;
};

type ReasonerView =
  | {
      source: 'snapshot';
      title: string;
      summary: string;
      modeLabel: string;
      bullets: string[];
      citations: EvidenceCitation[];
      guardrails: string[];
      generatedAt: string;
      rejectedCitations: string[];
      fallbackReason: string | null;
    }
  | {
      source: 'draft';
      title: string;
      summary: string;
      modeLabel: string;
      bullets: string[];
      citations: EvidenceCitation[];
      guardrails: string[];
      generatedAt: string | null;
      rejectedCitations: string[];
      fallbackReason: string | null;
    };

const defaultForm: TaskCreateInput = {
  target: 'orders-api@node-3',
  language: 'Go',
  collector: 'perf',
  scenario: 'cpu_hot',
  targetType: 'label',
  attachSource: 'managed-workload',
  processInfo: null,
};

const detailTabStorageKey = 'mini-drop.detail-tab';
const detailCollapsedStorageKey = 'mini-drop.detail-collapsed';
const taskFlowCollapsedStorageKey = 'mini-drop.task-flow-collapsed';
const launchPanelCollapsedStorageKey = 'mini-drop.launch-panel-collapsed';
const notesPanelCollapsedStorageKey = 'mini-drop.notes-panel-collapsed';

const statusOrder: Record<TaskSummary['status'], number> = {
  PENDING: 0,
  RUNNING: 1,
  UPLOADING: 2,
  DONE: 3,
  FAILED: 4,
};

function localizeTaskForUi(task: TaskDetail): TaskDetail {
  return {
    ...task,
    title: displayTaskTitle(task.title, task.scenario, task.target),
    collectorName: collectorDisplayName(task.collector, task.collectorName),
    scenarioName: scenarioDisplayName(task.scenario, task.scenarioName),
    signal: scenarioSignalLabel(task.scenario, task.signal),
    reportTitle: displayReportTitle(task.reportTitle, task.scenario),
    reportSummary: localizeLegacyText(task.reportSummary),
    primaryFinding: localizeLegacyText(task.primaryFinding),
    analysisSummary: localizeLegacyText(task.analysisSummary),
    trendSummary: localizeLegacyText(task.trendSummary),
    findings: task.findings.map((finding) => ({
      ...finding,
      title: localizeLegacyText(finding.title),
      evidence: localizeLegacyText(finding.evidence),
      recommendation: localizeLegacyText(finding.recommendation),
    })),
    insights: task.insights.map((insight) => ({
      ...insight,
      title: localizeLegacyText(insight.title),
      evidence: localizeLegacyText(insight.evidence),
      attribution: localizeLegacyText(insight.attribution),
    })),
    topFunctions: task.topFunctions.map((fn) => ({
      ...fn,
      locationSummary: fn.locationSummary ? localizeLegacyText(fn.locationSummary) : fn.locationSummary,
      sourceHint: fn.sourceHint ? localizeLegacyText(fn.sourceHint) : fn.sourceHint,
      representativeStack: (fn.representativeStack ?? []).map((entry) => localizeLegacyText(entry)),
    })),
    collectorLogs: task.collectorLogs.map((line) => localizeLegacyText(line)),
  };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-HK', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatAuditType(value: TaskAuditEvent['type']) {
  return value.replaceAll('.', ' ');
}

function statusLabel(status: TaskSummary['status']) {
  switch (status) {
    case 'PENDING':
      return '排队中';
    case 'RUNNING':
      return '运行中';
    case 'UPLOADING':
      return '上传中';
    case 'DONE':
      return '已完成';
    case 'FAILED':
      return '失败';
    default:
      return status;
  }
}

function statusTone(status: TaskSummary['status']) {
  switch (status) {
    case 'DONE':
      return 'green';
    case 'RUNNING':
      return 'cyan';
    case 'UPLOADING':
      return 'amber';
    case 'FAILED':
      return 'rose';
    default:
      return 'slate';
  }
}

function agentStatusLabel(agent: AgentSummary) {
  if (agent.status === 'offline') {
    return '离线';
  }
  if (agent.heartbeatState === 'stale') {
    return '心跳变慢';
  }
  return '在线';
}

function agentStatusTone(agent: AgentSummary) {
  if (agent.status === 'offline') {
    return 'rose';
  }
  if (agent.heartbeatState === 'stale') {
    return 'amber';
  }
  return 'green';
}

function verdictTone(verdict: TaskComparison['verdict'] | 'neutral') {
  switch (verdict) {
    case 'regression':
      return 'rose';
    case 'improvement':
      return 'green';
    case 'mixed':
      return 'amber';
    default:
      return 'slate';
  }
}

function artifactTone(kind: TaskArtifact['kind']) {
  switch (kind) {
    case 'speedscope':
      return 'cyan';
    case 'collapsed-stacks':
      return 'amber';
    case 'report':
      return 'green';
    case 'log':
      return 'rose';
    default:
      return 'slate';
  }
}

function readinessTone(readiness: CollectorRuntimeReadiness['readiness'] | null | undefined) {
  switch (readiness) {
    case 'preferred':
      return 'green';
    case 'partial-real':
      return 'amber';
    case 'fallback-only':
      return 'rose';
    case 'deferred-for-linux-proof':
      return 'purple';
    default:
      return 'slate';
  }
}

function collectorPathTone(
  mode: NonNullable<TaskArtifactsResponse['resultIndex']['provenance']>['mode'] | null | undefined,
) {
  switch (mode) {
    case 'real':
      return 'green';
    case 'partial-real':
      return 'amber';
    case 'fallback':
      return 'rose';
    default:
      return 'slate';
  }
}

function mappingTone(state: TaskDetail['topFunctions'][number]['mappingState']) {
  switch (state) {
    case 'full':
      return 'green';
    case 'file-only':
    case 'module-only':
      return 'amber';
    case 'synthetic':
      return 'rose';
    default:
      return 'slate';
  }
}

function mappingLabel(state: TaskDetail['topFunctions'][number]['mappingState']) {
  switch (state) {
    case 'full':
      return '文件 + 行号';
    case 'file-only':
      return '仅文件';
    case 'module-only':
      return '仅模块';
    case 'synthetic':
      return 'Synthetic';
    default:
      return '未映射';
  }
}

function hotspotLocationSummary(
  hotspot:
    | {
        module?: string | null;
        locationSummary?: string | null;
      }
    | null
    | undefined,
) {
  return hotspot?.locationSummary ? localizeLegacyText(hotspot.locationSummary) : hotspot?.module ?? '没有保留可读位置';
}

function hotspotMappingStateLabel(state: TaskDetail['topFunctions'][number]['mappingState']) {
  return mappingLabel(state);
}

function summarizeTargetContext(targetContext: TaskDetail['targetContext']): TaskProcessContextSummary {
  const processSummary = formatProcessSummary(targetContext.processInfo);
  return {
    targetType: targetContext.targetType,
    attachSource: targetContext.attachSource,
    processInfo: targetContext.processInfo,
    summary: `${targetTypeLabel(targetContext.targetType)} · ${attachSourceLabel(targetContext.attachSource)} · ${processSummary}`,
  };
}

function describeArtifact(artifact: TaskArtifact) {
  switch (artifact.kind) {
    case 'speedscope':
      return '已保留可供 speedscope 风格查看的交互式栈画像，等产物服务链路接稳后可直接联动查看。';
    case 'collapsed-stacks':
      return '已折叠栈格式，适合继续生成火焰图或做聚合校验。';
    case 'report':
      return '这是分析层生成指标、热点和诊断结论时使用的标准化采集报告。';
    case 'log':
      return '采集器或执行链路日志，方便审计、追踪和排障。';
    default:
      return '已保留原始采集输出，便于后续离线解析与人工复核。';
  }
}

function artifactPreviewLabel(artifact: TaskArtifact) {
  switch (artifact.kind) {
    case 'speedscope':
      return '在画像查看器中打开';
    case 'collapsed-stacks':
      return '查看 collapsed stack 文本';
    case 'report':
      return '查看标准化报告';
    case 'log':
      return '查看执行日志';
    default:
      return '查看原始采集输出';
  }
}

function evidenceAnchorId(citationLabel: string) {
  const normalized = citationLabel.trim();
  if (
    /^(metric|hotspot|finding|artifact)-/.test(normalized) ||
    normalized === 'comparison-baseline' ||
    normalized === 'timeline-latest' ||
    normalized === 'lifecycle-status' ||
    normalized === 'target-context' ||
    normalized === 'provenance-path' ||
    normalized === 'symbolization-state' ||
    normalized === 'trend-latest-driver'
  ) {
    return `evidence-${normalized}`;
  }
  return null;
}

function evidenceSurfaceLabel(citationLabel: string) {
  if (citationLabel.startsWith('metric-')) {
    return '指标条';
  }
  if (citationLabel.startsWith('hotspot-')) {
    return '热点表';
  }
  if (citationLabel.startsWith('finding-')) {
    return '结论卡片';
  }
  if (citationLabel.startsWith('artifact-')) {
    return '产物面板';
  }
  if (citationLabel === 'comparison-baseline') {
    return '对比面板';
  }
  if (citationLabel === 'timeline-latest') {
    return '时间线';
  }
  if (citationLabel === 'lifecycle-status' || citationLabel === 'target-context' || citationLabel === 'provenance-path') {
    return '运行摘要';
  }
  if (citationLabel === 'symbolization-state') {
    return '符号化摘要';
  }
  if (citationLabel === 'trend-latest-driver') {
    return '趋势驱动';
  }
  return '证据包';
}

function pathTail(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.slice(-3).join(' / ');
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function sameComparisonScope(left: TaskDetail, right: TaskDetail) {
  return left.target === right.target && left.collector === right.collector && left.scenario === right.scenario;
}

function pressureTone(value: number) {
  if (value >= 70) {
    return 'rose';
  }
  if (value >= 55) {
    return 'amber';
  }
  return 'green';
}

function trendDeltaLabel(value: number | null) {
  if (value === null) {
    return '起点';
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}

function pressureScore(metrics: TaskDetail['metrics']) {
  return metrics.cpu * 0.45 + metrics.blocked * 0.3 + metrics.gc * 0.2 + metrics.syscalls * 0.05;
}

function describePressureDelta(delta: number) {
  if (delta >= 4) {
    return 'regression';
  }
  if (delta <= -4) {
    return 'improvement';
  }
  return 'neutral';
}

function verdictLabel(verdict: TaskComparison['verdict'] | 'neutral' | 'initial') {
  switch (verdict) {
    case 'regression':
      return '回退';
    case 'improvement':
      return '改善';
    case 'mixed':
      return '混合';
    case 'initial':
      return '起点';
    default:
      return '持平';
  }
}

function severityLabel(severity: TaskDetail['findings'][number]['severity']) {
  switch (severity) {
    case 'high':
      return '高';
    case 'medium':
      return '中';
    default:
      return '提示';
  }
}

function readinessLabel(readiness: CollectorRuntimeReadiness['readiness'] | null | undefined) {
  switch (readiness) {
    case 'preferred':
      return '首选';
    case 'partial-real':
      return '部分真实';
    case 'fallback-only':
      return '仅 fallback';
    case 'deferred-for-linux-proof':
      return 'Linux 证明延期';
    default:
      return '未知';
  }
}

function provenanceModeLabel(
  mode: NonNullable<TaskArtifactsResponse['resultIndex']['provenance']>['mode'] | null | undefined,
) {
  switch (mode) {
    case 'real':
      return '真实采样';
    case 'partial-real':
      return '部分真实';
    case 'fallback':
      return 'Fallback';
    default:
      return '未知';
  }
}

function symbolizationStatusLabel(status: TaskSymbolizationSummary['status'] | null | undefined) {
  switch (status) {
    case 'full':
      return '完整';
    case 'partial':
      return '部分';
    case 'fallback':
      return 'Fallback';
    default:
      return '未知';
  }
}

function runStageLabel(value: string | null | undefined) {
  switch (value) {
    case 'PENDING':
    case 'queued':
      return '排队中';
    case 'RUNNING':
    case 'running':
      return '运行中';
    case 'UPLOADING':
    case 'analyzing':
      return '上传中';
    case 'prepare':
      return '准备中';
    case 'collecting':
      return '采集中';
    case 'finalizing':
      return '收尾中';
    case 'FAILED':
    case 'failed':
    case 'error':
      return '失败';
    case 'DONE':
    case 'complete':
    case 'done':
      return '已完成';
    default:
      return localizeLegacyText(value ?? '未知');
  }
}

function continuousSliceTone(status: ContinuousProfileWindowResponse['window']['slices'][number]['status']) {
  switch (status) {
    case 'ready':
      return 'green';
    case 'failed':
      return 'rose';
    default:
      return 'amber';
  }
}

function continuousSliceLabel(status: ContinuousProfileWindowResponse['window']['slices'][number]['status']) {
  switch (status) {
    case 'ready':
      return '已就绪';
    case 'failed':
      return '失败';
    default:
      return '部分';
  }
}

function metricTrend(delta: number | null) {
  if (delta === null) {
    return 'initial' as const;
  }
  if (delta >= 3) {
    return 'regressed' as const;
  }
  if (delta <= -3) {
    return 'improved' as const;
  }
  return 'flat' as const;
}

function earliestFirst(left: { updatedAt: string }, right: { updatedAt: string }) {
  return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
}

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function describeHotspotShift(previous: TaskDetail, current: TaskDetail) {
  const before = previous.topFunctions[0];
  const after = current.topFunctions[0];
  if (!before && !after) {
    return '两次运行都没有保留可排序的主热点。';
  }
  if (!before && after) {
    return `${after.name} 在较新的运行中第一次成为主热点。`;
  }
  if (before && !after) {
    return `${before.name} 从较新的热点列表中消失了。`;
  }
  if (before?.name === after?.name) {
    const delta = (after?.percent ?? 0) - (before?.percent ?? 0);
    if (delta >= 3) {
      return `${after?.name ?? '该热点'} 的采样占比扩大了 ${formatPercent(delta)}。`;
    }
    if (delta <= -3) {
      return `${after?.name ?? '该热点'} 的采样占比下降了 ${formatPercent(Math.abs(delta))}。`;
    }
    return `${after?.name ?? '该热点'} 在两次运行之间基本持平。`;
  }
  return `主热点从 ${before?.name ?? 'n/a'} 切换到 ${after?.name ?? 'n/a'}。`;
}

function buildLocalTrendBundle(selectedTask: TaskDetail | null, scopedTasks: TaskDetail[]) {
  if (!selectedTask) {
    return null;
  }

  const sorted = [...scopedTasks].sort(earliestFirst);
  const points: LocalTrendPoint[] = sorted.map((task, index) => {
    const previous = sorted[index - 1];
    const totalPressure = Number(pressureScore(task.metrics).toFixed(1));
    const previousPressure = previous ? Number(pressureScore(previous.metrics).toFixed(1)) : null;
    const pressureDelta = previousPressure === null ? null : Number((totalPressure - previousPressure).toFixed(1));
    const topHotspot = task.topFunctions[0] ?? null;
    const summary =
      previous === undefined
        ? '这是当前本地历史序列中的第一条可比运行。'
        : describeHotspotShift(previous, task);

    return {
      taskId: task.id,
      title: task.title,
      updatedAt: task.updatedAt,
      status: task.status,
      sampleCount: task.sampleCount,
      confidence: task.confidence,
      totalPressure,
      pressureDelta,
      verdictToPrevious:
        pressureDelta === null ? 'initial' : (describePressureDelta(pressureDelta) as TaskComparison['verdict']),
      metrics: task.metrics,
      topHotspot: topHotspot?.name ?? null,
      topHotspotPercent: topHotspot?.percent ?? null,
      topHotspotLocationSummary: hotspotLocationSummary(topHotspot),
      topHotspotMappingState: topHotspot?.mappingState,
      processContext: summarizeTargetContext(task.targetContext),
      summary,
      driverLabel: null,
      driverEvidence: null,
    };
  });

  const metricSeries: LocalTaskMetricSeries[] = (['cpu', 'blocked', 'gc', 'syscalls'] as const).map((metric) => ({
    metric,
    label:
      metric === 'cpu'
        ? 'CPU 压力'
        : metric === 'blocked'
          ? '阻塞时间'
          : metric === 'gc'
            ? 'GC 压力'
            : 'Syscall 占比',
    points: sorted.map((task, index) => {
      const previous = sorted[index - 1];
      const value = task.metrics[metric];
      const delta = previous ? Number((value - previous.metrics[metric]).toFixed(1)) : null;
      return {
        taskId: task.id,
        updatedAt: task.updatedAt,
        value,
        delta,
        trend: metricTrend(delta),
      };
    }),
  }));

  const hotspotChanges: LocalTaskHotspotChange[] = sorted.slice(1).map((task, index) => {
    const previous = sorted[index]!;
    const currentPressure = Number(pressureScore(task.metrics).toFixed(1));
    const previousPressure = Number(pressureScore(previous.metrics).toFixed(1));
    const pressureDelta = Number((currentPressure - previousPressure).toFixed(1));

    return {
      baselineId: previous.id,
      currentId: task.id,
      updatedAt: task.updatedAt,
      verdict: describePressureDelta(pressureDelta) as TaskComparison['verdict'],
      pressureDelta,
      kind: pressureDelta >= 4 ? 'intensified' : pressureDelta <= -4 ? 'cooled' : 'stable',
      driverLabel: null,
      driverEvidence: null,
      baselineHotspot: previous.topFunctions[0]
        ? {
            name: previous.topFunctions[0].name,
            module: previous.topFunctions[0].module,
            percent: previous.topFunctions[0].percent,
            rank: 1,
            locationSummary: previous.topFunctions[0].locationSummary,
            mappingState: previous.topFunctions[0].mappingState,
          }
        : null,
      currentHotspot: task.topFunctions[0]
        ? {
            name: task.topFunctions[0].name,
            module: task.topFunctions[0].module,
            percent: task.topFunctions[0].percent,
            rank: 1,
            locationSummary: task.topFunctions[0].locationSummary,
            mappingState: task.topFunctions[0].mappingState,
          }
        : null,
      summary: describeHotspotShift(previous, task),
    };
  });

  const summary =
    sorted.length > 1
      ? `当前基于任务列表推导出 ${sorted.length} 次可比较运行，最新综合压力为 ${points.at(-1)?.totalPressure.toFixed(1)}。`
      : '当前只有一次本地运行，因此历史序列会从单条任务开始展示。';

  return {
    taskId: selectedTask.id,
    scope: {
      target: selectedTask.target,
      collector: selectedTask.collector,
      scenario: selectedTask.scenario,
    },
    summary,
    points,
    metricSeries,
    hotspotChanges,
  } satisfies LocalTrendBundle;
}

function deriveHotspotMovements(current: TaskDetail | null, baseline: TaskDetail | null) {
  if (!current || !baseline) {
    return [] as HotspotMovement[];
  }

  const currentMap = new Map(current.topFunctions.map((item) => [item.name, item]));
  const baselineMap = new Map(baseline.topFunctions.map((item) => [item.name, item]));
  const names = Array.from(new Set([...baseline.topFunctions.slice(0, 4).map((item) => item.name), ...current.topFunctions.slice(0, 4).map((item) => item.name)]));

  return names
    .map((name) => {
      const beforeHotspot = baselineMap.get(name);
      const afterHotspot = currentMap.get(name);
      const before = beforeHotspot?.percent ?? 0;
      const after = afterHotspot?.percent ?? 0;
      const delta = Number((after - before).toFixed(1));
      const beforeLocation = hotspotLocationSummary(beforeHotspot);
      const afterLocation = hotspotLocationSummary(afterHotspot);
      let tone: HotspotMovement['tone'] = 'flat';
      let summary = '该热点在两次运行中的占比基本持平。';

      if (before === 0 && after > 0) {
        tone = 'new';
        summary = `新热点出现在 ${afterLocation}，当前占据 ${formatPercent(after)} 的采样时间。`;
      } else if (after === 0 && before > 0) {
        tone = 'improved';
        summary = `原先位于 ${beforeLocation}、占比 ${formatPercent(before)} 的热点已经从当前主栈中消失。`;
      } else if (beforeHotspot?.locationSummary && afterHotspot?.locationSummary && beforeHotspot.locationSummary !== afterHotspot.locationSummary) {
        tone = delta >= 0 ? 'regressed' : 'improved';
        summary = `${name} 仍然存在，但位置从 ${beforeLocation} 移动到了 ${afterLocation}。`;
      } else if (delta >= 3) {
        tone = 'regressed';
        summary = `热点扩大了 ${formatPercent(Math.abs(delta))}，现在在 ${afterLocation} 占据 ${formatPercent(after)}。`;
      } else if (delta <= -3) {
        tone = 'improved';
        summary = `热点回落了 ${formatPercent(Math.abs(delta))}，现在在 ${afterLocation} 占据 ${formatPercent(after)}。`;
      }

      return {
        name,
        module: afterHotspot?.module ?? beforeHotspot?.module ?? 'unknown',
        before,
        after,
        delta,
        tone,
        summary,
        beforeLocation,
        afterLocation,
        beforeMappingState: beforeHotspot?.mappingState,
        afterMappingState: afterHotspot?.mappingState,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function buildReasonerDraft(task: TaskDetail, comparison: TaskComparison | null, baselineTask: TaskDetail | null) {
  const dominant = task.topFunctions[0];
  const worstMetric = [...comparison?.metricDeltas ?? []]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  const citations: EvidenceCitation[] = [
    {
      label: '热点证据',
      evidence: dominant
        ? `${dominant.name} 位于 ${dominant.module}，占据 ${dominant.percent}% 的采样时间${dominant.locationSummary ? `，位置为 ${dominant.locationSummary}` : ''}。`
        : '当前没有可用的主热点。'
    },
    {
      label: '运行时压力',
      evidence: `CPU ${task.metrics.cpu}%，blocked ${task.metrics.blocked}%，GC ${task.metrics.gc}%，syscalls ${task.metrics.syscalls}%。`,
    },
    {
      label: '样本来源',
      evidence: `共采到 ${task.sampleCount} 个样本，来源为 ${task.sampleSource}。`,
    },
  ];

  if (comparison && baselineTask) {
    citations.push({
      label: '基线差异',
      evidence: `${comparison.summary} ${comparison.changedHotspot}`,
    });
  }

  if (task.artifacts[0]) {
    citations.push({
      label: '产物轨迹',
      evidence: `${task.artifacts[0].label} 已保存在 ${pathTail(task.artifacts[0].path)}。`,
    });
  }

  const bullets = [
    task.reportSummary,
    comparison?.summary ?? task.trendSummary,
    task.findings[0]?.recommendation ?? '建议以下一次验证任务继续复核当前保留的证据与产物。',
  ].filter(Boolean);

  const emphasis = worstMetric
    ? `${worstMetric.label} 在两次运行之间变化了 ${formatPercent(Math.abs(worstMetric.delta))}。`
    : '当前没有可用的基线指标漂移，因此摘要只锚定单次运行证据。';

  return {
    title: 'LLM 诊断预览',
    summary: `${localizeLegacyText(task.primaryFinding)} ${localizeLegacyText(emphasis)}`,
    bullets,
    citations,
  };
}

function buildReasonerView(
  snapshot: TaskReasonerSnapshot | null,
  draft: ReturnType<typeof buildReasonerDraft> | null,
): ReasonerView | null {
  if (snapshot) {
    const evidenceMap = new Map(snapshot.input.evidence.map((item) => [item.id, item.detail]));
    return {
      source: 'snapshot',
      title: 'Reasoner 快照',
      summary: localizeLegacyText(snapshot.output.summary),
      modeLabel:
        snapshot.output.mode === 'stub'
          ? '证据约束 stub'
          : snapshot.output.mode === 'external'
            ? '外部 API reasoner'
            : 'Reasoner 已禁用',
      bullets:
        snapshot.output.findings.length > 0
          ? snapshot.output.findings.map((finding) => `${localizeLegacyText(finding.title)}: ${localizeLegacyText(finding.detail)}`)
          : ['这次运行没有产出额外模型结论。'],
      citations:
        snapshot.output.citations.length > 0
          ? snapshot.output.citations.map((citation) => ({
              label: citation,
              evidence: localizeLegacyText(evidenceMap.get(citation) ?? '该引用目标不在当前 snapshot 证据包中。'),
            }))
          : snapshot.input.evidence.slice(0, 4).map((item) => ({ label: item.label, evidence: localizeLegacyText(item.detail) })),
      guardrails: snapshot.input.guardrails.map((guardrail) => localizeLegacyText(guardrail)),
      generatedAt: snapshot.output.generatedAt,
      rejectedCitations: snapshot.output.rejectedCitations,
      fallbackReason: snapshot.output.fallbackReason ? localizeLegacyText(snapshot.output.fallbackReason) : null,
    };
  }

  if (!draft) {
    return null;
  }

  return {
    source: 'draft',
    title: draft.title,
    summary: draft.summary,
    modeLabel: '规则预览',
    bullets: draft.bullets,
    citations: draft.citations,
    guardrails: ['当前正在等待持久化 reasoner snapshot 或真实模型响应。'],
    generatedAt: null,
    rejectedCitations: [],
    fallbackReason: null,
  };
}

function taskStateMessage(task: TaskDetail, latestAudit: TaskAuditEvent | null) {
  switch (task.status) {
    case 'FAILED':
      return localizeLegacyText(task.statusReason || latestAudit?.detail || '任务在形成完整诊断前失败了。');
    case 'DONE':
      return localizeLegacyText(task.statusReason || latestAudit?.message || '本次运行已完成，证据包已经可以复核。');
    case 'UPLOADING':
      return localizeLegacyText(task.statusReason || '采样结果正在落盘、上传或转换为可分析产物。');
    case 'RUNNING':
      return localizeLegacyText(task.statusReason || '当前 workload 仍在运行，采集器也还在持续保留证据与产物。');
    default:
      return localizeLegacyText(task.statusReason || '任务已进入队列，正在等待执行资源。');
  }
}

function prettyPreview(response: ArtifactPreviewResponse | null) {
  if (!response?.preview.content) {
    return null;
  }

  if (response.preview.mode === 'json') {
    try {
      return JSON.stringify(JSON.parse(response.preview.content), null, 2);
    } catch {
      return response.preview.content;
    }
  }

  return response.preview.content;
}

function FlameGraph({ root }: { root: FlameNode }) {
  const [viewState, setViewState] = useState<FlameGraphViewState>({
    focusPath: null,
    searchTerm: '',
    collapsed: false,
  });

  useEffect(() => {
    setViewState({
      focusPath: null,
      searchTerm: '',
      collapsed: false,
    });
  }, [root]);

  const rows = useMemo(() => buildFlameGraphRows(root, viewState), [root, viewState]);
  const focusedNode = useMemo(
    () => (viewState.focusPath ? findFlameNodeByPath(root, viewState.focusPath)?.node ?? root : root),
    [root, viewState.focusPath],
  );
  const matches = useMemo(
    () => searchFlameGraph(root, viewState.searchTerm, viewState.focusPath),
    [root, viewState.focusPath, viewState.searchTerm],
  );
  const matchPaths = useMemo(() => new Set(matches.map((match) => match.path)), [matches]);
  const height = (maxFlameDepth(focusedNode) + 1) * 42 + 12;
  const total = Math.max(1, focusedNode.value || root.value);
  const focusLabel = focusedNode.hidden ? '全图' : focusedNode.name;
  const focusLocation =
    focusedNode.locationSummary ?? focusedNode.module ?? (focusedNode.hidden ? '当前展示的是整张火焰图。' : '没有保留额外位置信息。');

  return (
    <div className="flamegraph-shell">
      <div className="flamegraph-toolbar">
        <label className="flamegraph-search">
          <span>搜索 frame</span>
          <input
            value={viewState.searchTerm}
            placeholder="函数名 / 模块 / 文件位置"
            onChange={(event) =>
              setViewState((current) => ({
                ...current,
                searchTerm: event.target.value,
              }))
            }
          />
        </label>

        <div className="flamegraph-actions">
          <button
            type="button"
            className="detail-toggle"
            onClick={() =>
              setViewState({
                focusPath: null,
                searchTerm: '',
                collapsed: false,
              })
            }
            disabled={!viewState.focusPath && viewState.searchTerm.length === 0}
          >
            重置缩放
          </button>
        </div>
      </div>

      <div className="flamegraph-summary">
        <article className="surface-summary-card">
          <span>当前焦点</span>
          <strong>{focusLabel}</strong>
          <small>{focusLocation}</small>
        </article>
        <article className="surface-summary-card">
          <span>当前宽度</span>
          <strong>{((focusedNode.value / Math.max(1, root.value)) * 100).toFixed(1)}%</strong>
          <small>当前视图共覆盖 {focusedNode.value} 个样本单位。</small>
        </article>
        <article className="surface-summary-card">
          <span>搜索结果</span>
          <strong>{viewState.searchTerm ? matches.length : rows.length}</strong>
          <small>{viewState.searchTerm ? '已高亮当前视图内的匹配 frame。' : '点击任意 bar 可以放大到该调用子树。'}</small>
        </article>
      </div>

      {viewState.searchTerm ? (
        matches.length > 0 ? (
          <div className="flamegraph-match-list">
            {matches.slice(0, 6).map((match) => (
              <button
                key={match.path}
                type="button"
                className="flamegraph-match"
                onClick={() =>
                  setViewState((current) => ({
                    ...current,
                    focusPath: match.path,
                  }))
                }
              >
                <strong>{match.node.name}</strong>
                <small>{match.node.locationSummary ?? match.node.module ?? '没有保留可读位置'}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="inline-banner">当前焦点范围内没有匹配到该关键字。</div>
        )
      ) : null}

      <svg className="flamegraph" viewBox={`0 0 1000 ${height}`} role="img" aria-label="Performance flame graph">
        {rows.map(({ node, depth, x, width, path }) => {
          const barY = height - (depth + 1) * 42;
          const fill = node.color ?? 'var(--frame-muted)';
          const label = truncateFlameLabel(node.name, width);
          const isFocused = viewState.focusPath === path;
          const isMatched = matchPaths.has(path);
          const opacity =
            viewState.searchTerm.length > 0 ? (isMatched ? 0.98 : 0.24) : isFocused ? 1 : depth === 0 ? 0.95 : 0.92;
          return (
            <g
              key={path}
              className={`flame-node${isFocused ? ' flame-node-focused' : ''}${isMatched ? ' flame-node-matched' : ''}`}
              onClick={() =>
                setViewState((current) => ({
                  ...current,
                  focusPath: path,
                }))
              }
            >
              <title>{flameNodeTooltip(node, total)}</title>
              <rect
                x={x}
                y={barY}
                width={width}
                height={34}
                rx={3}
                fill={fill}
                opacity={opacity}
              />
              {label ? (
                <text x={x + 10} y={barY + 21} className="flame-label">
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StatCard({
  panelId,
  label,
  value,
  hint,
  tone,
}: {
  panelId?: string;
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <article id={panelId} className={`stat-card stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function App() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [tasks, setTasks] = useState<TaskDetail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<TaskComparison | null>(null);
  const [artifactBundle, setArtifactBundle] = useState<TaskArtifactsResponse | null>(null);
  const [auditBundle, setAuditBundle] = useState<TaskAuditResponse | null>(null);
  const [reasonerBundle, setReasonerBundle] = useState<TaskReasonerResponse | null>(null);
  const [trendBundle, setTrendBundle] = useState<TaskTrendsResponse | null>(null);
  const [continuousProfileBundle, setContinuousProfileBundle] = useState<ContinuousProfileResponse | null>(null);
  const [runStateBundle, setRunStateBundle] = useState<TaskRunStateResponse | null>(null);
  const [sidecarLoading, setSidecarLoading] = useState(false);
  const [sidecarError, setSidecarError] = useState<string | null>(null);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewResponse | null>(null);
  const [artifactPreviewLoading, setArtifactPreviewLoading] = useState(false);
  const [artifactPreviewError, setArtifactPreviewError] = useState<string | null>(null);
  const [form, setForm] = useState<TaskCreateInput>(defaultForm);
  const [localProcesses, setLocalProcesses] = useState<ProcessListResponse['processes']>([]);
  const [detailTab, setDetailTab] = useState<DetailTabId>(() => {
    if (typeof window === 'undefined') {
      return 'compare';
    }
    return normalizeDetailTabSelection(window.localStorage.getItem(detailTabStorageKey) as DetailTabId | null, true);
  });
  const [detailCollapsed, setDetailCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(detailCollapsedStorageKey) === '1';
  });
  const [taskFlowCollapsed, setTaskFlowCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(taskFlowCollapsedStorageKey) === '1';
  });
  const [launchPanelCollapsed, setLaunchPanelCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(launchPanelCollapsedStorageKey) === '1';
  });
  const [notesPanelCollapsed, setNotesPanelCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return true;
    }
    return window.localStorage.getItem(notesPanelCollapsedStorageKey) !== '0';
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continuousScope, setContinuousScope] = useState<'task' | 'history'>('history');
  const [continuousLimit, setContinuousLimit] = useState<number>(6);
  const [selectedContinuousSliceId, setSelectedContinuousSliceId] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function loadAll() {
      try {
        const [catalogRes, tasksRes, processRes, agentRes] = await Promise.all([
          fetch('/api/catalog'),
          fetch('/api/tasks'),
          fetch('/api/processes'),
          fetch('/api/agents'),
        ]);
        const nextCatalog = (await catalogRes.json()) as CatalogResponse;
        const nextTasks = (await tasksRes.json()) as TasksResponse;
        const nextProcesses = processRes.ok ? ((await processRes.json()) as ProcessListResponse).processes : [];
        const nextAgents = agentRes.ok ? ((await agentRes.json()) as AgentsResponse).agents : [];
        const localizedTasks = nextTasks.tasks.map(localizeTaskForUi);
        if (ignore) return;
        setCatalog(nextCatalog);
        setAgents(nextAgents);
        setLocalProcesses(nextProcesses);
        setTasks(localizedTasks.sort((a, b) => statusOrder[b.status] - statusOrder[a.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
        setSelectedId((current) => current ?? localizedTasks[0]?.id ?? null);
        setBaselineId((current) => current ?? localizedTasks[1]?.id ?? localizedTasks[0]?.id ?? null);
        setLoading(false);
      } catch (fetchError) {
        if (!ignore) {
          setError(fetchError instanceof Error ? fetchError.message : '加载 Mini-Drop 失败');
          setLoading(false);
        }
      }
    }

    loadAll();
    const timer = window.setInterval(loadAll, 2000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!catalog) {
      return;
    }

    const compatible = catalog.collectors.filter((collector) => collector.languageCoverage.includes(form.language));
    if (compatible.length > 0 && !compatible.some((collector) => collector.id === form.collector)) {
      setForm((current) => ({ ...current, collector: compatible[0].id }));
    }
  }, [catalog, form.collector, form.language]);

  useEffect(() => {
    let ignore = false;

    async function loadComparison() {
      if (!selectedId || !baselineId || selectedId === baselineId) {
        setComparison(null);
        return;
      }

      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(selectedId)}/compare/${encodeURIComponent(baselineId)}`);
        if (!response.ok) {
          setComparison(null);
          return;
        }
        const data = (await response.json()) as ComparisonResponse;
        if (!ignore) {
          setComparison(data.comparison);
        }
      } catch {
        if (!ignore) {
          setComparison(null);
        }
      }
    }

    loadComparison();
    return () => {
      ignore = true;
    };
  }, [baselineId, selectedId, tasks]);

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null;
  const comparableTasks = useMemo(
    () =>
      selectedTask
        ? tasks
            .filter((task) => task.id !== selectedTask.id && sameComparisonScope(task, selectedTask))
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        : [],
    [selectedTask, tasks],
  );
  const baselineTask = tasks.find((task) => task.id === baselineId) ?? comparableTasks[0] ?? null;
  const scopedHistoryTasks = useMemo(
    () =>
      selectedTask
        ? [...comparableTasks, selectedTask]
            .filter((task, index, all) => all.findIndex((candidate) => candidate.id === task.id) === index)
            .sort(earliestFirst)
        : [],
    [comparableTasks, selectedTask],
  );

  useEffect(() => {
    if (!selectedTask) {
      return;
    }

    setBaselineId((current) => {
      if (current && comparableTasks.some((task) => task.id === current)) {
        return current;
      }
      return comparableTasks[0]?.id ?? null;
    });
  }, [comparableTasks, selectedTask]);

  useEffect(() => {
    let ignore = false;

    async function loadSelectedTaskSidecars() {
      if (!selectedTask) {
        setArtifactBundle(null);
        setAuditBundle(null);
        setReasonerBundle(null);
        setTrendBundle(null);
        setContinuousProfileBundle(null);
        setRunStateBundle(null);
        return;
      }

      setSidecarLoading(true);
      setSidecarError(null);

      try {
        const [artifactsRes, auditRes, reasonerRes, trendsRes, continuousRes, runStateRes] = await Promise.all([
          fetch(`/api/tasks/${encodeURIComponent(selectedTask.id)}/artifacts`),
          fetch(`/api/tasks/${encodeURIComponent(selectedTask.id)}/audit`),
          fetch(`/api/tasks/${encodeURIComponent(selectedTask.id)}/reasoner`),
          fetch(`/api/tasks/${encodeURIComponent(selectedTask.id)}/trends`),
          fetch(
            `/api/tasks/${encodeURIComponent(selectedTask.id)}/continuous-profile?scope=${continuousScope}&limit=${continuousLimit}`,
          ),
          fetch(`/api/tasks/${encodeURIComponent(selectedTask.id)}/run-state`),
        ]);

        const [artifactsData, auditData, reasonerData, trendsData, continuousData, runStateData] = await Promise.all([
          artifactsRes.ok ? ((await artifactsRes.json()) as TaskArtifactsResponse) : null,
          auditRes.ok ? ((await auditRes.json()) as TaskAuditResponse) : null,
          reasonerRes.ok ? ((await reasonerRes.json()) as TaskReasonerResponse) : null,
          trendsRes.ok ? ((await trendsRes.json()) as TaskTrendsResponse) : null,
          continuousRes.ok ? ((await continuousRes.json()) as ContinuousProfileResponse) : null,
          runStateRes.ok ? ((await runStateRes.json()) as TaskRunStateResponse) : null,
        ]);

        if (ignore) {
          return;
        }

        setArtifactBundle(artifactsData);
        setAuditBundle(auditData);
        setReasonerBundle(reasonerData);
        setTrendBundle(trendsData);
        setContinuousProfileBundle(continuousData);
        setRunStateBundle(runStateData);
      } catch (fetchError) {
        if (!ignore) {
          setSidecarError(fetchError instanceof Error ? fetchError.message : '加载任务侧边数据失败');
        }
      } finally {
        if (!ignore) {
          setSidecarLoading(false);
        }
      }
    }

    void loadSelectedTaskSidecars();

    return () => {
      ignore = true;
    };
  }, [continuousLimit, continuousScope, selectedTask?.id, selectedTask?.updatedAt]);

  const activeArtifacts = artifactBundle?.artifacts ?? selectedTask?.artifacts ?? [];
  const continuousSlices = continuousProfileBundle?.window.slices ?? [];
  const selectedContinuousSlice =
    continuousSlices.find((slice) => slice.id === selectedContinuousSliceId) ?? continuousSlices.at(-1) ?? null;

  useEffect(() => {
    setSelectedArtifactPath(activeArtifacts[0]?.path ?? null);
  }, [selectedTask?.id, activeArtifacts]);

  useEffect(() => {
    setSelectedContinuousSliceId(continuousSlices.at(-1)?.id ?? null);
  }, [continuousProfileBundle?.taskId, continuousSlices.length]);

  useEffect(() => {
    let ignore = false;

    async function loadPreview() {
      if (!selectedTask || !selectedArtifactPath) {
        setArtifactPreview(null);
        setArtifactPreviewError(null);
        return;
      }

      setArtifactPreviewLoading(true);
      setArtifactPreviewError(null);

      try {
        const response = await fetch(
          `/api/tasks/${encodeURIComponent(selectedTask.id)}/artifacts/content?path=${encodeURIComponent(selectedArtifactPath)}`,
        );
        if (!response.ok) {
          const body = (await response.json()) as { message?: string };
          throw new Error(body.message ?? '加载产物预览失败');
        }

        const data = (await response.json()) as ArtifactPreviewResponse;
        if (!ignore) {
          setArtifactPreview(data);
        }
      } catch (previewError) {
        if (!ignore) {
          setArtifactPreview(null);
          setArtifactPreviewError(previewError instanceof Error ? previewError.message : '加载产物预览失败');
        }
      } finally {
        if (!ignore) {
          setArtifactPreviewLoading(false);
        }
      }
    }

    void loadPreview();
    return () => {
      ignore = true;
    };
  }, [selectedArtifactPath, selectedTask?.id]);

  const activeTasks = tasks.filter((task) => task.status === 'RUNNING' || task.status === 'PENDING' || task.status === 'UPLOADING').length;
  const doneTasks = tasks.filter((task) => task.status === 'DONE').length;
  const avgConfidence = tasks.length
    ? Math.round((tasks.reduce((sum, task) => sum + task.confidence, 0) / tasks.length) * 100)
    : 0;

  const compatibleCollectors = useMemo(
    () => catalog?.collectors.filter((collector) => collector.languageCoverage.includes(form.language)) ?? [],
    [catalog, form.language],
  );
  const targetTypeOptions = catalog?.targetTypes ?? [
    { id: 'label' as const, label: '逻辑目标', description: '按当前 managed workload 路径运行。' },
    { id: 'pid' as const, label: '指定 PID', description: '手动输入 PID，优先直接 attach。' },
    { id: 'process' as const, label: '选择进程', description: '从本机进程列表选择。' },
  ];
  const selectedProcessPid = form.processInfo?.pid ?? form.pid ?? undefined;

  const hotspotMovements = useMemo(
    () => deriveHotspotMovements(selectedTask, baselineTask),
    [baselineTask, selectedTask],
  );

  const reasonerDraft = useMemo(
    () => (selectedTask ? buildReasonerDraft(selectedTask, comparison, baselineTask) : null),
    [baselineTask, comparison, selectedTask],
  );

  const selectedArtifact = activeArtifacts.find((artifact) => artifact.path === selectedArtifactPath) ?? activeArtifacts[0] ?? null;
  const latestAudit = auditBundle?.auditEvents[0] ?? null;
  const collectorReadiness =
    (selectedTask
      ? runStateBundle?.probeSummary?.find((entry) => entry.collector === selectedTask.collector) ??
        catalog?.collectorReadiness.find((entry) => entry.collector === selectedTask.collector)
      : null) ?? null;
  const runStage = runStateBundle?.activeRun?.stage ?? runStateBundle?.lastCollectorStage ?? selectedTask?.status ?? 'PENDING';
  const resultProvenance = artifactBundle?.resultIndex.provenance ?? null;
  const symbolizationSummary = artifactBundle?.resultIndex.symbolization ?? null;
  const historyBundle = useMemo(
    () => trendBundle ?? buildLocalTrendBundle(selectedTask, scopedHistoryTasks),
    [scopedHistoryTasks, selectedTask, trendBundle],
  );
  const historyMode = trendBundle ? '持久化趋势模型' : '基于已加载任务推导';
  const auditSummary = useMemo(() => {
    const events = auditBundle?.auditEvents ?? [];
    return {
      total: events.length,
      warning: events.filter((event) => event.severity === 'warning').length,
      error: events.filter((event) => event.severity === 'error').length,
    };
  }, [auditBundle]);
  const selectedHistoryPoint = historyBundle?.points.find((point) => point.taskId === selectedTask?.id) ?? null;
  const comparisonWarnings = comparison?.compatibility.warnings ?? [];
  const historyWarnings = trendBundle?.historySummary.compatibilityWarnings ?? comparisonWarnings;
  const baselineLabel = baselineTask
    ? `${baselineTask.collectorName} • ${formatCompactDate(baselineTask.updatedAt)} • ${baselineTask.sampleCount} 个样本`
    : '请从下方候选列表中选择一条可比较运行。';
  const reasonerView = useMemo(
    () => buildReasonerView(reasonerBundle?.snapshot ?? null, reasonerDraft),
    [reasonerBundle, reasonerDraft],
  );
  const availableDetailTabs = useMemo(() => visibleDetailTabs(Boolean(reasonerView)), [reasonerView]);
  const artifactPreviewText = useMemo(() => prettyPreview(artifactPreview), [artifactPreview]);

  useEffect(() => {
    const normalized = normalizeDetailTabSelection(detailTab, Boolean(reasonerView));
    if (normalized !== detailTab) {
      setDetailTab(normalized);
    }
  }, [detailTab, reasonerView]);

  useEffect(() => {
    window.localStorage.setItem(detailTabStorageKey, detailTab);
  }, [detailTab]);

  useEffect(() => {
    window.localStorage.setItem(detailCollapsedStorageKey, detailCollapsed ? '1' : '0');
  }, [detailCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(taskFlowCollapsedStorageKey, taskFlowCollapsed ? '1' : '0');
  }, [taskFlowCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(launchPanelCollapsedStorageKey, launchPanelCollapsed ? '1' : '0');
  }, [launchPanelCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(notesPanelCollapsedStorageKey, notesPanelCollapsed ? '1' : '0');
  }, [notesPanelCollapsed]);

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? '创建任务失败');
      }
      const data = (await response.json()) as { task: TaskDetail };
      const nextTask = localizeTaskForUi(data.task);
      setTasks((current) => [nextTask, ...current.filter((task) => task.id !== nextTask.id)]);
      setSelectedId(data.task.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '创建任务失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="shell booting">正在启动 Mini-Drop...</div>;
  }

  return (
    <div className="shell">
      <aside className="hero-panel">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Mini-Drop</p>
            <h1>把性能诊断压缩进一个本机可跑、证据清晰的控制台。</h1>
          </div>
          <div className="status-pill">本地诊断台</div>
        </div>

        <p className="lede">
          发起一次诊断任务，观察它经过排队、运行、分析与完成状态，并直接查看火焰图、热点变化和证据约束结论。
        </p>

        <div className="stat-grid">
          <StatCard label="活跃任务" value={String(activeTasks)} hint="排队中、运行中或分析中" tone="cyan" />
          <StatCard label="已完成" value={String(doneTasks)} hint="可直接复核结果" tone="green" />
          <StatCard label="平均置信度" value={`${avgConfidence}%`} hint="当前分析可信度" tone="amber" />
        </div>

        <section className="sidebar-section">
          <div className="section-head section-head-compact">
            <div>
              <h2>发起诊断</h2>
              <p className="section-subtitle">选择目标模式、语言、采集器和场景，开始一条新的证据链。</p>
            </div>
            <button
              type="button"
              className="section-toggle"
              onClick={() => setLaunchPanelCollapsed((current) => !current)}
              aria-expanded={!launchPanelCollapsed}
            >
              {launchPanelCollapsed ? '展开' : '收起'}
            </button>
          </div>

          {launchPanelCollapsed ? (
            <div className="collapsed-strip">
              <span>{targetTypeLabel(form.targetType ?? 'label')}</span>
              <strong>{form.target || '未填写目标'}</strong>
              <small>
                {form.language} · {collectorDisplayName(form.collector, form.collector)} · {scenarioDisplayName(form.scenario, form.scenario)}
              </small>
            </div>
          ) : (
            <form className="launch-form" onSubmit={submitTask}>
              <label>
                目标模式
                <select
                  value={form.targetType ?? 'label'}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      targetType: event.target.value as TaskCreateInput['targetType'],
                      pid: event.target.value === 'label' ? undefined : current.pid,
                      processInfo: event.target.value === 'label' ? null : current.processInfo ?? null,
                      attachSource:
                        event.target.value === 'pid'
                          ? 'external-pid'
                          : event.target.value === 'process'
                            ? 'process-selection'
                            : 'managed-workload',
                    }))
                  }
                >
                  {targetTypeOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                {form.targetType === 'label' ? '逻辑目标' : '逻辑目标（用于历史归组）'}
                <input
                  value={form.target}
                  onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
                  placeholder={form.targetType === 'label' ? 'orders-api@node-3' : '例如 checkout-api@local'}
                />
              </label>

              {form.targetType === 'pid' ? (
                <label>
                  PID
                  <input
                    value={form.pid ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        pid: event.target.value ? Number(event.target.value) : undefined,
                        processInfo: null,
                      }))
                    }
                    placeholder="12345"
                    inputMode="numeric"
                  />
                </label>
              ) : null}

              {form.targetType === 'process' ? (
                <label>
                  本机进程
                  <select
                    value={selectedProcessPid ?? ''}
                    onChange={(event) => {
                      const pid = Number(event.target.value);
                      const nextProcess = localProcesses.find((item) => item.pid === pid) ?? null;
                      setForm((current) => ({
                        ...current,
                        pid: Number.isFinite(pid) ? pid : undefined,
                        processInfo: nextProcess,
                        target: current.target || nextProcess?.name || current.target,
                      }));
                    }}
                  >
                    <option value="">请选择进程</option>
                    {localProcesses.map((processInfo) => (
                      <option key={processInfo.pid} value={processInfo.pid}>
                        {`PID ${processInfo.pid} • ${processInfo.name} • ${processInfo.commandSummary}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="form-row">
                <label>
                  语言
                  <select
                    value={form.language}
                    onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
                  >
                    <option>Go</option>
                    <option>Java</option>
                    <option>Python</option>
                    <option>C++</option>
                  </select>
                </label>

                <label>
                  采集器
                  <select
                    value={form.collector}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, collector: event.target.value as TaskCreateInput['collector'] }))
                    }
                  >
                    {catalog?.collectors.map((collector) => (
                      <option key={collector.id} value={collector.id}>
                        {collector.displayNameZh ?? collector.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                诊断场景
                <select
                  value={form.scenario}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, scenario: event.target.value as TaskCreateInput['scenario'] }))
                  }
                >
                  {catalog?.scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.displayNameZh ?? scenario.name}
                    </option>
                  ))}
                </select>
              </label>

              {form.targetType !== 'label' ? (
                <div className="compatibility-card">
                  <span>真实进程上下文</span>
                  <small>{formatProcessSummary(form.processInfo)}</small>
                </div>
              ) : null}

              <div className="compatibility-card">
                <span>兼容采集器</span>
                <div className="chip-row">
                  {compatibleCollectors.map((collector) => (
                    <span
                      key={collector.id}
                      className={`micro-chip ${collector.id === form.collector ? 'micro-chip-active' : ''}`}
                    >
                      {collector.displayNameZh ?? collector.name}
                    </span>
                  ))}
                  {compatibleCollectors.length === 0 ? <span className="micro-chip">当前语言没有完全匹配的采集器</span> : null}
                </div>
              </div>

              {catalog?.collectorReadiness?.length ? (
                <div className="collector-readiness-grid">
                  {catalog.collectorReadiness.map((entry) => {
                    const maturityInfo = catalog.collectors.find((c) => c.id === entry.collector);
                    return (
                      <article
                        key={entry.collector}
                        className={`readiness-card readiness-${readinessTone(entry.readiness)} ${form.collector === entry.collector ? 'readiness-active' : ''}`}
                      >
                        <div className="baseline-candidate-head">
                          <strong>{entry.collector}</strong>
                          <span className={`tone tone-${readinessTone(entry.readiness)}`}>{readinessLabel(entry.readiness)}</span>
                        </div>
                        <small>{localizeLegacyText(entry.detail)}</small>
                        {maturityInfo?.maturityNoteZh ? (
                          <small className="maturity-note">{maturityInfo.maturityNoteZh}</small>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}

              <button type="submit" disabled={submitting}>
                {submitting ? '发起中...' : '发起诊断'}
              </button>
            </form>
          )}
        </section>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className="notes-card sidebar-section">
          <div className="section-head section-head-compact">
            <h2>采集器说明</h2>
            <button
              type="button"
              className="section-toggle"
              onClick={() => setNotesPanelCollapsed((current) => !current)}
              aria-expanded={!notesPanelCollapsed}
            >
              {notesPanelCollapsed ? '展开' : '收起'}
            </button>
          </div>
          {notesPanelCollapsed ? (
            <p className="collapsed-caption">默认收起说明区，避免左侧面板过长；需要时再展开查看 collector 提示。</p>
          ) : (
            <ul>
              {catalog?.collectorNotes.map((note) => (
                <li key={note}>{localizeLegacyText(note)}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="notes-card sidebar-section">
          <div className="section-head section-head-compact">
            <h2>Agent 状态</h2>
            <span>{agents.length} 个</span>
          </div>
          {agents.length > 0 ? (
            <div className="agent-list">
              {agents.map((agent) => (
                <article key={agent.id} className="agent-card">
                  <div className="baseline-candidate-head">
                    <strong>{agent.label}</strong>
                    <span className={`tone tone-${agentStatusTone(agent)}`}>{agentStatusLabel(agent)}</span>
                  </div>
                  <p className="report-summary">
                    {agent.platform} / {agent.arch} · Node {agent.nodeVersion}
                  </p>
                  <div className="agent-meta-grid">
                    <div>
                      <span>心跳</span>
                      <strong>{formatTime(agent.lastHeartbeatAt)}</strong>
                    </div>
                    <div>
                      <span>活跃任务</span>
                      <strong>{agent.currentTaskId ? shortId(agent.currentTaskId) : '空闲'}</strong>
                    </div>
                    <div>
                      <span>采集器</span>
                      <strong>{agent.collectors.length}</strong>
                    </div>
                    <div>
                      <span>窗口</span>
                      <strong>{agent.staleAfterSeconds}s</strong>
                    </div>
                  </div>
                  <small className="report-summary">
                    {agent.notes.at(-1) ?? (agent.currentTaskId ? `当前正在处理 ${agent.currentTaskId}` : '当前没有登记中的活跃任务。')}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <p className="collapsed-caption">当前还没有独立 Agent 注册。此时系统会按配置继续使用本机 runner 或保持排队。</p>
          )}
        </section>
      </aside>

      <main className="workspace">
        <section className="section-block task-flow-shell">
          <div className="section-head section-head-compact">
            <div>
              <h2>任务流</h2>
              <p className="section-subtitle">当前共跟踪 {tasks.length} 条诊断任务</p>
            </div>
            <button
              type="button"
              className="section-toggle"
              onClick={() => setTaskFlowCollapsed((current) => !current)}
              aria-expanded={!taskFlowCollapsed}
            >
              {taskFlowCollapsed ? '展开任务流' : '折叠任务流'}
            </button>
          </div>

          {taskFlowCollapsed ? (
            <div className="collapsed-strip task-flow-collapsed">
              <span>当前选中</span>
              <strong>{selectedTask?.title ?? '还没有选中任务'}</strong>
              <small>
                {selectedTask
                  ? `${statusLabel(selectedTask.status)} · ${selectedTask.collectorName} · ${formatTime(selectedTask.updatedAt)}`
                  : '展开后可以切换任务、查看进度和更新时间。'}
              </small>
            </div>
          ) : tasks.length > 0 ? (
            <div className="task-list">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  className={`task-item ${task.id === selectedId ? 'selected' : ''}`}
                  onClick={() => setSelectedId(task.id)}
                >
                  <div className="task-topline">
                    <strong>{task.title}</strong>
                    <span className={`tone tone-${statusTone(task.status)}`}>{statusLabel(task.status)}</span>
                  </div>
                  <p>
                    {task.collectorName} • {task.scenarioName} • {task.language}
                  </p>
                  <div className="task-progress">
                    <span>进度</span>
                    <div className="progress-track">
                      <div className={`progress-fill tone-${statusTone(task.status)}`} style={{ width: `${task.progress}%` }} />
                    </div>
                    <strong>{task.progress}%</strong>
                  </div>
                  <div className="task-meta">
                    <span>{task.target}</span>
                    <span>{formatTime(task.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-panel">
              <strong>还没有任务</strong>
              <p>从左侧发起一次诊断后，这里会出现任务流、状态变化和完整证据链。</p>
            </div>
          )}
        </section>

        {selectedTask ? (
          <>
            <section className="section-block report-panel">
              <div className="section-head">
                <div>
                  <h2>{selectedTask.reportTitle}</h2>
                  <p className="section-subtitle">{selectedTask.primaryFinding}</p>
                </div>
                <div className="header-badges">
                  <span className={`tone tone-${statusTone(selectedTask.status)}`}>{statusLabel(selectedTask.status)}</span>
                  <span className="tone tone-green">{Math.round(selectedTask.confidence * 100)}% 置信度</span>
                </div>
              </div>

              <div className="summary-grid">
                <article className="summary-card">
                  <span>运行范围</span>
                  <strong>{selectedTask.collectorName}</strong>
                  <small>
                    {selectedTask.scenarioName} · {selectedTask.target}
                  </small>
                </article>
                <article className="summary-card">
                  <span>目标上下文</span>
                  <strong>{targetTypeLabel(selectedTask.targetContext.targetType)}</strong>
                  <small>{formatProcessSummary(selectedTask.targetContext.processInfo)}</small>
                </article>
                <article className="summary-card">
                  <span>样本来源</span>
                  <strong>{selectedTask.sampleSource}</strong>
                  <small>共保留 {selectedTask.sampleCount} 个样本</small>
                </article>
                <article className="summary-card">
                  <span>趋势结论</span>
                  <strong>{verdictLabel(selectedTask.baselineComparison?.verdict ?? 'neutral')}</strong>
                  <small>{selectedTask.trendSummary}</small>
                </article>
                <article className="summary-card">
                  <span>历史序列</span>
                  <strong>{historyBundle?.points.length ?? 1} 次</strong>
                  <small>{historyBundle ? localizeLegacyText(historyBundle.summary) : '当出现可比较历史后，这里会显示趋势摘要。'}</small>
                </article>
              </div>

              <div className={`state-banner state-${statusTone(selectedTask.status)}`}>
                <div>
                  <span className="preview-label">任务状态</span>
                  <strong>{taskStateMessage(selectedTask, latestAudit)}</strong>
                </div>
                <div className="state-banner-meta">
                  <span>进度 {selectedTask.progress}%</span>
                  <span>
                    {selectedTask.status === 'FAILED'
                      ? '建议先查看审计与产物，再重新发起同一范围任务做干净对比。'
                      : runStateBundle?.stopPending
                        ? '停止请求已提交；runner 正在清理并尽量保留已有证据。'
                        : '任务运行中时，卡片状态和证据面板会持续刷新。'}
                  </span>
                </div>
              </div>

              {sidecarError ? <div className="error-banner">{sidecarError}</div> : null}
              {sidecarLoading && !artifactBundle && !auditBundle && !reasonerBundle ? (
                <div className="inline-banner">正在刷新当前任务的运行态、产物、审计和诊断结论面板...</div>
              ) : null}

              <div className="surface-summary">
                <article id="evidence-lifecycle-status" className="surface-summary-card">
                  <span>Runner 阶段</span>
                  <strong>{runStageLabel(runStage)}</strong>
                  <small>
                    {runStateBundle?.activeRun
                      ? `最近更新于 ${formatTime(runStateBundle.activeRun.updatedAt)}，当前登记了 ${runStateBundle.activeRun.cleanupHookCount} 个 cleanup hook。`
                      : '当前没有保留可用的 managed runner 快照。'}
                  </small>
                </article>
                <article className="surface-summary-card">
                  <span>采集器就绪度</span>
                  <strong>{readinessLabel(collectorReadiness?.readiness)}</strong>
                  <small>
                    {collectorReadiness
                      ? `${collectorReadiness.collector} · supported=${collectorReadiness.supported} · available=${collectorReadiness.available}。`
                      : '只有保留了 runner 快照或 catalog probe 时，这里才会显示探测细节。'}
                  </small>
                </article>
                <article className="surface-summary-card">
                  <span>停止状态</span>
                  <strong>{runStateBundle?.stopPending ? '停止中' : '正常'}</strong>
                  <small>
                    {runStateBundle?.activeRun?.stopReason
                      ? runStateBundle.activeRun.stopReason
                      : '当前没有记录中的停止请求。'}
                  </small>
                </article>
                <article id="evidence-target-context" className="surface-summary-card">
                  <span>采样路径</span>
                  <strong>{attachSourceLabel(selectedTask.targetContext.attachSource)}</strong>
                  <small>
                    {selectedTask.targetContext.attachDecision}
                  </small>
                </article>
              </div>

              {collectorReadiness ? (
                <div className="inline-banner">
                  Probe 细节：{localizeLegacyText(collectorReadiness.detail)}
                  {runStateBundle?.activeRun?.stopRequestedAt ? ` 停止请求时间 ${formatTime(runStateBundle.activeRun.stopRequestedAt)}。` : ''}
                </div>
              ) : null}

              <p className="report-summary">{selectedTask.reportSummary}</p>
              <p className="report-summary">{selectedTask.analysisSummary}</p>

              <div className="metric-strip">
                <StatCard panelId="evidence-metric-cpu" label="CPU" value={`${selectedTask.metrics.cpu}%`} hint="采样利用率" tone="cyan" />
                <StatCard panelId="evidence-metric-blocked" label="阻塞" value={`${selectedTask.metrics.blocked}%`} hint="锁或等待时间" tone="rose" />
                <StatCard panelId="evidence-metric-gc" label="GC" value={`${selectedTask.metrics.gc}%`} hint="运行时停顿占比" tone="amber" />
                <StatCard panelId="evidence-metric-syscalls" label="Syscall" value={`${selectedTask.metrics.syscalls}%`} hint="内核切换占比" tone="green" />
              </div>

              <div className="finding-list">
                {selectedTask.findings.map((finding, index) => (
                  <article key={finding.title} id={`evidence-finding-${index + 1}`} className={`finding finding-${finding.severity}`}>
                    <div className="finding-head">
                      <strong>{finding.title}</strong>
                      <span>{severityLabel(finding.severity)}</span>
                    </div>
                    <p>{finding.evidence}</p>
                    <small>{finding.recommendation}</small>
                  </article>
                ))}
              </div>
            </section>

            <section className="section-block detail-panel-shell">
              <div className="detail-toolbar">
                <div className="detail-tabs">
                  {availableDetailTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`detail-tab ${detailTab === tab.id ? 'detail-tab-active' : ''}`}
                      onClick={() => {
                        setDetailCollapsed(false);
                        setDetailTab(tab.id);
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="detail-toggle"
                  onClick={() => setDetailCollapsed((current) => !current)}
                >
                  {detailCollapsed ? '展开右侧面板' : '折叠右侧面板'}
                </button>
              </div>

              {detailCollapsed ? (
                <div className="empty-panel">
                  <strong>右侧面板已折叠</strong>
                  <p>可以随时重新展开，切换查看对比趋势、产物日志、审计、火焰图、证据链和诊断结论。</p>
                </div>
              ) : null}

              {!detailCollapsed && detailTab === 'compare' ? (
            <section className="comparison-panel">
              <div className="section-head">
                <h2>对比与趋势</h2>
                <span>基线对比与历史序列</span>
              </div>

              <div className="comparison-controls">
                <label>
                  基线任务
                  <select value={baselineId ?? ''} onChange={(event) => setBaselineId(event.target.value || null)}>
                    <option value="">{comparableTasks.length > 0 ? '选择基线' : '当前还没有可比较基线'}</option>
                    {comparableTasks.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                    ))}
                  </select>
                </label>
                <div id="evidence-comparison-baseline" className={`comparison-summary verdict-${verdictTone(comparison?.verdict ?? 'neutral')}`}>
                  <strong>{verdictLabel(comparison?.verdict ?? 'neutral')}</strong>
                  <p>{comparison?.summary ?? '选择另一条同范围任务后，这里会显示压力变化与热点迁移。'}</p>
                </div>
              </div>

              <div className="baseline-strip">
                <article className="baseline-card baseline-primary">
                  <span>当前基线</span>
                  <strong>{baselineTask?.reportTitle ?? '还没有选择基线'}</strong>
                  <small>{baselineLabel}</small>
                </article>
                <article className="baseline-card">
                  <span>可比较任务</span>
                  <strong>{comparableTasks.length}</strong>
                  <small>这里只展示相同逻辑目标、collector 和 scenario 的任务，减少误导性对比。</small>
                </article>
                <article className="baseline-card">
                  <span>趋势来源</span>
                  <strong>{historyMode}</strong>
                  <small>
                    {trendBundle
                      ? `当前使用 API 返回的持久化趋势模型。${trendBundle.historySummary.latestDriver ? ` 最新 driver：${trendBundle.historySummary.latestDriver.label}。` : ''}`
                      : '当前回退为基于已加载任务卡片构建的本地趋势模型。'}
                  </small>
                </article>
                <article className="baseline-card">
                  <span>真实采样对象</span>
                  <strong>{targetTypeLabel((selectedHistoryPoint?.processContext ?? summarizeTargetContext(selectedTask.targetContext)).targetType)}</strong>
                  <small>{selectedHistoryPoint?.processContext.summary ?? summarizeTargetContext(selectedTask.targetContext).summary}</small>
                </article>
              </div>

              {historyWarnings.length > 0 ? (
                <div className="inline-banner">
                  可比性提醒：{historyWarnings.join(' ')}
                </div>
              ) : null}

              {comparableTasks.length > 0 ? (
                <div className="baseline-candidate-list">
                  {comparableTasks.slice(0, 4).map((task) => (
                    <button
                      key={task.id}
                      className={`baseline-candidate ${baselineTask?.id === task.id ? 'baseline-candidate-active' : ''}`}
                      onClick={() => setBaselineId(task.id)}
                    >
                      <div className="baseline-candidate-head">
                        <strong>{task.reportTitle}</strong>
                        <span className={`tone tone-${statusTone(task.status)}`}>{statusLabel(task.status)}</span>
                      </div>
                      <p>{task.primaryFinding}</p>
                      <small>{formatCompactDate(task.updatedAt)} • {task.sampleCount} 个样本 • {task.topFunctions[0]?.name ?? '没有保留热点'}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-panel">
                  <strong>还没有可比较基线</strong>
                  <p>再次发起相同逻辑目标 + collector + scenario 的任务后，这里会显示更清晰的热点变化与趋势结论。</p>
                </div>
              )}

              {historyBundle ? (
                <div className="trend-shell">
                  <article className="trend-overview-card">
                    <span>序列摘要</span>
                    <strong>{localizeLegacyText(historyBundle.summary)}</strong>
                    <small>
                      范围: {historyBundle.scope.target} • {historyBundle.scope.collector} • {historyBundle.scope.scenario}
                    </small>
                  </article>

                  <div className="sequence-spotlight">
                    <article className="spotlight-card">
                      <span>当前任务位置</span>
                      <strong>{selectedHistoryPoint ? `#${historyBundle.points.findIndex((point) => point.taskId === selectedHistoryPoint.taskId) + 1}` : 'n/a'}</strong>
                      <small>{selectedHistoryPoint ? `${selectedHistoryPoint.totalPressure.toFixed(1)} 压力 • ${selectedHistoryPoint.sampleCount} 个样本` : '等待出现可比较历史。'}</small>
                    </article>
                    <article className="spotlight-card">
                      <span>相对前一次压力变化</span>
                      <strong>{trendDeltaLabel(selectedHistoryPoint?.pressureDelta ?? null)}</strong>
                      <small>
                        {trendBundle?.historySummary.currentStreak.verdict && trendBundle.historySummary.currentStreak.verdict !== 'initial'
                          ? `持久化趋势里已形成 ${trendBundle.historySummary.currentStreak.length} 次连续 ${verdictLabel(trendBundle.historySummary.currentStreak.verdict)}。`
                          : `相对上一条可比较任务的结果是 ${verdictLabel(selectedHistoryPoint?.verdictToPrevious ?? 'initial')}。`}
                      </small>
                    </article>
                    <article className="spotlight-card">
                      <span>头部热点</span>
                      <strong>{selectedHistoryPoint?.topHotspot ?? selectedTask.topFunctions[0]?.name ?? '暂无热点'}</strong>
                      <small>
                        {selectedHistoryPoint
                          ? `${selectedHistoryPoint.topHotspotPercent ?? 0}% 采样占比，位置 ${selectedHistoryPoint.topHotspotLocationSummary ?? '暂无可读位置'}。`
                          : selectedTask.topFunctions[0]
                            ? `当前任务中占比 ${selectedTask.topFunctions[0].percent}%。`
                            : '当前报告没有保留排序热点。'}
                      </small>
                      {selectedHistoryPoint?.topHotspotMappingState ? (
                        <span className={`tone tone-${mappingTone(selectedHistoryPoint.topHotspotMappingState)}`}>
                          {hotspotMappingStateLabel(selectedHistoryPoint.topHotspotMappingState)}
                        </span>
                      ) : null}
                    </article>
                  </div>

                  <div className="trend-lane">
                    {historyBundle.points.map((point, index) => {
                      const isCurrent = point.taskId === selectedTask.id;
                      const isBaseline = point.taskId === baselineTask?.id;
                      const height = Math.max(32, Math.min(132, point.totalPressure * 1.45));

                      return (
                        <button
                          key={point.taskId}
                          className={`trend-point ${isCurrent ? 'trend-current' : ''} ${isBaseline ? 'trend-baseline' : ''}`}
                          onClick={() => setSelectedId(point.taskId)}
                        >
                          <div className="trend-bar-shell">
                            <div className={`trend-bar tone-${pressureTone(point.totalPressure)}`} style={{ height: `${height}px` }} />
                          </div>
                          <strong>#{index + 1}</strong>
                          <span>{point.totalPressure.toFixed(1)} 压力</span>
                          <small>{point.topHotspot ?? '无热点'}</small>
                          <small>{point.topHotspotLocationSummary ?? '没有保留可读位置'}</small>
                          {point.topHotspotMappingState ? (
                            <span className={`tone tone-${mappingTone(point.topHotspotMappingState)}`}>
                              {hotspotMappingStateLabel(point.topHotspotMappingState)}
                            </span>
                          ) : null}
                          <small>
                            {verdictLabel(point.verdictToPrevious)} • {trendDeltaLabel(point.pressureDelta)}
                          </small>
                          <small>{localizeLegacyText(point.driverEvidence ?? point.summary)}</small>
                          <small>{formatCompactDate(point.updatedAt)} • {shortId(point.taskId)}</small>
                        </button>
                      );
                    })}
                  </div>

                  <div className="trend-metric-grid">
                    {historyBundle.metricSeries.map((series) => (
                      <article key={series.metric} className="trend-metric-card">
                        <div className="trend-metric-head">
                          <strong>{series.label}</strong>
                          <span>{series.points.at(-1)?.value ?? 0}%</span>
                        </div>
                        <div className="trend-metric-pills">
                          {series.points.map((point, index) => (
                            <div key={`${series.metric}-${point.taskId}`} className={`trend-pill pill-${point.trend}`}>
                              <span>#{index + 1}</span>
                              <strong>{point.value}%</strong>
                              <small>{trendDeltaLabel(point.delta)}</small>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="trend-change-list">
                    {historyBundle.hotspotChanges.length > 0 ? (
                      historyBundle.hotspotChanges
                        .slice(-3)
                        .reverse()
                        .map((change) => (
                          <article key={`${change.baselineId}-${change.currentId}`} className={`trend-change trend-${verdictTone(change.verdict)}`}>
                            <div className="trend-change-head">
                              <strong>{verdictLabel(change.verdict)}</strong>
                              <span>{change.pressureDelta > 0 ? '+' : ''}{change.pressureDelta.toFixed(1)} 压力</span>
                            </div>
                            <p>{change.summary}</p>
                            <div className="trend-hotspot-stack">
                              <div className="trend-hotspot-meta">
                                <span>基线热点</span>
                                <strong>{change.baselineHotspot?.name ?? 'n/a'}</strong>
                                <small>{hotspotLocationSummary(change.baselineHotspot)}</small>
                                {change.baselineHotspot?.mappingState ? (
                                  <span className={`tone tone-${mappingTone(change.baselineHotspot.mappingState)}`}>
                                    {hotspotMappingStateLabel(change.baselineHotspot.mappingState)}
                                  </span>
                                ) : null}
                              </div>
                              <div className="trend-hotspot-meta">
                                <span>当前热点</span>
                                <strong>{change.currentHotspot?.name ?? 'n/a'}</strong>
                                <small>{hotspotLocationSummary(change.currentHotspot)}</small>
                                {change.currentHotspot?.mappingState ? (
                                  <span className={`tone tone-${mappingTone(change.currentHotspot.mappingState)}`}>
                                    {hotspotMappingStateLabel(change.currentHotspot.mappingState)}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {change.driverLabel || change.driverEvidence ? (
                              <small>
                                {change.driverLabel ? `${change.driverLabel}: ` : ''}
                                {localizeLegacyText(change.driverEvidence ?? '当前没有保留可直接引用的 driver 证据。')}
                              </small>
                            ) : null}
                            <small>
                              {shortId(change.baselineId)} → {shortId(change.currentId)}
                            </small>
                          </article>
                        ))
                    ) : (
                      <article className="trend-change trend-slate">
                        <div className="trend-change-head">
                          <strong>起点</strong>
                          <span>0.0 压力</span>
                        </div>
                        <p>当前对比范围里还没有可展示的热点变化历史。</p>
                        <small>再运行一次可比较采样任务，这里就会形成趋势序列。</small>
                      </article>
                    )}
                  </div>

                  <div className="continuous-profile-shell">
                    <div className="continuous-profile-head">
                      <div>
                        <span>连续画像窗口</span>
                        <strong>
                          {continuousProfileBundle
                            ? `${continuousProfileBundle.window.sliceCount} 段窗口`
                            : '等待窗口数据'}
                        </strong>
                        <small>
                          {continuousScope === 'history'
                            ? '当前展示同目标历史窗口，适合回看 repeated capture 的变化。'
                            : '当前展示单次任务对应的保留窗口。'}
                        </small>
                      </div>
                      <div className="continuous-profile-controls">
                        <button
                          type="button"
                          className={continuousScope === 'history' ? 'control-active' : ''}
                          onClick={() => setContinuousScope('history')}
                        >
                          同目标历史
                        </button>
                        <button
                          type="button"
                          className={continuousScope === 'task' ? 'control-active' : ''}
                          onClick={() => setContinuousScope('task')}
                        >
                          当前任务
                        </button>
                        <button
                          type="button"
                          className={continuousLimit === 3 ? 'control-active' : ''}
                          onClick={() => setContinuousLimit(3)}
                        >
                          最近 3 段
                        </button>
                        <button
                          type="button"
                          className={continuousLimit === 6 ? 'control-active' : ''}
                          onClick={() => setContinuousLimit(6)}
                        >
                          最近 6 段
                        </button>
                      </div>
                    </div>

                    {continuousSlices.length > 0 ? (
                      <>
                        <div className="continuous-slice-lane">
                          {continuousSlices.map((slice, index) => (
                            <button
                              key={slice.id}
                              className={`continuous-slice-card ${
                                selectedContinuousSlice?.id === slice.id ? 'continuous-slice-active' : ''
                              }`}
                              onClick={() => setSelectedContinuousSliceId(slice.id)}
                            >
                              <div className="continuous-slice-top">
                                <strong>#{index + 1}</strong>
                                <span className={`tone tone-${continuousSliceTone(slice.status)}`}>
                                  {continuousSliceLabel(slice.status)}
                                </span>
                              </div>
                              <span>{formatCompactDate(slice.startedAt)}</span>
                              <strong>{slice.sampleCount} 个样本</strong>
                              <small>{slice.sampleSource}</small>
                              <small>{shortId(slice.taskId)}</small>
                            </button>
                          ))}
                        </div>

                        {selectedContinuousSlice ? (
                          <div className="continuous-slice-summary">
                            <article className="spotlight-card">
                              <span>选中窗口</span>
                              <strong>{formatCompactDate(selectedContinuousSlice.startedAt)}</strong>
                              <small>
                                {formatTime(selectedContinuousSlice.startedAt)} → {formatTime(selectedContinuousSlice.endedAt)}
                              </small>
                            </article>
                            <article className="spotlight-card">
                              <span>窗口状态</span>
                              <strong>{continuousSliceLabel(selectedContinuousSlice.status)}</strong>
                              <small>{selectedContinuousSlice.sampleCount} 个样本 • {selectedContinuousSlice.sampleSource}</small>
                            </article>
                            <article className="spotlight-card spotlight-wide">
                              <span>窗口摘要</span>
                              <strong>{localizeLegacyText(selectedContinuousSlice.summary)}</strong>
                              <small>
                                来自任务 {shortId(selectedContinuousSlice.taskId)} • 保留 {selectedContinuousSlice.artifactPaths.length} 条 artifact 路径
                              </small>
                            </article>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="empty-panel">
                        <strong>当前还没有连续画像窗口</strong>
                        <p>完成更多同范围任务后，这里会把每次保留的时间窗口串成一个可回看的连续画像序列。</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {comparison && baselineTask ? (
                <>
                  <div className="comparison-grid">
                    <article className="comparison-card">
                      <span>当前任务 vs 基线</span>
                      <strong>{comparison.totalPressureDelta > 0 ? '+' : ''}{comparison.totalPressureDelta.toFixed(1)} 压力</strong>
                      <small>{comparison.changedHotspot}</small>
                    </article>
                    <article className="comparison-card">
                      <span>置信度变化</span>
                      <strong>{comparison.confidenceDelta > 0 ? '+' : ''}{comparison.confidenceDelta.toFixed(1)}%</strong>
                      <small>对比基线：{baselineTask.reportTitle}</small>
                    </article>
                    <article id="evidence-trend-latest-driver" className="comparison-card">
                      <span>趋势 driver</span>
                      <strong>{comparison.driver?.label ?? '当前没有明确主导 driver'}</strong>
                      <small>{comparison.driver?.evidence ?? '各项指标变化过于接近，暂时无法命名唯一主导 driver。'}</small>
                    </article>
                    <article className="comparison-card">
                      <span>热点迁移</span>
                      <strong>{comparison.hotspotShift.kind}</strong>
                      <small>{comparison.hotspotShift.summary}</small>
                    </article>
                    <article className="comparison-card comparison-wide">
                      <span>进程上下文可比性</span>
                      <strong>{comparisonWarnings.length > 0 ? '需要人工确认' : '上下文基本一致'}</strong>
                      <small>
                        当前：{comparison.current.processContext.summary}
                        {' | '}
                        基线：{comparison.baseline.processContext.summary}
                        {comparisonWarnings.length > 0 ? ` | ${comparisonWarnings.join(' ')}` : ''}
                      </small>
                    </article>
                    <article className="comparison-card comparison-wide">
                      <span>指标变化</span>
                      <div className="comparison-metrics">
                        {comparison.metricDeltas.map((metric) => (
                          <div key={metric.metric} className={`comparison-metric metric-${metric.trend}`}>
                            <strong>{metric.label}</strong>
                            <span>
                              {metric.before}% → {metric.after}% ({metric.delta > 0 ? '+' : ''}
                              {metric.delta.toFixed(1)}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                    <article className="comparison-card comparison-wide">
                      <span>可读热点上下文</span>
                      <div className="comparison-hotspot-pair">
                        <div className="comparison-hotspot-card">
                          <strong>{comparison.hotspotShift.baselineTop?.name ?? '没有保留基线热点'}</strong>
                          <small>{hotspotLocationSummary(comparison.hotspotShift.baselineTop)}</small>
                          {comparison.hotspotShift.baselineTop?.mappingState ? (
                            <span className={`tone tone-${mappingTone(comparison.hotspotShift.baselineTop.mappingState)}`}>
                              {hotspotMappingStateLabel(comparison.hotspotShift.baselineTop.mappingState)}
                            </span>
                          ) : null}
                        </div>
                        <div className="comparison-hotspot-card">
                          <strong>{comparison.hotspotShift.currentTop?.name ?? '没有保留当前热点'}</strong>
                          <small>{hotspotLocationSummary(comparison.hotspotShift.currentTop)}</small>
                          {comparison.hotspotShift.currentTop?.mappingState ? (
                            <span className={`tone tone-${mappingTone(comparison.hotspotShift.currentTop.mappingState)}`}>
                              {hotspotMappingStateLabel(comparison.hotspotShift.currentTop.mappingState)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  </div>

                  <div className="movement-grid">
                    {hotspotMovements.slice(0, 6).map((movement) => (
                      <article key={movement.name} className={`movement-card movement-${movement.tone}`}>
                        <div className="movement-head">
                          <strong>{movement.name}</strong>
                          <span>{movement.delta > 0 ? '+' : ''}{movement.delta.toFixed(1)}%</span>
                        </div>
                        <p>{movement.summary}</p>
                        <small>
                          {movement.module} • {movement.before}% → {movement.after}%
                        </small>
                        <small>{movement.beforeLocation} → {movement.afterLocation}</small>
                        <div className="comparison-hotspot-pair">
                          {movement.beforeMappingState ? (
                            <span className={`tone tone-${mappingTone(movement.beforeMappingState)}`}>
                              基线 {hotspotMappingStateLabel(movement.beforeMappingState)}
                            </span>
                          ) : null}
                          {movement.afterMappingState ? (
                            <span className={`tone tone-${mappingTone(movement.afterMappingState)}`}>
                              当前 {hotspotMappingStateLabel(movement.afterMappingState)}
                            </span>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
              ) : null}

            {!detailCollapsed && detailTab === 'artifacts' ? (
            <section className="artifact-panel">
              <div className="section-head">
                <h2>产物与日志</h2>
                <span>已保留 {activeArtifacts.length} 个产物</span>
              </div>

              <div className="surface-summary">
                <article className="surface-summary-card">
                  <span>产物预览</span>
                  <strong>{selectedArtifact ? selectedArtifact.label : '尚未选择产物'}</strong>
                  <small>
                    {artifactPreviewLoading
                      ? '正在加载内联预览...'
                      : artifactPreview?.preview.truncated
                        ? '为保证可读性，当前预览已被截断。'
                        : selectedTask.status === 'FAILED'
                          ? '本次任务失败了，因此预览里可能只保留了部分证据。'
                          : '如果产物类型支持，这里会直接展示内联预览。'}
                  </small>
                </article>
                <article className="surface-summary-card">
                  <span>审计覆盖</span>
                  <strong>{auditSummary.total} 条事件</strong>
                  <small>{auditSummary.error > 0 ? `审计链中保留了 ${auditSummary.error} 条 error 事件。` : auditSummary.warning > 0 ? `审计链中保留了 ${auditSummary.warning} 条 warning 事件。` : '当前只保留了 info 级审计事件。'}</small>
                </article>
                <article className="surface-summary-card">
                  <span>Reasoner 模式</span>
                  <strong>{reasonerView?.modeLabel ?? '不可用'}</strong>
                  <small>
                    {reasonerView
                      ? reasonerView.fallbackReason
                        ? `当前正在安全 Fallback：${reasonerView.fallbackReason}`
                        : '下方诊断结论面板会基于当前任务和对比上下文展示。'
                      : '当前任务还没有可用的 reasoner 输出或草稿。'}
                  </small>
                </article>
              </div>

              <div className="artifact-workspace">
                <div className="artifact-list">
                  {activeArtifacts.length > 0 ? (
                    activeArtifacts.map((artifact, index) => (
                      <button
                        key={`${artifact.kind}-${artifact.path}`}
                        id={`evidence-artifact-${index + 1}`}
                        className={`artifact-card artifact-${artifactTone(artifact.kind)} ${selectedArtifact?.path === artifact.path ? 'artifact-selected' : ''}`}
                        onClick={() => setSelectedArtifactPath(artifact.path)}
                      >
                        <div className="artifact-head">
                          <strong>{artifact.label}</strong>
                          <span>{artifact.kind}</span>
                        </div>
                        <p>{describeArtifact(artifact)}</p>
                        <small>{pathTail(artifact.path)}</small>
                      </button>
                    ))
                  ) : (
                    <div className="empty-panel">
                      <strong>还没有索引到产物</strong>
                      <p>
                        {selectedTask.status === 'FAILED'
                          ? '这次任务在采集器生成更完整产物前就失败了，可以先查看审计和诊断结论看剩余证据。'
                          : '当前任务还没有暴露出更完整的产物包。'}
                      </p>
                    </div>
                  )}
                </div>

                <article className="artifact-preview">
                  <div className="artifact-preview-head">
                    <div>
                      <span className="preview-label">当前选中产物</span>
                      <h3>{selectedArtifact?.label ?? '尚未选择产物'}</h3>
                    </div>
                    {selectedArtifact ? <span className={`tone tone-${artifactTone(selectedArtifact.kind)}`}>{selectedArtifact.kind}</span> : null}
                  </div>

                  {selectedArtifact ? (
                    <>
                      <p>{describeArtifact(selectedArtifact)}</p>
                      <div className="preview-meta">
                        <div>
                          <span>产物路径</span>
                          <strong>{selectedArtifact.path}</strong>
                        </div>
                        <div>
                          <span>建议动作</span>
                          <strong>{artifactPreviewLabel(selectedArtifact)}</strong>
                        </div>
                        <div>
                          <span>预览能力</span>
                          <strong>{selectedArtifact.previewable === false ? '仅离线查看' : '支持内联或离线查看'}</strong>
                        </div>
                        <div>
                          <span>预览提示</span>
                          <strong>{selectedArtifact.previewHint ?? '当前没有保留额外预览提示。'}</strong>
                        </div>
                      </div>

                      {artifactBundle?.resultIndex ? (
                        <div className="result-index-card">
                          <div>
                            <span>索引样本来源</span>
                            <strong>{artifactBundle.resultIndex.sampleSource}</strong>
                          </div>
                          <div>
                            <span>索引样本数</span>
                            <strong>{artifactBundle.resultIndex.sampleCount}</strong>
                          </div>
                          <div>
                            <span>索引产物数</span>
                            <strong>{artifactBundle.resultIndex.artifactCount}</strong>
                          </div>
                          <div>
                            <span>采集模式</span>
                            <strong>{provenanceModeLabel(artifactBundle.resultIndex.provenance?.mode)}</strong>
                          </div>
                          <div>
                            <span>可预览产物</span>
                            <strong>{artifactBundle.resultIndex.previewableArtifactCount}</strong>
                          </div>
                          <div>
                            <span>符号化</span>
                            <strong>{symbolizationStatusLabel(symbolizationSummary?.status)}</strong>
                          </div>
                        </div>
                      ) : null}

                      {artifactBundle?.resultIndex.provenance ? (
                        <div id="evidence-provenance-path" className="result-index-card">
                          <div>
                            <span>采样路径</span>
                            <strong className={`inline-tone inline-tone-${collectorPathTone(artifactBundle.resultIndex.provenance.mode)}`}>
                              {artifactBundle.resultIndex.provenance.sourceKind}
                            </strong>
                          </div>
                          <div>
                            <span>采集模式</span>
                            <strong>{provenanceModeLabel(artifactBundle.resultIndex.provenance.mode)}</strong>
                          </div>
                          <div>
                            <span>原因</span>
                            <strong>{artifactBundle.resultIndex.provenance.reason}</strong>
                          </div>
                          <div>
                            <span>原始信号</span>
                            <strong>{artifactBundle.resultIndex.provenance.rawSignal}</strong>
                          </div>
                          <div>
                            <span>期望产物</span>
                            <strong>{artifactBundle.resultIndex.provenance.expectedArtifacts.join(', ') || 'n/a'}</strong>
                          </div>
                          {artifactBundle.resultIndex.provenance.notes && artifactBundle.resultIndex.provenance.notes.length > 0 ? (
                            <div>
                              <span>备注</span>
                              <strong>{artifactBundle.resultIndex.provenance.notes.join('; ')}</strong>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {symbolizationSummary ? (
                        <div id="evidence-symbolization-state" className="result-index-card">
                          <div>
                            <span>已映射热点</span>
                            <strong>{symbolizationSummary.mappedHotspots}</strong>
                          </div>
                          <div>
                            <span>Synthetic 热点</span>
                            <strong>{symbolizationSummary.syntheticHotspots}</strong>
                          </div>
                          <div>
                            <span>行级映射热点</span>
                            <strong>{symbolizationSummary.lineMappedHotspots}</strong>
                          </div>
                        </div>
                      ) : null}

                      {artifactPreviewLoading ? <p>正在加载产物预览...</p> : null}
                      {artifactPreviewError ? <div className="error-banner">{artifactPreviewError}</div> : null}
                      {artifactPreview && !artifactPreviewLoading ? (
                        artifactPreview.preview.mode === 'unsupported' ? (
                          <div className="preview-shell">
                            <strong>暂不支持内联预览</strong>
                            <p>
                              这类产物更适合交给离线工具处理，而不是直接在浏览器里查看。
                              {selectedTask.status === 'FAILED'
                                ? ' 但即便如此，保留的路径和审计链仍然能帮助解释这次部分失败的任务。'
                                : ''}
                            </p>
                          </div>
                        ) : (
                          <div className="preview-shell">
                            <div className="preview-shell-head">
                              <strong>{artifactPreview.preview.mode.toUpperCase()} 预览</strong>
                              <span>
                                {artifactPreview.preview.byteLength} bytes
                                {artifactPreview.preview.truncated ? ' · 已截断' : ''}
                              </span>
                            </div>
                            <p className="preview-summary">
                              {artifactPreview.preview.mimeType} • {artifactPreview.preview.summary}
                            </p>
                            <pre>{artifactPreviewText}</pre>
                          </div>
                        )
                      ) : null}
                    </>
                  ) : (
                    <p>选择左侧产物卡片后，可以核对这次任务到底保留了哪些离线分析证据。</p>
                  )}

                  <div className="collector-logs">
                    {selectedTask.collectorLogs.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </article>
              </div>
            </section>
            ) : null}

            {!detailCollapsed && detailTab === 'audit' ? (
            <section className="audit-panel">
              <div className="section-head">
                <h2>审计</h2>
                <span>{auditBundle?.auditEvents.length ?? 0} 条事件</span>
              </div>

              {sidecarLoading && !auditBundle ? <div className="inline-banner">正在加载当前任务的审计轨迹...</div> : null}
              {auditBundle?.auditEvents.length ? (
                <div className="audit-list">
                  {auditBundle.auditEvents.map((event) => (
                    <article key={event.id} className={`audit-card audit-${event.severity}`}>
                      <div className="audit-head">
                        <strong>{formatAuditType(event.type)}</strong>
                        <span>{formatTime(event.at)}</span>
                      </div>
                      <p>{localizeLegacyText(event.message)}</p>
                      {event.detail ? <small>{localizeLegacyText(event.detail)}</small> : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="report-summary">当前任务还没有保留审计事件。</p>
              )}
            </section>
            ) : null}

            {!detailCollapsed && detailTab === 'flame' ? (
            <section className="flame-panel">
              <div className="section-head">
                <h2>火焰图</h2>
                <span>{selectedTask.signal}</span>
              </div>
              <FlameGraph root={selectedTask.flameGraph} />
            </section>
            ) : null}

            {!detailCollapsed && detailTab === 'evidence' ? (
            <section className="evidence-panel">
              <div className="section-head">
                <h2>证据链</h2>
                <span>时间线与热点明细</span>
              </div>

              <div className="timeline">
                {selectedTask.timeline.map((event, index) => (
                  <article
                    key={`${event.at}-${event.title}`}
                    id={index === selectedTask.timeline.length - 1 ? 'evidence-timeline-latest' : undefined}
                    className="timeline-item"
                  >
                    <time>{formatTime(event.at)}</time>
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.detail}</p>
                    </div>
                  </article>
                ))}
              </div>

              <div className="function-table">
                <div className="table-head">
                  <span>热点函数</span>
                  <span>占比</span>
                  <span>位置</span>
                  <span>映射</span>
                </div>
                {selectedTask.topFunctions.map((fn, index) => (
                  <div key={fn.name} id={`evidence-hotspot-${index + 1}`} className="table-row">
                    <span>
                      <strong>{fn.name}</strong>
                      <small>{fn.module}</small>
                    </span>
                    <span>{fn.percent}%</span>
                    <span>{fn.locationSummary ?? fn.module}</span>
                    <span>
                      <span className={`tone tone-${mappingTone(fn.mappingState)}`}>{mappingLabel(fn.mappingState)}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="insight-list">
                {selectedTask.insights.map((insight) => (
                  <article key={insight.title} className={`insight-card insight-${insight.direction}`}>
                    <strong>{insight.title}</strong>
                    <p>{insight.evidence}</p>
                    <small>{insight.attribution}</small>
                  </article>
                ))}
              </div>
            </section>
            ) : null}

            {!detailCollapsed && detailTab === 'reasoner' ? (
              reasonerView ? (
              <section className="reasoner-panel">
                <div className="section-head">
                  <h2>{reasonerView.title}</h2>
                  <span>{reasonerView.modeLabel}</span>
                </div>

                <div className="reasoner-shell">
                  <article className="reasoner-summary">
                    <span>诊断摘要</span>
                    <strong>{reasonerView.summary}</strong>
                    <ul className="reasoner-bullets">
                      {reasonerView.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                    <div className="guardrail-list">
                      {reasonerView.guardrails.map((guardrail) => (
                        <small key={guardrail}>{guardrail}</small>
                      ))}
                    </div>
                    {reasonerView.rejectedCitations.length > 0 ? (
                      <div className="reasoner-note">
                        <strong>已过滤引用</strong>
                        <p>{reasonerView.rejectedCitations.join(', ')}</p>
                      </div>
                    ) : null}
                    {reasonerView.fallbackReason ? (
                      <div className="reasoner-note">
                        <strong>Fallback 原因</strong>
                        <p>{reasonerView.fallbackReason}</p>
                      </div>
                    ) : null}
                    {reasonerView.generatedAt ? (
                      <small className="generated-at">生成时间 {formatTime(reasonerView.generatedAt)}</small>
                    ) : (
                      <small className="generated-at">当前暂时展示本地规则生成的摘要，直到持久化 snapshot 可用为止。</small>
                    )}
                  </article>

                  <article className="citation-panel">
                    <span>证据引用</span>
                    <div className="citation-list">
                      {reasonerView.citations.map((citation) => (
                        <div key={citation.label} className="citation-card">
                          <strong>{citation.label}</strong>
                          <small>{evidenceSurfaceLabel(citation.label)}</small>
                          <p>{citation.evidence}</p>
                          {evidenceAnchorId(citation.label) ? (
                            <a className="citation-link" href={`#${evidenceAnchorId(citation.label)}`}>
                              跳转到对应证据
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              </section>
              ) : (
                <div className="empty-panel">
                  <strong>当前没有诊断结论</strong>
                  <p>reasoner 还没有生成可展示的摘要，可以先查看证据链、产物和审计。</p>
                </div>
              )
            ) : null}
            </section>
          </>
        ) : (
          <section className="section-block empty-state">
            <h2>还没有选中任务</h2>
            <p>先创建一次任务，再从这里查看完整的证据闭环。</p>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
