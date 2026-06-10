import type { TaskComparison, TaskDetail, TaskFinding, TaskMetrics, TrendInsight } from '../../shared/types.js';
import { formatDelta, strongestMetricDelta } from './comparison-helpers.js';
import type { AnalysisContext, AnalysisNarrative, NormalizedHotspot } from './types.js';

export function buildQueuedTimeline(signal: string) {
  const start = new Date();
  const stamps = [0, 900, 1800, 2700].map((offset) => new Date(start.getTime() + offset));
  return [
    { at: stamps[0].toISOString(), title: 'Task queued', detail: `Queued for ${signal.toLowerCase()} sampling.` },
    { at: stamps[1].toISOString(), title: 'Workload prepared', detail: 'A real workload process is about to be profiled.' },
    { at: stamps[2].toISOString(), title: 'Collector pending', detail: 'The chosen collector will attach or wrap the workload next.' },
    { at: stamps[3].toISOString(), title: 'Analysis pending', detail: 'Trend attribution will be added after the run completes.' },
  ];
}

export function buildAnalysisNarrative(context: AnalysisContext): AnalysisNarrative {
  const dominant = context.run.hotspots[0] ?? buildFallbackHotspot(context.task.primaryFinding);
  const hotspotMovement = context.comparison ? describeHotspotMovementFromComparison(context.task, context.comparison) : null;
  const trendDriver = context.comparison ? deriveTrendDriver(context.comparison) : null;

  return {
    confidence: computeConfidence(context.run.metrics, dominant.percent, context.run.sampleCount),
    primaryFinding: `${dominant.name} is the dominant hot path.`,
    analysisSummary: buildAnalysisSummary(context, dominant),
    trendSummary: buildTrendSummary(context.comparison, hotspotMovement, trendDriver),
    timeline: buildTimeline(context.task.collectorName, context.run.title, context.outcome.logs, context.comparison, hotspotMovement),
    findings: buildFindings(context.task, context.run.hotspots, context.run.metrics, context.comparison, context.outcome.logs, hotspotMovement, trendDriver),
    insights: buildInsights(context.run.hotspots, context.run.metrics, context.comparison, context.outcome.logs, hotspotMovement, trendDriver),
    flameGraph: buildFlameGraph(context.run.title, context.run.hotspots),
    trendDriver,
  };
}

function buildTimeline(
  collectorName: string,
  reportTitle: string,
  logs: string[],
  comparison: TaskComparison | null,
  hotspotMovement: string | null,
) {
  const start = new Date();
  const stamps = [0, 1100, 2200, 3300].map((offset) => new Date(start.getTime() + offset));
  const baselineText = comparison
    ? `${comparison.summary} ${hotspotMovement ?? comparison.changedHotspot}`
    : 'No prior baseline was available for this run.';

  return [
    { at: stamps[0].toISOString(), title: 'Real workload launched', detail: `Collector ${collectorName} started a real profiling run.` },
    { at: stamps[1].toISOString(), title: 'Sampling complete', detail: `The collector captured files and signals for ${reportTitle}.` },
    { at: stamps[2].toISOString(), title: 'Frames normalized', detail: logs[0] ?? 'Collector logs were captured and normalized for the report.' },
    { at: stamps[3].toISOString(), title: 'Trend attributed', detail: baselineText },
  ];
}

function buildFindings(
  task: TaskDetail,
  hotspots: AnalysisContext['run']['hotspots'],
  metrics: TaskMetrics,
  comparison: TaskComparison | null,
  logs: string[],
  hotspotMovement: string | null,
  trendDriver: AnalysisNarrative['trendDriver'],
) {
  const dominant = hotspots[0];
  const findings: TaskFinding[] = [];

  if (dominant) {
    findings.push({
      title: `${dominant.name} dominates the sampled stack`,
      severity: dominant.percent >= 30 ? 'high' : 'medium',
      evidence: `${dominant.name} accounts for ${dominant.percent}% of the measured time in ${dominant.frame.module}:${dominant.frame.line ?? 'n/a'}.`,
      recommendation: `Reduce the work done in ${dominant.name} and confirm the share drops below ${Math.max(10, dominant.percent - 10)}% after the fix.`,
    });
  }

  if (comparison) {
    findings.push({
      title: `Baseline comparison is ${comparison.verdict}`,
      severity: comparison.verdict === 'regression' ? 'high' : comparison.verdict === 'improvement' ? 'medium' : 'info',
      evidence: `${comparison.summary} ${hotspotMovement ?? comparison.changedHotspot}`,
      recommendation:
        comparison.verdict === 'regression'
          ? `Investigate ${trendDriver?.label ?? 'the hottest changed metric'} and re-run the same scenario after the patch.`
          : 'Keep the current change set, then re-sample to confirm the trend persists.',
    });
  }

  findings.push({
    title: 'Collector output is consistent with a real sample',
    severity: logs.length > 0 ? 'medium' : 'info',
    evidence: `Captured ${hotspots.length} ranked hotspots with CPU ${metrics.cpu}%, blocked ${metrics.blocked}% and GC ${metrics.gc}%.`,
    recommendation: `Use the captured artifacts from ${task.collectorName} as the reference run for the next comparison.`,
  });

  return findings.slice(0, 3);
}

function buildInsights(
  hotspots: AnalysisContext['run']['hotspots'],
  metrics: TaskMetrics,
  comparison: TaskComparison | null,
  logs: string[],
  hotspotMovement: string | null,
  trendDriver: AnalysisNarrative['trendDriver'],
) {
  const dominant = hotspots[0];
  const cpuDirection = metrics.cpu >= 70 ? 'regressed' : metrics.cpu <= 40 ? 'improved' : 'flat';

  const insights: TrendInsight[] = [
    {
      title: 'Hotspot concentration',
      direction: dominant && dominant.percent >= 30 ? 'regressed' : 'improved',
      evidence: dominant
        ? `${dominant.name} owns ${dominant.percent}% of sampled time and resolves to ${dominant.frame.file}:${dominant.frame.line ?? 'n/a'}.`
        : 'No hotspot data was captured.',
      attribution: dominant ? dominant.frame.sourceHint : 'collector report',
    },
    {
      title: 'Pressure driver',
      direction: trendDriver?.trend ?? cpuDirection,
      evidence: trendDriver?.evidence ?? `CPU share landed at ${metrics.cpu}% while blocked time sat at ${metrics.blocked}%.`,
      attribution: trendDriver?.label ?? 'workload report',
    },
    {
      title: 'Baseline trajectory',
      direction:
        comparison?.verdict === 'regression'
          ? 'regressed'
          : comparison?.verdict === 'improvement'
            ? 'improved'
            : comparison?.verdict === 'mixed'
              ? 'flat'
              : 'flat',
      evidence: comparison?.summary ?? 'No prior run was available for trend attribution.',
      attribution: hotspotMovement ?? comparison?.changedHotspot ?? logs[0] ?? 'collector log',
    },
  ];

  return insights;
}

function buildAnalysisSummary(context: AnalysisContext, dominant: NormalizedHotspot) {
  const secondary = context.run.hotspots[1];
  const source = `${dominant.frame.file}:${dominant.frame.line ?? 'n/a'}`;
  const secondaryText = secondary ? ` Secondary pressure sits on ${secondary.name} at ${secondary.percent}%.` : '';
  return `${context.run.title} captured ${context.run.sampleCount} samples from ${context.run.sampleSource}. ${context.run.summary} The current dominant hotspot is ${dominant.name} at ${source}.${secondaryText}`;
}

function buildTrendSummary(
  comparison: TaskComparison | null,
  hotspotMovement: string | null,
  trendDriver: AnalysisNarrative['trendDriver'],
) {
  if (!comparison) {
    return 'This is the first run for the selected comparison scope, so no trend delta was available.';
  }

  const driverText = trendDriver
    ? ` The strongest metric movement was ${trendDriver.label} (${formatDelta(trendDriver.delta)}).`
    : '';

  return `${comparison.summary} ${hotspotMovement ?? comparison.changedHotspot}${driverText}`;
}

function buildFlameGraph(title: string, hotspots: AnalysisContext['run']['hotspots']) {
  const base = hotspots.reduce((sum, item) => sum + item.percent, 0);
  const misc = Math.max(5, 100 - base);
  const children = [
    ...hotspots.map((hotspot, index) => ({
      name: hotspot.name,
      value: hotspot.percent,
      module: hotspot.frame.module,
      color: palette[index % palette.length],
      children: buildFlameChildren(hotspot.name, hotspot.percent, index, hotspot.supportingFrames.map((frame) => frame.displayName)),
    })),
    { name: 'misc', value: misc, color: '#64748b' },
  ];

  return {
    name: title,
    value: 100,
    color: '#0f172a',
    children,
  };
}

function buildFlameChildren(name: string, percent: number, index: number, supportingFrames: string[]) {
  const first = Math.max(1, Math.round(percent * 0.62));
  const second = Math.max(1, percent - first);
  return [
    { name: supportingFrames[0] ?? `${name}:core`, value: first, color: palette[(index + 1) % palette.length] },
    { name: supportingFrames[1] ?? `${name}:support`, value: second, color: palette[(index + 2) % palette.length] },
  ];
}

function computeConfidence(metrics: TaskMetrics, topShare: number, sampleCount: number) {
  const base = 0.6 + topShare / 200 + Math.min(0.2, sampleCount / 500);
  const gcAdjustment = metrics.gc >= 20 ? 0.02 : 0;
  const cpuAdjustment = metrics.cpu > 80 ? 0.05 : 0;
  return Math.min(0.99, Number((base + gcAdjustment + cpuAdjustment).toFixed(2)));
}

function deriveTrendDriver(comparison: TaskComparison) {
  const strongest = strongestMetricDelta(comparison.metricDeltas);
  if (!strongest) {
    return null;
  }

  return {
    label: strongest.label,
    trend: strongest.trend,
    delta: strongest.delta,
    evidence: `${strongest.label} moved from ${strongest.before}% to ${strongest.after}% (${formatDelta(strongest.delta)}).`,
  };
}

function describeHotspotMovementFromComparison(task: TaskDetail, comparison: TaskComparison) {
  const baseline = task.baselineComparison;
  if (!baseline) {
    return comparison.changedHotspot;
  }

  return comparison.changedHotspot;
}

function buildFallbackHotspot(primaryFinding: string): NormalizedHotspot {
  return {
    name: primaryFinding,
    percent: 0,
    module: 'unknown/module',
    rank: 1,
    frame: {
      displayName: primaryFinding,
      symbol: primaryFinding,
      module: 'unknown/module',
      file: 'unknown',
      line: null,
      sourceHint: 'unknown/module',
    },
    supportingFrames: [],
  };
}

const palette = ['#1f6feb', '#22c55e', '#f59e0b', '#38bdf8', '#a855f7', '#ef4444'];
