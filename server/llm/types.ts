import type { TaskArtifact, TaskComparison, TaskDetail, TaskFinding, TaskMetrics } from '../../shared/types.js';

export interface ReasonerEvidenceItem {
  id: string;
  kind: 'metric' | 'hotspot' | 'finding' | 'comparison' | 'artifact' | 'timeline';
  label: string;
  detail: string;
  value?: number | string;
}

export interface ReasonerInput {
  taskId: string;
  reportTitle: string;
  reportSummary: string;
  target: string;
  collector: string;
  scenario: string;
  evidence: ReasonerEvidenceItem[];
  guardrails: string[];
}

export interface ReasonerFinding {
  title: string;
  detail: string;
  citations: string[];
}

export interface ReasonerOutput {
  mode: 'disabled' | 'stub';
  summary: string;
  findings: ReasonerFinding[];
  citations: string[];
  generatedAt: string;
  guardrailStatus: 'enforced';
}

export interface ReasonerSnapshot {
  input: ReasonerInput;
  output: ReasonerOutput;
}

export interface ReasonerTaskShape {
  id: string;
  target: string;
  collectorName: string;
  scenarioName: string;
  reportTitle: string;
  reportSummary: string;
  metrics: TaskMetrics;
  topFunctions: TaskDetail['topFunctions'];
  findings: TaskFinding[];
  baselineComparison: TaskComparison | null;
  artifacts: TaskArtifact[];
  timeline: TaskDetail['timeline'];
}
