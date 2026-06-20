import type { ComparisonCompatibility, TaskComparison, TaskDetail, TaskProcessContextSummary } from '../shared/types.js';
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
  const compatibility = buildComparisonCompatibility(baseline, current);
  const sharedFinding = buildSharedFinding(baseline, current);
  const metricSummary = {
    strongest: strongestMetric,
    regressions: metricDeltas.filter((item) => item.trend === 'regressed'),
    improvements: metricDeltas.filter((item) => item.trend === 'improved'),
    stable: metricDeltas.filter((item) => item.trend === 'flat'),
  };
  const driver = strongestMetric
    ? {
        label: strongestMetric.label,
        trend: strongestMetric.trend,
        delta: strongestMetric.delta,
        evidence: `${strongestMetric.label} 从 ${strongestMetric.before}% 变化到 ${strongestMetric.after}%（${formatDelta(strongestMetric.delta)}）。${buildDriverHotspotContext(baseline, current)}${buildCaptureContextEvidence(baseline, current)}${compatibility.warnings[0] ? ` 可比性提示：${compatibility.warnings[0]}` : ''}`,
        hotspotLocationSummary: current.topFunctions[0]?.locationSummary ?? current.topFunctions[0]?.module ?? null,
      }
    : null;
  const hotspotShift = buildHotspotShift(baseline, current, hotspotMovement);
  const hotspotContext =
    hotspotShift.kind === 'replaced'
      ? ' 主热点领导位已经发生切换。'
      : hotspotShift.kind === 'stable'
        ? ' 主热点领导位保持稳定。'
        : '';

  const summary =
    verdict === 'regression'
      ? `当前运行相较基线恶化了 ${formatDelta(totalPressureDelta)} 压力。${strongestMetric ? `${strongestMetric.label} 的变化最明显。` : ''}${hotspotContext}`
      : verdict === 'improvement'
        ? `当前运行相较基线改善了 ${formatDelta(Math.abs(totalPressureDelta))} 压力。${strongestMetric ? `${strongestMetric.label} 的改善最明显。` : ''}${hotspotContext}`
        : verdict === 'mixed'
          ? `当前运行呈混合状态：部分信号改善，部分信号回退。${strongestMetric ? `最大变化来自 ${strongestMetric.label}。` : ''}${hotspotContext}`
          : `当前运行与基线基本持平。${hotspotContext}`;
  const compatibilitySuffix =
    compatibility.warnings.length > 0 ? ` 可比性提醒：${compatibility.warnings.join(' ')}` : '';

  return {
    baselineId: baseline.id,
    currentId: current.id,
    verdict,
    summary: `${summary}${compatibilitySuffix}`,
    confidenceDelta,
    totalPressureDelta,
    metricDeltas,
    changedHotspot,
    sharedFinding,
    baseline: buildComparisonTaskSnapshot(baseline, baselinePressure),
    current: buildComparisonTaskSnapshot(current, currentPressure),
    hotspotShift,
    metricSummary,
    driver,
    compatibility,
    evidence: [
      `${summary}${compatibilitySuffix}`,
      changedHotspot,
      driver?.evidence ?? '当前没有识别出唯一的主导指标变化。',
      sharedFinding,
      buildCaptureContextEvidence(baseline, current).trim(),
      ...compatibility.warnings,
    ],
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

  const sharedWithLocations = shared
    .map((name) => {
      const currentHotspot = current.topFunctions.find((item) => item.name === name) ?? null;
      return currentHotspot?.locationSummary ? `${name} @ ${currentHotspot.locationSummary}` : name;
    })
    .join(', ');

  return `共同热点：${sharedWithLocations}。基线结论：${baseline.primaryFinding}；当前结论：${current.primaryFinding}`;
}

function buildCaptureContextEvidence(baseline: TaskDetail, current: TaskDetail) {
  const baselineContext = `${baseline.status}/upload=${baseline.uploadState}/source=${baseline.sampleSource}`;
  const currentContext = `${current.status}/upload=${current.uploadState}/source=${current.sampleSource}`;
  return ` 基线证据上下文 ${baselineContext}；当前证据上下文 ${currentContext}。`;
}

function buildComparisonTaskSnapshot(task: TaskDetail, totalPressure: number) {
  const top = task.topFunctions[0] ?? null;
  return {
    taskId: task.id,
    title: task.reportTitle,
    updatedAt: task.updatedAt,
    confidence: task.confidence,
    sampleCount: task.sampleCount,
    totalPressure: Number(totalPressure.toFixed(1)),
    topHotspot: top
      ? {
          name: top.name,
          module: top.module,
          percent: top.percent,
          rank: 1,
          locationSummary: top.locationSummary,
          mappingState: top.mappingState,
        }
      : null,
    processContext: buildProcessContextSummary(task),
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

function buildComparisonCompatibility(baseline: TaskDetail, current: TaskDetail): ComparisonCompatibility {
  const baselineInfo = baseline.targetContext.processInfo;
  const currentInfo = current.targetContext.processInfo;
  const sameTargetType = baseline.targetContext.targetType === current.targetContext.targetType;
  const sameAttachSource = baseline.targetContext.attachSource === current.targetContext.attachSource;
  const sameProcessIdentity =
    baselineInfo && currentInfo
      ? baselineInfo.pid === currentInfo.pid &&
        normalizeProcessSignature(baselineInfo.commandSummary || baselineInfo.command) ===
          normalizeProcessSignature(currentInfo.commandSummary || currentInfo.command) &&
        baselineInfo.name === currentInfo.name
      : null;

  const warnings: string[] = [];
  if (isFallbackLikeRun(baseline) || isFallbackLikeRun(current)) {
    warnings.push('至少一侧运行仍依赖 fallback 采样路径，默认不建议把它作为趋势或基线。');
  }
  if (!sameTargetType) {
    warnings.push(
      `目标模式从 ${targetTypeLabel(baseline.targetContext.targetType)} 变成了 ${targetTypeLabel(current.targetContext.targetType)}，历史对比可能混入不同采样入口。`,
    );
  }
  if (!sameAttachSource) {
    warnings.push(
      `采样路径从 ${attachSourceLabel(baseline.targetContext.attachSource)} 变成了 ${attachSourceLabel(current.targetContext.attachSource)}，运行来源并不完全一致。`,
    );
  }
  if (baselineInfo && currentInfo) {
    if (baselineInfo.pid !== currentInfo.pid) {
      warnings.push(`PID 从 ${baselineInfo.pid} 变化到 ${currentInfo.pid}；热点迁移更适合作为跨进程证据，而不是同一进程内的精确漂移。`);
    }
    const baselineSignature = normalizeProcessSignature(baselineInfo.commandSummary || baselineInfo.command);
    const currentSignature = normalizeProcessSignature(currentInfo.commandSummary || currentInfo.command);
    if (baselineSignature !== currentSignature || baselineInfo.name !== currentInfo.name) {
      warnings.push(
        `保留的进程身份从 ${baselineInfo.name} 变成了 ${currentInfo.name}；命令行或二进制上下文已经不是一一对应的比较。`,
      );
    }
  } else if (baselineInfo || currentInfo) {
    warnings.push('只有一侧保留了真实进程元数据，因此当前可比性只限于逻辑目标范围。');
  }

  return {
    sameTargetType,
    sameAttachSource,
    sameProcessIdentity,
    warnings,
  };
}

function normalizeProcessSignature(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildDriverHotspotContext(baseline: TaskDetail, current: TaskDetail) {
  const baselineHotspot = baseline.topFunctions[0] ?? null;
  const currentHotspot = current.topFunctions[0] ?? null;
  if (!baselineHotspot && !currentHotspot) {
    return ' 当前没有可用于这次对比的主热点位置。';
  }
  if (!baselineHotspot || !currentHotspot) {
    return ` 主热点上下文切换到了 ${currentHotspot?.locationSummary ?? currentHotspot?.module ?? baselineHotspot?.locationSummary ?? baselineHotspot?.module ?? '未知位置'}。`;
  }

  const baselineLocation = baselineHotspot.locationSummary ?? baselineHotspot.module;
  const currentLocation = currentHotspot.locationSummary ?? currentHotspot.module;
  if (baselineHotspot.name === currentHotspot.name && baselineLocation === currentLocation) {
    return ` ${currentHotspot.name} 仍然稳定停留在 ${currentLocation}。`;
  }
  return ` 主热点从 ${baselineHotspot.name}（${baselineLocation}）移动到了 ${currentHotspot.name}（${currentLocation}）。`;
}

function buildHotspotShift(
  baseline: TaskDetail,
  current: TaskDetail,
  movement: ReturnType<typeof describeHotspotMovement>,
) {
  const baselineTop = baseline.topFunctions[0] ?? null;
  const currentTop = current.topFunctions[0] ?? null;
  const baselineNames = baseline.topFunctions.slice(0, 4).map((item) => item.name);
  const currentNames = current.topFunctions.slice(0, 4).map((item) => item.name);
  const sharedHotspots = currentNames.filter((name) => baselineNames.includes(name));
  const overlapRatio = baselineNames.length === 0 ? 0 : sharedHotspots.length / baselineNames.length;
  const newHotspots = currentNames.filter((name) => !baselineNames.includes(name));
  const droppedHotspots = baselineNames.filter((name) => !currentNames.includes(name));

  return {
    kind: movement.kind as import('../shared/types.js').HotspotShiftKind,
    summary: movement.summary,
    attribution: movement.attribution,
    emphasis: movement.emphasis,
    overlapCount: sharedHotspots.length,
    overlapRatio: Number(overlapRatio.toFixed(2)),
    sharedHotspots,
    newHotspots,
    droppedHotspots,
    baselineTop: baselineTop
      ? {
          name: baselineTop.name,
          module: baselineTop.module,
          percent: baselineTop.percent,
          rank: 1,
          locationSummary: baselineTop.locationSummary,
          mappingState: baselineTop.mappingState,
        }
      : null,
    currentTop: currentTop
      ? {
          name: currentTop.name,
          module: currentTop.module,
          percent: currentTop.percent,
          rank: 1,
          locationSummary: currentTop.locationSummary,
          mappingState: currentTop.mappingState,
        }
      : null,
  };
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

function isFallbackLikeRun(task: TaskDetail) {
  return task.targetContext.attachSource === 'managed-fallback' || task.sampleSource.toLowerCase().includes('fallback');
}
