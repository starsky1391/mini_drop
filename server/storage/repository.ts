import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppState, TaskArtifact, TaskAuditEvent, TaskDetail, TaskResultIndex } from '../../shared/types.js';
import { buildReasonerSnapshot } from '../llm/index.js';
import type { ReasonerSnapshot } from '../llm/types.js';
import {
  storageLayout,
  taskArtifactIndexPath,
  taskAuditTrailPath,
  taskReasonerSnapshotPath,
  taskSnapshotPath,
} from './layout.js';

export async function ensureStorageLayout() {
  await Promise.all([
    fs.mkdir(storageLayout.dataDir, { recursive: true }),
    fs.mkdir(storageLayout.tasksDir, { recursive: true }),
    fs.mkdir(storageLayout.indexesDir, { recursive: true }),
    fs.mkdir(storageLayout.auditsDir, { recursive: true }),
    fs.mkdir(storageLayout.reasonerDir, { recursive: true }),
  ]);
}

export async function persistTaskSnapshot(task: TaskDetail) {
  await ensureStorageLayout();
  await writeJson(taskSnapshotPath(task.id), task);
}

export async function persistArtifactIndex(taskId: string, artifacts: TaskArtifact[], resultIndex: TaskResultIndex) {
  await ensureStorageLayout();
  await writeJson(taskArtifactIndexPath(taskId), { taskId, artifacts, resultIndex });
}

export async function appendAuditTrailEvent(event: TaskAuditEvent) {
  await ensureStorageLayout();
  await fs.appendFile(taskAuditTrailPath(event.taskId), `${JSON.stringify(event)}\n`, 'utf8');
}

export async function persistReasonerSnapshot(task: TaskDetail) {
  await ensureStorageLayout();
  await writeJson(taskReasonerSnapshotPath(task.id), buildReasonerSnapshot(task));
}

export async function readAuditTrail(taskId: string) {
  try {
    const raw = await fs.readFile(taskAuditTrailPath(taskId), 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TaskAuditEvent);
  } catch {
    return [];
  }
}

export async function readReasonerSnapshot(taskId: string) {
  return readJson<ReasonerSnapshot | null>(taskReasonerSnapshotPath(taskId), null);
}

export async function readArtifactIndex(taskId: string) {
  return readJson<{ taskId: string; artifacts: TaskArtifact[]; resultIndex: TaskResultIndex } | null>(
    taskArtifactIndexPath(taskId),
    null,
  );
}

export async function syncStateIndexes(state: AppState) {
  await ensureStorageLayout();
  const taskIndexPath = path.join(storageLayout.indexesDir, 'tasks.json');
  const auditIndexPath = path.join(storageLayout.indexesDir, 'audits.json');
  const taskIndex = state.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    target: task.target,
    collector: task.collector,
    scenario: task.scenario,
    updatedAt: task.updatedAt,
    artifactCount: task.artifacts.length,
    sampleCount: task.sampleCount,
  }));
  const auditIndex = state.auditEvents.map((event) => ({
    id: event.id,
    taskId: event.taskId,
    at: event.at,
    type: event.type,
    severity: event.severity,
  }));

  await Promise.all([writeJson(taskIndexPath, taskIndex), writeJson(auditIndexPath, auditIndex)]);
}

async function writeJson(filePath: string, value: unknown) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
