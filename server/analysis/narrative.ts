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
    timeline: buildTimeline(context, hotspotMovement),
    findings: buildFindings(context, dominant, hotspotMovement, trendDriver),
    insights: buildInsights(context, dominant, hotspotMovement, trendDriver),
    flameGraph: buildFlameGraph(context.run.title, context.run.hotspots),
    trendDriver,
  };
}

function buildTimeline(context: AnalysisContext, hotspotMovement: string | null) {
  const start = new Date();
  const stamps = [0, 1100, 2200, 3300].map((offset) => new Date(start.getTime() + offset));
  const baselineText = context.comparison
    ? `${context.comparison.summary} ${hotspotMovement ?? context.comparison.changedHotspot}`
    : 'No prior baseline was available for this run.';

  return [
    {
      at: stamps[0].toISOString(),
      title: 'Real workload launched',
      detail: `Collector ${context.task.collectorName} started a real profiling run.`,
    },
    {
      at: stamps[1].toISOString(),
      title: 'Sampling complete',
      detail: `The collector captured files and signals for ${context.run.title}${context.run.usedRealData ? ` across ${Math.max(1, context.run.stackCount)} stack shape(s)` : ''}.`,
    },
    {
      at: stamps[2].toISOString(),
      title: 'Frames normalized',
      detail:
        context.outcome.logs[0] ??
        `Normalized stack evidence${context.run.threadCount > 0 ? ` spanned ${context.run.threadCount} profiled thread(s)` : ' was captured from the sampled process'}.`,
    },
    { at: stamps[3].toISOString(), title: 'Trend attributed', detail: baselineText },
  ];
}

function buildFindings(
  context: AnalysisContext,
  dominant: NormalizedHotspot,
  hotspotMovement: string | null,
  trendDriver: AnalysisNarrative['trendDriver'],
) {
  const findings: TaskFinding[] = [];

  findings.push({
    title: `${dominant.name} dominates the sampled stack`,
    severity: dominant.percent >= 30 ? 'high' : 'medium',
    evidence: `${dominant.name} accounts for ${dominant.percent}% of the measured time in ${dominant.frame.module}:${dominant.frame.line ?? 'n/a'} across ${dominant.sampleCount} sample(s). ${describeRepresentativeStack(dominant)}`,
    recommendation: `Reduce the work done in ${dominant.name} and confirm the share drops below ${Math.max(10, dominant.percent - 10)}% after the fix.`,
  });

  if (context.comparison) {
    findings.push({
      title: `Baseline comparison is ${context.comparison.verdict}`,
      severity:
        context.comparison.verdict === 'regression'
          ? 'high'
          : context.comparison.verdict === 'improvement'
            ? 'medium'
            : 'info',
      evidence: `${context.comparison.summary} ${hotspotMovement ?? context.comparison.changedHotspot}`,
      recommendation:
        context.comparison.verdict === 'regression'
          ? `Investigate ${trendDriver?.label ?? 'the hottest changed metric'} and re-run the same scenario after the patch.`
          : 'Keep the current change set, then re-sample to confirm the trend persists.',
    });
  }

  findings.push({
    title: context.run.usedRealData ? 'Collector output preserved structured stack evidence' : 'Collector output fell back to synthetic hotspot evidence',
    severity: context.outcome.logs.length > 0 ? 'medium' : 'info',
    evidence: context.run.usedRealData
      ? `Captured ${context.run.hotspots.length} ranked hotspots from ${context.run.stackCount} unique stack shape(s)${context.run.threadCount > 0 ? ` across ${context.run.threadCount} thread(s)` : ''}.`
      : `Captured ${context.run.hotspots.length} ranked hotspots with CPU ${context.run.metrics.cpu}%, blocked ${context.run.metrics.blocked}% and GC ${context.run.metrics.gc}% via fallback sources.`,
    recommendation: `Use the captured artifacts from ${context.task.collectorName} as the reference run for the next comparison.`,
  });

  return findings.slice(0, 3);
}

function buildInsights(
  context: AnalysisContext,
  dominant: NormalizedHotspot,
  hotspotMovement: string | null,
  trendDriver: AnalysisNarrative['trendDriver'],
) {
  const cpuDirection =
    context.run.metrics.cpu >= 70 ? 'regressed' : context.run.metrics.cpu <= 40 ? 'improved' : 'flat';

  const insights: TrendInsight[] = [
    {
      title: 'Hotspot concentration',
      direction: dominant.percent >= 30 ? 'regressed' : 'improved',
      evidence: `${dominant.name} owns ${dominant.percent}% of sampled time and resolves to ${dominant.frame.file}:${dominant.frame.line ?? 'n/a'}. ${describeCallerSpread(dominant)}`,
      attribution: dominant.frame.sourceHint,
    },
    {
      title: 'Pressure driver',
      direction: trendDriver?.trend ?? cpuDirection,
      evidence:
        trendDriver?.evidence ??
        `CPU share landed at ${context.run.metrics.cpu}% while blocked time sat at ${context.run.metrics.blocked}%.`,
      attribution: trendDriver?.label ?? 'workload report',
    },
    {
      title: 'Baseline trajectory',
      direction:
        context.comparison?.verdict === 'regression'
          ? 'regressed'
          : context.comparison?.verdict === 'improvement'
            ? 'improved'
            : 'flat',
      evidence: context.comparison?.summary ?? 'No prior run was available for trend attribution.',
      attribution: hotspotMovement ?? context.comparison?.changedHotspot ?? context.outcome.logs[0] ?? 'collector log',
    },
  ];

  return insights;
}

function buildAnalysisSummary(context: AnalysisContext, dominant: NormalizedHotspot) {
  const secondary = context.run.hotspots[1];
  const source = `${dominant.frame.file}:${dominant.frame.line ?? 'n/a'}`;
  const secondaryText = secondary ? ` Secondary pressure sits on ${secondary.name} at ${secondary.percent}%.` : '';
  const realSourceText = context.run.usedRealData
    ? ` Normalization preserved ${context.run.stackCount} stack shape(s)${context.run.threadCount > 0 ? ` across ${context.run.threadCount} thread(s)` : ''}.`
    : ' The current report is still relying on fallback hotspot evidence.';
  return `${context.run.title} captured ${context.run.sampleCount} samples from ${context.run.sampleSource}. ${context.run.summary}${realSourceText} The current dominant hotspot is ${dominant.name} at ${source}.${secondaryText}`;
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
      children: buildFlameChildren(hotspot.name, hotspot.percent, index, hotspot),
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

function buildFlameChildren(name: string, percent: number, index: number, hotspot: NormalizedHotspot) {
  const first = Math.max(1, Math.round(percent * 0.62));
  const second = Math.max(1, percent - first);
  const supportNames = hotspot.supportingFrames.map((frame) => frame.displayName);
  const representativeNames = hotspot.representativeStack.slice(-3, -1).map((frame) => frame.displayName);
  return [
    {
      name: supportNames[0] ?? representativeNames[0] ?? `${name}:core`,
      value: first,
      color: palette[(index + 1) % palette.length],
    },
    {
      name: supportNames[1] ?? representativeNames[1] ?? `${name}:support`,
      value: second,
      color: palette[(index + 2) % palette.length],
    },
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
    sampleWeight: 0,
    sampleCount: 0,
    threadCount: 0,
    threadLabels: [],
    supportingFrames: [],
    representativeStack: [],
  };
}

function describeRepresentativeStack(hotspot: NormalizedHotspot) {
  const representative = hotspot.representativeStack.map((frame) => frame.displayName);
  if (representative.length <= 1) {
    return `Representative stack stays centered on ${hotspot.name}.`;
  }

  return `Representative path: ${representative.join(' -> ')}.`;
}

function describeCallerSpread(hotspot: NormalizedHotspot) {
  if (hotspot.supportingFrames.length === 0) {
    return 'No caller spread was retained for this hotspot.';
  }

  const callers = hotspot.supportingFrames.map((frame) => frame.displayName).slice(0, 3);
  return `The strongest callers were ${callers.join(', ')}.`;
}

const palette = ['#1f6feb', '#22c55e', '#f59e0b', '#38bdf8', '#a855f7', '#ef4444'];
