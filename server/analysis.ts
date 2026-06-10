import { randomUUID } from 'node:crypto';
import { getCollector, getScenario } from '../shared/catalog.js';
import type { CollectorOutcome } from './collectors/types.js';
import type {
  TaskComparison,
  TaskCreateInput,
  TaskDetail,
  TaskSummary,
} from '../shared/types.js';
import { buildAnalysisNarrative, buildQueuedTimeline } from './analysis/narrative.js';
import { normalizeCollectorOutcome } from './analysis/normalize.js';

function nowIso() {
  return new Date().toISOString();
}

function buildSummary(input: TaskCreateInput): TaskSummary {
  const scenario = getScenario(input.scenario);
  const collector = getCollector(input.collector);
  const createdAt = nowIso();

  return {
    id: randomUUID(),
    title: `${scenario.name} on ${input.target}`,
    target: input.target,
    language: input.language,
    collector: collector.id,
    collectorName: collector.name,
    scenario: scenario.id,
    scenarioName: scenario.name,
    status: 'queued',
    progress: 8,
    createdAt,
    updatedAt: createdAt,
    signal: scenario.signal,
  };
}

export function createQueuedTask(input: TaskCreateInput): TaskDetail {
  const scenario = getScenario(input.scenario);
  const summary = buildSummary(input);

  return {
    ...summary,
    reportTitle: `${scenario.name} diagnosis`,
    reportSummary: 'Waiting for a real collector run.',
    primaryFinding: scenario.primaryFinding,
    confidence: scenario.confidence,
    metrics: { cpu: 0, blocked: 0, gc: 0, syscalls: 0 },
    timeline: buildQueuedTimeline(scenario.signal),
    findings: [],
    topFunctions: scenario.topFunctions,
    flameGraph: scenario.flameGraph,
    sampleCount: 0,
    sampleSource: 'pending',
    artifacts: [],
    collectorLogs: [],
    analysisSummary: 'The task is queued and awaiting real sampling output.',
    trendSummary: 'Trend analysis will appear after the first run completes.',
    insights: [],
    baselineComparison: null,
  };
}

export function createTaskDetail(input: TaskCreateInput): TaskDetail {
  const scenario = getScenario(input.scenario);
  const queued = createQueuedTask(input);
  const outcome: CollectorOutcome = {
    status: 'analyzing',
    progress: 72,
    artifacts: [],
    sample: {
      sampleCount: 240,
      topFunctions: scenario.topFunctions,
      metrics: {
        cpu: scenario.cpu,
        blocked: scenario.blocked,
        gc: scenario.gc,
        syscalls: scenario.syscalls,
      },
      summary: scenario.summary,
      rawSignal: scenario.signal === 'Python Hot Loop' ? 'python-stack-sampling' : 'native-stack-sampling',
      workloadReportPath: '',
    },
    report: {
      scenario: input.scenario,
      collector: input.collector,
      target: input.target,
      title: scenario.name,
      durationMs: 8000,
      result: 1,
      metrics: {
        cpu: scenario.cpu,
        blocked: scenario.blocked,
        gc: scenario.gc,
        syscalls: scenario.syscalls,
      },
      topFunctions: scenario.topFunctions,
      summary: scenario.summary,
    },
    logs: ['Synthetic compatibility task created for legacy callers.'],
  };

  return finalizeTask(queued, outcome, null);
}

export function finalizeTask(
  task: TaskDetail,
  outcome: CollectorOutcome,
  baselineComparison: TaskComparison | null,
): TaskDetail {
  const run = normalizeCollectorOutcome(task, outcome);
  const narrative = buildAnalysisNarrative({
    task,
    outcome,
    comparison: baselineComparison,
    run,
  });

  return {
    ...task,
    status: 'done',
    progress: 100,
    updatedAt: nowIso(),
    reportTitle: `${run.title} diagnosis`,
    reportSummary: run.summary,
    primaryFinding: narrative.primaryFinding,
    confidence: narrative.confidence,
    metrics: run.metrics,
    timeline: narrative.timeline,
    findings: narrative.findings,
    topFunctions: run.hotspots.map((hotspot) => ({
      name: hotspot.name,
      percent: hotspot.percent,
      module: hotspot.module,
    })),
    flameGraph: narrative.flameGraph,
    sampleCount: run.sampleCount,
    sampleSource: run.sampleSource,
    artifacts: outcome.artifacts,
    collectorLogs: outcome.logs,
    analysisSummary: narrative.analysisSummary,
    trendSummary: narrative.trendSummary,
    insights: narrative.insights,
    baselineComparison,
  };
}
