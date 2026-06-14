import { promises as fs } from 'node:fs';
import type {
  AgentSummary,
  AppState,
  ContinuousProfileSlice,
  ContinuousProfileSliceIndexEntry,
  TaskCreateInput,
  TaskArtifact,
  TaskAuditEvent,
  TaskDetail,
  TaskResultIndex,
} from '../../shared/types.js';
import { buildReasonerSnapshot } from '../llm/index.js';
import type { ReasonerSnapshot } from '../llm/types.js';
import { buildArtifactPreviewMetadata } from '../artifact-preview.js';
import type { CollectorOutcome } from '../collectors/types.js';
import {
  agentIndexPath,
  agentSnapshotPath,
  auditIndexPath,
  continuousSliceIndexPath,
  storageLayout,
  taskIndexPath,
  taskContinuousSlicesPath,
  taskArtifactIndexPath,
  taskAuditTrailPath,
  taskReasonerSnapshotPath,
  taskStagedUploadPath,
  taskSnapshotPath,
} from './layout.js';

export interface StagedCollectorOutcomeRecord {
  taskId: string;
  stagedAt: string;
  source: 'agent' | 'managed-runner';
  input: TaskCreateInput;
  outcome: CollectorOutcome;
}

export async function ensureStorageLayout() {
  await Promise.all([
    fs.mkdir(storageLayout.dataDir, { recursive: true }),
    fs.mkdir(storageLayout.tasksDir, { recursive: true }),
    fs.mkdir(storageLayout.agentsDir, { recursive: true }),
    fs.mkdir(storageLayout.runStateDir, { recursive: true }),
    fs.mkdir(storageLayout.stagedDir, { recursive: true }),
    fs.mkdir(storageLayout.slicesDir, { recursive: true }),
    fs.mkdir(storageLayout.indexesDir, { recursive: true }),
    fs.mkdir(storageLayout.auditsDir, { recursive: true }),
    fs.mkdir(storageLayout.reasonerDir, { recursive: true }),
  ]);
}

export async function persistTaskSnapshot(task: TaskDetail) {
  await ensureStorageLayout();
  await writeJson(taskSnapshotPath(task.id), task);
}

export async function persistStagedCollectorOutcome(record: StagedCollectorOutcomeRecord) {
  await ensureStorageLayout();
  await writeJson(taskStagedUploadPath(record.taskId), record);
}

export async function persistAgentSnapshot(agent: AgentSummary) {
  await ensureStorageLayout();
  await writeJson(agentSnapshotPath(agent.id), agent);
}

export async function persistArtifactIndex(taskId: string, artifacts: TaskArtifact[], resultIndex: TaskResultIndex) {
  await ensureStorageLayout();
  await writeJson(taskArtifactIndexPath(taskId), { taskId, artifacts, resultIndex });
}

export async function persistContinuousProfileSlices(taskId: string, slices: ContinuousProfileSlice[]) {
  await ensureStorageLayout();
  await writeJson(taskContinuousSlicesPath(taskId), { taskId, slices });
}

export async function appendAuditTrailEvent(event: TaskAuditEvent) {
  await ensureStorageLayout();
  await fs.appendFile(taskAuditTrailPath(event.taskId), `${JSON.stringify(event)}\n`, 'utf8');
}

export async function persistReasonerSnapshot(task: TaskDetail) {
  await ensureStorageLayout();
  await writeJson(taskReasonerSnapshotPath(task.id), await buildReasonerSnapshot(task));
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

export async function readStagedCollectorOutcome(taskId: string) {
  return readJson<StagedCollectorOutcomeRecord | null>(taskStagedUploadPath(taskId), null);
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

export async function readContinuousProfileSlices(taskId: string) {
  return readJson<{ taskId: string; slices: ContinuousProfileSlice[] } | null>(taskContinuousSlicesPath(taskId), null);
}

export async function readContinuousProfileSliceIndex() {
  return readJson<ContinuousProfileSliceIndexEntry[] | null>(continuousSliceIndexPath(), null);
}

export async function syncContinuousProfileSliceIndex(entries: ContinuousProfileSliceIndexEntry[]) {
  await ensureStorageLayout();
  await writeJson(continuousSliceIndexPath(), entries);
}

export async function removeStagedCollectorOutcome(taskId: string) {
  try {
    await fs.rm(taskStagedUploadPath(taskId), { force: true });
  } catch {
    // Ignore cleanup failures so analysis completion does not regress task lifecycle updates.
  }
}

export async function syncStateIndexes(state: AppState) {
  await ensureStorageLayout();
  const taskIndex = state.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    target: task.target,
    targetType: task.targetContext.targetType,
    attachSource: task.targetContext.attachSource,
    processPid: task.targetContext.processInfo?.pid ?? null,
    processName: task.targetContext.processInfo?.name ?? null,
    collector: task.collector,
    scenario: task.scenario,
    updatedAt: task.updatedAt,
    statusReason: task.statusReason,
    uploadState: task.uploadState,
    artifactCount: task.artifacts.length,
    previewableArtifactCount: task.artifacts.filter((artifact) => {
      if (typeof artifact.previewable === 'boolean') {
        return artifact.previewable;
      }
      return buildArtifactPreviewMetadata(artifact.path, artifact.kind).previewable;
    }).length,
    artifactKinds: [...new Set(task.artifacts.map((artifact) => artifact.kind))],
    sampleCount: task.sampleCount,
    sampleSource: task.sampleSource,
    symbolizationStatus:
      task.topFunctions.length === 0
        ? 'unknown'
        : task.topFunctions.every((item) => item.mappingState === 'full')
          ? 'full'
          : task.topFunctions.some((item) => item.mappingState === 'full' || item.mappingState === 'file-only' || item.mappingState === 'module-only')
            ? 'partial'
            : 'fallback',
    provenanceMode:
      task.artifacts.find(
        (artifact) =>
          artifact.kind === 'report' &&
          (artifact.label.toLowerCase().includes('collection path') || artifact.path.toLowerCase().includes('collection-path')),
      ) !== undefined
        ? 'captured'
        : 'unavailable',
    lastCollectorStage:
      task.status === 'RUNNING'
        ? 'collecting'
        : task.status === 'UPLOADING'
          ? 'finalizing'
          : task.status === 'DONE'
            ? 'completed'
            : task.status === 'FAILED'
              ? 'failed'
              : 'created',
  }));
  const auditIndex = state.auditEvents.map((event) => ({
    id: event.id,
    taskId: event.taskId,
    at: event.at,
    type: event.type,
    severity: event.severity,
  }));
  const agentIndex = state.agents.map((agent) => ({
    id: agent.id,
    label: agent.label,
    status: agent.status,
    heartbeatState: agent.heartbeatState,
    registeredAt: agent.registeredAt,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    lastSeenAt: agent.lastSeenAt,
    staleAfterSeconds: agent.staleAfterSeconds,
    platform: agent.platform,
    arch: agent.arch,
    currentTaskId: agent.currentTaskId,
  }));

  await Promise.all([writeJson(taskIndexPath(), taskIndex), writeJson(auditIndexPath(), auditIndex), writeJson(agentIndexPath(), agentIndex)]);
}

async function writeJson(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
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
