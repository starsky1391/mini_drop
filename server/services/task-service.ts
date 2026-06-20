import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createQueuedTask } from '../analysis.js';
import { compareTasks } from '../comparison.js';
import { collectorRegistry } from '../collectors/index.js';
import {
  buildContinuousProfileSlice,
  buildContinuousProfileWindow,
  loadContinuousProfileSlices,
  loadContinuousProfileWindow,
} from '../profiling-slices.js';
import { buildTaskTrends } from '../trends.js';
import { getProcessByPid, listLocalProcesses } from '../process-discovery.js';
import {
  appendAuditEvent,
  deleteTaskFlow,
  getAgent,
  getTaskArtifactBundle,
  getTask,
  getTaskReasonerSnapshot,
  isFallbackTask,
  listAgents,
  listAuditEvents,
  listTaskArtifacts,
  listTasks,
  markAgentOffline,
  saveTask,
  upsertAgent,
} from '../store.js';
import { cancelTaskExecution, finalizeUploadedTaskExecution, runTaskExecution } from '../execution.js';
import { getPendingStopRequest, loadAgentRunSnapshot } from '../agent/run-registry.js';
import { probeAgentEnvironment } from '../agent/probe.js';
import { buildArtifactPreviewMetadata, inferPreviewMode } from '../artifact-preview.js';
import { isCollectorId, isScenarioId, isTaskTargetType } from '../../shared/catalog.js';
import type {
  AgentProcessSnapshot,
  AgentHeartbeatRequest,
  AgentListResponse,
  AgentPollTaskResponse,
  AgentRegistrationResponse,
  AgentRegisterRequest,
  AgentSummary,
  AgentUploadResultRequest,
  AgentUploadResultResponse,
  ArtifactPreview,
  ArtifactPreviewResponse,
  ApiErrorResponse,
  CollectorId,
  CollectorRuntimeReadiness,
  ContinuousProfileWindowResponse,
  ProcessListResponse,
  TaskArtifactsResponse,
  TaskAuditResponse,
  TaskAttachSource,
  TaskComparisonResponse,
  TaskCreateInput,
  TaskCreateRequest,
  TaskDetailResponse,
  TaskFlowDeleteResponse,
  TaskListFilters,
  TaskProcessInfo,
  TaskListResponse,
  TaskReasonerResponse,
  TaskRunStateResponse,
  TaskStatus,
  TaskTargetType,
} from '../../shared/types.js';

const validStatuses: TaskStatus[] = ['PENDING', 'RUNNING', 'UPLOADING', 'DONE', 'FAILED'];
const previewByteLimit = 64 * 1024;
const defaultAgentStaleAfterSeconds = 30;
const allowManagedRunnerFallback = process.env.MINI_DROP_DISABLE_MANAGED_RUNNER !== '1';

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiErrorResponse };

type ContinuousProfileScope = 'task' | 'history';

export interface LoadContinuousProfileOptions {
  scope?: ContinuousProfileScope;
  from?: string;
  to?: string;
  limit?: number;
}

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function validateTaskCreateInput(body: unknown): Promise<ValidationResult<TaskCreateInput>> {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      error: {
        code: 'invalid_body',
        message: 'Request body must be a JSON object.',
      },
    };
  }

  const candidate = body as Partial<TaskCreateRequest>;
  const target = trimString(candidate.target);
  const targetType = trimString(candidate.targetType) || 'label';
  const language = trimString(candidate.language);
  const collector = trimString(candidate.collector);
  const scenario = trimString(candidate.scenario);
  const requestProcessInfo = normalizeRequestedProcessInfo(candidate.processInfo);
  const pid = parsePositiveInteger(candidate.pid ?? requestProcessInfo?.pid);
  const details: string[] = [];

  if (!targetType) {
    details.push('targetType is required');
  } else if (!isTaskTargetType(targetType)) {
    details.push('targetType must be one of: label, pid, process');
  }
  if (!language) {
    details.push('language is required');
  }
  if (!collector) {
    details.push('collector is required');
  } else if (!isCollectorId(collector)) {
    details.push(`collector must be one of: perf, py-spy, async-profiler, ebpf`);
  }
  if (!scenario) {
    details.push('scenario is required');
  } else if (!isScenarioId(scenario)) {
    details.push('scenario must be one of: cpu_hot, lock_contention, gc_pressure, python_hot_loop');
  }

  if (isTaskTargetType(targetType)) {
    if (targetType === 'label' && !target) {
      details.push('target is required when targetType=label');
    }
    if ((targetType === 'pid' || targetType === 'process') && !pid) {
      details.push(`pid is required when targetType=${targetType}`);
    }
  }

  if (details.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_task_create_input',
        message: 'Task creation input is invalid.',
        details,
      },
    };
  }

  const preferredAgent = await loadPreferredProcessAgent();
  let processInfo: TaskProcessInfo | null = null;
  if (targetType !== 'label' && pid) {
    processInfo = resolveProcessFromSnapshot(preferredAgent?.processSnapshot ?? null, pid);
    if (!processInfo) {
      processInfo = await getProcessByPid(pid);
    }
    if (!processInfo) {
      return {
        ok: false,
        error: {
          code: 'target_process_not_found',
          message: `No running process matched PID ${pid}.`,
          details: [
            preferredAgent
              ? `PID 校验已优先使用 Agent ${preferredAgent.label} (${preferredAgent.id}) 的真实进程快照。`
              : 'The selected target process must still exist when the task is created.',
          ],
        },
      };
    }
  }

  const normalizedTargetType = targetType as TaskTargetType;
  const normalizedTarget =
    target ||
    processInfo?.name ||
    requestProcessInfo?.name ||
    (pid ? `pid:${pid}` : 'local-target');

  return {
    ok: true,
    value: {
      target: normalizedTarget,
      language,
      collector: collector as TaskCreateInput['collector'],
      scenario: scenario as TaskCreateInput['scenario'],
      targetType: normalizedTargetType,
      pid: processInfo?.pid ?? pid,
      processInfo,
      attachSource: defaultAttachSource(normalizedTargetType),
    },
  };
}

export function parseTaskListFilters(query: Record<string, unknown>): ValidationResult<TaskListFilters> {
  const status = trimString(query.status);
  const collector = trimString(query.collector);
  const scenario = trimString(query.scenario);
  const target = trimString(query.target);
  const targetType = trimString(query.targetType);
  const details: string[] = [];

  if (status && !validStatuses.includes(status as TaskStatus)) {
    details.push(`status must be one of: ${validStatuses.join(', ')}`);
  }
  if (collector && !isCollectorId(collector)) {
    details.push('collector filter is invalid');
  }
  if (scenario && !isScenarioId(scenario)) {
    details.push('scenario filter is invalid');
  }
  if (targetType && !isTaskTargetType(targetType)) {
    details.push('targetType filter is invalid');
  }

  if (details.length > 0) {
    return {
      ok: false,
      error: {
        code: 'invalid_task_filters',
        message: 'One or more task list filters are invalid.',
        details,
      },
    };
  }

  return {
    ok: true,
    value: {
      status: status ? (status as TaskStatus) : undefined,
      collector: (collector || undefined) as TaskListFilters['collector'],
      scenario: (scenario || undefined) as TaskListFilters['scenario'],
      target: target || undefined,
      targetType: (targetType || undefined) as TaskListFilters['targetType'],
    },
  };
}

export async function createTaskAndDispatch(input: TaskCreateInput): Promise<TaskDetailResponse> {
  const onlineAgents = await listAgents();
  const preferIndependentAgent = onlineAgents.some(isAgentAvailableForDispatch);
  const statusReason = preferIndependentAgent
    ? '任务已经创建，正在等待独立 Agent 拉取并执行。'
    : allowManagedRunnerFallback
      ? '任务已经创建，正在等待本机 runner 执行。'
      : '任务已经创建，但当前没有可用的独立 Agent。';
  const task = createQueuedTask(input);
  const savedTask = await saveTask({
    ...task,
    status: 'PENDING',
    statusReason,
    uploadState: 'not_started',
    progress: 9,
    updatedAt: new Date().toISOString(),
  });

  await appendAuditEvent({
    id: randomUUID(),
    taskId: task.id,
    at: new Date().toISOString(),
    type: 'task.execution_dispatched',
    actor: 'api',
    severity: 'info',
    message: preferIndependentAgent ? '任务已进入 Agent 队列。' : '任务已分发给本机 runner。',
    detail: preferIndependentAgent
      ? '当前存在可用的独立 Agent，任务会等待被拉取。'
      : allowManagedRunnerFallback
        ? '当前没有可用 Agent，因此会继续由本机 runner 执行。'
        : '当前没有可用 Agent，任务会保持排队状态直到有 Agent 上线。',
    metadata: {
      collector: input.collector,
      scenario: input.scenario,
      independentAgentPreferred: preferIndependentAgent,
      managedRunnerFallback: !preferIndependentAgent && allowManagedRunnerFallback,
    },
  });

  if (!preferIndependentAgent && allowManagedRunnerFallback) {
    void runTaskExecution(task.id, input);
  }
  return { task: savedTask };
}

export async function loadLocalProcesses(): Promise<ProcessListResponse> {
  const preferredAgent = await loadPreferredProcessAgent();
  if (preferredAgent?.processSnapshot?.processes.length) {
    return {
      collectedAt: preferredAgent.processSnapshot.collectedAt,
      processes: preferredAgent.processSnapshot.processes,
      source: 'agent',
      agentId: preferredAgent.id,
      agentLabel: preferredAgent.label,
    };
  }

  const local = await listLocalProcesses();
  return {
    ...local,
    source: 'server-local',
    agentId: null,
    agentLabel: null,
  };
}

export async function loadAgentList(): Promise<AgentListResponse> {
  const agents = await listAgents();
  return {
    staleAfterSeconds: defaultAgentStaleAfterSeconds,
    agents: agents.map((agent) => refreshAgentHeartbeatState(agent)),
  };
}

export async function loadCatalogCollectorReadiness(): Promise<{
  collectorReadiness: CollectorRuntimeReadiness[];
  source: 'agent' | 'server-fallback';
  agentId: string | null;
  agentLabel: string | null;
  notes: string[];
}> {
  const agents = (await listAgents()).map((agent) => refreshAgentHeartbeatState(agent));
  const preferredAgent =
    agents.find((agent) => isAgentAvailableForDispatch(agent) && agent.collectors.length > 0) ??
    agents.find((agent) => agent.collectors.length > 0) ??
    null;

  if (preferredAgent) {
    return {
      collectorReadiness: preferredAgent.collectors,
      source: 'agent',
      agentId: preferredAgent.id,
      agentLabel: preferredAgent.label,
      notes: [
        `collector readiness 来源于已注册 Agent：${preferredAgent.label} (${preferredAgent.id})`,
        `agent status=${preferredAgent.status} heartbeat=${preferredAgent.heartbeatState}`,
      ],
    };
  }

  const collectorReadiness = await Promise.all(
    collectorRegistry.entries().map(async ([_, plugin]) => {
      const probe = await probeAgentEnvironment(plugin);
      return probe.collectors[0]!;
    }),
  );

  return {
    collectorReadiness,
    source: 'server-fallback',
    agentId: null,
    agentLabel: null,
    notes: ['当前没有可用 Agent，collector readiness 已回退到 server 本机探测结果。'],
  };
}

export async function registerAgent(body: unknown): Promise<ValidationResult<AgentRegistrationResponse>> {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      error: {
        code: 'invalid_agent_register_body',
        message: 'Agent register body must be a JSON object.',
      },
    };
  }

  const candidate = body as AgentRegisterRequest;
  const now = new Date().toISOString();
  const agentId = trimString(candidate.id) || randomUUID();
  const label = trimString(candidate.label) || `agent-${agentId.slice(0, 8)}`;
  const platform = trimString(candidate.host?.platform) || process.platform;
  const arch = trimString(candidate.host?.arch) || process.arch;
  const nodeVersion = trimString(candidate.host?.nodeVersion) || process.version;
  const hostPid = typeof candidate.host?.pid === 'number' ? candidate.host.pid : null;
  const collectors = normalizeHeartbeatCollectors(candidate.collectors ?? []);
  const existing = await getAgent(agentId);

  const next: AgentSummary = {
    id: agentId,
    label,
    status: 'online',
    heartbeatState: 'healthy',
    registeredAt: existing?.registeredAt ?? now,
    lastHeartbeatAt: now,
    lastSeenAt: now,
    staleAfterSeconds: defaultAgentStaleAfterSeconds,
    platform,
    arch,
    nodeVersion,
    hostPid,
    currentTaskId: existing?.currentTaskId ?? null,
    notes: normalizeNotes(candidate.notes),
    collectors,
    processSnapshot: normalizeProcessSnapshot(candidate.processSnapshot),
    lastOfflineAt: existing?.lastOfflineAt,
    lastRecoveryAt: existing?.status === 'offline' ? now : existing?.lastRecoveryAt,
  };

  const saved = refreshAgentHeartbeatState(await upsertAgent(next));
  await appendAuditEvent({
    id: randomUUID(),
    taskId: `agent:${saved.id}`,
    at: now,
    type: 'task.updated',
    actor: 'agent',
    severity: 'info',
    message: existing ? 'Agent 重新注册成功。' : 'Agent 注册成功。',
    detail: `${saved.label} (${saved.platform}/${saved.arch}) 心跳窗口 ${saved.staleAfterSeconds}s。`,
  });

  return {
    ok: true,
    value: {
      accepted: true,
      staleAfterSeconds: defaultAgentStaleAfterSeconds,
      agent: saved,
    },
  };
}

export async function acceptAgentHeartbeat(
  agentId: string,
  body: unknown,
): Promise<
  | { ok: true; value: AgentRegistrationResponse }
  | { ok: false; status: number; error: ApiErrorResponse }
> {
  const existing = await getAgent(agentId);
  if (!existing) {
    return {
      ok: false,
      status: 404,
      error: {
        code: 'agent_not_found',
        message: 'Agent not registered.',
      },
    };
  }

  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'invalid_agent_heartbeat_body',
        message: 'Agent heartbeat body must be a JSON object.',
      },
    };
  }

  const candidate = body as AgentHeartbeatRequest;
  const now = new Date().toISOString();
  const recovered = existing.status === 'offline';
  const next: AgentSummary = {
    ...existing,
    status: 'online',
    heartbeatState: 'healthy',
    lastHeartbeatAt: now,
    lastSeenAt: now,
    currentTaskId: typeof candidate.currentTaskId === 'string' ? candidate.currentTaskId : null,
    collectors: normalizeHeartbeatCollectors(candidate.collectors ?? existing.collectors),
    notes: normalizeNotes(candidate.notes?.length ? candidate.notes : existing.notes),
    processSnapshot: normalizeProcessSnapshot(candidate.processSnapshot) ?? existing.processSnapshot ?? null,
    lastRecoveryAt: recovered ? now : existing.lastRecoveryAt,
  };

  const saved = refreshAgentHeartbeatState(await upsertAgent(next));
  await appendAuditEvent({
    id: randomUUID(),
    taskId: `agent:${saved.id}`,
    at: now,
    type: 'task.updated',
    actor: 'agent',
    severity: 'info',
    message: recovered ? 'Agent 心跳恢复。' : 'Agent 心跳已更新。',
    detail: saved.currentTaskId ? `当前执行任务 ${saved.currentTaskId}。` : '当前没有登记中的活跃任务。',
  });

  return {
    ok: true,
    value: {
      accepted: true,
      staleAfterSeconds: defaultAgentStaleAfterSeconds,
      agent: saved,
    },
  };
}

export async function pollAgentTask(
  agentId: string,
): Promise<
  | { ok: true; value: AgentPollTaskResponse }
  | { ok: false; status: number; error: ApiErrorResponse }
> {
  const existing = await getAgent(agentId);
  if (!existing) {
    return {
      ok: false,
      status: 404,
      error: {
        code: 'agent_not_found',
        message: 'Agent not registered.',
      },
    };
  }

  const refreshed = refreshAgentHeartbeatState(existing);
  const leasedTask = refreshed.currentTaskId ? await getTask(refreshed.currentTaskId) : null;
  if (leasedTask && !isTerminalTaskStatus(leasedTask.status)) {
    return {
      ok: true,
      value: {
        accepted: true,
        agent: refreshed,
        task: leasedTask,
        message: 'Returned the current leased task for this agent.',
      },
    };
  }

  const normalizedAgent =
    refreshed.currentTaskId && (!leasedTask || isTerminalTaskStatus(leasedTask.status))
      ? await upsertAgent({
          ...refreshed,
          currentTaskId: null,
          status: 'online',
          heartbeatState: 'healthy',
        })
      : refreshed;

  const agents = await listAgents();
  const leasedTaskIds = new Set(agents.map((agent) => agent.currentTaskId).filter((id): id is string => Boolean(id)));
  const queuedTasks = await listTasks({ status: 'PENDING' });
  const nextTask =
    queuedTasks
      .filter((task) => !leasedTaskIds.has(task.id))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0] ?? null;

  if (!nextTask) {
    return {
      ok: true,
      value: {
        accepted: true,
        agent: normalizedAgent,
        task: null,
        message: 'No queued task is ready for agent pickup.',
      },
    };
  }

  const assignedAgent = await upsertAgent({
    ...normalizedAgent,
    status: 'online',
    heartbeatState: 'healthy',
    currentTaskId: nextTask.id,
    lastSeenAt: new Date().toISOString(),
  });

  await appendAuditEvent({
    id: randomUUID(),
    taskId: nextTask.id,
    at: new Date().toISOString(),
    type: 'task.execution_dispatched',
    actor: 'agent',
    severity: 'info',
    message: '任务已分配给 Agent。',
    detail: `Agent ${assignedAgent.label} (${assignedAgent.id}) 已领取任务。`,
    metadata: {
      agentId: assignedAgent.id,
      agentLabel: assignedAgent.label,
    },
  });

  return {
    ok: true,
    value: {
      accepted: true,
      agent: assignedAgent,
      task: nextTask,
      message: 'Queued task leased to the agent successfully.',
    },
  };
}

export async function acceptAgentUploadResult(
  agentId: string,
  body: unknown,
): Promise<
  | { ok: true; value: AgentUploadResultResponse }
  | { ok: false; status: number; error: ApiErrorResponse }
> {
  const existing = await getAgent(agentId);
  if (!existing) {
    return {
      ok: false,
      status: 404,
      error: {
        code: 'agent_not_found',
        message: 'Agent not registered.',
      },
    };
  }

  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'invalid_agent_upload_body',
        message: 'Agent upload body must be a JSON object.',
      },
    };
  }

  const candidate = body as AgentUploadResultRequest;
  const taskId = trimString(candidate.taskId);
  if (!taskId) {
    return {
      ok: false,
      status: 400,
      error: {
        code: 'invalid_agent_upload_body',
        message: 'taskId is required for agent upload result acknowledgements.',
      },
    };
  }

  const task = await getTask(taskId);
  if (!task) {
    return {
      ok: false,
      status: 404,
      error: {
        code: 'task_not_found',
        message: 'Task not found.',
      },
    };
  }

  if (existing.currentTaskId && existing.currentTaskId !== taskId) {
    return {
      ok: false,
      status: 409,
      error: {
        code: 'agent_task_mismatch',
        message: 'Agent upload result does not match the currently leased task.',
      },
    };
  }

  const uploadState = normalizeUploadState(candidate.uploadState);
  const note = trimString(candidate.note);
  const artifactCount = typeof candidate.artifactCount === 'number' ? candidate.artifactCount : null;
  const releaseLease = uploadState === 'uploaded' || uploadState === 'upload_failed';
  const statusReason = note || buildUploadStateMessage(uploadState);

  if (uploadState === 'uploading' || uploadState === 'upload_failed' || uploadState === 'uploaded') {
    await saveTask({
      ...task,
      status: uploadState === 'upload_failed' ? 'FAILED' : 'UPLOADING',
      statusReason,
      uploadState,
      progress:
        uploadState === 'upload_failed'
          ? 100
          : uploadState === 'uploaded'
            ? Math.max(task.progress, 86)
            : Math.max(task.progress, 78),
      updatedAt: new Date().toISOString(),
    });
  }

  if (uploadState === 'uploaded') {
    await finalizeUploadedTaskExecution(taskId, {
      source: 'agent',
      statusReason: note || 'Agent 已确认上传完成，server 正在生成最终分析结果。',
    });
  }

  const nextAgent = await upsertAgent({
    ...existing,
    currentTaskId: releaseLease ? null : taskId,
    status: 'online',
    heartbeatState: 'healthy',
    lastSeenAt: new Date().toISOString(),
    notes: note ? normalizeNotes([...existing.notes, note]) : existing.notes,
  });

  await appendAuditEvent({
    id: randomUUID(),
    taskId,
    at: new Date().toISOString(),
    type: 'task.updated',
    actor: 'agent',
    severity: uploadState === 'upload_failed' ? 'warning' : 'info',
    message: buildUploadStateMessage(uploadState),
    detail: statusReason || `Agent ${nextAgent.label} 上报了 ${uploadState} 状态。`,
    metadata: {
      agentId: nextAgent.id,
      uploadState,
      artifactCount,
    },
  });

  return {
    ok: true,
    value: {
      accepted: true,
      taskId,
      message: buildUploadStateMessage(uploadState),
    },
  };
}

export async function sweepOfflineAgents() {
  const agents = await listAgents();
  const offline: AgentSummary[] = [];

  for (const agent of agents) {
    const refreshed = refreshAgentHeartbeatState(agent);
    if (agent.status !== 'offline' && refreshed.status === 'offline') {
      const saved = await markAgentOffline(agent.id, 'Heartbeat exceeded the stale window.');
      if (saved) {
        offline.push(saved);
        await appendAuditEvent({
          id: randomUUID(),
          taskId: `agent:${saved.id}`,
          at: new Date().toISOString(),
          type: 'task.updated',
          actor: 'system',
          severity: 'warning',
          message: 'Agent 已转为离线。',
          detail: `最后一次心跳超出了 ${saved.staleAfterSeconds}s 窗口。`,
        });
      }
    }
  }

  return offline;
}

export async function loadTaskDetail(taskId: string): Promise<TaskDetailResponse | null> {
  const task = await getTask(taskId);
  return task ? { task } : null;
}

export async function loadTaskList(filters: TaskListFilters): Promise<TaskListResponse> {
  const tasks = await listTasks(filters);
  return { tasks };
}

export async function loadTaskComparison(taskId: string, otherId: string): Promise<TaskComparisonResponse | null> {
  const [baseline, current] = await Promise.all([getTask(otherId), getTask(taskId)]);
  if (!baseline || !current) {
    return null;
  }
  return {
    comparison: compareTasks(baseline, current),
  };
}

export async function loadTaskArtifacts(taskId: string): Promise<TaskArtifactsResponse | null> {
  return loadTaskSidecar(taskId, async () => {
    const bundle = await getTaskArtifactBundle(taskId);
    if (!bundle) {
      throw new Error('Task artifacts were requested for a missing task.');
    }

    return {
      taskId,
      artifacts: bundle.artifacts,
      resultIndex: {
        ...bundle.resultIndex,
        taskId,
      },
    };
  });
}

export async function loadTaskAudit(taskId: string): Promise<TaskAuditResponse | null> {
  return loadTaskSidecar(taskId, async () => ({
    taskId,
    auditEvents: await listAuditEvents(taskId),
  }));
}

export async function loadAuditFeed(taskId?: string) {
  return {
    auditEvents: await listAuditEvents(taskId),
  };
}

export async function loadTaskReasoner(taskId: string) {
  return loadTaskSidecar<TaskReasonerResponse>(taskId, async () => ({
    taskId,
    snapshot: await getTaskReasonerSnapshot(taskId),
  }));
}

export async function loadTaskTrends(taskId: string) {
  return loadTaskSidecar(taskId, async () => {
    const tasks = await listTasks();
    return buildTaskTrends(taskId, tasks);
  });
}

export async function loadTaskContinuousProfile(
  taskId: string,
  options: LoadContinuousProfileOptions = {},
): Promise<ContinuousProfileWindowResponse | null> {
  return loadTaskSidecar(taskId, async () => {
    const task = await getTask(taskId);
    if (!task) {
      return null;
    }

    if (options.scope === 'history') {
      const scopedTasks = (await listTasks()).filter(
        (candidate) =>
          candidate.target === task.target &&
          candidate.collector === task.collector &&
          candidate.scenario === task.scenario &&
          !isFallbackTask(candidate),
      );

      const scopedSlices = (
        await Promise.all(
          scopedTasks.map(async (candidate) => {
            const persisted = await loadContinuousProfileSlices(candidate.id);
            return persisted.length > 0 ? persisted : [buildContinuousProfileSlice({ task: candidate })];
          }),
        )
      ).flat();

      return {
        taskId,
        window: buildContinuousProfileWindow(taskId, applyContinuousProfileOptions(scopedSlices, options)),
      };
    }

    const loaded = await loadContinuousProfileWindow(taskId, options);
    return (
      loaded ?? {
        taskId,
        window: buildContinuousProfileWindow(taskId, [buildContinuousProfileSlice({ task })]),
      }
    );
  });
}

export async function loadTaskRunState(taskId: string) {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  const activeRun = await loadAgentRunSnapshot(taskId);
  const probeSummary = activeRun?.probe?.collectors ?? null;

  return {
    taskId,
    taskStatus: task.status,
    activeRun,
    stopPending: Boolean(getPendingStopRequest(taskId)),
    probeSummary,
    lastCollectorStage: activeRun?.stage ?? null,
  } satisfies TaskRunStateResponse;
}

export async function cancelTask(taskId: string) {
  return await cancelTaskExecution(taskId, 'Stop requested via API.', 'api');
}

export async function deleteTaskFlowByTarget(target: string): Promise<TaskFlowDeleteResponse | null> {
  return deleteTaskFlow(target);
}

export async function loadArtifactPreview(taskId: string, artifactPath: string) {
  return loadTaskSidecar<ArtifactPreviewResponse | ApiErrorResponse>(taskId, async () => {
    const artifacts = (await listTaskArtifacts(taskId)) ?? [];
    const artifact = artifacts.find((item) => item.path === artifactPath);
    if (!artifact) {
      return {
        code: 'artifact_not_found',
        message: 'Artifact not found for the selected task.',
      } satisfies ApiErrorResponse;
    }

    const task = await getTask(taskId);
    if (!task) {
      return {
        code: 'artifact_not_found',
        message: 'Artifact not found for the selected task.',
      } satisfies ApiErrorResponse;
    }

    return {
      taskId,
      artifact,
      preview: await readArtifactPreview(artifact.path, task.collector),
    };
  });
}

async function readArtifactPreview(filePath: string, collector?: string): Promise<ArtifactPreview> {
  const collectorId = isCollectorId(collector ?? '') ? (collector as CollectorId) : undefined;
  const preview = buildArtifactPreviewMetadata(filePath, inferArtifactKindFromPath(filePath), collectorId);
  const mode = preview.mode;
  if (mode === 'unsupported') {
    const stats = await fs.stat(filePath).catch(() => null);
    return {
      mode,
      content: null,
      truncated: false,
      byteLength: stats?.size ?? 0,
      mimeType: preview.mimeType,
      summary: preview.previewHint,
    };
  }

  const raw = await fs.readFile(filePath, 'utf8');
  const byteLength = Buffer.byteLength(raw, 'utf8');
  const truncated = byteLength > previewByteLimit;
  const content = truncated ? raw.slice(0, previewByteLimit) : raw;

  return {
    mode,
    content,
    truncated,
    byteLength,
    mimeType: preview.mimeType,
    summary: truncated
      ? `${preview.previewHint} The inline preview was truncated to ${previewByteLimit} bytes.`
      : preview.previewHint,
  };
}

function inferArtifactKindFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.log' || ext === '.txt' || ext === '.jsonl' || ext === '.ndjson') {
    return 'log' as const;
  }
  if (ext === '.collapsed' || ext === '.folded') {
    return 'collapsed-stacks' as const;
  }
  if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.md') {
    return 'report' as const;
  }
  if (inferPreviewMode(filePath) === 'unsupported') {
    return 'raw' as const;
  }
  return 'raw' as const;
}

async function loadTaskSidecar<T>(taskId: string, loader: () => Promise<T>): Promise<T | null> {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  return loader();
}

function parsePositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return undefined;
}

function normalizeRequestedProcessInfo(value: unknown): TaskProcessInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<TaskProcessInfo>;
  const pid = parsePositiveInteger(candidate.pid);
  const name = trimString(candidate.name);
  const command = trimString(candidate.command);
  const commandSummary = trimString(candidate.commandSummary);
  const languageHint = trimString(candidate.languageHint);

  if (!pid && !name && !command && !commandSummary) {
    return null;
  }

  return {
    pid: pid ?? 0,
    name,
    command,
    commandSummary: commandSummary || command || name,
    languageHint: languageHint || null,
    alive: true,
  };
}

function normalizeProcessSnapshot(value: unknown): AgentProcessSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<AgentProcessSnapshot>;
  const processes = Array.isArray(candidate.processes)
    ? candidate.processes.map((item) => normalizeRequestedProcessInfo(item)).filter((item): item is TaskProcessInfo => Boolean(item))
    : [];

  return {
    collectedAt: typeof candidate.collectedAt === 'string' ? candidate.collectedAt : new Date().toISOString(),
    processes,
  };
}

function resolveProcessFromSnapshot(snapshot: AgentProcessSnapshot | null, pid: number) {
  if (!snapshot) {
    return null;
  }
  return snapshot.processes.find((item) => item.pid === pid) ?? null;
}

async function loadPreferredProcessAgent(): Promise<AgentSummary | null> {
  const agents = (await listAgents()).map((agent) => refreshAgentHeartbeatState(agent));
  return (
    agents.find(
      (agent) =>
        isAgentAvailableForDispatch(agent) &&
        Boolean(agent.processSnapshot?.processes.length),
    ) ??
    agents.find((agent) => Boolean(agent.processSnapshot?.processes.length)) ??
    null
  );
}

function defaultAttachSource(targetType: TaskTargetType): TaskAttachSource {
  if (targetType === 'pid') {
    return 'external-pid';
  }
  if (targetType === 'process') {
    return 'process-selection';
  }
  return 'managed-workload';
}

function normalizeHeartbeatCollectors(items: unknown[]): CollectorRuntimeReadiness[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item): item is CollectorRuntimeReadiness => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      collector: item.collector,
      supported: Boolean(item.supported),
      available: Boolean(item.available),
      readiness: item.readiness,
      detail: typeof item.detail === 'string' ? item.detail : 'No collector detail retained.',
    }));
}

function normalizeNotes(notes: unknown): string[] {
  if (!Array.isArray(notes)) {
    return [];
  }
  return [...new Set(notes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

function refreshAgentHeartbeatState(agent: AgentSummary): AgentSummary {
  const ageSeconds = Math.max(0, (Date.now() - Date.parse(agent.lastHeartbeatAt)) / 1000);
  if (ageSeconds > agent.staleAfterSeconds) {
    return {
      ...agent,
      status: 'offline',
      heartbeatState: 'lost',
    };
  }
  if (ageSeconds > Math.max(5, agent.staleAfterSeconds / 2)) {
    return {
      ...agent,
      status: 'online',
      heartbeatState: 'stale',
    };
  }
  return {
    ...agent,
    status: 'online',
    heartbeatState: 'healthy',
  };
}

function normalizeUploadState(value: unknown) {
  return value === 'uploading' || value === 'uploaded' || value === 'upload_failed' ? value : 'uploaded';
}

function buildUploadStateMessage(uploadState: AgentUploadResultRequest['uploadState']) {
  if (uploadState === 'uploading') {
    return 'Agent 正在上传采样产物。';
  }
  if (uploadState === 'upload_failed') {
    return 'Agent 上传采样产物失败。';
  }
  return 'Agent 已完成采样产物上传。';
}

function isTerminalTaskStatus(status: TaskStatus) {
  return status === 'DONE' || status === 'FAILED';
}

function isAgentAvailableForDispatch(agent: AgentSummary) {
  const refreshed = refreshAgentHeartbeatState(agent);
  return refreshed.status === 'online' && refreshed.heartbeatState !== 'lost';
}

function applyContinuousProfileOptions(
  slices: Awaited<ReturnType<typeof loadContinuousProfileSlices>>,
  options: LoadContinuousProfileOptions,
) {
  const fromTs = options.from ? Date.parse(options.from) : null;
  const toTs = options.to ? Date.parse(options.to) : null;
  const filtered = [...slices]
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt))
    .filter((slice) => {
      const startedAt = Date.parse(slice.startedAt);
      const endedAt = Date.parse(slice.endedAt);
      if (fromTs !== null && endedAt < fromTs) {
        return false;
      }
      if (toTs !== null && startedAt > toTs) {
        return false;
      }
      return true;
    });

  if (options.limit && options.limit > 0 && filtered.length > options.limit) {
    return filtered.slice(-options.limit);
  }

  return filtered;
}
