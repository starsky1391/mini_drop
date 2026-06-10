export type TaskStatus = 'queued' | 'running' | 'analyzing' | 'done' | 'failed';

export type CollectorId = 'perf' | 'py-spy' | 'async-profiler' | 'ebpf';

export type ScenarioId = 'cpu_hot' | 'lock_contention' | 'gc_pressure' | 'python_hot_loop';

export type ArtifactKind = 'raw' | 'collapsed-stacks' | 'speedscope' | 'report' | 'log';

export type AuditActor = 'system' | 'api' | 'agent' | 'user';

export type AuditSeverity = 'info' | 'warning' | 'error';

export type AuditEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.status_changed'
  | 'task.execution_dispatched'
  | 'task.stop_requested'
  | 'task.stopped'
  | 'task.artifacts_indexed'
  | 'task.validation_failed'
  | 'task.failed';

export interface CollectorInfo {
  id: CollectorId;
  name: string;
  languageCoverage: string[];
  latencyLabel: string;
  note: string;
  supportsRealCollection: boolean;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  targetLanguage: string;
  summary: string;
  signal: string;
  cpu: number;
  blocked: number;
  gc: number;
  syscalls: number;
  confidence: number;
  primaryFinding: string;
  recommendation: string;
  topFunctions: Array<{
    name: string;
    percent: number;
    module: string;
  }>;
  flameGraph: FlameNode;
}

export interface FlameNode {
  name: string;
  value: number;
  module?: string;
  color?: string;
  children?: FlameNode[];
}

export interface TaskEvent {
  at: string;
  title: string;
  detail: string;
}

export interface TaskFinding {
  title: string;
  severity: 'info' | 'medium' | 'high';
  evidence: string;
  recommendation: string;
}

export interface TaskArtifact {
  id?: string;
  taskId?: string;
  createdAt?: string;
  contentType?: string;
  path: string;
  label: string;
  kind: ArtifactKind;
  sizeBytes?: number;
  source?: string;
}

export interface TaskMetrics {
  cpu: number;
  blocked: number;
  gc: number;
  syscalls: number;
}

export type ComparisonTrend = 'improved' | 'regressed' | 'flat';

export type ComparisonVerdict = 'improvement' | 'regression' | 'mixed' | 'neutral';

export interface MetricDelta {
  metric: keyof TaskMetrics;
  label: string;
  higherIsBetter: boolean;
  before: number;
  after: number;
  delta: number;
  trend: ComparisonTrend;
}

export interface TaskSummary {
  id: string;
  title: string;
  target: string;
  language: string;
  collector: CollectorId;
  collectorName: string;
  scenario: ScenarioId;
  scenarioName: string;
  status: TaskStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  signal: string;
}

export interface TaskResultIndex {
  taskId: string;
  target: string;
  collector: CollectorId;
  scenario: ScenarioId;
  status: TaskStatus;
  sampleCount: number;
  sampleSource: string;
  artifactCount: number;
  updatedAt: string;
}

export interface TaskDetail extends TaskSummary {
  reportTitle: string;
  reportSummary: string;
  primaryFinding: string;
  confidence: number;
  metrics: TaskMetrics;
  timeline: TaskEvent[];
  findings: TaskFinding[];
  topFunctions: ScenarioDefinition['topFunctions'];
  flameGraph: FlameNode;
  sampleCount: number;
  sampleSource: string;
  artifacts: TaskArtifact[];
  collectorLogs: string[];
  analysisSummary: string;
  trendSummary: string;
  insights: TrendInsight[];
  baselineComparison: TaskComparison | null;
}

export interface TaskAuditEvent {
  id: string;
  taskId: string;
  at: string;
  type: AuditEventType;
  actor: AuditActor;
  severity: AuditSeverity;
  message: string;
  detail?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface TrendInsight {
  title: string;
  direction: ComparisonTrend;
  evidence: string;
  attribution: string;
}

export interface TaskComparison {
  baselineId: string;
  currentId: string;
  verdict: ComparisonVerdict;
  summary: string;
  confidenceDelta: number;
  totalPressureDelta: number;
  metricDeltas: MetricDelta[];
  changedHotspot: string;
  sharedFinding: string;
}

export interface AppState {
  stateVersion: number;
  tasks: TaskDetail[];
  auditEvents: TaskAuditEvent[];
}

export interface TaskCreateInput {
  target: string;
  language: string;
  collector: CollectorId;
  scenario: ScenarioId;
}

export interface TaskCreateRequest {
  target: string;
  language: string;
  collector: CollectorId;
  scenario: ScenarioId;
}

export interface TaskListFilters {
  status?: TaskStatus;
  collector?: CollectorId;
  scenario?: ScenarioId;
  target?: string;
}

export interface CatalogResponse {
  collectors: CollectorInfo[];
  scenarios: ScenarioDefinition[];
  collectorNotes: string[];
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  collectors: number;
  scenarios: number;
}

export interface TaskListResponse {
  tasks: TaskDetail[];
}

export interface TaskDetailResponse {
  task: TaskDetail;
}

export interface TaskComparisonResponse {
  comparison: TaskComparison;
}

export interface TaskArtifactsResponse {
  taskId: string;
  artifacts: TaskArtifact[];
  resultIndex: TaskResultIndex;
}

export interface TaskAuditResponse {
  taskId: string;
  auditEvents: TaskAuditEvent[];
}

export interface ApiErrorResponse {
  message: string;
  code: string;
  details?: string[];
}
