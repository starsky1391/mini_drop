import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AppState,
  TaskArtifact,
  TaskAuditEvent,
  TaskDetail,
  TaskListFilters,
  TaskResultIndex,
  TaskStatus,
  TaskSummary,
} from '../shared/types.js';
import {
  appendAuditTrailEvent,
  persistArtifactIndex,
  persistReasonerSnapshot,
  persistTaskSnapshot,
  readArtifactIndex,
  readAuditTrail,
  readReasonerSnapshot,
  syncStateIndexes,
} from './storage/repository.js';

const statePath = path.join(process.cwd(), 'data', 'state.json');
const stateVersion = 2;

function emptyState(): AppState {
  return {
    stateVersion,
    tasks: [],
    auditEvents: [],
  };
}

async function ensureDir() {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
}

function normalizeState(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') {
    return emptyState();
  }

  const parsed = raw as Partial<AppState> & { tasks?: unknown; auditEvents?: unknown };
  return {
    stateVersion: typeof parsed.stateVersion === 'number' ? parsed.stateVersion : stateVersion,
    tasks: Array.isArray(parsed.tasks) ? (parsed.tasks as TaskDetail[]) : [],
    auditEvents: Array.isArray(parsed.auditEvents) ? (parsed.auditEvents as TaskAuditEvent[]) : [],
  };
}

async function readState(): Promise<AppState> {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

async function writeState(state: AppState) {
  await ensureDir();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  await syncStateIndexes(state);
}

async function statSize(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return undefined;
  }
}

async function normalizeArtifacts(taskId: string, artifacts: TaskArtifact[]) {
  return Promise.all(
    artifacts.map(async (artifact) => ({
      ...artifact,
      id: artifact.id ?? `${taskId}:${artifact.kind}:${artifact.path}`,
      taskId,
      createdAt: artifact.createdAt ?? new Date().toISOString(),
      sizeBytes: artifact.sizeBytes ?? (await statSize(artifact.path)),
      source: artifact.source ?? 'collector',
    })),
  );
}

function severityForStatus(status: TaskStatus): TaskAuditEvent['severity'] {
  if (status === 'failed') {
    return 'error';
  }
  return 'info';
}

function buildAuditEvent(taskId: string, type: TaskAuditEvent['type'], message: string, detail?: string): TaskAuditEvent {
  return {
    id: randomUUID(),
    taskId,
    at: new Date().toISOString(),
    type,
    actor: 'system',
    severity: type === 'task.failed' ? 'error' : 'info',
    message,
    detail,
  };
}

function sortTasks(tasks: TaskDetail[]) {
  return tasks.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function applyTaskFilters(tasks: TaskDetail[], filters: TaskListFilters = {}) {
  return tasks.filter((task) => {
    if (filters.status && task.status !== filters.status) {
      return false;
    }
    if (filters.collector && task.collector !== filters.collector) {
      return false;
    }
    if (filters.scenario && task.scenario !== filters.scenario) {
      return false;
    }
    if (filters.target && !task.target.toLowerCase().includes(filters.target.toLowerCase())) {
      return false;
    }
    return true;
  });
}

export async function listTasks(filters: TaskListFilters = {}) {
  const state = await readState();
  return sortTasks(applyTaskFilters(state.tasks, filters));
}

export async function getTask(id: string) {
  const state = await readState();
  return state.tasks.find((task) => task.id === id) ?? null;
}

export async function listTaskArtifacts(taskId: string) {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  const normalized = await normalizeArtifacts(taskId, task.artifacts);
  const stored = await readArtifactIndex(taskId);
  return stored?.artifacts ?? normalized;
}

export async function getTaskArtifactBundle(taskId: string) {
  const task = await getTask(taskId);
  if (!task) {
    return null;
  }

  const normalized = await normalizeArtifacts(taskId, task.artifacts);
  const stored = await readArtifactIndex(taskId);
  if (stored) {
    return stored;
  }

  return {
    taskId,
    artifacts: normalized,
    resultIndex: createTaskResultIndex({
      ...task,
      artifacts: normalized,
    }),
  };
}

export async function listAuditEvents(taskId?: string) {
  const state = await readState();
  const events = taskId ? state.auditEvents.filter((event) => event.taskId === taskId) : state.auditEvents;
  if (taskId) {
    const auditTrail = await readAuditTrail(taskId);
    const deduped = [...events, ...auditTrail].filter(
      (event, index, all) => all.findIndex((candidate) => candidate.id === event.id) === index,
    );
    return deduped.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export async function appendAuditEvent(event: TaskAuditEvent) {
  const state = await readState();
  await writeState({
    ...state,
    auditEvents: [event, ...state.auditEvents],
  });
  await appendAuditTrailEvent(event);
  return event;
}

export function createTaskResultIndex(task: TaskDetail): TaskResultIndex {
  return {
    taskId: task.id,
    target: task.target,
    collector: task.collector,
    scenario: task.scenario,
    status: task.status,
    sampleCount: task.sampleCount,
    sampleSource: task.sampleSource,
    artifactCount: task.artifacts.length,
    updatedAt: task.updatedAt,
  };
}

function createSummaryPlaceholder(summary: TaskSummary): TaskDetail {
  return {
    ...summary,
    reportTitle: `${summary.scenarioName} diagnosis`,
    reportSummary: 'Task summary saved before a full report was available.',
    primaryFinding: 'Task summary has not been expanded into a full report yet.',
    confidence: 0,
    metrics: { cpu: 0, blocked: 0, gc: 0, syscalls: 0 },
    timeline: [],
    findings: [],
    topFunctions: [],
    flameGraph: { name: 'pending', value: 100, color: '#64748b' },
    sampleCount: 0,
    sampleSource: 'unknown',
    artifacts: [],
    collectorLogs: [],
    analysisSummary: 'A full analysis report has not been generated yet.',
    trendSummary: 'Trend analysis is unavailable for this summary-only task.',
    insights: [],
    baselineComparison: null,
  };
}

export async function saveTask(task: TaskDetail) {
  const state = await readState();
  const existing = state.tasks.find((item) => item.id === task.id) ?? null;
  const nextTask = {
    ...task,
    artifacts: await normalizeArtifacts(task.id, task.artifacts),
  };

  const nextEvents: TaskAuditEvent[] = [];
  if (!existing) {
    nextEvents.push(
      buildAuditEvent(task.id, 'task.created', 'Task persisted for the first time.', `${task.collector} on ${task.target}`),
    );
  }

  if (!existing || existing.status !== nextTask.status) {
    nextEvents.push({
      id: randomUUID(),
      taskId: task.id,
      at: new Date().toISOString(),
      type: nextTask.status === 'failed' ? 'task.failed' : 'task.status_changed',
      actor: 'system',
      severity: severityForStatus(nextTask.status),
      message: `Task status is now ${nextTask.status}.`,
      detail: existing ? `Previous status: ${existing.status}` : 'Initial task status saved.',
      metadata: {
        status: nextTask.status,
        progress: nextTask.progress,
      },
    });
  }

  if ((existing?.artifacts.length ?? 0) !== nextTask.artifacts.length) {
    nextEvents.push({
      id: randomUUID(),
      taskId: task.id,
      at: new Date().toISOString(),
      type: 'task.artifacts_indexed',
      actor: 'system',
      severity: 'info',
      message: `Indexed ${nextTask.artifacts.length} artifacts for the task.`,
      metadata: {
        artifactCount: nextTask.artifacts.length,
      },
    });
  }

  if (nextEvents.length === 0) {
    nextEvents.push(
      buildAuditEvent(task.id, 'task.updated', 'Task metadata updated.', `Progress ${nextTask.progress}%`),
    );
  }

  const rest = state.tasks.filter((item) => item.id !== nextTask.id);
  await writeState({
    stateVersion,
    tasks: sortTasks([nextTask, ...rest]),
    auditEvents: [...nextEvents, ...state.auditEvents],
  });
  await Promise.all([
    persistTaskSnapshot(nextTask),
    persistArtifactIndex(nextTask.id, nextTask.artifacts, createTaskResultIndex(nextTask)),
    persistReasonerSnapshot(nextTask),
    ...nextEvents.map((event) => appendAuditTrailEvent(event)),
  ]);

  return nextTask;
}

export async function saveSummary(summary: TaskSummary) {
  const state = await readState();
  const existing = state.tasks.find((item) => item.id === summary.id);
  const next = existing ? { ...existing, ...summary } : createSummaryPlaceholder(summary);
  await saveTask(next);
  return next;
}

export async function upsertTask(task: TaskDetail) {
  return saveTask(task);
}

export async function getTaskReasonerSnapshot(taskId: string) {
  return readReasonerSnapshot(taskId);
}
