export type TaskStatus = 'PENDING' | 'RUNNING' | 'UPLOADING' | 'DONE' | 'FAILED';
export type AgentStatus = 'online' | 'offline';
export type AgentHeartbeatState = 'healthy' | 'stale' | 'lost';

export type CollectorId = 'perf' | 'py-spy' | 'async-profiler' | 'ebpf';
export type TaskTargetType = 'label' | 'pid' | 'process';
export type TaskAttachSource = 'managed-workload' | 'external-pid' | 'process-selection' | 'managed-fallback';

export type ScenarioId = 'cpu_hot' | 'lock_contention' | 'gc_pressure' | 'python_hot_loop';

export type ArtifactKind = 'raw' | 'collapsed-stacks' | 'speedscope' | 'report' | 'log';
export type CollectorProvenanceMode = 'real' | 'partial-real' | 'fallback';
export type ArtifactPreviewMode = 'json' | 'text' | 'unsupported';
export type ReasonerMode = 'disabled' | 'stub' | 'external';
export type ReasonerGuardrailStatus = 'enforced';
export type TaskReasonerToolName =
  | 'get_task_evidence_bundle'
  | 'get_baseline_context'
  | 'get_artifact_excerpt'
  | 'validate_citations';
export type TaskReasonerToolStatus = 'completed' | 'failed' | 'rejected';
export type TaskReasonerFindingStatus = 'verified' | 'context-only';
export type CollectorReadinessStatus = 'preferred' | 'partial-real' | 'fallback-only' | 'deferred-for-linux-proof' | 'unavailable';
export type SymbolizationMappingState = 'full' | 'file-only' | 'module-only' | 'synthetic' | 'unknown';
export type SymbolizationMappingSource = 'retained' | 'derived-path' | 'derived-symbol' | 'fallback';
export type TaskUploadState = 'not_started' | 'uploading' | 'uploaded' | 'upload_failed';

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
  displayNameZh?: string;
  languageCoverage: string[];
  latencyLabel: string;
  latencyLabelZh?: string;
  note: string;
  noteZh?: string;
  supportsRealCollection: boolean;
  expectedMaturityOnCurrentHost?: 'stable' | 'partial' | 'fallback' | 'deferred';
  maturityNote?: string;
  maturityNoteZh?: string;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  displayNameZh?: string;
  targetLanguage: string;
  targetLanguageZh?: string;
  summary: string;
  summaryZh?: string;
  signal: string;
  signalZh?: string;
  cpu: number;
  blocked: number;
  gc: number;
  syscalls: number;
  confidence: number;
  primaryFinding: string;
  recommendation: string;
  topFunctions: TaskHotFunction[];
  flameGraph: FlameNode;
}

export interface FlameNode {
  name: string;
  value: number;
  module?: string;
  color?: string;
  locationSummary?: string;
  mappingState?: SymbolizationMappingState;
  sourceHint?: string;
  sampleCount?: number;
  hidden?: boolean;
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

export interface TaskHotFunction {
  name: string;
  percent: number;
  module: string;
  locationSummary?: string;
  file?: string | null;
  line?: number | null;
  mappingState?: SymbolizationMappingState;
  mappingSource?: SymbolizationMappingSource;
  sourceHint?: string;
  representativeStack?: string[];
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
  previewable?: boolean;
  previewHint?: string;
}

export interface TaskMetrics {
  cpu: number;
  blocked: number;
  gc: number;
  syscalls: number;
}

export interface FlameGraphViewState {
  focusPath: string | null;
  searchTerm: string;
  collapsed: boolean;
}

export interface TaskProcessInfo {
  pid: number;
  name: string;
  command: string;
  commandSummary: string;
  languageHint: string | null;
  discoveredAt?: string;
  alive?: boolean;
}

export interface TaskTargetContext {
  targetType: TaskTargetType;
  attachSource: TaskAttachSource;
  processInfo: TaskProcessInfo | null;
  attachDecision: string;
}

export interface ContinuousProfileSlice {
  id: string;
  taskId: string;
  agentId: string | null;
  target: string;
  collector: CollectorId;
  scenario: ScenarioId;
  startedAt: string;
  endedAt: string;
  sampleCount: number;
  sampleSource: string;
  status: 'ready' | 'partial' | 'failed';
  artifactPaths: string[];
  summary: string;
}

export interface ContinuousProfileWindow {
  taskId: string;
  from: string;
  to: string;
  sliceCount: number;
  slices: ContinuousProfileSlice[];
}

export interface ContinuousProfileSliceIndexEntry {
  taskId: string;
  target: string;
  collector: CollectorId;
  scenario: ScenarioId;
  sliceCount: number;
  firstStartedAt: string | null;
  lastEndedAt: string | null;
  statuses: Array<ContinuousProfileSlice['status']>;
  sampleCount: number;
  updatedAt: string;
}

export interface ContinuousProfileWindowResponse {
  taskId: string;
  window: ContinuousProfileWindow;
}

export interface ContinuousProfileSliceIndexResponse {
  indexes: ContinuousProfileSliceIndexEntry[];
}

export interface AgentSummary {
  id: string;
  label: string;
  status: AgentStatus;
  heartbeatState: AgentHeartbeatState;
  registeredAt: string;
  lastHeartbeatAt: string;
  lastSeenAt: string;
  staleAfterSeconds: number;
  platform: string;
  arch: string;
  nodeVersion: string;
  hostPid: number | null;
  currentTaskId: string | null;
  notes: string[];
  collectors: CollectorRuntimeReadiness[];
  lastOfflineAt?: string;
  lastRecoveryAt?: string;
}

export interface TaskProcessContextSummary {
  targetType: TaskTargetType;
  attachSource: TaskAttachSource;
  processInfo: TaskProcessInfo | null;
  summary: string;
}

export interface CollectorProvenance {
  collector: CollectorId | string;
  mode: CollectorProvenanceMode;
  command: string | null;
  reason: string;
  sourceKind: string;
  rawSignal: string;
  expectedArtifacts: string[];
  notes: string[];
  generatedAt?: string;
  artifactPath?: string;
}

export interface TaskSymbolizationSummary {
  status: 'full' | 'partial' | 'fallback';
  mappedHotspots: number;
  syntheticHotspots: number;
  lineMappedHotspots: number;
  notes: string[];
}

export interface CollectorRuntimeReadiness {
  collector: CollectorId;
  supported: boolean;
  available: boolean;
  readiness: CollectorReadinessStatus;
  detail: string;
}

export type ComparisonTrend = 'improved' | 'regressed' | 'flat';

export type ComparisonVerdict = 'improvement' | 'regression' | 'mixed' | 'neutral';

export type HotspotShiftKind =
  | 'stable'
  | 'module-shifted'
  | 'intensified'
  | 'cooled'
  | 'anchored'
  | 'reordered'
  | 'shifted'
  | 'replaced';

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
  targetContext: TaskTargetContext;
  language: string;
  collector: CollectorId;
  collectorName: string;
  scenario: ScenarioId;
  scenarioName: string;
  status: TaskStatus;
  statusReason: string;
  uploadState: TaskUploadState;
  progress: number;
  createdAt: string;
  updatedAt: string;
  signal: string;
}

export interface TaskResultIndex {
  taskId: string;
  target: string;
  targetContext: TaskTargetContext;
  collector: CollectorId;
  scenario: ScenarioId;
  status: TaskStatus;
  statusReason: string;
  uploadState: TaskUploadState;
  sampleCount: number;
  sampleSource: string;
  artifactCount: number;
  previewableArtifactCount: number;
  artifactKinds: ArtifactKind[];
  provenance: CollectorProvenance | null;
  symbolization: TaskSymbolizationSummary | null;
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
  topFunctions: TaskHotFunction[];
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

export interface TaskComparisonHotspot {
  name: string;
  module: string;
  percent: number;
  rank: number;
  locationSummary?: string;
  mappingState?: SymbolizationMappingState;
}

export interface HotspotShift {
  kind: HotspotShiftKind;
  summary: string;
  attribution: string;
  emphasis: ComparisonTrend;
  overlapCount: number;
  overlapRatio: number;
  sharedHotspots: string[];
  newHotspots: string[];
  droppedHotspots: string[];
  baselineTop: TaskComparisonHotspot | null;
  currentTop: TaskComparisonHotspot | null;
}

export interface ComparisonDriver {
  label: string;
  trend: ComparisonTrend;
  delta: number;
  evidence: string;
  hotspotLocationSummary?: string | null;
}

export interface ComparisonMetricSummary {
  strongest: MetricDelta | null;
  regressions: MetricDelta[];
  improvements: MetricDelta[];
  stable: MetricDelta[];
}

export interface ComparisonTaskSnapshot {
  taskId: string;
  title: string;
  updatedAt: string;
  confidence: number;
  sampleCount: number;
  totalPressure: number;
  topHotspot: TaskComparisonHotspot | null;
  processContext: TaskProcessContextSummary;
}

export interface ComparisonCompatibility {
  sameTargetType: boolean;
  sameAttachSource: boolean;
  sameProcessIdentity: boolean | null;
  warnings: string[];
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
  baseline: ComparisonTaskSnapshot;
  current: ComparisonTaskSnapshot;
  hotspotShift: HotspotShift;
  metricSummary: ComparisonMetricSummary;
  driver: ComparisonDriver | null;
  compatibility: ComparisonCompatibility;
  evidence: string[];
}

export interface TaskTrendPoint {
  taskId: string;
  title: string;
  updatedAt: string;
  status: TaskStatus;
  sampleCount: number;
  confidence: number;
  totalPressure: number;
  pressureDelta: number | null;
  verdictToPrevious: ComparisonVerdict | 'initial';
  metrics: TaskMetrics;
  topHotspot: string | null;
  topHotspotPercent: number | null;
  topHotspotLocationSummary: string | null;
  topHotspotMappingState?: SymbolizationMappingState;
  processContext: TaskProcessContextSummary;
  summary: string;
  driverLabel: string | null;
  driverEvidence: string | null;
}

export interface TaskMetricTrendPoint {
  taskId: string;
  updatedAt: string;
  value: number;
  delta: number | null;
  trend: ComparisonTrend | 'initial';
}

export interface TaskMetricSeries {
  metric: keyof TaskMetrics;
  label: string;
  points: TaskMetricTrendPoint[];
}

export interface TaskHotspotChange {
  baselineId: string;
  currentId: string;
  updatedAt: string;
  verdict: ComparisonVerdict;
  pressureDelta: number;
  kind: HotspotShiftKind;
  driverLabel: string | null;
  driverEvidence: string | null;
  baselineHotspot: TaskComparisonHotspot | null;
  currentHotspot: TaskComparisonHotspot | null;
  summary: string;
}

export interface TaskTrendTransition {
  baselineId: string;
  currentId: string;
  updatedAt: string;
  comparison: TaskComparison;
}

export interface TaskHistorySummary {
  runCount: number;
  focusIndex: number;
  verdictCounts: Record<ComparisonVerdict, number>;
  processVariants: number;
  attachSources: TaskAttachSource[];
  targetTypes: TaskTargetType[];
  compatibilityWarnings: string[];
  currentStreak: {
    verdict: ComparisonVerdict | 'initial';
    length: number;
  };
  latestDriver: ComparisonDriver | null;
}

export interface TaskTrendsResponse {
  taskId: string;
  scope: {
    target: string;
    collector: CollectorId;
    scenario: ScenarioId;
  };
  summary: string;
  historySummary: TaskHistorySummary;
  latestComparison: TaskComparison | null;
  points: TaskTrendPoint[];
  metricSeries: TaskMetricSeries[];
  hotspotChanges: TaskHotspotChange[];
  transitions: TaskTrendTransition[];
}

export interface AppState {
  stateVersion: number;
  tasks: TaskDetail[];
  agents: AgentSummary[];
  auditEvents: TaskAuditEvent[];
}

export interface TaskCreateInput {
  target: string;
  language: string;
  collector: CollectorId;
  scenario: ScenarioId;
  targetType?: TaskTargetType;
  pid?: number;
  processInfo?: TaskProcessInfo | null;
  attachSource?: TaskAttachSource;
}

export interface TaskCreateRequest {
  target?: string;
  language: string;
  collector: CollectorId;
  scenario: ScenarioId;
  targetType?: TaskTargetType;
  pid?: number;
  processInfo?: TaskProcessInfo | null;
}

export interface TaskListFilters {
  status?: TaskStatus;
  collector?: CollectorId;
  scenario?: ScenarioId;
  target?: string;
  targetType?: TaskTargetType;
}

export interface ProcessListResponse {
  collectedAt: string;
  processes: TaskProcessInfo[];
}

export interface CatalogResponse {
  collectors: CollectorInfo[];
  scenarios: ScenarioDefinition[];
  targetTypes: {
    id: TaskTargetType;
    label: string;
    description: string;
  }[];
  collectorNotes: string[];
  collectorReadiness: CollectorRuntimeReadiness[];
  collectorReadinessSource?: 'agent' | 'server-fallback';
  collectorReadinessAgentId?: string | null;
  collectorReadinessAgentLabel?: string | null;
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

export interface TaskFlowDeleteResponse {
  target: string;
  deletedTaskIds: string[];
  deletedCount: number;
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

export interface ArtifactPreview {
  mode: ArtifactPreviewMode;
  content: string | null;
  truncated: boolean;
  byteLength: number;
  mimeType: string;
  summary: string;
}

export interface ArtifactPreviewResponse {
  taskId: string;
  artifact: TaskArtifact;
  preview: ArtifactPreview;
}

export interface TaskAuditResponse {
  taskId: string;
  auditEvents: TaskAuditEvent[];
}

export interface TaskReasonerEvidenceItem {
  id: string;
  kind: 'metric' | 'hotspot' | 'finding' | 'comparison' | 'artifact' | 'timeline';
  label: string;
  detail: string;
  value?: number | string;
}

export interface TaskReasonerToolDefinition {
  name: TaskReasonerToolName;
  purpose: string;
  readOnly: boolean;
}

export interface TaskReasonerRejectedCitation {
  citation: string;
  reason: string;
}

export interface TaskReasonerToolInvocation {
  id: string;
  tool: TaskReasonerToolName;
  status: TaskReasonerToolStatus;
  requestSummary: string;
  responseSummary: string;
  evidenceIds: string[];
  startedAt: string;
  finishedAt: string;
  error: string | null;
}

export interface TaskReasonerFinding {
  title: string;
  detail: string;
  citations: string[];
  status: TaskReasonerFindingStatus;
}

export interface TaskReasonerSnapshot {
  input: {
    taskId: string;
    reportTitle: string;
    reportSummary: string;
    target: string;
    collector: string;
    scenario: string;
    evidence: TaskReasonerEvidenceItem[];
    guardrails: string[];
    availableTools: TaskReasonerToolDefinition[];
    toolContext: TaskReasonerToolInvocation[];
  };
  output: {
    mode: ReasonerMode;
    summary: string;
    findings: TaskReasonerFinding[];
    citations: string[];
    rejectedCitations: string[];
    rejectedCitationDetails: TaskReasonerRejectedCitation[];
    toolInvocations: TaskReasonerToolInvocation[];
    generatedAt: string;
    guardrailStatus: ReasonerGuardrailStatus;
    fallbackReason: string | null;
  };
}

export interface TaskRunStateResponse {
  taskId: string;
  taskStatus: TaskStatus;
  activeRun: {
    taskId: string;
    stage: 'created' | 'probing' | 'ready' | 'collecting' | 'finalizing' | 'completed' | 'failed' | 'stopped';
    startedAt: string;
    updatedAt: string;
    stopRequested: boolean;
    stopRequestedAt?: string;
    stopReason?: string;
    cleanupHookCount: number;
    probe: {
      collectedAt: string;
      host: {
        platform: string;
        arch: string;
        nodeVersion: string;
        pid: number;
      };
      collectors: CollectorRuntimeReadiness[];
      notes: string[];
    } | null;
    logs: string[];
  } | null;
  stopPending: boolean;
  probeSummary: CollectorRuntimeReadiness[] | null;
  lastCollectorStage: string | null;
}

export interface TaskReasonerResponse {
  taskId: string;
  snapshot: TaskReasonerSnapshot | null;
}

export interface AgentRegisterRequest {
  id?: string;
  label?: string;
  host?: {
    platform?: string;
    arch?: string;
    nodeVersion?: string;
    pid?: number;
  };
  collectors?: CollectorRuntimeReadiness[];
  notes?: string[];
}

export interface AgentHeartbeatRequest {
  currentTaskId?: string | null;
  collectors?: CollectorRuntimeReadiness[];
  notes?: string[];
}

export interface AgentRegistrationResponse {
  accepted: boolean;
  staleAfterSeconds: number;
  agent: AgentSummary;
}

export interface AgentListResponse {
  staleAfterSeconds: number;
  agents: AgentSummary[];
}

export interface AgentPollTaskResponse {
  accepted: boolean;
  agent: AgentSummary;
  task: TaskDetail | null;
  message: string;
}

export interface AgentUploadResultRequest {
  taskId: string;
  note?: string;
  artifactCount?: number;
  uploadState?: TaskUploadState;
}

export interface AgentUploadResultResponse {
  accepted: boolean;
  taskId: string;
  message: string;
}

export interface ApiErrorResponse {
  message: string;
  code: string;
  details?: string[];
}
