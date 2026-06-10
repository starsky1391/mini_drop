import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createQueuedTask } from '../analysis.js';
import { compareTasks } from '../comparison.js';
import {
  appendAuditEvent,
  getTaskArtifactBundle,
  getTask,
  getTaskReasonerSnapshot,
  listAuditEvents,
  listTaskArtifacts,
  listTasks,
  saveTask,
} from '../store.js';
import { cancelTaskExecution, runTaskExecution } from '../execution.js';
import { getAgentRunSnapshot, getPendingStopRequest } from '../agent/run-registry.js';
import { isCollectorId, isScenarioId } from '../../shared/catalog.js';
import type {
  ApiErrorResponse,
  TaskArtifactsResponse,
  TaskAuditResponse,
  TaskComparisonResponse,
  TaskCreateInput,
  TaskCreateRequest,
  TaskDetailResponse,
  TaskListFilters,
  TaskListResponse,
  TaskStatus,
} from '../../shared/types.js';

const validStatuses: TaskStatus[] = ['queued', 'running', 'analyzing', 'done', 'failed'];
const previewByteLimit = 64 * 1024;

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiErrorResponse };

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateTaskCreateInput(body: unknown): ValidationResult<TaskCreateInput> {
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
  const language = trimString(candidate.language);
  const collector = trimString(candidate.collector);
  const scenario = trimString(candidate.scenario);
  const details: string[] = [];

  if (!target) {
    details.push('target is required');
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

  return {
    ok: true,
    value: {
      target,
      language,
      collector: collector as TaskCreateInput['collector'],
      scenario: scenario as TaskCreateInput['scenario'],
    },
  };
}

export function parseTaskListFilters(query: Record<string, unknown>): ValidationResult<TaskListFilters> {
  const status = trimString(query.status);
  const collector = trimString(query.collector);
  const scenario = trimString(query.scenario);
  const target = trimString(query.target);
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
    },
  };
}

export async function createTaskAndDispatch(input: TaskCreateInput): Promise<TaskDetailResponse> {
  const task = createQueuedTask(input);
  const savedTask = await saveTask({
    ...task,
    status: 'queued',
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
    message: 'Task execution dispatched to the runner.',
    metadata: {
      collector: input.collector,
      scenario: input.scenario,
    },
  });

  void runTaskExecution(task.id, input);
  return { task: savedTask };
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
  return (await getTaskArtifactBundle(taskId)) ?? null;
}

export async function loadTaskAudit(taskId: string): Promise<TaskAuditResponse | null> {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  return {
    taskId,
    auditEvents: await listAuditEvents(taskId),
  };
}

export async function loadAuditFeed(taskId?: string) {
  return {
    auditEvents: await listAuditEvents(taskId),
  };
}

export async function loadTaskReasoner(taskId: string) {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  return {
    taskId,
    snapshot: await getTaskReasonerSnapshot(taskId),
  };
}

export async function loadTaskRunState(taskId: string) {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  return {
    taskId,
    taskStatus: task.status,
    activeRun: getAgentRunSnapshot(taskId),
    stopPending: Boolean(getPendingStopRequest(taskId)),
  };
}

export async function cancelTask(taskId: string) {
  return await cancelTaskExecution(taskId, 'Stop requested via API.', 'api');
}

export async function loadArtifactPreview(taskId: string, artifactPath: string) {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  const artifacts = (await listTaskArtifacts(taskId)) ?? [];
  const artifact = artifacts.find((item) => item.path === artifactPath);
  if (!artifact) {
    return {
      code: 'artifact_not_found',
      message: 'Artifact not found for the selected task.',
    } satisfies ApiErrorResponse;
  }

  const preview = await readArtifactPreview(artifact.path);
  return {
    taskId,
    artifact,
    preview,
  };
}

async function readArtifactPreview(filePath: string) {
  const mode = inferPreviewMode(filePath);
  if (mode === 'unsupported') {
    return {
      mode,
      content: null,
      truncated: false,
      byteLength: 0,
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
  };
}

function inferPreviewMode(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    return 'json' as const;
  }
  if (['.txt', '.log', '.data', '.folded', '.collapsed'].includes(ext) || ext === '') {
    return 'text' as const;
  }
  return 'unsupported' as const;
}
