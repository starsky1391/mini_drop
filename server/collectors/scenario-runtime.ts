import { getScenario } from '../../shared/catalog.js';
import type { CollectorId, ScenarioDefinition, ScenarioId } from '../../shared/types.js';

export interface RuntimeProfile {
  scenario: ScenarioDefinition;
  collector: CollectorId;
  durationMs: number;
  sampleRate: number;
  targetPid: number;
  targetCommand: string;
  supported: boolean;
  notes: string[];
}

export function resolveRuntimeProfile(input: {
  scenario: ScenarioId;
  collector: CollectorId;
  target: string;
  language: string;
}): RuntimeProfile {
  const scenario = getScenario(input.scenario);
  const durationMs = Number(process.env.MINI_DROP_CAPTURE_MS ?? 8000);
  const sampleRate = Number(process.env.MINI_DROP_SAMPLE_RATE ?? 99);
  const targetPid = Number(process.env.MINI_DROP_TARGET_PID ?? 0) || process.pid;
  const targetCommand = process.env.MINI_DROP_TARGET_CMD ?? input.target;
  const supported = input.collector === 'perf' || input.collector === 'py-spy';
  const notes = [
    `Collector: ${input.collector}`,
    `Language: ${input.language}`,
    `Target: ${targetCommand}`,
    `Scenario: ${scenario.name}`,
  ];

  return {
    scenario,
    collector: input.collector,
    durationMs,
    sampleRate,
    targetPid,
    targetCommand,
    supported,
    notes,
  };
}
