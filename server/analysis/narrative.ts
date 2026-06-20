import type { FlameNode, TaskComparison, TaskDetail, TaskFinding, TaskMetrics, TrendInsight } from '../../shared/types.js';
import { formatDelta, strongestMetricDelta } from './comparison-helpers.js';
import type { AnalysisContext, AnalysisNarrative, NormalizedHotspot } from './types.js';

type FlameTreeNode = FlameNode & {
  children?: FlameTreeNode[];
};

export function buildQueuedTimeline(signal: string) {
  const start = new Date();
  const stamps = [0, 900, 1800, 2700].map((offset) => new Date(start.getTime() + offset));
  return [
    { at: stamps[0].toISOString(), title: '任务已入队', detail: `已进入 ${signal} 采样队列。` },
    { at: stamps[1].toISOString(), title: 'workload 已就绪', detail: '真实 workload 进程即将进入采样。' },
    { at: stamps[2].toISOString(), title: '等待采集器', detail: '已选择的采集器下一步会 attach 或包裹目标 workload。' },
    { at: stamps[3].toISOString(), title: '等待分析', detail: '运行完成后会补充趋势归因与对比结论。' },
  ];
}

export function buildAnalysisNarrative(context: AnalysisContext): AnalysisNarrative {
  const dominant = context.run.hotspots[0] ?? buildFallbackHotspot(context.task.primaryFinding);
  const hotspotMovement = context.comparison ? describeHotspotMovementFromComparison(context.task, context.comparison) : null;
  const trendDriver = context.comparison ? deriveTrendDriver(context.comparison) : null;
  const symbolization = summarizeSymbolization(context.run.hotspots);
  const evidenceStatus = summarizeEvidenceStatus(context);

  return {
    confidence: computeConfidence(context.run.metrics, dominant.percent, context.run.sampleCount, dominant.frame.mappingState),
    primaryFinding: `${dominant.name} 是当前最主要的热路径${symbolization.dominantSuffix}。`,
    analysisSummary: buildAnalysisSummary(context, dominant),
    trendSummary: buildTrendSummary(context.comparison, hotspotMovement, trendDriver),
    timeline: buildTimeline(context, hotspotMovement),
    findings: buildFindings(context, dominant, hotspotMovement, trendDriver, evidenceStatus),
    insights: buildInsights(context, dominant, hotspotMovement, trendDriver),
    flameGraph: buildFlameGraph(context.run.title, context.run.topStacks, context.run.hotspots),
    trendDriver,
  };
}

function buildTimeline(context: AnalysisContext, hotspotMovement: string | null) {
  const start = new Date();
  const stamps = [0, 1100, 2200, 3300].map((offset) => new Date(start.getTime() + offset));
  const compatibilitySuffix =
    context.comparison?.compatibility.warnings.length
      ? ` 可比性提示：${context.comparison.compatibility.warnings.join(' ')}`
      : '';
  const baselineText = context.comparison
    ? `${context.comparison.summary} ${hotspotMovement ?? context.comparison.changedHotspot}${compatibilitySuffix}`
    : '这次运行还没有可用的历史基线。';

  return [
    {
      at: stamps[0].toISOString(),
      title: '真实 workload 已启动',
      detail: `Collector ${context.task.collectorName} 已开始真实剖析运行。`,
    },
    {
      at: stamps[1].toISOString(),
      title: '采样完成',
      detail: `采集器已经为 ${context.run.title} 保留了文件与信号${context.run.usedRealData ? `，覆盖 ${Math.max(1, context.run.stackCount)} 种栈形态` : ''}。`,
    },
    {
      at: stamps[2].toISOString(),
      title: '栈帧已标准化',
      detail:
        context.outcome.logs[0] ??
        `标准化后的栈证据${context.run.threadCount > 0 ? `覆盖了 ${context.run.threadCount} 个被采样线程` : '已经从目标进程中成功提取'}。`,
    },
    { at: stamps[3].toISOString(), title: '趋势已归因', detail: baselineText },
  ];
}

function buildFindings(
  context: AnalysisContext,
  dominant: NormalizedHotspot,
  hotspotMovement: string | null,
  trendDriver: AnalysisNarrative['trendDriver'],
  evidenceStatus: ReturnType<typeof summarizeEvidenceStatus>,
) {
  const findings: TaskFinding[] = [];

  findings.push({
    title: `${dominant.name} 主导了当前采样栈`,
    severity: dominant.percent >= 30 ? 'high' : 'medium',
    evidence: `${dominant.name} 在 ${formatFrameLocation(dominant.frame)} 处占据了 ${dominant.percent}% 的采样时间，共覆盖 ${dominant.sampleCount} 个样本。${describeRepresentativeStack(dominant)}`,
    recommendation: `优先减少 ${dominant.name} 内部的工作量，并在修复后确认它的占比下降到 ${Math.max(10, dominant.percent - 10)}% 以下。`,
  });

  if (context.comparison) {
    findings.push({
      title: `基线对比结论：${comparisonVerdictLabel(context.comparison.verdict)}`,
      severity:
        context.comparison.verdict === 'regression'
          ? 'high'
          : context.comparison.verdict === 'improvement'
            ? 'medium'
            : 'info',
      evidence: `${context.comparison.summary} ${hotspotMovement ?? context.comparison.changedHotspot}`,
      recommendation:
        context.comparison.verdict === 'regression'
          ? `优先排查 ${trendDriver?.label ?? '变化最明显的指标'}，并在修复后重新运行同一场景。`
          : '保留当前改动，再次采样确认趋势是否稳定延续。',
    });
  }

  findings.push({
    title: evidenceStatus.title,
    severity: context.outcome.logs.length > 0 ? 'medium' : 'info',
    evidence: evidenceStatus.kind === 'real'
      ? `共保留了 ${context.run.hotspots.length} 个排序热点，来自 ${context.run.stackCount} 种唯一栈形态${context.run.threadCount > 0 ? `，覆盖 ${context.run.threadCount} 个线程` : ''}。`
      : evidenceStatus.kind === 'partial-real'
        ? `当前已保留真实 perf 产物，并从中提炼了部分可读热点或样本线索；当前展示仍带有降级成分。当前指标为 CPU ${context.run.metrics.cpu}%、blocked ${context.run.metrics.blocked}%、GC ${context.run.metrics.gc}% 等。`
        : `当前通过 fallback 路径保留了 ${context.run.hotspots.length} 个排序热点，同时记录了 CPU ${context.run.metrics.cpu}%、blocked ${context.run.metrics.blocked}%、GC ${context.run.metrics.gc}% 等指标。`,
    recommendation: `建议把这次由 ${context.task.collectorName} 生成的产物作为后续对比的参考运行。`,
  });

  const symbolization = summarizeSymbolization(context.run.hotspots);
  findings.push({
    title: '可读源码映射质量',
    severity: symbolization.status === 'fallback' ? 'medium' : 'info',
    evidence: symbolization.summary,
    recommendation:
      symbolization.status === 'full'
        ? '复核产物时可以优先沿着文件与行号映射继续下钻。'
        : '在依赖源码级归因做优化决策前，先交叉核对保留产物。',
  });

  return findings.slice(0, 4);
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
      title: '热点集中度',
      direction: dominant.percent >= 30 ? 'regressed' : 'improved',
      evidence: `${dominant.name} 占据了 ${dominant.percent}% 的采样时间，映射位置为 ${formatFrameLocation(dominant.frame)}。${describeCallerSpread(dominant)}`,
      attribution: describeMappingConfidence(dominant.frame),
    },
    {
      title: '压力 driver',
      direction: trendDriver?.trend ?? cpuDirection,
      evidence:
        trendDriver?.evidence ??
        `CPU 占比为 ${context.run.metrics.cpu}% ，blocked 时间为 ${context.run.metrics.blocked}%。`,
      attribution: trendDriver?.label ?? 'workload 报告',
    },
    {
      title: '基线走势',
      direction:
        context.comparison?.verdict === 'regression'
          ? 'regressed'
          : context.comparison?.verdict === 'improvement'
            ? 'improved'
            : 'flat',
      evidence: context.comparison?.summary ?? '当前没有更早运行可用于趋势归因。',
      attribution: hotspotMovement ?? context.comparison?.changedHotspot ?? context.outcome.logs[0] ?? 'collector 日志',
    },
  ];

  return insights;
}

function buildAnalysisSummary(context: AnalysisContext, dominant: NormalizedHotspot) {
  const secondary = context.run.hotspots[1];
  const source = formatFrameLocation(dominant.frame);
  const secondaryText = secondary ? ` 次级压力位于 ${secondary.name}，占比 ${secondary.percent}%。` : '';
  const evidenceStatus = summarizeEvidenceStatus(context);
  const realSourceText =
    evidenceStatus.kind === 'real'
      ? ` 标准化阶段保留了 ${context.run.stackCount} 种栈形态${context.run.threadCount > 0 ? `，覆盖 ${context.run.threadCount} 个线程` : ''}。`
      : evidenceStatus.kind === 'partial-real'
        ? ' 当前报告保留了部分真实栈证据，但热点排序与指标解释仍包含降级成分。'
        : ' 当前报告仍然依赖 fallback 热点证据。';
  const symbolization = summarizeSymbolization(context.run.hotspots);
  return `${context.run.title} 从 ${context.run.sampleSource} 保留了 ${context.run.sampleCount} 个样本。${context.run.summary}${realSourceText} ${symbolization.summary} 当前主热点是 ${dominant.name}，位置在 ${source}.${secondaryText}`;
}

function summarizeEvidenceStatus(context: AnalysisContext) {
  if (context.run.usedRealData) {
    return { kind: 'real' as const, title: '采集器输出保留了结构化栈证据' };
  }

  if (context.outcome.sample.rawSignal.includes(':partial')) {
    return { kind: 'partial-real' as const, title: '采集器输出保留了部分真实栈证据' };
  }

  return { kind: 'fallback' as const, title: '采集器输出回退到了 synthetic 热点证据' };
}

function buildTrendSummary(
  comparison: TaskComparison | null,
  hotspotMovement: string | null,
  trendDriver: AnalysisNarrative['trendDriver'],
) {
  if (!comparison) {
    return '这是当前对比范围内的第一次运行，因此还没有趋势增量可供分析。';
  }

  const effectiveDriver = comparison.driver ?? trendDriver;
  const driverText = effectiveDriver
    ? ` 最明显的指标变化来自 ${effectiveDriver.label}（${formatDelta(effectiveDriver.delta)}）。`
    : '';
  const compatibilityText =
    comparison.compatibility.warnings.length > 0
      ? ` 可比性提醒：${comparison.compatibility.warnings.join(' ')}`
      : '';

  return `${comparison.summary} ${hotspotMovement ?? comparison.changedHotspot}${driverText}${compatibilityText}`;
}

function buildFlameGraph(
  title: string,
  topStacks: AnalysisContext['run']['topStacks'],
  hotspots: AnalysisContext['run']['hotspots'],
) {
  const root: FlameTreeNode = {
    name: 'all',
    value: 0,
    color: '#f8f4d8',
    hidden: true,
    children: [],
  };

  const stackInputs = topStacks.length
    ? topStacks.map((stack) => ({
        weight: Math.max(1, Math.round(stack.weight)),
        frames: stack.frames.map((frame) => ({
          name: frame.displayName,
          module: frame.module,
          file: frame.file,
          line: frame.line,
          mappingState: frame.mappingState,
          sourceHint: frame.sourceHint,
        })),
      }))
    : hotspots.map((hotspot) => ({
        weight: Math.max(1, Math.round(hotspot.sampleWeight)),
        frames: hotspot.representativeStack.map((frame) => ({
          name: frame.displayName,
          module: frame.module,
          file: frame.file,
          line: frame.line,
          mappingState: frame.mappingState,
          sourceHint: frame.sourceHint,
        })),
      }));

  for (const stack of stackInputs) {
    const normalizedFrames = stack.frames
      .map((frame) => ({
        name: normalizeFlameFrameName(frame.name, title),
        module: frame.module,
        locationSummary: formatFlameFrameLocation(frame),
        mappingState: frame.mappingState,
        sourceHint: frame.sourceHint,
      }))
      .filter((frame) => frame.name.length > 0);

    if (normalizedFrames.length === 0) {
      continue;
    }

    root.value += stack.weight;
    let cursor = root;
    for (const frame of normalizedFrames) {
      let child = cursor.children?.find(
        (entry) =>
          entry.name === frame.name &&
          (entry.module ?? '') === (frame.module ?? '') &&
          (entry.locationSummary ?? '') === (frame.locationSummary ?? ''),
      );
      if (!child) {
        child = {
          name: frame.name,
          value: 0,
          module: frame.module,
          locationSummary: frame.locationSummary,
          mappingState: frame.mappingState,
          sourceHint: frame.sourceHint,
          color: flameColorForName(frame.name),
          children: [],
        };
        cursor.children?.push(child);
      }
      child.value += stack.weight;
      child.sampleCount = child.value;
      cursor = child;
    }
  }

  if (!root.children?.length) {
    return {
      name: 'all',
      value: 100,
      color: '#f8f4d8',
      hidden: true,
      children: [
        {
          name: normalizeFlameFrameName(title, title),
          value: 100,
          sampleCount: 100,
          locationSummary: 'No retained stack evidence',
          color: flameColorForName(title),
        },
      ],
    };
  }

  sortFlameChildren(root);
  return root;
}

function normalizeFlameFrameName(name: string, title: string) {
  const normalized = name.trim();
  if (!normalized) {
    return '';
  }
  if (normalized === title) {
    return normalized;
  }
  return normalized;
}

function sortFlameChildren(node: FlameTreeNode) {
  if (!node.children?.length) {
    return;
  }
  node.children.sort((left, right) => right.value - left.value);
  for (const child of node.children) {
    sortFlameChildren(child);
  }
}

function flameColorForName(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return flamePalette[hash % flamePalette.length];
}

function formatFlameFrameLocation(frame: {
  module: string;
  file: string;
  line: number | null;
  sourceHint: string;
  mappingState: NormalizedHotspot['frame']['mappingState'];
}) {
  if (frame.mappingState === 'full') {
    return `${frame.file}:${frame.line}`;
  }
  if (frame.mappingState === 'file-only') {
    return `${frame.file} (line unavailable)`;
  }
  if (frame.mappingState === 'module-only') {
    return `${frame.module} (module only)`;
  }
  if (frame.mappingState === 'synthetic') {
    return `${frame.module} (synthetic fallback)`;
  }
  return `${frame.sourceHint || frame.module} (unmapped)`;
}

function computeConfidence(
  metrics: TaskMetrics,
  topShare: number,
  sampleCount: number,
  mappingState: NormalizedHotspot['frame']['mappingState'],
) {
  const base = 0.6 + topShare / 200 + Math.min(0.2, sampleCount / 500);
  const gcAdjustment = metrics.gc >= 20 ? 0.02 : 0;
  const cpuAdjustment = metrics.cpu > 80 ? 0.05 : 0;
  const mappingAdjustment =
    mappingState === 'full'
      ? 0.04
      : mappingState === 'file-only'
        ? 0.02
        : mappingState === 'module-only'
          ? 0
          : mappingState === 'synthetic'
            ? -0.08
            : -0.12;
  return Math.min(0.99, Math.max(0.25, Number((base + gcAdjustment + cpuAdjustment + mappingAdjustment).toFixed(2))));
}

function deriveTrendDriver(comparison: TaskComparison) {
  if (comparison.driver) {
    return comparison.driver;
  }

  const strongest = strongestMetricDelta(comparison.metricDeltas);
  if (!strongest) {
    return null;
  }

  return {
    label: strongest.label,
    trend: strongest.trend,
    delta: strongest.delta,
    evidence: `${strongest.label} 从 ${strongest.before}% 变化到 ${strongest.after}%（${formatDelta(strongest.delta)}）。`,
  };
}

function describeHotspotMovementFromComparison(task: TaskDetail, comparison: TaskComparison) {
  const structured = `${comparison.hotspotShift.summary} ${comparison.hotspotShift.attribution}`.trim();
  if (structured) {
    return structured;
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
      mappingState: 'unknown',
      mappingSource: 'fallback',
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
  const representative = hotspot.representativeStack.map((frame) => `${frame.displayName} @ ${formatFrameLocation(frame)}`);
  if (representative.length <= 1) {
    return `代表性栈仍然围绕 ${hotspot.name} 展开。`;
  }

  return `代表性路径：${representative.join(' -> ')}。`;
}

function describeCallerSpread(hotspot: NormalizedHotspot) {
  if (hotspot.supportingFrames.length === 0) {
    return '当前没有为这个热点保留调用方扩散信息。';
  }

  const callers = hotspot.supportingFrames
    .map((frame) => `${frame.displayName} @ ${formatFrameLocation(frame)}`)
    .slice(0, 3);
  return `最强的调用方包括 ${callers.join(', ')}。`;
}

function formatFrameLocation(frame: NormalizedHotspot['frame']) {
  if (frame.mappingState === 'full') {
    return `${frame.file}:${frame.line}`;
  }
  if (frame.mappingState === 'file-only') {
    return `${frame.file}（没有行号）`;
  }
  if (frame.mappingState === 'module-only') {
    return `${frame.module}（仅模块级映射）`;
  }
  if (frame.mappingState === 'synthetic') {
    return `${frame.module}（synthetic fallback）`;
  }
  return `${frame.sourceHint || frame.module}（未映射）`;
}

function describeMappingConfidence(frame: NormalizedHotspot['frame']) {
  if (frame.mappingState === 'full') {
    return '已保留文件与行号映射';
  }
  if (frame.mappingState === 'file-only') {
    return '只保留了文件映射，没有行号';
  }
  if (frame.mappingState === 'module-only') {
    return '只有模块级可读映射';
  }
  if (frame.mappingState === 'synthetic') {
    return 'synthetic fallback 映射';
  }
  return '没有保留可读映射';
}

function summarizeSymbolization(hotspots: NormalizedHotspot[]) {
  const full = hotspots.filter((hotspot) => hotspot.frame.mappingState === 'full').length;
  const partial = hotspots.filter(
    (hotspot) => hotspot.frame.mappingState === 'file-only' || hotspot.frame.mappingState === 'module-only',
  ).length;
  const fallback = hotspots.length - full - partial;
  const status = full === hotspots.length ? 'full' : full + partial > 0 ? 'partial' : 'fallback';
  const dominantSuffix =
    hotspots[0]?.frame.mappingState === 'full'
      ? `，并且已经映射到 ${formatFrameLocation(hotspots[0].frame)}`
      : hotspots[0]
        ? `，当前${describeMappingConfidence(hotspots[0].frame)}`
        : '';
  const summary =
    status === 'full'
      ? `当前热点的可读符号化已经完整，${full} 个热点都映射到了文件与行号。`
      : status === 'partial'
        ? `当前符号化结果部分可读：${full} 个热点保留了文件与行号，${partial} 个只保留了文件或模块上下文，另有 ${fallback} 个仍然依赖 fallback 标签。`
        : '当前可读符号化能力有限：保留的热点主要依赖 fallback 或未映射标签，而不是直接源码位置。';

  return {
    status,
    dominantSuffix,
    summary,
  };
}

const flamePalette = ['#f4d03f', '#f5b041', '#eb984e', '#dc7633', '#d35400', '#f7dc6f', '#ec7063', '#cb4335'];

function comparisonVerdictLabel(verdict: TaskComparison['verdict']) {
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
