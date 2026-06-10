import { compareTasks } from './comparison.js';
import { collectorRegistry } from './collectors/index.js';
import type { TaskCreateInput, TaskDetail } from '../shared/types.js';
import { finalizeTask } from './analysis.js';
import { getTask, listTasks, saveTask } from './store.js';
import { prepareManagedCollection } from './agent/managed-run.js';

export async function runTaskExecution(taskId: string, input: TaskCreateInput) {
  const queuedTask = await getTask(taskId);
  if (!queuedTask) {
    return;
  }

  await saveTask({
    ...queuedTask,
    status: 'running',
    progress: 24,
    updatedAt: new Date().toISOString(),
  });

  const plugin = collectorRegistry.get(input.collector);
  if (!plugin) {
    await saveTask(
      buildFailedTask(queuedTask, {
        title: 'Collector unavailable',
        summary: `Collector ${input.collector} is not registered.`,
        message: `Collector ${input.collector} is not registered.`,
        sampleSource: 'collector-unavailable',
      }),
    );
    return;
  }

  let managedRun: Awaited<ReturnType<typeof prepareManagedCollection>> | null = null;
  try {
    managedRun = await prepareManagedCollection(taskId, input, plugin);
    managedRun.controller.transition('collecting', `Collector ${plugin.capability.name} is starting.`);

    await saveTask({
      ...(await getTask(taskId))!,
      status: 'analyzing',
      progress: 64,
      collectorLogs: buildProbeLogLines(managedRun.probe),
      updatedAt: new Date().toISOString(),
    });

    const outcome = await managedRun.controller.runWithCleanup(() =>
      plugin.collect({
        taskId,
        target: input.target,
        language: input.language,
        scenario: input.scenario,
        collector: input.collector,
      }),
    );
    managedRun.controller.transition('finalizing', 'Collector output captured; finalizing analysis.');

    const currentTask = await getTask(taskId);
    if (!currentTask) {
      return;
    }

    const outcomeWithAgentLogs = {
      ...outcome,
      logs: dedupeLogs([...managedRun.controller.snapshot().logs, ...outcome.logs]),
    };

    const previewTask = finalizeTask(currentTask, outcomeWithAgentLogs, null);
    const baseline = await findBaselineTask(previewTask);
    const baselineComparison = baseline ? compareTasks(baseline, previewTask) : null;
    const finalTask = finalizeTask(currentTask, outcomeWithAgentLogs, baselineComparison);

    await saveTask(finalTask);
    await managedRun.controller.complete('Agent run finalized successfully.');
  } catch (error) {
    const currentTask = await getTask(taskId);
    if (!currentTask) {
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown collector failure';
    if (managedRun) {
      await managedRun.controller.fail(error);
    }

    await saveTask(
      buildFailedTask(currentTask, {
        title: 'Collection failed',
        summary: 'The collector execution did not complete successfully.',
        message,
        sampleSource: 'failed',
        logs: managedRun ? managedRun.controller.snapshot().logs : [],
      }),
    );
  }
}

async function findBaselineTask(current: TaskDetail) {
  const tasks = await listTasks();
  return (
    tasks.find(
      (task) =>
        task.id !== current.id &&
        task.status === 'done' &&
        task.collector === current.collector &&
        task.scenario === current.scenario,
    ) ?? null
  );
}

function buildProbeLogLines(probe: NonNullable<Awaited<ReturnType<typeof prepareManagedCollection>>['probe']>) {
  const collectorLines = probe.collectors.map(
    (entry) =>
      `probe ${entry.collector}: supported=${entry.supported} available=${entry.available} detail=${entry.detail}`,
  );

  return dedupeLogs([...probe.notes, ...collectorLines]);
}

function dedupeLogs(lines: string[]) {
  return [...new Set(lines.filter(Boolean))];
}

function buildFailedTask(
  task: TaskDetail,
  options: {
    title: string;
    summary: string;
    message: string;
    sampleSource: string;
    logs?: string[];
  },
) {
  return {
    ...task,
    status: 'failed',
    progress: 100,
    updatedAt: new Date().toISOString(),
    reportTitle: options.title,
    reportSummary: options.summary,
    primaryFinding: options.title,
    confidence: 0,
    metrics: { cpu: 0, blocked: 0, gc: 0, syscalls: 0 },
    timeline: [{ at: new Date().toISOString(), title: 'Collector error', detail: options.message }],
    findings: [
      {
        title: options.title,
        severity: 'high',
        evidence: options.message,
        recommendation: 'Check collector availability and rerun the task.',
      },
    ],
    topFunctions: [],
    flameGraph: { name: 'failed', value: 100, color: '#ef4444' },
    sampleCount: 0,
    sampleSource: options.sampleSource,
    artifacts: [],
    collectorLogs: dedupeLogs([...(options.logs ?? []), options.message]),
    analysisSummary: 'The collector failed before a valid profile could be captured.',
    trendSummary: 'No trend analysis was produced.',
    insights: [],
    baselineComparison: null,
  } satisfies TaskDetail;
}
