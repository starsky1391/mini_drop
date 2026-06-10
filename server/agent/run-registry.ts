import type { TaskCreateInput } from '../../shared/types.js';
import type {
  AgentCleanupHook,
  AgentEnvironmentProbe,
  AgentRunController,
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

export function createAgentRunController(taskId: string, input: TaskCreateInput): AgentRunController {
  const now = new Date().toISOString();
  const record: AgentRunRecord = {
    snapshot: {
      taskId,
      input,
      stage: 'created',
      startedAt: now,
      updatedAt: now,
      stopRequested: false,
      cleanupHookCount: 0,
      probe: null,
      logs: [`agent run created for ${input.collector} on ${input.target}`],
    },
    cleanup: [],
  };

  runs.set(taskId, record);

  const touch = (stage?: AgentRunStage) => {
    if (stage) {
      record.snapshot.stage = stage;
    }
    record.snapshot.updatedAt = new Date().toISOString();
    record.snapshot.cleanupHookCount = record.cleanup.length;
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
      appendLog(`[stop-requested] ${reason}`);
      await drainCleanupHooks(record);
      touch('stopped');
    },
    async complete(note) {
      if (note) {
        appendLog(note);
      }
      await drainCleanupHooks(record);
      touch('completed');
      runs.delete(taskId);
    },
    async fail(error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown agent execution error';
      appendLog(`[failed] ${message}`);
      await drainCleanupHooks(record);
      touch('failed');
      runs.delete(taskId);
    },
  };
}

export function getAgentRunSnapshot(taskId: string) {
  const record = runs.get(taskId);
  if (!record) {
    return null;
  }

  return {
    ...record.snapshot,
    logs: [...record.snapshot.logs],
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
