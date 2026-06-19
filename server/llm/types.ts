import type {
  ReasonerGuardrailStatus,
  ReasonerMode,
  TaskArtifact,
  TaskComparison,
  TaskDetail,
  TaskFinding,
  TaskMetrics,
  TaskReasonerFindingStatus,
  TaskReasonerSnapshot,
  TaskReasonerRejectedCitation,
  TaskReasonerToolDefinition,
  TaskReasonerToolInvocation,
  TaskReasonerToolName,
  TaskReasonerToolStatus,
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
  availableTools: ReasonerToolDefinition[];
  toolContext: ReasonerToolInvocation[];
}

export interface ReasonerFinding {
  title: string;
  detail: string;
  citations: string[];
  status: TaskReasonerFindingStatus;
}

export interface ReasonerRejectedCitation {
  citation: string;
  reason: string;
}

export interface ReasonerOutput {
  mode: ReasonerMode;
  summary: string;
  findings: ReasonerFinding[];
  citations: string[];
  rejectedCitations: string[];
  rejectedCitationDetails: TaskReasonerRejectedCitation[];
  toolInvocations: ReasonerToolInvocation[];
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

export interface ReasonerToolDefinition extends TaskReasonerToolDefinition {
  name: TaskReasonerToolName;
}

export type ReasonerToolName = TaskReasonerToolName;
export type ReasonerToolStatus = TaskReasonerToolStatus;

export interface ReasonerToolInvocation extends TaskReasonerToolInvocation {
  tool: TaskReasonerToolName;
  status: TaskReasonerToolStatus;
}

export interface ReasonerToolResult {
  invocation: ReasonerToolInvocation;
  evidenceIds: string[];
}

export interface ReasonerToolRegistryEntry extends ReasonerToolDefinition {
  invoke(input: ReasonerInput, args?: Record<string, unknown>): ReasonerToolResult;
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
