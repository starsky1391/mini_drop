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

export interface CollectorFrameEvidence {
  name: string;
  symbol: string;
  module: string;
  file: string;
  line: number | null;
  sourceHint: string;
  address?: string | null;
}

export interface CollectorStackEvidence {
  key: string;
  weight: number;
  threadLabel: string | null;
  frames: CollectorFrameEvidence[];
}

export interface CollectorHotspotEvidence {
  name: string;
  module: string;
  percent: number;
  sampleWeight: number;
  sampleCount: number;
  threadCount: number;
  leaf: CollectorFrameEvidence;
  callers: CollectorFrameEvidence[];
  representativeStack: CollectorFrameEvidence[];
  threadLabels: string[];
}

export interface CollectorProfileEvidence {
  sourceKind: string;
  usedRealData: boolean;
  sampleCount: number;
  stackCount: number;
  threadCount: number;
  topStacks: CollectorStackEvidence[];
  hotspots: CollectorHotspotEvidence[];
  collapsedStacks: string;
}

export interface CollectorSample {
  sampleCount: number;
  topFunctions: TaskDetail['topFunctions'];
  metrics: TaskMetrics;
  summary: string;
  rawSignal: string;
  workloadReportPath: string;
  evidence?: CollectorProfileEvidence;
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
  evidence?: CollectorProfileEvidence;
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
