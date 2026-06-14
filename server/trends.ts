import type {
  TaskComparison,
  TaskDetail,
  TaskHistorySummary,
  TaskHotspotChange,
  TaskMetricSeries,
  TaskMetrics,
  TaskProcessContextSummary,
  TaskTrendTransition,
  TaskTrendsResponse,
} from '../shared/types.js';
import { compareTasks } from './comparison.js';
import { pressureScore } from './analysis/comparison-helpers.js';

const metricLabels: Record<keyof TaskMetrics, string> = {
  cpu: 'CPU 压力',
  blocked: '阻塞时间',
  gc: 'GC 压力',
  syscalls: 'Syscall 占比',
};

export function buildTaskTrends(taskId: string, tasks: TaskDetail[]): TaskTrendsResponse | null {
  const focus = tasks.find((task) => task.id === taskId) ?? null;
  if (!focus) {
    return null;
  }

  const scoped = tasks
    .filter(
      (task) =>
        task.target === focus.target &&
        task.collector === focus.collector &&
        task.scenario === focus.scenario &&
        (task.status === 'DONE' || task.status === 'FAILED'),
    )
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));

  const comparisons = new Map<string, TaskComparison>();
  for (let index = 1; index < scoped.length; index += 1) {
    const previous = scoped[index - 1]!;
    const current = scoped[index]!;
    comparisons.set(current.id, compareTasks(previous, current));
  }

  const transitions: TaskTrendTransition[] = scoped.slice(1).map((task, index) => ({
    baselineId: scoped[index]!.id,
    currentId: task.id,
    updatedAt: task.updatedAt,
    comparison: comparisons.get(task.id)!,
  }));

  const points = scoped.map((task, index) => {
    const comparison = comparisons.get(task.id) ?? null;
    const totalPressure = Number(pressureScore(task.metrics).toFixed(1));
    const topHotspot = task.topFunctions[0] ?? null;
    return {
      taskId: task.id,
      title: task.title,
      updatedAt: task.updatedAt,
      status: task.status,
      sampleCount: task.sampleCount,
      confidence: task.confidence,
      totalPressure,
      pressureDelta: comparison ? comparison.totalPressureDelta : null,
      verdictToPrevious: comparison?.verdict ?? ('initial' as const),
      metrics: task.metrics,
      topHotspot: topHotspot?.name ?? null,
      topHotspotPercent: topHotspot?.percent ?? null,
      topHotspotLocationSummary: topHotspot?.locationSummary ?? topHotspot?.module ?? null,
      topHotspotMappingState: topHotspot?.mappingState,
      processContext: buildProcessContextSummary(task),
      summary:
        comparison?.summary ??
        `这是当前历史范围内的首条可比运行。保留状态 ${task.status} / upload=${task.uploadState} / source=${task.sampleSource}。`,
      driverLabel: comparison?.driver?.label ?? null,
      driverEvidence: comparison?.driver?.evidence ?? null,
    };
  });

  const metricSeries: TaskMetricSeries[] = (Object.keys(metricLabels) as Array<keyof TaskMetrics>).map((metric) => ({
    metric,
    label: metricLabels[metric],
    points: scoped.map((task, index) => {
      const previous = scoped[index - 1];
      const currentValue = task.metrics[metric];
      const delta = previous ? Number((currentValue - previous.metrics[metric]).toFixed(1)) : null;
      return {
        taskId: task.id,
        updatedAt: task.updatedAt,
        value: currentValue,
        delta,
        trend:
          delta === null ? 'initial' : delta < 0 ? 'improved' : delta > 0 ? 'regressed' : 'flat',
      };
    }),
  }));

  const hotspotChanges: TaskHotspotChange[] = scoped.slice(1).map((task, index) => {
    const previous = scoped[index]!;
    const comparison = comparisons.get(task.id)!;
    return {
      baselineId: previous.id,
      currentId: task.id,
      updatedAt: task.updatedAt,
      verdict: comparison.verdict,
      pressureDelta: comparison.totalPressureDelta,
      kind: comparison.hotspotShift.kind,
      driverLabel: comparison.driver?.label ?? null,
      driverEvidence: comparison.driver?.evidence ?? null,
      baselineHotspot: comparison.hotspotShift.baselineTop,
      currentHotspot: comparison.hotspotShift.currentTop,
      summary: comparison.changedHotspot,
    };
  });

  const priorRuns = Math.max(0, scoped.length - 1);
  const latestComparison = comparisons.get(focus.id) ?? null;
  const historySummary = buildHistorySummary(focus.id, scoped, transitions);
  const streakText =
    historySummary.currentStreak.verdict === 'initial'
      ? '仅包含起点运行'
      : `${historySummary.currentStreak.length} 次连续${verdictLabel(historySummary.currentStreak.verdict)}`;
  const latestDriverText = historySummary.latestDriver
    ? ` 最近的主导 driver 是 ${historySummary.latestDriver.label}（${historySummary.latestDriver.delta > 0 ? '+' : ''}${historySummary.latestDriver.delta.toFixed(1)}）。${historySummary.latestDriver.evidence}`
    : '';
  const summary =
    priorRuns === 0
      ? `当前目标、collector 与 scenario 还没有更早的可比较运行。当前证据上下文为 ${focus.status} / upload=${focus.uploadState} / source=${focus.sampleSource}。`
      : latestComparison
        ? `当前任务位于一个 ${scoped.length} 次运行的历史序列中。最近一步的结论是 ${verdictLabel(latestComparison.verdict)}，综合压力变化为 ${latestComparison.totalPressureDelta > 0 ? '+' : ''}${latestComparison.totalPressureDelta.toFixed(1)}。当前范围正处于${streakText}。${latestDriverText} 当前证据上下文为 ${focus.status} / upload=${focus.uploadState} / source=${focus.sampleSource}。${historySummary.compatibilityWarnings.length > 0 ? ` 可比性提醒：${historySummary.compatibilityWarnings.join(' ')}` : ''}`
        : `当前任务属于一个 ${scoped.length} 次运行的历史序列，其中更早的可比较运行有 ${priorRuns} 次。当前范围正处于${streakText}。${latestDriverText} 当前证据上下文为 ${focus.status} / upload=${focus.uploadState} / source=${focus.sampleSource}。${historySummary.compatibilityWarnings.length > 0 ? ` 可比性提醒：${historySummary.compatibilityWarnings.join(' ')}` : ''}`;

  return {
    taskId: focus.id,
    scope: {
      target: focus.target,
      collector: focus.collector,
      scenario: focus.scenario,
    },
    summary,
    historySummary,
    latestComparison,
    points,
    metricSeries,
    hotspotChanges,
    transitions,
  };
}

function buildHistorySummary(
  focusTaskId: string,
  scoped: TaskDetail[],
  transitions: TaskTrendTransition[],
): TaskHistorySummary {
  const verdictCounts: TaskHistorySummary['verdictCounts'] = {
    regression: 0,
    improvement: 0,
    mixed: 0,
    neutral: 0,
  };

  for (const transition of transitions) {
    verdictCounts[transition.comparison.verdict] += 1;
  }

  const focusIndex = Math.max(0, scoped.findIndex((task) => task.id === focusTaskId));
  const currentStreak = deriveCurrentStreak(transitions);
  const latestDriver = transitions.at(-1)?.comparison.driver ?? null;
  const attachSources = [...new Set(scoped.map((task) => task.targetContext.attachSource))];
  const targetTypes = [...new Set(scoped.map((task) => task.targetContext.targetType))];
  const processVariants = new Set(
    scoped.map((task) => {
      const info = task.targetContext.processInfo;
      return info ? `${info.pid}|${info.name}|${normalizeProcessSignature(info.commandSummary || info.command)}` : 'none';
    }),
  ).size;
  const compatibilityWarnings = Array.from(
    new Set(transitions.flatMap((transition) => transition.comparison.compatibility.warnings)),
  );

  return {
    runCount: scoped.length,
    focusIndex,
    verdictCounts,
    processVariants,
    attachSources,
    targetTypes,
    compatibilityWarnings,
    currentStreak,
    latestDriver,
  };
}

function deriveCurrentStreak(transitions: TaskTrendTransition[]) {
  if (transitions.length === 0) {
    return {
      verdict: 'initial' as const,
      length: 1,
    };
  }

  const latestVerdict = transitions.at(-1)!.comparison.verdict;
  let length = 0;
  for (let index = transitions.length - 1; index >= 0; index -= 1) {
    if (transitions[index]!.comparison.verdict !== latestVerdict) {
      break;
    }
    length += 1;
  }

  return {
    verdict: latestVerdict,
    length,
  };
}

function buildProcessContextSummary(task: TaskDetail): TaskProcessContextSummary {
  const info = task.targetContext.processInfo;
  const processSummary = info
    ? `PID ${info.pid}${info.name ? ` • ${info.name}` : ''}${info.languageHint ? ` • ${info.languageHint}` : ''}${info.commandSummary ? ` • ${info.commandSummary}` : ''}`
    : '未保留真实进程元数据';
  return {
    targetType: task.targetContext.targetType,
    attachSource: task.targetContext.attachSource,
    processInfo: info,
    summary: `${targetTypeLabel(task.targetContext.targetType)} · ${attachSourceLabel(task.targetContext.attachSource)} · ${processSummary}`,
  };
}

function normalizeProcessSignature(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function verdictLabel(verdict: TaskComparison['verdict']) {
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

function targetTypeLabel(targetType: TaskDetail['targetContext']['targetType']) {
  switch (targetType) {
    case 'pid':
      return '指定 PID';
    case 'process':
      return '选择进程';
    default:
      return '逻辑目标';
  }
}

function attachSourceLabel(source: TaskDetail['targetContext']['attachSource']) {
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
