import type { ComparisonTrend, MetricDelta, TaskDetail, TaskMetrics } from '../../shared/types.js';

const metricLabels: Record<keyof TaskMetrics, string> = {
  cpu: 'CPU pressure',
  blocked: 'Blocked time',
  gc: 'GC pressure',
  syscalls: 'Syscall share',
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
      summary: 'Hotspot movement could not be determined because both runs lacked ranked stacks.',
      attribution: 'No comparable hotspot data was available.',
      emphasis: 'flat' as ComparisonTrend,
    };
  }

  if (baselineTop?.name === currentTop?.name) {
    const delta = (currentTop?.percent ?? 0) - (baselineTop?.percent ?? 0);
    if (delta >= 6) {
      return {
        kind: 'intensified',
        summary: `Hotspot stayed on ${currentTop?.name ?? 'the same path'} and intensified by ${delta.toFixed(1)}%.`,
        attribution: `${currentTop?.name ?? 'The dominant path'} concentrated more sampled time while neighboring hotspots stayed secondary.`,
        emphasis: 'regressed' as ComparisonTrend,
      };
    }
    if (delta <= -6) {
      return {
        kind: 'cooled',
        summary: `Hotspot stayed on ${currentTop?.name ?? 'the same path'} but cooled by ${Math.abs(delta).toFixed(1)}%.`,
        attribution: `${currentTop?.name ?? 'The dominant path'} still leads the stack, but its share dropped enough to suggest dispersion.`,
        emphasis: 'improved' as ComparisonTrend,
      };
    }

    return {
      kind: 'anchored',
      summary: `Hotspot remains anchored on ${currentTop?.name ?? 'the same path'}.`,
      attribution: `${currentTop?.name ?? 'The dominant path'} stayed on top with ${shared.length} supporting hotspots preserved across both runs.`,
      emphasis: 'flat' as ComparisonTrend,
    };
  }

  if (shared.length >= 2) {
    return {
      kind: 'reordered',
      summary: `Hotspot leadership shifted from ${baselineTop?.name ?? 'n/a'} to ${currentTop?.name ?? 'n/a'} within the same hotspot cluster.`,
      attribution: `${shared.join(', ')} remained in the top stack set, so the profile likely reordered existing pressure instead of introducing a brand-new path.`,
      emphasis: 'flat' as ComparisonTrend,
    };
  }

  if (overlap > 0) {
    return {
      kind: 'shifted',
      summary: `Hotspot shifted from ${baselineTop?.name ?? 'n/a'} to ${currentTop?.name ?? 'n/a'}.`,
      attribution: `Only ${shared.length} hotspot(s) overlapped, which suggests pressure moved toward ${currentTop?.module ?? 'a new module'}.`,
      emphasis: 'regressed' as ComparisonTrend,
    };
  }

  return {
    kind: 'replaced',
    summary: `Hotspot completely rotated from ${baselineTop?.name ?? 'n/a'} to ${currentTop?.name ?? 'n/a'}.`,
    attribution: `The leading stack set no longer overlaps, so a fresh execution path likely became dominant.`,
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
