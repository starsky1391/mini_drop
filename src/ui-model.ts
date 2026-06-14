import { collectors, scenarios } from '../shared/catalog';
import type { CollectorId, ScenarioId, TaskAttachSource, TaskProcessInfo, TaskTargetType } from '../shared/types';

export type DetailTabId = 'compare' | 'artifacts' | 'audit' | 'flame' | 'evidence' | 'reasoner';

export type DetailTabOption = {
  id: DetailTabId;
  label: string;
};

export const detailTabCatalog: DetailTabOption[] = [
  { id: 'compare', label: '对比与趋势' },
  { id: 'artifacts', label: '产物与日志' },
  { id: 'audit', label: '审计' },
  { id: 'flame', label: '火焰图' },
  { id: 'evidence', label: '证据链' },
  { id: 'reasoner', label: '诊断结论' },
];

export function visibleDetailTabs(hasReasoner: boolean) {
  return detailTabCatalog.filter((item) => (hasReasoner ? true : item.id !== 'reasoner'));
}

export function normalizeDetailTabSelection(requested: DetailTabId | null | undefined, hasReasoner: boolean) {
  const visible = visibleDetailTabs(hasReasoner);
  if (requested && visible.some((item) => item.id === requested)) {
    return requested;
  }
  return visible[0]?.id ?? 'compare';
}

export function targetTypeLabel(targetType: TaskTargetType | undefined) {
  switch (targetType) {
    case 'pid':
      return '指定 PID';
    case 'process':
      return '选择进程';
    default:
      return '逻辑目标';
  }
}

export function attachSourceLabel(source: TaskAttachSource) {
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

export function formatProcessSummary(processInfo: TaskProcessInfo | null | undefined) {
  if (!processInfo) {
    return '未保留真实进程上下文';
  }
  const runtimeHint = processInfo.languageHint ? ` • ${processInfo.languageHint}` : '';
  return `PID ${processInfo.pid} • ${processInfo.name}${runtimeHint} • ${processInfo.commandSummary}`;
}

export function collectorDisplayName(collectorId: CollectorId | string | undefined, fallback?: string | null) {
  const collector = collectors.find((item) => item.id === collectorId);
  return collector?.displayNameZh ?? fallback ?? String(collectorId ?? '');
}

export function scenarioDisplayName(scenarioId: ScenarioId | string | undefined, fallback?: string | null) {
  const scenario = scenarios.find((item) => item.id === scenarioId);
  return scenario?.displayNameZh ?? fallback ?? String(scenarioId ?? '');
}

export function scenarioSignalLabel(scenarioId: ScenarioId | string | undefined, fallback?: string | null) {
  const scenario = scenarios.find((item) => item.id === scenarioId);
  return scenario?.signalZh ?? fallback ?? String(scenarioId ?? '');
}

export function displayTaskTitle(title: string, scenarioId: ScenarioId | string | undefined, target: string) {
  const localizedScenario = scenarioDisplayName(scenarioId, null);
  if (localizedScenario && target) {
    return `${localizedScenario} · ${target}`;
  }
  return localizeLegacyText(title);
}

export function displayReportTitle(title: string, scenarioId: ScenarioId | string | undefined) {
  if (title === 'Task stopped') {
    return '任务已停止';
  }
  if (title === 'Collector unavailable') {
    return '采集器不可用';
  }
  if (title === 'Collection failed') {
    return '采集失败';
  }

  const scenario = scenarios.find((item) => item.id === scenarioId);
  if (scenario) {
    if (title === `${scenario.name} diagnosis` || title === `${scenario.displayNameZh} diagnosis` || title === `${scenario.displayNameZh} 诊断`) {
      return `${scenario.displayNameZh} 诊断`;
    }
  }

  return localizeLegacyText(title);
}

export function localizeLegacyText(text: string | null | undefined) {
  if (!text) {
    return text ?? '';
  }

  return text
    .replaceAll('Task stopped before completion.', '任务在完成前已停止。')
    .replaceAll('Task execution was stopped before the profiling workflow completed.', '任务在剖析流程完成前已被停止。')
    .replaceAll('The task was stopped before a stable analysis result could be finalized.', '任务在稳定分析结果生成前就被停止了。')
    .replaceAll('Trend analysis is unavailable because the run stopped early.', '本次运行提前停止，暂时无法生成趋势分析。')
    .replaceAll('Task stopped', '任务已停止')
    .replaceAll('Collector unavailable', '采集器不可用')
    .replaceAll('Collection failed', '采集失败')
    .replaceAll('Waiting for a real collector run.', '等待真实采集结果。')
    .replaceAll('The task is queued and awaiting real sampling output.', '任务已经入队，正在等待真实采样结果。')
    .replaceAll('Trend analysis will appear after the first run completes.', '首轮运行完成后，这里会出现趋势分析。')
    .replaceAll('Task summary saved before a full report was available.', '完整报告生成前已先保存任务摘要。')
    .replaceAll('Task summary has not been expanded into a full report yet.', '当前任务摘要还没有展开成完整报告。')
    .replaceAll('A full analysis report has not been generated yet.', '当前还没有生成完整分析报告。')
    .replaceAll('Trend analysis is unavailable for this summary-only task.', '这个摘要任务暂时不提供趋势分析。')
    .replaceAll('Stop requested from test.', '测试触发了停止请求。')
    .replaceAll('Retry the task when the target environment is ready for sampling.', '等目标环境准备好后，再重新发起采样。')
    .replaceAll('Initial comparable run in this history scope.', '这是当前历史范围内的首条可比运行。')
    .replaceAll('Current run is effectively flat against the baseline.', '当前运行与基线基本持平。')
    .replaceAll('Hotspot movement could not be determined because both runs lacked ranked stacks.', '两次运行都没有保留可排序栈，因此暂时无法判断热点迁移。')
    .replaceAll('No comparable hotspot data was available.', '当前没有可比较的热点数据。')
    .replaceAll('No dominant hotspot location was available for this comparison.', '当前没有可用于这次对比的主热点位置。')
    .replaceAll('Managed Workload', 'managed workload')
    .replaceAll('CPU pressure', 'CPU 压力')
    .replaceAll('Blocked time', '阻塞时间')
    .replaceAll('GC pressure', 'GC 压力')
    .replaceAll('Syscall share', 'Syscall 占比')
    .replaceAll('line unavailable', '没有行号')
    .replaceAll('module-level only', '仅模块级')
    .replaceAll('module-level mapping', '仅模块级映射')
    .replaceAll('unmapped', '未映射')
    .replace(/label via managed-workload; no retained process metadata/gi, '逻辑目标 · managed workload · 未保留真实进程元数据')
    .replace(/label via managed-fallback; no retained process metadata/gi, '逻辑目标 · managed workload fallback · 未保留真实进程元数据');
}
