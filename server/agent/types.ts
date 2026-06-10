import type { CollectorId, TaskCreateInput } from '../../shared/types.js';
import type { CollectorPlugin } from '../collectors/types.js';

export type AgentRunStage =
  | 'created'
  | 'probing'
  | 'ready'
  | 'collecting'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface AgentCollectorAvailability {
  collector: CollectorId;
  supported: boolean;
  available: boolean;
  detail: string;
}

export interface AgentEnvironmentProbe {
  collectedAt: string;
  host: {
    platform: NodeJS.Platform;
    arch: string;
    nodeVersion: string;
    pid: number;
  };
  collectors: AgentCollectorAvailability[];
  notes: string[];
}

export interface AgentRunSnapshot {
  taskId: string;
  input: TaskCreateInput;
  stage: AgentRunStage;
  startedAt: string;
  updatedAt: string;
  stopRequested: boolean;
  cleanupHookCount: number;
  probe: AgentEnvironmentProbe | null;
  logs: string[];
}

export type AgentCleanupHook = () => Promise<void> | void;

export interface AgentManagedCollection {
  controller: AgentRunController;
  plugin: CollectorPlugin;
  probe: AgentEnvironmentProbe;
}

export interface AgentRunController {
  snapshot(): AgentRunSnapshot;
  transition(stage: AgentRunStage, note?: string): void;
  attachProbe(probe: AgentEnvironmentProbe): void;
  log(message: string): void;
  registerCleanupHook(label: string, hook: AgentCleanupHook): void;
  runWithCleanup<T>(operation: () => Promise<T>): Promise<T>;
  requestStop(reason: string): Promise<void>;
  complete(note?: string): Promise<void>;
  fail(error: unknown): Promise<void>;
}
