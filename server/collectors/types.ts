import type { CollectorId, ScenarioId, TaskDetail, TaskMetrics, TaskStatus } from '../../shared/types.js';

export interface CollectionContext {
  taskId: string;
  target: string;
  language: string;
  scenario: ScenarioId;
  collector: CollectorId;
}

export interface CollectorCapabilities {
  id: CollectorId;
  name: string;
  languages: string[];
  description: string;
  supportsRealCollection: boolean;
}

export interface CollectorArtifact {
  kind: 'raw' | 'collapsed-stacks' | 'speedscope' | 'report' | 'log';
  path: string;
  label: string;
}

export interface CollectorSample {
  sampleCount: number;
  topFunctions: TaskDetail['topFunctions'];
  metrics: TaskMetrics;
  summary: string;
  rawSignal: string;
  workloadReportPath: string;
}

export interface CollectorReport {
  scenario: ScenarioId;
  collector: CollectorId;
  target: string;
  title: string;
  durationMs: number;
  result: number;
  metrics: TaskMetrics;
  topFunctions: TaskDetail['topFunctions'];
  summary: string;
}

export interface CollectorOutcome {
  status: TaskStatus;
  progress: number;
  artifacts: CollectorArtifact[];
  sample: CollectorSample;
  report: CollectorReport;
  logs: string[];
}

export interface CollectorPlugin {
  capability: CollectorCapabilities;
  collect(context: CollectionContext): Promise<CollectorOutcome>;
}
