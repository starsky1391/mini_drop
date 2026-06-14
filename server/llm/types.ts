import type {
  ReasonerGuardrailStatus,
  ReasonerMode,
  TaskArtifact,
  TaskComparison,
  TaskDetail,
  TaskFinding,
  TaskMetrics,
  TaskReasonerSnapshot,
  TaskTargetContext,
} from '../../shared/types.js';

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
  mode: ReasonerMode;
  summary: string;
  findings: ReasonerFinding[];
  citations: string[];
  rejectedCitations: string[];
  generatedAt: string;
  guardrailStatus: ReasonerGuardrailStatus;
  fallbackReason: string | null;
}

export interface ReasonerSnapshot extends TaskReasonerSnapshot {
  input: ReasonerInput;
  output: ReasonerOutput;
}

export interface ReasonerClient {
  mode: ReasonerMode;
  generate(input: ReasonerInput): Promise<ReasonerOutput>;
}

export interface ExternalReasonerConfig {
  endpoint: string | null;
  apiKey: string | null;
  model: string | null;
  timeoutMs: number;
  protocol: 'mini-drop' | 'openai-chat';
  configPath: string | null;
}

export interface ExternalReasonerModelConfig {
  id: string;
  name?: string;
  vendor?: string;
  apiKey?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  url?: string;
  supportsToolCall?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
}

export interface ExternalReasonerModelRegistry {
  models: ExternalReasonerModelConfig[];
}

export interface ReasonerTaskShape {
  id: string;
  target: string;
  collectorName: string;
  scenarioName: string;
  status: TaskDetail['status'];
  statusReason: TaskDetail['statusReason'];
  uploadState: TaskDetail['uploadState'];
  sampleCount: TaskDetail['sampleCount'];
  sampleSource: TaskDetail['sampleSource'];
  reportTitle: string;
  reportSummary: string;
  metrics: TaskMetrics;
  topFunctions: TaskDetail['topFunctions'];
  findings: TaskFinding[];
  targetContext: TaskTargetContext;
  baselineComparison: TaskComparison | null;
  artifacts: TaskArtifact[];
  timeline: TaskDetail['timeline'];
}
