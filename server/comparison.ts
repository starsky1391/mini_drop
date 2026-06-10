import type { TaskComparison, TaskDetail } from '../shared/types.js';
import {
  buildMetricDeltas,
  deriveVerdict,
  describeHotspotMovement,
  formatDelta,
  pressureScore,
  strongestMetricDelta,
} from './analysis/comparison-helpers.js';

export function compareTasks(baseline: TaskDetail, current: TaskDetail): TaskComparison {
  const metricDeltas = buildMetricDeltas(baseline, current);
  const baselinePressure = pressureScore(baseline.metrics);
  const currentPressure = pressureScore(current.metrics);
  const totalPressureDelta = Number((currentPressure - baselinePressure).toFixed(1));
  const confidenceDelta = Number(((current.confidence - baseline.confidence) * 100).toFixed(1));
  const hotspotMovement = describeHotspotMovement(baseline, current);
  const changedHotspot = `${hotspotMovement.summary} ${hotspotMovement.attribution}`.trim();
  const verdict = deriveVerdict(metricDeltas, totalPressureDelta);
  const strongestMetric = strongestMetricDelta(metricDeltas);
  const sharedFinding = buildSharedFinding(baseline, current);

  const summary =
    verdict === 'regression'
      ? `Current run looks worse than the baseline by ${formatDelta(totalPressureDelta)} pressure.${strongestMetric ? ` ${strongestMetric.label} moved the most.` : ''}`
      : verdict === 'improvement'
        ? `Current run looks better than the baseline by ${formatDelta(Math.abs(totalPressureDelta))} pressure.${strongestMetric ? ` ${strongestMetric.label} improved the most.` : ''}`
        : verdict === 'mixed'
          ? `Current run is mixed: some signals improved while others regressed.${strongestMetric ? ` The largest movement came from ${strongestMetric.label}.` : ''}`
          : `Current run is effectively flat against the baseline.`;

  return {
    baselineId: baseline.id,
    currentId: current.id,
    verdict,
    summary,
    confidenceDelta,
    totalPressureDelta,
    metricDeltas,
    changedHotspot,
    sharedFinding,
  };
}

function buildSharedFinding(baseline: TaskDetail, current: TaskDetail) {
  const shared = current.topFunctions
    .map((item) => item.name)
    .filter((name) => baseline.topFunctions.some((candidate) => candidate.name === name))
    .slice(0, 3);

  if (shared.length === 0) {
    return `${baseline.primaryFinding} vs ${current.primaryFinding}`;
  }

  return `Shared hotspots: ${shared.join(', ')}. ${baseline.primaryFinding} vs ${current.primaryFinding}`;
}
