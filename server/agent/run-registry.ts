import { promises as fs } from 'node:fs';
import type { TaskCreateInput } from '../../shared/types.js';
import { ensureStorageLayout } from '../storage/repository.js';
import { taskRunStatePath } from '../storage/layout.js';
import type {
  AgentCleanupHook,
  AgentEnvironmentProbe,
  AgentRunController,
  AgentRunControllerOptions,
  AgentRunSnapshot,
  AgentRunStage,
} from './types.js';

interface CleanupRegistration {
  label: string;
  hook: AgentCleanupHook;
}

interface AgentRunRecord {
  snapshot: AgentRunSnapshot;
  cleanup: CleanupRegistration[];
}

const runs = new Map<string, AgentRunRecord>();
const archivedRuns = new Map<string, AgentRunSnapshot>();
const pendingStops = new Map<string, { reason: string; requestedAt: string }>();
const snapshotWriteChains = new Map<string, Promise<void>>();

export function createAgentRunController(
  taskId: string,
  input: TaskCreateInput,
  options: AgentRunControllerOptions = {},
): AgentRunController {
  const now = new Date().toISOString();
  const pendingStop = pendingStops.get(taskId) ?? null;
  archivedRuns.delete(taskId);
  const record: AgentRunRecord = {
    snapshot: {
      taskId,
      input,
      stage: 'created',
      startedAt: now,
      updatedAt: now,
      stopRequested: pendingStop !== null,
      stopRequestedAt: pendingStop?.requestedAt,
      stopReason: pendingStop?.reason,
      cleanupHookCount: 0,
      probe: null,
      logs: [`agent run created for ${input.collector} on ${input.target}`],
    },
    cleanup: [],
  };

  if (pendingStop) {
    record.snapshot.logs.push(`[stop-requested] ${pendingStop.reason}`);
  }

  runs.set(taskId, record);
  emitSnapshot(record.snapshot, options);

  const touch = (stage?: AgentRunStage) => {
    if (stage) {
      record.snapshot.stage = stage;
    }
    record.snapshot.updatedAt = new Date().toISOString();
    record.snapshot.cleanupHookCount = record.cleanup.length;
    emitSnapshot(record.snapshot, options);
  };

  const appendLog = (message: string) => {
    record.snapshot.logs.push(message);
    touch();
  };

  return {
    snapshot() {
      return {
        ...record.snapshot,
        logs: [...record.snapshot.logs],
      };
    },
    transition(stage, note) {
      touch(stage);
      if (note) {
        appendLog(`[${stage}] ${note}`);
      }
    },
    attachProbe(probe: AgentEnvironmentProbe) {
      record.snapshot.probe = probe;
      appendLog(`probe captured at ${probe.collectedAt}`);
    },
    log(message: string) {
      appendLog(message);
    },
    registerCleanupHook(label: string, hook: AgentCleanupHook) {
      record.cleanup.push({ label, hook });
      appendLog(`cleanup hook registered: ${label}`);
    },
    async runWithCleanup<T>(operation: () => Promise<T>) {
      try {
        return await operation();
      } finally {
        if (record.snapshot.stopRequested) {
          await drainCleanupHooks(record);
          touch('stopped');
        }
      }
    },
    async requestStop(reason: string) {
      record.snapshot.stopRequested = true;
      record.snapshot.stopRequestedAt = new Date().toISOString();
      record.snapshot.stopReason = reason;
      pendingStops.set(taskId, {
        reason,
        requestedAt: record.snapshot.stopRequestedAt,
      });
      appendLog(`[stop-requested] ${reason}`);
      await drainCleanupHooks(record);
      touch('stopped');
    },
    async complete(note) {
      if (note) {
        appendLog(note);
      }
      await drainCleanupHooks(record);
      touch(record.snapshot.stopRequested ? 'stopped' : 'completed');
      const archived = cloneSnapshot(record.snapshot);
      archivedRuns.set(taskId, archived);
      emitSnapshot(archived, options);
      await persistSnapshot(archived);
      runs.delete(taskId);
      pendingStops.delete(taskId);
    },
    async fail(error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown agent execution error';
      appendLog(`[failed] ${message}`);
      await drainCleanupHooks(record);
      touch('failed');
      const archived = cloneSnapshot(record.snapshot);
      archivedRuns.set(taskId, archived);
      emitSnapshot(archived, options);
      await persistSnapshot(archived);
      runs.delete(taskId);
      pendingStops.delete(taskId);
    },
  };
}

export function getAgentRunSnapshot(taskId: string) {
  const record = runs.get(taskId);
  if (!record) {
    const archived = archivedRuns.get(taskId);
    return archived ? cloneSnapshot(archived) : null;
  }

  return cloneSnapshot(record.snapshot);
}

export async function loadAgentRunSnapshot(taskId: string) {
  const inMemory = getAgentRunSnapshot(taskId);
  if (inMemory) {
    return inMemory;
  }

  try {
    const raw = await fs.readFile(taskRunStatePath(taskId), 'utf8');
    return JSON.parse(raw) as AgentRunSnapshot;
  } catch {
    return null;
  }
}

export function getPendingStopRequest(taskId: string) {
  return pendingStops.get(taskId) ?? null;
}

export function clearPendingStopRequest(taskId: string) {
  pendingStops.delete(taskId);
}

export async function requestAgentRunStop(taskId: string, reason: string) {
  const requestedAt = new Date().toISOString();
  pendingStops.set(taskId, { reason, requestedAt });

  const record = runs.get(taskId);
  if (!record) {
    return {
      accepted: true,
      active: false,
      snapshot: null,
    };
  }

  record.snapshot.stopRequested = true;
  record.snapshot.stopRequestedAt = requestedAt;
  record.snapshot.stopReason = reason;
  record.snapshot.updatedAt = requestedAt;
  record.snapshot.logs.push(`[stop-requested] ${reason}`);
  await persistSnapshot(cloneSnapshot(record.snapshot));

  await drainCleanupHooks(record);
  record.snapshot.stage = 'stopped';

  return {
    accepted: true,
    active: true,
    snapshot: {
      ...record.snapshot,
      logs: [...record.snapshot.logs],
    },
  };
}

async function drainCleanupHooks(record: AgentRunRecord) {
  while (record.cleanup.length > 0) {
    const next = record.cleanup.pop();
    if (!next) {
      continue;
    }

    try {
      await next.hook();
      record.snapshot.logs.push(`cleanup hook completed: ${next.label}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown cleanup failure';
      record.snapshot.logs.push(`cleanup hook failed (${next.label}): ${message}`);
    }
  }
}

function cloneSnapshot(snapshot: AgentRunSnapshot): AgentRunSnapshot {
  return {
    ...snapshot,
    logs: [...snapshot.logs],
    input: {
      ...snapshot.input,
      processInfo: snapshot.input.processInfo ? { ...snapshot.input.processInfo } : snapshot.input.processInfo ?? null,
    },
    probe: snapshot.probe
      ? {
          ...snapshot.probe,
          host: { ...snapshot.probe.host },
          collectors: snapshot.probe.collectors.map((collector) => ({ ...collector })),
          notes: [...snapshot.probe.notes],
        }
      : null,
  };
}

function emitSnapshot(snapshot: AgentRunSnapshot, options: AgentRunControllerOptions) {
  const cloned = cloneSnapshot(snapshot);
  options.onSnapshotChange?.(cloned);
  void persistSnapshot(cloned);
}

function persistSnapshot(snapshot: AgentRunSnapshot) {
  const previous = snapshotWriteChains.get(snapshot.taskId) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await ensureStorageLayout();
      await fs.writeFile(taskRunStatePath(snapshot.taskId), JSON.stringify(snapshot, null, 2), 'utf8');
    });
  snapshotWriteChains.set(snapshot.taskId, next);
  return next;
}
