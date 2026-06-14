import { randomUUID } from 'node:crypto';
import type { TaskCreateInput, TaskDetail, TaskUploadState } from '../shared/types.js';
import { finalizeTask } from './analysis.js';
import { compareTasks } from './comparison.js';
import { collectorRegistry } from './collectors/index.js';
import { prepareManagedCollection } from './agent/managed-run.js';
import {
  clearPendingStopRequest,
  getAgentRunSnapshot,
  getPendingStopRequest,
  requestAgentRunStop,
} from './agent/run-registry.js';
import {
  appendAuditEvent,
  getTask,
  listTasks,
  saveTask,
} from './store.js';
import {
  persistStagedCollectorOutcome,
  readStagedCollectorOutcome,
  removeStagedCollectorOutcome,
} from './storage/repository.js';
import { retainTaskContinuousProfileSlice } from './profiling-slices.js';

interface ExecuteTaskOptions {
  source: 'agent' | 'managed-runner';
  deferFinalize: boolean;
}

interface FinalizeUploadedOptions {
  source?: 'agent' | 'managed-runner';
  statusReason?: string;
}

export async function runTaskExecution(taskId: string, input: TaskCreateInput) {
  return executeTaskExecution(taskId, input, {
    source: 'managed-runner',
    deferFinalize: false,
  });
}

export async function collectTaskExecution(taskId: string, input: TaskCreateInput) {
  return executeTaskExecution(taskId, input, {
    source: 'agent',
    deferFinalize: true,
  });
}

export async function finalizeUploadedTaskExecution(taskId: string, options: FinalizeUploadedOptions = {}) {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  const staged = await readStagedCollectorOutcome(taskId);
  if (!staged) {
    const failedTask = await saveTask(
      buildFailedTask(task, {
        title: '上传后分析缺少暂存结果',
        summary: 'Agent 已上报上传完成，但 server 没有找到可分析的暂存产物。',
        message: '未找到对应的 staged collector outcome，无法继续完成最终分析。',
        sampleSource: task.sampleSource === 'pending' ? 'staged-missing' : task.sampleSource,
        artifacts: task.artifacts,
        logs: task.collectorLogs,
        failureStage: 'final-analysis',
      }),
    );
    return persistTerminalContinuousSlice(failedTask);
  }

  const statusReason =
    options.statusReason ||
    (options.source === 'agent'
      ? 'Agent 已完成上传，server 正在基于暂存产物生成最终分析结果。'
      : '本机 runner 正在基于暂存产物生成最终分析结果。');

  const uploadingTask = await saveTask({
    ...task,
    status: 'UPLOADING',
    statusReason,
    uploadState: 'uploaded',
    progress: Math.max(task.progress, 88),
    updatedAt: new Date().toISOString(),
    artifacts: staged.outcome.artifacts,
    collectorLogs: dedupeLogs([...task.collectorLogs, ...staged.outcome.logs, statusReason]),
    sampleCount: staged.outcome.sample.sampleCount,
    sampleSource: staged.outcome.sample.rawSignal,
  });

  try {
    const pendingStop = getPendingStopRequest(taskId);
    if (pendingStop) {
      clearPendingStopRequest(taskId);
      await removeStagedCollectorOutcome(taskId);
      return persistTerminalContinuousSlice(
        await saveTask(
        buildStoppedTask(uploadingTask, pendingStop.reason, {
          artifacts: staged.outcome.artifacts,
          collectorLogs: staged.outcome.logs,
          sampleCount: staged.outcome.sample.sampleCount,
          sampleSource: staged.outcome.sample.rawSignal,
          stopStage: 'final-analysis',
        }),
      ));
    }

    const collectorTaskContext = applyCollectorTargetContext(uploadingTask, staged.outcome);
    const previewTask = finalizeTask(collectorTaskContext, staged.outcome, null);
    const baseline = await findBaselineTask(previewTask);
    const baselineComparison = baseline ? compareTasks(baseline, previewTask) : null;
    const finalTask = finalizeTask(collectorTaskContext, staged.outcome, baselineComparison);

    const savedTask = await saveTask(finalTask);
    await persistTerminalContinuousSlice(savedTask);
    await appendAuditEvent({
      id: randomUUID(),
      taskId,
      at: new Date().toISOString(),
      type: 'task.updated',
      actor: 'system',
      severity: savedTask.sampleSource.includes('fallback') ? 'warning' : 'info',
      message: '暂存产物分析已完成。',
      detail: `server 已基于 ${savedTask.sampleSource} 完成 ${savedTask.sampleCount} 个样本的最终分析。`,
      metadata: {
        sampleCount: savedTask.sampleCount,
        artifactCount: savedTask.artifacts.length,
        source: options.source ?? staged.source,
      },
    });
    await removeStagedCollectorOutcome(taskId);
    return savedTask;
  } catch (error) {
    const message = error instanceof Error ? error.message : '暂存结果最终分析失败';
    const failedTask = await saveTask(
      buildFailedTask(uploadingTask, {
        title: '上传后分析失败',
        summary: 'server 在处理 staged collector output 时没有成功完成最终分析。',
        message,
        sampleSource: staged.outcome.sample.rawSignal,
        artifacts: staged.outcome.artifacts,
        logs: dedupeLogs([...staged.outcome.logs, message]),
        failureStage: 'final-analysis',
      }),
    );
    return persistTerminalContinuousSlice(failedTask);
  }
}

async function executeTaskExecution(taskId: string, input: TaskCreateInput, options: ExecuteTaskOptions) {
  const queuedTask = await getTask(taskId);
  if (!queuedTask) {
    return null;
  }

  const pendingStop = getPendingStopRequest(taskId);
  if (pendingStop) {
    clearPendingStopRequest(taskId);
    return persistTerminalContinuousSlice(await saveTask(buildStoppedTask(queuedTask, pendingStop.reason)));
  }

  await saveTask({
    ...queuedTask,
    status: 'RUNNING',
    statusReason: '采集器已经启动，正在目标上执行采样。',
    uploadState: 'not_started',
    progress: 24,
    updatedAt: new Date().toISOString(),
  });

  const plugin = collectorRegistry.get(input.collector);
  if (!plugin) {
    return persistTerminalContinuousSlice(
      await saveTask(
      buildFailedTask(queuedTask, {
        title: '采集器不可用',
        summary: `Collector ${input.collector} 尚未注册。`,
        message: `Collector ${input.collector} 尚未注册。`,
        sampleSource: 'collector-unavailable',
      }),
    ));
  }

  let managedRun: Awaited<ReturnType<typeof prepareManagedCollection>> | null = null;
  try {
    managedRun = await prepareManagedCollection(taskId, input, plugin);
    await appendAuditEvent(buildProbeAuditEvent(taskId, managedRun.probe, input.collector));
    const preCollectSnapshot = managedRun.controller.snapshot();
    if (preCollectSnapshot.stopRequested) {
      await managedRun.controller.complete('Agent run stopped before collection started.');
      return persistTerminalContinuousSlice(
        await saveTask(buildStoppedTask((await getTask(taskId)) ?? queuedTask, preCollectSnapshot.stopReason, {
          collectorLogs: preCollectSnapshot.logs,
          stopStage: preCollectSnapshot.stage,
        })),
      );
    }

    managedRun.controller.transition('collecting', `Collector ${plugin.capability.name} 正在启动。`);

    await saveTask({
      ...(await getTask(taskId))!,
      status: 'RUNNING',
      statusReason: '采集器正在运行，系统持续保留采样证据。',
      uploadState: 'not_started',
      progress: 42,
      collectorLogs: buildProbeLogLines(managedRun.probe),
      updatedAt: new Date().toISOString(),
    });

    const taskSnapshotBeforeCollect = (await getTask(taskId)) ?? queuedTask;
    const outcome = await managedRun.controller.runWithCleanup(() =>
      plugin.collect({
        taskId,
        target: input.target,
        targetContext: currentTaskTargetContext(taskSnapshotBeforeCollect),
        language: input.language,
        scenario: input.scenario,
        collector: input.collector,
        requestedPid: input.pid ?? input.processInfo?.pid ?? null,
        processInfo: input.processInfo ?? null,
      }),
    );

    managedRun.controller.transition('finalizing', '采集器输出已保留，正在暂存上传结果。');
    const outcomeWithAgentLogs = {
      ...outcome,
      logs: dedupeLogs([...managedRun.controller.snapshot().logs, ...outcome.logs]),
    };

    const currentTask = await getTask(taskId);
    if (!currentTask) {
      return null;
    }

    if (managedRun.controller.snapshot().stopRequested) {
      await managedRun.controller.complete('Agent run stopped after collection completed.');
      return persistTerminalContinuousSlice(
        await saveTask(buildStoppedTask(currentTask, managedRun.controller.snapshot().stopReason, {
          artifacts: outcome.artifacts,
          collectorLogs: outcomeWithAgentLogs.logs,
          sampleCount: outcome.sample.sampleCount,
          sampleSource: outcome.sample.rawSignal,
          stopStage: managedRun.controller.snapshot().stage,
        })),
      );
    }

    const collectorTaskContext = applyCollectorTargetContext(currentTask, outcomeWithAgentLogs);
    const stagedReason =
      options.source === 'agent'
        ? '采样已经结束，原始产物已由 Agent 暂存，等待上传确认和最终分析。'
        : '采样已经结束，原始产物已经暂存，准备生成最终分析结果。';
    const stagedTask = await saveTask({
      ...collectorTaskContext,
      status: 'UPLOADING',
      statusReason: stagedReason,
      uploadState: 'uploading',
      progress: 78,
      updatedAt: new Date().toISOString(),
      artifacts: outcome.artifacts,
      collectorLogs: outcomeWithAgentLogs.logs,
      sampleCount: outcome.sample.sampleCount,
      sampleSource: outcome.sample.rawSignal,
    });

    await persistStagedCollectorOutcome({
      taskId,
      stagedAt: new Date().toISOString(),
      source: options.source,
      input,
      outcome: outcomeWithAgentLogs,
    });
    await appendAuditEvent({
      id: randomUUID(),
      taskId,
      at: new Date().toISOString(),
      type: 'task.updated',
      actor: options.source === 'agent' ? 'agent' : 'system',
      severity: 'info',
      message: '采集器输出已暂存。',
      detail:
        options.source === 'agent'
          ? 'Agent 已保留原始产物，等待 upload-result 确认后由 server 完成分析。'
          : '本机 runner 已保留原始产物，准备继续完成最终分析。',
      metadata: {
        sampleCount: outcome.sample.sampleCount,
        artifactCount: outcome.artifacts.length,
        sampleSource: outcome.sample.rawSignal,
      },
    });

    if (options.deferFinalize) {
      await managedRun.controller.complete('Agent 已完成采集并暂存上传结果。');
      return stagedTask;
    }

    const finalTask = await finalizeUploadedTaskExecution(taskId, {
      source: options.source,
      statusReason: '本机 runner 已完成产物落盘，正在生成最终分析结果。',
    });
    await managedRun.controller.complete('本机 runner 已成功完成采集与最终分析。');
    return finalTask;
  } catch (error) {
    const currentTask = await getTask(taskId);
    if (!currentTask) {
      return null;
    }

    const message = error instanceof Error ? error.message : '未知采集器故障';
    if (managedRun?.controller.snapshot().stopRequested || getPendingStopRequest(taskId)) {
      if (managedRun) {
        await managedRun.controller.complete('Agent run stopped during collection.');
      } else {
        clearPendingStopRequest(taskId);
      }

      return persistTerminalContinuousSlice(
        await saveTask(buildStoppedTask(currentTask, managedRun?.controller.snapshot().stopReason ?? message, {
          collectorLogs: managedRun?.controller.snapshot().logs ?? currentTask.collectorLogs,
          stopStage: managedRun?.controller.snapshot().stage,
        })),
      );
    }

    if (managedRun) {
      await managedRun.controller.fail(error);
    }

    return persistTerminalContinuousSlice(
      await saveTask(buildFailedTask(currentTask, {
        title: '采集失败',
        summary: '采集器执行没有成功完成。',
        message,
        sampleSource: 'failed',
        artifacts: currentTask.artifacts,
        logs: managedRun ? managedRun.controller.snapshot().logs : [],
        failureStage: managedRun?.controller.snapshot().stage,
      })),
    );
  }
}

export async function cancelTaskExecution(taskId: string, reason: string, actor: 'api' | 'agent' | 'user' = 'api') {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  if (task.status === 'DONE' || task.status === 'FAILED') {
    return {
      accepted: false,
      task,
      runSnapshot: getAgentRunSnapshot(taskId),
      reason: '任务已经处于终态。',
    };
  }

  const stopResult = await requestAgentRunStop(taskId, reason);
  const savedTask = await saveTask(buildStoppedTask(task, reason));
  await persistTerminalContinuousSlice(savedTask);
  const timestamp = new Date().toISOString();

  await appendAuditEvent({
    id: randomUUID(),
    taskId,
    at: timestamp,
    type: 'task.stop_requested',
    actor,
    severity: 'warning',
    message: '已请求停止任务。',
    detail: reason,
  });

  await appendAuditEvent({
    id: randomUUID(),
    taskId,
    at: new Date().toISOString(),
    type: 'task.stopped',
    actor: 'system',
    severity: 'warning',
    message: '任务已被标记为停止。',
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

async function persistTerminalContinuousSlice(task: TaskDetail) {
  if (task.status === 'DONE' || task.status === 'FAILED') {
    await retainTaskContinuousProfileSlice(task);
  }
  return task;
}

async function findBaselineTask(current: TaskDetail) {
  const tasks = await listTasks();
  return (
    tasks.find(
      (task) =>
        task.id !== current.id &&
        task.status === 'DONE' &&
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

function currentTaskTargetContext(task: TaskDetail) {
  return task.targetContext;
}

function applyCollectorTargetContext(task: TaskDetail, outcome: { targetContext?: Partial<TaskDetail['targetContext']> }) {
  if (!outcome.targetContext) {
    return task;
  }

  return {
    ...task,
    targetContext: {
      ...task.targetContext,
      ...outcome.targetContext,
      processInfo: outcome.targetContext.processInfo ?? task.targetContext.processInfo,
    },
  } satisfies TaskDetail;
}

function buildProbeAuditEvent(
  taskId: string,
  probe: NonNullable<Awaited<ReturnType<typeof prepareManagedCollection>>['probe']>,
  collector: TaskCreateInput['collector'],
) {
  const availability = probe.collectors.find((entry) => entry.collector === collector) ?? probe.collectors[0] ?? null;
  return {
    id: randomUUID(),
    taskId,
    at: new Date().toISOString(),
    type: 'task.updated' as const,
    actor: 'agent' as const,
    severity: availability?.available ? ('info' as const) : ('warning' as const),
    message: 'Collector 探测已完成。',
    detail: availability?.detail ?? '当前没有保留更细的 collector 探测细节。',
    metadata: {
      collector,
      supported: availability?.supported ?? false,
      available: availability?.available ?? false,
      hostPlatform: probe.host.platform,
    },
  };
}

function buildStoppedTask(
  task: TaskDetail,
  reason?: string,
  options?: {
    artifacts?: TaskDetail['artifacts'];
    collectorLogs?: string[];
    sampleCount?: number;
    sampleSource?: string;
    stopStage?: string;
    uploadState?: TaskUploadState;
  },
) {
  const stopReason = reason || '任务在完成前被停止。';
  const stoppedAt = new Date().toISOString();
  return {
    ...task,
    status: 'FAILED',
    statusReason: stopReason,
    uploadState:
      options?.uploadState ??
      (options?.artifacts?.length || options?.sampleCount || task.artifacts.length || task.sampleCount
        ? 'uploaded'
        : 'upload_failed'),
    progress: 100,
    updatedAt: stoppedAt,
    reportTitle: '任务已停止',
    reportSummary: '任务在剖析流程完成前已被停止。',
    primaryFinding: '任务在完成前已停止。',
    confidence: 0,
    metrics: task.metrics ?? { cpu: 0, blocked: 0, gc: 0, syscalls: 0 },
    timeline: [
      ...(task.timeline ?? []),
      {
        at: stoppedAt,
        title: options?.stopStage ? `任务在 ${options.stopStage} 阶段被停止` : '任务已停止',
        detail: stopReason,
      },
    ],
    findings: [
      {
        title: '任务在完成前已停止',
        severity: 'medium',
        evidence: stopReason,
        recommendation: '等目标环境准备好后，再重新发起采样。',
      },
    ],
    topFunctions: [],
    flameGraph: { name: 'stopped', value: 100, color: '#f59e0b' },
    sampleCount: options?.sampleCount ?? task.sampleCount ?? 0,
    sampleSource: options?.sampleSource ?? (task.sampleSource === 'pending' ? 'stopped' : task.sampleSource),
    artifacts: options?.artifacts ?? task.artifacts ?? [],
    collectorLogs: dedupeLogs([...(options?.collectorLogs ?? task.collectorLogs ?? []), stopReason]),
    analysisSummary: '任务在稳定分析结果生成前就被停止了。',
    trendSummary: '本次运行提前停止，暂时无法生成趋势分析。',
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
    artifacts?: TaskDetail['artifacts'];
    logs?: string[];
    failureStage?: string;
  },
) {
  const failedAt = new Date().toISOString();
  return {
    ...task,
    status: 'FAILED',
    statusReason: options.message,
    uploadState: options.artifacts?.length || task.artifacts.length ? 'uploaded' : 'upload_failed',
    progress: 100,
    updatedAt: failedAt,
    reportTitle: options.title,
    reportSummary: options.summary,
    primaryFinding: options.title,
    confidence: 0,
    metrics: { cpu: 0, blocked: 0, gc: 0, syscalls: 0 },
    timeline: [
      ...(task.timeline ?? []),
      {
        at: failedAt,
        title: options.failureStage ? `${options.failureStage} 阶段发生 collector 错误` : 'collector 执行错误',
        detail: options.message,
      },
    ],
    findings: [
      {
        title: options.title,
        severity: 'high',
        evidence: options.message,
        recommendation: '先检查 collector 可用性，再重新发起任务。',
      },
    ],
    topFunctions: [],
    flameGraph: { name: 'failed', value: 100, color: '#ef4444' },
    sampleCount: task.sampleCount,
    sampleSource: options.sampleSource,
    artifacts: options.artifacts ?? task.artifacts ?? [],
    collectorLogs: dedupeLogs([...(options.logs ?? []), options.message]),
    analysisSummary: 'collector 在生成有效 profile 前就失败了。',
    trendSummary: '这次没有产出趋势分析。',
    insights: [],
    baselineComparison: null,
  } satisfies TaskDetail;
}
