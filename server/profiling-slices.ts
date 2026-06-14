import { randomUUID } from 'node:crypto';
import type {
  ContinuousProfileSlice,
  ContinuousProfileSliceIndexEntry,
  ContinuousProfileWindow,
  ContinuousProfileWindowResponse,
  TaskDetail,
} from '../shared/types.js';
import { summarizeContinuousSlice } from './analysis.js';
import {
  persistContinuousProfileSlices,
  readContinuousProfileSlices,
  readContinuousProfileSliceIndex,
  syncContinuousProfileSliceIndex,
} from './storage/repository.js';

export interface ContinuousProfileSliceInput {
  id?: string;
  task: TaskDetail;
  agentId?: string | null;
  startedAt?: string;
  endedAt?: string;
  status?: ContinuousProfileSlice['status'];
  summary?: string;
  artifactPaths?: string[];
  sampleCount?: number;
  sampleSource?: string;
}

export interface ContinuousProfileWindowLoadOptions {
  from?: string;
  to?: string;
  limit?: number;
}

export async function saveContinuousProfileSlices(
  taskId: string,
  slices: ContinuousProfileSlice[],
): Promise<ContinuousProfileWindowResponse> {
  const ordered = orderContinuousSlices(slices);
  await persistContinuousProfileSlices(taskId, ordered);
  await syncContinuousProfileSliceIndex(await rebuildContinuousProfileSliceIndex(taskId, ordered));
  return {
    taskId,
    window: createContinuousProfileWindow(taskId, ordered),
  };
}

export async function loadContinuousProfileWindow(
  taskId: string,
  options: ContinuousProfileWindowLoadOptions = {},
): Promise<ContinuousProfileWindowResponse | null> {
  const index = await readContinuousProfileSliceIndex();
  const entry = index?.find((item) => item.taskId === taskId) ?? null;
  if (!entry) {
    return null;
  }

  const slices = applyContinuousWindowOptions(await loadContinuousProfileSlices(taskId), options);
  return {
    taskId,
    window: createContinuousProfileWindow(taskId, slices, {
      fallbackFrom: entry.firstStartedAt ?? entry.updatedAt,
      fallbackTo: entry.lastEndedAt ?? entry.updatedAt,
    }),
  };
}

export async function loadContinuousProfileSlices(taskId: string): Promise<ContinuousProfileSlice[]> {
  const persisted = await readContinuousProfileSlices(taskId);
  return persisted?.slices ?? [];
}

export function buildContinuousProfileSlice(input: ContinuousProfileSliceInput): ContinuousProfileSlice {
  const startedAt = input.startedAt ?? input.task.createdAt;
  const endedAt = input.endedAt ?? input.task.updatedAt;
  const status = input.status ?? inferSliceStatus(input.task.status);
  const hotspot = input.task.topFunctions[0];

  return {
    id: input.id ?? randomUUID(),
    taskId: input.task.id,
    agentId: input.agentId ?? null,
    target: input.task.target,
    collector: input.task.collector,
    scenario: input.task.scenario,
    startedAt,
    endedAt,
    sampleCount: input.sampleCount ?? input.task.sampleCount,
    sampleSource: input.sampleSource ?? input.task.sampleSource,
    status,
    artifactPaths: input.artifactPaths ?? input.task.artifacts.map((artifact) => artifact.path),
    summary:
      input.summary ??
      summarizeContinuousSlice({
        target: input.task.target,
        collector: input.task.collector,
        scenario: input.task.scenario,
        sampleCount: input.sampleCount ?? input.task.sampleCount,
        status: input.task.status,
        topFunctions: hotspot ? [hotspot] : [],
      }),
  };
}

export async function retainTaskContinuousProfileSlice(
  task: TaskDetail,
  options?: {
    agentId?: string | null;
    summary?: string;
  },
) {
  const existing = await loadContinuousProfileSlices(task.id);
  const retainedSlice = buildContinuousProfileSlice({
    id: `${task.id}:terminal`,
    task,
    agentId: options?.agentId ?? null,
    summary: options?.summary,
  });
  const nextSlices = [...existing.filter((slice) => slice.id !== retainedSlice.id), retainedSlice];
  return saveContinuousProfileSlices(task.id, nextSlices);
}

export async function rebuildContinuousProfileSliceIndex(
  taskId: string,
  slices: ContinuousProfileSlice[],
): Promise<ContinuousProfileSliceIndexEntry[]> {
  const current = await readContinuousProfileSliceIndex();
  const updated = (current ?? []).filter((entry) => entry.taskId !== taskId);
  const nextEntry = buildContinuousProfileSliceIndexEntry(taskId, slices);
  return [...updated, nextEntry].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function buildContinuousProfileWindow(taskId: string, slices: ContinuousProfileSlice[]): ContinuousProfileWindow {
  return createContinuousProfileWindow(taskId, slices);
}

function buildContinuousProfileSliceIndexEntry(
  taskId: string,
  slices: ContinuousProfileSlice[],
): ContinuousProfileSliceIndexEntry {
  const ordered = [...slices].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const firstStartedAt = ordered[0]?.startedAt ?? null;
  const lastEndedAt = ordered.at(-1)?.endedAt ?? null;
  return {
    taskId,
    target: ordered[0]?.target ?? '',
    collector: ordered[0]?.collector ?? 'perf',
    scenario: ordered[0]?.scenario ?? 'cpu_hot',
    sliceCount: ordered.length,
    firstStartedAt,
    lastEndedAt,
    statuses: [...new Set(ordered.map((slice) => slice.status))],
    sampleCount: ordered.reduce((sum, slice) => sum + slice.sampleCount, 0),
    updatedAt: lastEndedAt ?? firstStartedAt ?? new Date().toISOString(),
  };
}

function inferSliceStatus(taskStatus: TaskDetail['status']): ContinuousProfileSlice['status'] {
  if (taskStatus === 'FAILED') {
    return 'failed';
  }
  if (taskStatus === 'DONE') {
    return 'ready';
  }
  return 'partial';
}

function applyContinuousWindowOptions(
  slices: ContinuousProfileSlice[],
  options: ContinuousProfileWindowLoadOptions,
) {
  const fromTs = options.from ? Date.parse(options.from) : null;
  const toTs = options.to ? Date.parse(options.to) : null;
  const filtered = orderContinuousSlices(slices).filter((slice) => {
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

function orderContinuousSlices(slices: ContinuousProfileSlice[]) {
  return [...slices].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
}

function createContinuousProfileWindow(
  taskId: string,
  slices: ContinuousProfileSlice[],
  options: {
    fallbackFrom?: string;
    fallbackTo?: string;
  } = {},
): ContinuousProfileWindow {
  const ordered = orderContinuousSlices(slices);
  return {
    taskId,
    from: ordered[0]?.startedAt ?? options.fallbackFrom ?? new Date().toISOString(),
    to: ordered.at(-1)?.endedAt ?? ordered[0]?.endedAt ?? options.fallbackTo ?? new Date().toISOString(),
    sliceCount: ordered.length,
    slices: ordered,
  };
}
