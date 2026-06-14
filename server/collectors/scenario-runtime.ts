import { getScenario } from '../../shared/catalog.js';
import type { CollectorId, ScenarioDefinition, ScenarioId, TaskAttachSource, TaskProcessInfo, TaskTargetContext } from '../../shared/types.js';

export interface RuntimeProfile {
  scenario: ScenarioDefinition;
  collector: CollectorId;
  durationMs: number;
  sampleRate: number;
  targetPid: number;
  targetCommand: string;
  requestedPid: number | null;
  attachSource: TaskAttachSource;
  processInfo: TaskProcessInfo | null;
  supported: boolean;
  notes: string[];
}

export function resolveRuntimeProfile(input: {
  scenario: ScenarioId;
  collector: CollectorId;
  target: string;
  targetContext: TaskTargetContext;
  requestedPid: number | null;
  processInfo: TaskProcessInfo | null;
  language: string;
}): RuntimeProfile {
  const scenario = getScenario(input.scenario);
  const durationMs = Number(process.env.MINI_DROP_CAPTURE_MS ?? 8000);
  const sampleRate = Number(process.env.MINI_DROP_SAMPLE_RATE ?? 99);
  const requestedPid = input.requestedPid ?? input.processInfo?.pid ?? null;
  const targetPid = requestedPid ?? (Number(process.env.MINI_DROP_TARGET_PID ?? 0) || process.pid);
  const targetCommand = input.processInfo?.commandSummary || process.env.MINI_DROP_TARGET_CMD || input.target;
  const supported =
    input.collector === 'perf' ||
    input.collector === 'py-spy' ||
    input.collector === 'async-profiler' ||
    input.collector === 'ebpf';
  const notes = [
    `Collector: ${input.collector}`,
    `Language: ${input.language}`,
    `Target: ${targetCommand}`,
    `Target mode: ${input.targetContext.targetType}`,
    `Attach source: ${input.targetContext.attachSource}`,
    `Scenario: ${scenario.name}`,
  ];
  if (input.processInfo?.pid) {
    notes.push(`Requested PID: ${input.processInfo.pid}`);
  }

  return {
    scenario,
    collector: input.collector,
    durationMs,
    sampleRate,
    targetPid,
    targetCommand,
    requestedPid,
    attachSource: input.targetContext.attachSource,
    processInfo: input.processInfo,
    supported,
    notes,
  };
}
