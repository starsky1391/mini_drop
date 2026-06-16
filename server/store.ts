import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AgentHeartbeatState,
  AgentListResponse,
  AgentRegisterRequest,
  AgentRegistrationResponse,
  AgentSummary,
  AppState,
  CollectorProvenance,
  TaskArtifact,
  TaskAuditEvent,
  TaskDetail,
  TaskListFilters,
  TaskProcessInfo,
  TaskResultIndex,
  TaskStatus,
  TaskSymbolizationSummary,
  TaskSummary,
  TaskTargetContext,
  TaskUploadState,
} from '../shared/types.js';
import { buildArtifactPreviewMetadata } from './artifact-preview.js';
import {
  appendAuditTrailEvent,
  ensureStorageLayout,
  persistAgentSnapshot,
  persistArtifactIndex,
  persistReasonerSnapshot,
  persistTaskSnapshot,
  readArtifactIndex,
  readAuditTrail,
  readReasonerSnapshot,
  syncStateIndexes,
} from './storage/repository.js';
import { storageLayout } from './storage/layout.js';

const statePath = storageLayout.stateFile;
const stateVersion = 2;
let stateMutationChain: Promise<void> = Promise.resolve();

function emptyState(): AppState {
  return {
    stateVersion,
    tasks: [],
    agents: [],
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
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeStoredTask) : [],
    agents: Array.isArray((parsed as { agents?: unknown }).agents) ? (parsed as { agents: AgentSummary[] }).agents.map(normalizeAgent) : [],
    auditEvents: Array.isArray(parsed.auditEvents) ? (parsed.auditEvents as TaskAuditEvent[]) : [],
  };
}

async function readState(): Promise<AppState> {
  await ensureStorageLayout();
  let parsed: AppState;
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    parsed = normalizeState(JSON.parse(raw));
  } catch {
    parsed = emptyState();
  }

  const recovered = await rehydrateStateFromSnapshots(parsed);
  const tasksRecovered = recovered.tasks.length > parsed.tasks.length;
  const agentsRecovered = recovered.agents.length > parsed.agents.length;
  if (tasksRecovered || agentsRecovered) {
    await writeState(recovered);
    return recovered;
  }

  return parsed;
}

async function writeState(state: AppState) {
  await ensureDir();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  await syncStateIndexes(state);
}

function withStateMutation<T>(operation: () => Promise<T>) {
  const result = stateMutationChain.then(operation, operation);
  stateMutationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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
  const normalized = await Promise.all(
    artifacts.map(async (artifact) => {
      const preview = buildArtifactPreviewMetadata(artifact.path, artifact.kind);
      return {
        ...artifact,
        id: artifact.id ?? `${taskId}:${artifact.kind}:${artifact.path}`,
        taskId,
        createdAt: artifact.createdAt ?? new Date().toISOString(),
        sizeBytes: artifact.sizeBytes ?? (await statSize(artifact.path)),
        source: artifact.source ?? 'collector',
        previewable: artifact.previewable ?? preview.previewable,
        previewHint: artifact.previewHint ?? preview.previewHint,
        contentType: artifact.contentType ?? preview.mimeType,
      };
    }),
  );

  return normalized.filter(
    (artifact, index, all) =>
      all.findIndex((candidate) => candidate.kind === artifact.kind && candidate.path === artifact.path) === index,
  );
}

async function rehydrateStateFromSnapshots(state: AppState): Promise<AppState> {
  const [tasks, agents] = await Promise.all([
    state.tasks.length > 0 ? Promise.resolve(state.tasks) : readTaskSnapshots(),
    state.agents.length > 0 ? Promise.resolve(state.agents) : readAgentSnapshots(),
  ]);

  if (tasks.length === state.tasks.length && agents.length === state.agents.length) {
    return state;
  }

  return {
    ...state,
    tasks,
    agents,
  };
}

async function readTaskSnapshots(): Promise<TaskDetail[]> {
  const files = await listJsonSnapshotFiles(storageLayout.tasksDir);
  const tasks = await Promise.all(
    files.map(async (filePath) => {
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        return normalizeStoredTask(JSON.parse(raw));
      } catch {
        return null;
      }
    }),
  );

  return sortTasks(tasks.filter((task): task is TaskDetail => Boolean(task)));
}

async function readAgentSnapshots(): Promise<AgentSummary[]> {
  const files = await listJsonSnapshotFiles(storageLayout.agentsDir);
  const agents = await Promise.all(
    files.map(async (filePath) => {
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        return normalizeAgent(JSON.parse(raw) as AgentSummary);
      } catch {
        return null;
      }
    }),
  );

  return agents
    .filter((agent): agent is AgentSummary => Boolean(agent))
    .sort((left, right) => Date.parse(right.lastHeartbeatAt) - Date.parse(left.lastHeartbeatAt));
}

async function listJsonSnapshotFiles(dirPath: string) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

function severityForStatus(status: TaskStatus): TaskAuditEvent['severity'] {
  if (status === 'FAILED') {
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
    if (filters.targetType && task.targetContext.targetType !== filters.targetType) {
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
    resultIndex: await buildTaskResultIndex({
      ...task,
      artifacts: normalized,
    }),
  };
}

function buildStatusAuditDetail(existing: TaskDetail | null, nextTask: TaskDetail) {
  const prefix = existing ? `Previous status: ${existing.status}. ` : '';
  if (nextTask.status === 'FAILED') {
    return `${prefix}${nextTask.statusReason} Source=${nextTask.sampleSource}.`;
  }
  if (nextTask.status === 'DONE') {
    return `${prefix}${nextTask.statusReason} ${nextTask.sampleCount} sample(s) retained from ${nextTask.sampleSource}.`;
  }
  if (nextTask.status === 'UPLOADING') {
    return `${prefix}${nextTask.statusReason} Upload state=${nextTask.uploadState}.`;
  }
  if (nextTask.status === 'RUNNING') {
    return `${prefix}${nextTask.statusReason}`;
  }
  return existing ? `${prefix}${nextTask.statusReason}` : 'Initial task status saved.';
}

function buildLifecycleReasonDetail(existing: TaskDetail, nextTask: TaskDetail) {
  const reasonChanged = existing.statusReason !== nextTask.statusReason;
  const uploadChanged = existing.uploadState !== nextTask.uploadState;
  const detailParts = [
    reasonChanged ? `Reason: ${existing.statusReason} -> ${nextTask.statusReason}.` : null,
    uploadChanged ? `Upload state: ${existing.uploadState} -> ${nextTask.uploadState}.` : null,
  ].filter((item): item is string => Boolean(item));

  return detailParts.join(' ') || `Progress ${existing.progress}% -> ${nextTask.progress}%.`;
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
  return withStateMutation(async () => {
    const state = await readState();
    await writeState({
      ...state,
      auditEvents: [event, ...state.auditEvents],
    });
    await appendAuditTrailEvent(event);
    return event;
  });
}

export async function listAgents(): Promise<AgentSummary[]> {
  const state = await readState();
  return [...state.agents].sort((left, right) => Date.parse(right.lastHeartbeatAt) - Date.parse(left.lastHeartbeatAt));
}

export async function getAgent(agentId: string): Promise<AgentSummary | null> {
  const state = await readState();
  return state.agents.find((agent) => agent.id === agentId) ?? null;
}

export async function upsertAgent(agent: AgentSummary): Promise<AgentSummary> {
  return withStateMutation(async () => {
    const state = await readState();
    const normalized = normalizeAgent(agent);
    const nextAgents = [normalized, ...state.agents.filter((item) => item.id !== normalized.id)];
    await writeState({
      ...state,
      agents: nextAgents,
    });
    await persistAgentSnapshot(normalized);
    return normalized;
  });
}

export async function markAgentOffline(agentId: string, reason: string) {
  const existing = await getAgent(agentId);
  if (!existing) {
    return null;
  }

  if (existing.status === 'offline' && existing.heartbeatState === 'lost') {
    return existing;
  }

  const now = new Date().toISOString();

  return upsertAgent({
    ...existing,
    status: 'offline',
    heartbeatState: 'lost',
    lastSeenAt: now,
    lastOfflineAt: now,
    notes: dedupeNotes([...existing.notes, reason]),
  });
}

export async function buildTaskResultIndex(task: TaskDetail): Promise<TaskResultIndex> {
  const previewableArtifactCount = task.artifacts.filter((artifact) => artifact.previewable !== false).length;
  return {
    taskId: task.id,
    target: task.target,
    targetContext: task.targetContext,
    collector: task.collector,
    scenario: task.scenario,
    status: task.status,
    statusReason: task.statusReason,
    uploadState: task.uploadState,
    sampleCount: task.sampleCount,
    sampleSource: task.sampleSource,
    artifactCount: task.artifacts.length,
    previewableArtifactCount,
    artifactKinds: [...new Set(task.artifacts.map((artifact) => artifact.kind))],
    provenance: await readCollectorProvenance(task.artifacts),
    symbolization: buildTaskSymbolizationSummary(task),
    updatedAt: task.updatedAt,
  };
}

function normalizeStoredTask(raw: unknown): TaskDetail {
  const task = raw as TaskDetail & {
    targetContext?: Partial<TaskTargetContext> | null;
    processInfo?: Partial<TaskProcessInfo> | null;
    statusReason?: string;
    uploadState?: TaskUploadState | string;
  };

  const target = typeof task.target === 'string' ? task.target : 'unknown-target';
  const attachSource = normalizeAttachSource(task.targetContext?.attachSource, task.sampleSource);
  const processInfo = normalizeProcessInfo(task.targetContext?.processInfo ?? task.processInfo ?? null);
  const status = normalizeTaskStatus(task.status);
  const uploadState = normalizeTaskUploadState(task.uploadState, status, task.artifacts ?? [], task.sampleCount ?? 0);

  return {
    ...task,
    target,
    status,
    statusReason:
      typeof task.statusReason === 'string' && task.statusReason.trim().length > 0
        ? task.statusReason
        : defaultStatusReason(status, uploadState, task.sampleSource),
    uploadState,
    targetContext: {
      targetType: normalizeTargetType(task.targetContext?.targetType, processInfo),
      attachSource,
      processInfo,
      attachDecision:
        typeof task.targetContext?.attachDecision === 'string' && task.targetContext.attachDecision.trim()
          ? task.targetContext.attachDecision
          : attachSource === 'managed-workload'
            ? '任务按 managed workload 路径运行。'
            : processInfo
              ? `任务记录了真实进程 PID ${processInfo.pid}。`
              : '任务未保留可验证的真实进程上下文。',
    },
  } satisfies TaskDetail;
}

function normalizeAgent(raw: AgentSummary): AgentSummary {
  return {
    ...raw,
    status: raw.status === 'online' ? 'online' : 'offline',
    heartbeatState: normalizeHeartbeatState(raw.heartbeatState),
    notes: dedupeNotes(Array.isArray(raw.notes) ? raw.notes : []),
    collectors: Array.isArray(raw.collectors) ? raw.collectors : [],
    lastOfflineAt: raw.lastOfflineAt,
    lastRecoveryAt: raw.lastRecoveryAt,
  };
}

function normalizeHeartbeatState(value: AgentHeartbeatState | undefined): AgentHeartbeatState {
  if (value === 'healthy' || value === 'stale' || value === 'lost') {
    return value;
  }
  return 'stale';
}

function dedupeNotes(lines: string[]) {
  return [...new Set(lines.filter(Boolean))];
}

function normalizeTargetType(
  value: TaskTargetContext['targetType'] | undefined,
  processInfo: TaskProcessInfo | null,
): TaskTargetContext['targetType'] {
  if (value === 'label' || value === 'pid' || value === 'process') {
    return value;
  }
  return processInfo ? 'pid' : 'label';
}

function normalizeAttachSource(value: string | undefined, sampleSource: string) {
  if (
    value === 'managed-workload' ||
    value === 'external-pid' ||
    value === 'process-selection' ||
    value === 'managed-fallback'
  ) {
    return value;
  }
  return sampleSource.includes('fallback') ? 'managed-fallback' : 'managed-workload';
}

function normalizeProcessInfo(raw: Partial<TaskProcessInfo> | null | undefined): TaskProcessInfo | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const pid = typeof raw.pid === 'number' && Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : 0;
  const name = typeof raw.name === 'string' ? raw.name : '';
  const command = typeof raw.command === 'string' ? raw.command : '';
  const commandSummary = typeof raw.commandSummary === 'string' ? raw.commandSummary : command || name;

  if (!pid && !name && !commandSummary) {
    return null;
  }

  return {
    pid,
    name,
    command,
    commandSummary,
    languageHint: typeof raw.languageHint === 'string' ? raw.languageHint : null,
    discoveredAt: typeof raw.discoveredAt === 'string' ? raw.discoveredAt : undefined,
    alive: typeof raw.alive === 'boolean' ? raw.alive : true,
  };
}

function createSummaryPlaceholder(summary: TaskSummary): TaskDetail {
  return {
    ...summary,
    statusReason: '摘要任务还没有进入可执行生命周期。',
    uploadState: 'not_started',
    reportTitle: `${summary.scenarioName} 诊断`,
    reportSummary: '完整报告生成前已先保存任务摘要。',
    primaryFinding: '当前任务摘要还没有展开成完整报告。',
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
    analysisSummary: '当前还没有生成完整分析报告。',
    trendSummary: '这个摘要任务暂时不提供趋势分析。',
    insights: [],
    baselineComparison: null,
  };
}

export async function saveTask(task: TaskDetail) {
  return withStateMutation(async () => {
    const state = await readState();
    const existing = state.tasks.find((item) => item.id === task.id) ?? null;
    const nextTask = normalizeTaskForPersistence({
      ...task,
      artifacts: await normalizeArtifacts(task.id, task.artifacts),
    });

    const nextEvents: TaskAuditEvent[] = [];
    if (!existing) {
      nextEvents.push(
        buildAuditEvent(task.id, 'task.created', '任务首次完成持久化。', `${task.collector} on ${task.target}`),
      );
    }

    if (!existing || existing.status !== nextTask.status) {
      nextEvents.push({
        id: randomUUID(),
        taskId: task.id,
        at: new Date().toISOString(),
        type: nextTask.status === 'FAILED' ? 'task.failed' : 'task.status_changed',
        actor: 'system',
        severity: severityForStatus(nextTask.status),
        message: `任务状态已变为 ${nextTask.status}。`,
        detail: buildStatusAuditDetail(existing, nextTask),
        metadata: {
          status: nextTask.status,
          statusReason: nextTask.statusReason,
          uploadState: nextTask.uploadState,
          progress: nextTask.progress,
          sampleSource: nextTask.sampleSource,
          artifactCount: nextTask.artifacts.length,
        },
      });
    }

    if (existing && existing.status === nextTask.status && (existing.statusReason !== nextTask.statusReason || existing.uploadState !== nextTask.uploadState)) {
      nextEvents.push({
        id: randomUUID(),
        taskId: task.id,
        at: new Date().toISOString(),
        type: 'task.updated',
        actor: 'system',
        severity: severityForStatus(nextTask.status),
        message: '任务生命周期原因已更新。',
        detail: buildLifecycleReasonDetail(existing, nextTask),
        metadata: {
          status: nextTask.status,
          statusReason: nextTask.statusReason,
          uploadState: nextTask.uploadState,
          previousUploadState: existing.uploadState,
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
          artifactKinds: nextTask.artifacts.map((artifact) => artifact.kind).join(','),
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
      agents: state.agents ?? [],
      auditEvents: [...nextEvents, ...state.auditEvents],
    });
    const resultIndex = await buildTaskResultIndex(nextTask);
    await Promise.all([
      persistTaskSnapshot(nextTask),
      persistArtifactIndex(nextTask.id, nextTask.artifacts, resultIndex),
      persistReasonerSnapshot(nextTask),
      ...nextEvents.map((event) => appendAuditTrailEvent(event)),
    ]);

    return nextTask;
  });
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

async function readCollectorProvenance(artifacts: TaskArtifact[]): Promise<CollectorProvenance | null> {
  const collectionPathArtifact =
    artifacts.find(
      (artifact) =>
        artifact.kind === 'report' &&
        (artifact.label.toLowerCase().includes('collection path') || artifact.path.toLowerCase().includes('collection-path')),
    ) ?? null;

  if (!collectionPathArtifact) {
    return null;
  }

  try {
    const raw = await fs.readFile(collectionPathArtifact.path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CollectorProvenance>;
    return {
      collector: typeof parsed.collector === 'string' ? parsed.collector : 'unknown',
      mode: parsed.mode === 'real' || parsed.mode === 'partial-real' ? parsed.mode : 'fallback',
      command: typeof parsed.command === 'string' ? parsed.command : null,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'Unknown collection path.',
      sourceKind: typeof parsed.sourceKind === 'string' ? parsed.sourceKind : 'unknown',
      rawSignal: typeof parsed.rawSignal === 'string' ? parsed.rawSignal : 'unknown',
      expectedArtifacts: Array.isArray(parsed.expectedArtifacts)
        ? parsed.expectedArtifacts.filter((item): item is string => typeof item === 'string')
        : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes.filter((item): item is string => typeof item === 'string') : [],
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined,
      artifactPath: collectionPathArtifact.path,
    };
  } catch {
    return null;
  }
}

function buildTaskSymbolizationSummary(task: TaskDetail): TaskSymbolizationSummary | null {
  if (task.topFunctions.length === 0) {
    return null;
  }

  const syntheticHotspots = task.topFunctions.filter((hotspot) => hotspot.mappingState === 'synthetic' || hotspot.mappingState === 'unknown').length;
  const mappedHotspots = task.topFunctions.length - syntheticHotspots;
  const lineMappedHotspots = task.topFunctions.filter((hotspot) => hotspot.mappingState === 'full').length;
  const status =
    lineMappedHotspots === task.topFunctions.length
      ? 'full'
      : mappedHotspots > 0
        ? 'partial'
        : 'fallback';

  return {
    status,
    mappedHotspots,
    syntheticHotspots,
    lineMappedHotspots,
    notes: [
      lineMappedHotspots > 0
        ? `${lineMappedHotspots} hotspot(s) retained file and line context.`
        : mappedHotspots > 0
          ? `${mappedHotspots} hotspot(s) retained readable file or module context without full line mapping.`
          : 'Readable hotspot module context is currently unavailable.',
      syntheticHotspots > 0 ? `${syntheticHotspots} hotspot(s) still rely on synthetic or unknown module labels.` : 'No synthetic hotspot modules were detected.',
    ],
  };
}

function normalizeTaskForPersistence(task: TaskDetail): TaskDetail {
  const status = normalizeTaskStatus(task.status);
  const uploadState = normalizeTaskUploadState(task.uploadState, status, task.artifacts, task.sampleCount);
  return {
    ...task,
    status,
    uploadState,
    statusReason:
      typeof task.statusReason === 'string' && task.statusReason.trim().length > 0
        ? task.statusReason
        : defaultStatusReason(status, uploadState, task.sampleSource),
  };
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  switch (value) {
    case 'PENDING':
    case 'RUNNING':
    case 'UPLOADING':
    case 'DONE':
    case 'FAILED':
      return value;
    case 'queued':
      return 'PENDING';
    case 'running':
      return 'RUNNING';
    case 'analyzing':
      return 'UPLOADING';
    case 'done':
      return 'DONE';
    case 'failed':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

function normalizeTaskUploadState(
  value: unknown,
  status: TaskStatus,
  artifacts: TaskArtifact[],
  sampleCount: number,
): TaskUploadState {
  if (value === 'not_started' || value === 'uploading' || value === 'uploaded' || value === 'upload_failed') {
    return value;
  }
  if (status === 'DONE') {
    return 'uploaded';
  }
  if (status === 'UPLOADING') {
    return 'uploading';
  }
  if (status === 'FAILED') {
    return artifacts.length > 0 || sampleCount > 0 ? 'uploaded' : 'upload_failed';
  }
  return 'not_started';
}

function defaultStatusReason(status: TaskStatus, uploadState: TaskUploadState, sampleSource: string) {
  switch (status) {
    case 'RUNNING':
      return '任务已经开始执行采样。';
    case 'UPLOADING':
      return uploadState === 'uploading'
        ? '采样结果正在落盘、上传或转换成可分析产物。'
        : '采样产物已经进入上传或索引阶段。';
    case 'DONE':
      return `采样、上传和分析已经完成。Source=${sampleSource}.`;
    case 'FAILED':
      return '任务未能完成，请查看审计记录和已保留产物。';
    default:
      return '任务已经创建，正在等待执行资源。';
  }
}
