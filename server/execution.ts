import { compareTasks } from './comparison.js';
import { collectorRegistry } from './collectors/index.js';
import type { TaskCreateInput, TaskDetail } from '../shared/types.js';
import { finalizeTask } from './analysis.js';
import { appendAuditEvent, getTask, listTasks, saveTask } from './store.js';
import { prepareManagedCollection } from './agent/managed-run.js';
import {
  clearPendingStopRequest,
  getAgentRunSnapshot,
  getPendingStopRequest,
  requestAgentRunStop,
} from './agent/run-registry.js';
import { randomUUID } from 'node:crypto';

export async function runTaskExecution(taskId: string, input: TaskCreateInput) {
  const queuedTask = await getTask(taskId);
  if (!queuedTask) {
    return;
  }
  const pendingStop = getPendingStopRequest(taskId);
  if (pendingStop) {
    clearPendingStopRequest(taskId);
    await saveTask(buildStoppedTask(queuedTask, pendingStop.reason));
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
    const preCollectSnapshot = managedRun.controller.snapshot();
    if (preCollectSnapshot.stopRequested) {
      await managedRun.controller.complete('Agent run stopped before collection started.');
      await saveTask(buildStoppedTask((await getTask(taskId)) ?? queuedTask, preCollectSnapshot.stopReason));
      return;
    }

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
    if (managedRun.controller.snapshot().stopRequested) {
      await saveTask(buildStoppedTask(currentTask, managedRun.controller.snapshot().stopReason));
      await managedRun.controller.complete('Agent run stopped after collection completed.');
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
    if (managedRun?.controller.snapshot().stopRequested || getPendingStopRequest(taskId)) {
      await saveTask(buildStoppedTask(currentTask, managedRun?.controller.snapshot().stopReason ?? message));
      if (managedRun) {
        await managedRun.controller.complete('Agent run stopped during collection.');
      } else {
        clearPendingStopRequest(taskId);
      }
      return;
    }

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

export async function cancelTaskExecution(taskId: string, reason: string, actor: 'api' | 'agent' | 'user' = 'api') {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  if (task.status === 'done' || task.status === 'failed') {
    return {
      accepted: false,
      task,
      runSnapshot: getAgentRunSnapshot(taskId),
      reason: 'Task is already terminal.',
    };
  }

  const stopResult = await requestAgentRunStop(taskId, reason);
  const savedTask = await saveTask(buildStoppedTask(task, reason));
  const timestamp = new Date().toISOString();

  await appendAuditEvent({
    id: randomUUID(),
    taskId,
    at: timestamp,
    type: 'task.stop_requested',
    actor,
    severity: 'warning',
    message: 'Task stop requested.',
    detail: reason,
  });

  await appendAuditEvent({
    id: randomUUID(),
    taskId,
    at: new Date().toISOString(),
    type: 'task.stopped',
    actor: 'system',
    severity: 'warning',
    message: 'Task marked as stopped.',
    detail: reason,
    metadata: {
      activeRun: stopResult.active,
    },
  });

  return {
    accepted: true,
    task: savedTask,
    runSnapshot: stopResult.snapshot,
    reason,
  };
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

function buildStoppedTask(task: TaskDetail, reason?: string) {
  const stopReason = reason || 'Task execution was stopped before completion.';
  return {
    ...task,
    status: 'failed',
    progress: 100,
    updatedAt: new Date().toISOString(),
    reportTitle: 'Task stopped',
    reportSummary: 'Task execution was stopped before the profiling workflow completed.',
    primaryFinding: 'Task stopped before completion.',
    confidence: 0,
    metrics: task.metrics ?? { cpu: 0, blocked: 0, gc: 0, syscalls: 0 },
    timeline: [
      ...(task.timeline ?? []),
      { at: new Date().toISOString(), title: 'Task stopped', detail: stopReason },
    ],
    findings: [
      {
        title: 'Task stopped before completion',
        severity: 'medium',
        evidence: stopReason,
        recommendation: 'Retry the task when the target environment is ready for sampling.',
      },
    ],
    topFunctions: [],
    flameGraph: { name: 'stopped', value: 100, color: '#f59e0b' },
    sampleCount: 0,
    sampleSource: 'stopped',
    artifacts: task.artifacts ?? [],
    collectorLogs: dedupeLogs([...(task.collectorLogs ?? []), stopReason]),
    analysisSummary: 'The task was stopped before a stable analysis result could be finalized.',
    trendSummary: 'Trend analysis is unavailable because the run stopped early.',
    insights: [],
    baselineComparison: null,
  } satisfies TaskDetail;
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
