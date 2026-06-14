import type { ComparisonTrend, MetricDelta, TaskDetail, TaskMetrics } from '../../shared/types.js';

const metricLabels: Record<keyof TaskMetrics, string> = {
  cpu: 'CPU 压力',
  blocked: '阻塞时间',
  gc: 'GC 压力',
  syscalls: 'Syscall 占比',
};

const metricDirection: Record<keyof TaskMetrics, boolean> = {
  cpu: false,
  blocked: false,
  gc: false,
  syscalls: false,
};

export function buildMetricDeltas(baseline: TaskDetail, current: TaskDetail): MetricDelta[] {
  return (Object.keys(metricLabels) as Array<keyof TaskMetrics>).map((metric) => {
    const before = baseline.metrics[metric];
    const after = current.metrics[metric];
    const delta = Number((after - before).toFixed(1));
    const higherIsBetter = metricDirection[metric];
    const trend = classifyMetricTrend(delta, higherIsBetter);

    return {
      metric,
      label: metricLabels[metric],
      higherIsBetter,
      before,
      after,
      delta,
      trend,
    };
  });
}

export function pressureScore(metrics: TaskMetrics) {
  return metrics.cpu * 0.45 + metrics.blocked * 0.3 + metrics.gc * 0.2 + metrics.syscalls * 0.05;
}

export function describeHotspotMovement(baseline: TaskDetail, current: TaskDetail) {
  const baselineTop = baseline.topFunctions[0] ?? null;
  const currentTop = current.topFunctions[0] ?? null;
  const baselineNames = new Set(baseline.topFunctions.slice(0, 4).map((item) => item.name));
  const currentNames = new Set(current.topFunctions.slice(0, 4).map((item) => item.name));
  const shared = [...currentNames].filter((name) => baselineNames.has(name));
  const overlap = baselineNames.size > 0 ? shared.length / baselineNames.size : 0;

  if (!baselineTop && !currentTop) {
    return {
      kind: 'stable',
      summary: '两次运行都没有保留可排序栈，因此暂时无法判断热点迁移。',
      attribution: '当前没有可比较的热点数据。',
      emphasis: 'flat' as ComparisonTrend,
    };
  }

  if (baselineTop?.name === currentTop?.name && baselineTop.module !== currentTop?.module) {
    return {
      kind: 'module-shifted',
      summary: `热点仍然是 ${formatHotspotName(currentTop)}，但位置从 ${formatHotspotLocation(baselineTop)} 移动到了 ${formatHotspotLocation(currentTop)}。`,
      attribution: `${formatHotspotName(currentTop)} 依旧主导画像，但主要来源位置已经切换到新的模块或符号化位置。`,
      emphasis: 'regressed' as ComparisonTrend,
    };
  }

  if (
    baselineTop?.name === currentTop?.name &&
    baselineTop.locationSummary &&
    currentTop?.locationSummary &&
    baselineTop.locationSummary !== currentTop.locationSummary
  ) {
    return {
      kind: 'module-shifted',
      summary: `热点仍然是 ${formatHotspotName(currentTop)}，但可读位置从 ${baselineTop.locationSummary} 变成了 ${currentTop.locationSummary}。`,
      attribution: `${formatHotspotName(currentTop)} 仍然占主导，但两次运行映射出的代码位置已经发生变化。`,
      emphasis: 'regressed' as ComparisonTrend,
    };
  }

  if (baselineTop?.name === currentTop?.name) {
    const delta = (currentTop?.percent ?? 0) - (baselineTop?.percent ?? 0);
    if (delta >= 6) {
      return {
        kind: 'intensified',
        summary: `热点仍然集中在 ${formatHotspotName(currentTop)}（${formatHotspotLocation(currentTop)}），占比上升了 ${delta.toFixed(1)}%。`,
        attribution: `${formatHotspotName(currentTop)} 吸收了更多采样时间，周边热点仍处于次要位置。`,
        emphasis: 'regressed' as ComparisonTrend,
      };
    }
    if (delta <= -6) {
      return {
        kind: 'cooled',
        summary: `热点仍然集中在 ${formatHotspotName(currentTop)}（${formatHotspotLocation(currentTop)}），但占比下降了 ${Math.abs(delta).toFixed(1)}%。`,
        attribution: `${formatHotspotName(currentTop)} 虽然还在栈顶，但占比已经明显回落，说明压力开始分散。`,
        emphasis: 'improved' as ComparisonTrend,
      };
    }

    return {
      kind: 'anchored',
      summary: `热点稳定锚定在 ${formatHotspotName(currentTop)}（${formatHotspotLocation(currentTop)}）。`,
      attribution: `${formatHotspotName(currentTop)} 持续位于首位，并且两次运行保留了 ${shared.length} 个共同支撑热点。`,
      emphasis: 'flat' as ComparisonTrend,
    };
  }

  if (shared.length >= 2) {
    const previousRank = baseline.topFunctions.findIndex((item) => item.name === currentTop?.name);
    return {
      kind: 'reordered',
      summary: `主热点在同一组热点簇中从 ${formatHotspotName(baselineTop)} 切换成了 ${formatHotspotName(currentTop)}。`,
      attribution: `${shared.join(', ')} 仍然留在头部栈集合中，因此更像是已有压力重新排序，而不是出现了全新的执行路径${previousRank >= 0 ? `；${formatHotspotName(currentTop)} 是从第 ${previousRank + 1} 位升上来的` : ''}。`,
      emphasis: 'flat' as ComparisonTrend,
    };
  }

  if (overlap > 0) {
    return {
      kind: 'shifted',
      summary: `主热点从 ${formatHotspotName(baselineTop)}（${formatHotspotLocation(baselineTop)}）迁移到了 ${formatHotspotName(currentTop)}（${formatHotspotLocation(currentTop)}）。`,
      attribution: `只有 ${shared.length} 个热点仍然重合，说明压力正在向 ${formatHotspotLocation(currentTop)} 转移。`,
      emphasis: 'regressed' as ComparisonTrend,
    };
  }

  return {
    kind: 'replaced',
    summary: `主热点已经从 ${formatHotspotName(baselineTop)} 完全轮换成 ${formatHotspotName(currentTop)}。`,
    attribution: `头部栈集合已经没有重合，说明新的执行路径很可能在 ${formatHotspotLocation(currentTop)} 成为了主导。`,
    emphasis: 'regressed' as ComparisonTrend,
  };
}

export function deriveVerdict(metricDeltas: MetricDelta[], totalPressureDelta: number) {
  const regressions = metricDeltas.filter((item) => item.trend === 'regressed').length;
  const improvements = metricDeltas.filter((item) => item.trend === 'improved').length;

  if (regressions > 0 && improvements > 0) {
    if (totalPressureDelta >= 4) {
      return 'regression' as const;
    }
    if (totalPressureDelta <= -4) {
      return 'improvement' as const;
    }
    return 'mixed' as const;
  }

  if (regressions > 0) {
    return 'regression' as const;
  }

  if (improvements > 0) {
    return 'improvement' as const;
  }

  return 'neutral' as const;
}

export function strongestMetricDelta(metricDeltas: MetricDelta[]) {
  return metricDeltas
    .slice()
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))[0] ?? null;
}

export function formatDelta(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function classifyMetricTrend(delta: number, higherIsBetter: boolean): ComparisonTrend {
  if (delta === 0) {
    return 'flat';
  }

  const improved = higherIsBetter ? delta > 0 : delta < 0;
  return improved ? 'improved' : 'regressed';
}

function formatHotspotName(hotspot: TaskDetail['topFunctions'][number] | null) {
  return hotspot?.name ?? 'n/a';
}

function formatHotspotLocation(hotspot: TaskDetail['topFunctions'][number] | null) {
  return hotspot?.locationSummary ?? hotspot?.module ?? '未知热点位置';
}
