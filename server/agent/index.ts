import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import type {
  AgentProcessSnapshot,
  AgentHeartbeatRequest,
  AgentPollTaskResponse,
  AgentRegisterRequest,
  AgentRegistrationResponse,
  AgentUploadResultRequest,
  AgentUploadResultResponse,
  TaskCreateInput,
  TaskDetail,
} from '../../shared/types.js';
import { collectTaskExecution } from '../execution.js';
import { getTask } from '../store.js';
import { probeAllAgentCollectors } from './probe.js';
import { listLocalProcesses } from '../process-discovery.js';

export interface AgentRuntimeConfig {
  agentId: string;
  label: string;
  baseUrl: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  idleDelayMs: number;
  errorDelayMs: number;
}

export interface AgentApiClient {
  register(body: AgentRegisterRequest): Promise<AgentRegistrationResponse>;
  heartbeat(body: AgentHeartbeatRequest): Promise<AgentRegistrationResponse>;
  pollTask(): Promise<AgentPollTaskResponse>;
  uploadResult(body: AgentUploadResultRequest): Promise<AgentUploadResultResponse>;
}

export function resolveAgentRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AgentRuntimeConfig {
  const agentId = env.MINI_DROP_AGENT_ID?.trim() || randomUUID();
  return {
    agentId,
    label: env.MINI_DROP_AGENT_LABEL?.trim() || `local-agent-${agentId.slice(0, 8)}`,
    baseUrl: (env.MINI_DROP_AGENT_BASE_URL?.trim() || 'http://127.0.0.1:8787').replace(/\/+$/, ''),
    pollIntervalMs: Math.max(500, Number(env.MINI_DROP_AGENT_POLL_MS ?? 1500)),
    heartbeatIntervalMs: Math.max(1000, Number(env.MINI_DROP_AGENT_HEARTBEAT_MS ?? 5000)),
    idleDelayMs: Math.max(500, Number(env.MINI_DROP_AGENT_IDLE_MS ?? 1200)),
    errorDelayMs: Math.max(1000, Number(env.MINI_DROP_AGENT_ERROR_MS ?? 2500)),
  };
}

export function createAgentApiClient(
  config: AgentRuntimeConfig,
  fetchImpl: typeof fetch = fetch,
): AgentApiClient {
  const request = async <T>(pathname: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(`${config.baseUrl}${pathname}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const message =
        typeof payload.message === 'string'
          ? payload.message
          : `Agent API ${pathname} failed with HTTP ${response.status}.`;
      throw new Error(message);
    }

    return payload as T;
  };

  return {
    register(body) {
      return request<AgentRegistrationResponse>('/api/agents/register', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    heartbeat(body) {
      return request<AgentRegistrationResponse>(`/api/agents/${encodeURIComponent(config.agentId)}/heartbeat`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    pollTask() {
      return request<AgentPollTaskResponse>(`/api/agents/${encodeURIComponent(config.agentId)}/poll-task`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    uploadResult(body) {
      return request<AgentUploadResultResponse>(`/api/agents/${encodeURIComponent(config.agentId)}/upload-result`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
  };
}

export async function registerAgentProcess(config: AgentRuntimeConfig, client: AgentApiClient) {
  const probe = await probeAllAgentCollectors();
  const processSnapshot = await buildAgentProcessSnapshot();
  return client.register({
    id: config.agentId,
    label: config.label,
    host: {
      platform: probe.host.platform,
      arch: probe.host.arch,
      nodeVersion: probe.host.nodeVersion,
      pid: probe.host.pid,
    },
    collectors: probe.collectors,
    notes: probe.notes,
    processSnapshot,
  });
}

async function buildAgentProcessSnapshot(): Promise<AgentProcessSnapshot> {
  const processes = await listLocalProcesses();
  return {
    collectedAt: processes.collectedAt,
    processes: processes.processes,
  };
}

export function taskDetailToCreateInput(task: TaskDetail): TaskCreateInput {
  return {
    target: task.target,
    language: task.language,
    collector: task.collector,
    scenario: task.scenario,
    targetType: task.targetContext.targetType,
    pid: task.targetContext.processInfo?.pid,
    processInfo: task.targetContext.processInfo,
    attachSource: task.targetContext.attachSource,
  };
}

export async function executeLeasedTask(
  task: TaskDetail,
  config: AgentRuntimeConfig,
  client: AgentApiClient,
) {
  await client.heartbeat({
    currentTaskId: task.id,
    notes: [`Agent ${config.label} accepted task ${task.id}.`],
    processSnapshot: await buildAgentProcessSnapshot(),
  });

  try {
    const stagedTask = await collectTaskExecution(task.id, taskDetailToCreateInput(task));
    const persistedTask = stagedTask ?? (await getTask(task.id));
    const uploadState = persistedTask?.status === 'FAILED' ? 'upload_failed' : 'uploaded';
    const artifactCount = persistedTask?.artifacts.length ?? 0;
    const note =
      persistedTask?.statusReason ||
      (uploadState === 'uploaded' ? 'Agent 已完成采样并暂存产物。' : 'Agent 执行失败，已保留失败状态。');

    await client.uploadResult({
      taskId: task.id,
      uploadState,
      artifactCount,
      note,
    });
    const finalizedTask = await getTask(task.id);
    await client.heartbeat({
      currentTaskId: null,
      notes: [`Agent ${config.label} finished task ${task.id} with ${uploadState}.`],
      processSnapshot: await buildAgentProcessSnapshot(),
    });
    return finalizedTask;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown leased task execution error.';
    await client.uploadResult({
      taskId: task.id,
      uploadState: 'upload_failed',
      artifactCount: 0,
      note: message,
    });
    await client.heartbeat({
      currentTaskId: null,
      notes: [`Agent ${config.label} failed task ${task.id}: ${message}`],
      processSnapshot: await buildAgentProcessSnapshot(),
    });
    throw error;
  }
}

export async function runAgentWorkCycle(config: AgentRuntimeConfig, client: AgentApiClient) {
  const leased = await client.pollTask();
  if (!leased.task) {
    await client.heartbeat({
      currentTaskId: null,
      notes: [`Agent ${config.label} is idle and waiting for queued tasks.`],
      processSnapshot: await buildAgentProcessSnapshot(),
    });
    return false;
  }

  await executeLeasedTask(leased.task, config, client);
  return true;
}

export async function runAgentLoop(
  config: AgentRuntimeConfig = resolveAgentRuntimeConfig(),
  fetchImpl: typeof fetch = fetch,
) {
  const client = createAgentApiClient(config, fetchImpl);
  await registerAgentProcess(config, client);

  let stopped = false;
  let currentTaskId: string | null = null;
  const heartbeatTimer = setInterval(() => {
    void buildHeartbeatPayload(config, currentTaskId)
      .then((payload) => client.heartbeat(payload))
      .catch((error) => {
        console.error('[mini-drop-agent] heartbeat failed:', error instanceof Error ? error.message : String(error));
      });
  }, config.heartbeatIntervalMs);

  heartbeatTimer.unref?.();

  const stop = () => {
    stopped = true;
    clearInterval(heartbeatTimer);
  };

  while (!stopped) {
    try {
      const leased = await client.pollTask();
      if (!leased.task) {
        currentTaskId = null;
        await delay(config.idleDelayMs);
        continue;
      }

      currentTaskId = leased.task.id;
      await executeLeasedTask(leased.task, config, client);
      currentTaskId = null;
      await delay(100);
    } catch (error) {
      currentTaskId = null;
      console.error('[mini-drop-agent] work cycle failed:', error instanceof Error ? error.message : String(error));
      await delay(config.errorDelayMs);
      try {
        await registerAgentProcess(config, client);
      } catch (registerError) {
        console.error(
          '[mini-drop-agent] re-register failed:',
          registerError instanceof Error ? registerError.message : String(registerError),
        );
      }
    }
  }

  return {
    stop,
  };
}

async function buildHeartbeatPayload(config: AgentRuntimeConfig, currentTaskId: string | null): Promise<AgentHeartbeatRequest> {
  return {
    currentTaskId,
    notes: [
      currentTaskId
        ? `Agent ${config.label} is currently working on ${currentTaskId}.`
        : `Agent ${config.label} heartbeat ok.`,
    ],
    processSnapshot: await buildAgentProcessSnapshot(),
  };
}

async function main() {
  const config = resolveAgentRuntimeConfig();
  console.log(
    `[mini-drop-agent] starting ${config.label} (${config.agentId}) against ${config.baseUrl} with poll=${config.pollIntervalMs}ms heartbeat=${config.heartbeatIntervalMs}ms`,
  );
  await runAgentLoop(config);
}

const launchedScript = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (launchedScript && import.meta.url === launchedScript) {
  void main().catch((error) => {
    console.error('[mini-drop-agent] fatal:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
