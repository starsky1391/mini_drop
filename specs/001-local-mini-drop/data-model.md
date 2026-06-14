# Data Model: Local Mini-Drop

## 1. Diagnosis Task

Represents one user-initiated diagnosis run.

### Core Fields

- `id`: Unique task identifier
- `title`: User-facing task title derived from target and scenario
- `target`: Logical diagnosis scope used for history, compare, and trend grouping
- `targetContext`: Structured target metadata retained for the run
- `language`: Language context chosen for the run
- `collector`: Selected collection mode
- `scenario`: Selected diagnosis scenario
- `status`: Current lifecycle state
- `statusReason`: Explicit explanation for why the task is in the current lifecycle state
- `uploadState`: Explicit upload or artifact-staging state
- `progress`: User-facing progress indicator
- `createdAt`: Creation timestamp
- `updatedAt`: Last state-change timestamp
- `signal`: Short signal classification for the run

### Derived or Detail Fields

- `reportTitle`
- `reportSummary`
- `primaryFinding`
- `analysisSummary`
- `trendSummary`
- `confidence`
- `sampleCount`
- `sampleSource`
- `capturePathMode`
- `capturePathReason`
- `runStateSnapshot`

### Target Context

- `targetType`: One of `label`, `pid`, or `process`
- `attachSource`: One of `managed-workload`, `external-pid`, `process-selection`, or `managed-fallback`
- `attachDecision`: Human-readable explanation of which path actually ran
- `processInfo`: Optional retained real-process metadata

### Process Info

- `pid`: Retained process identifier
- `name`: Process executable or runtime name
- `command`: Full command line when available
- `commandSummary`: Truncated, UI-safe command summary
- `languageHint`: Best-effort runtime hint such as `Python`, `Java`, `Node.js`, or `Go`
- `discoveredAt`: Timestamp for when the process metadata was captured
- `alive`: Whether the process was known alive at selection time

### Lifecycle States

- `PENDING`
- `RUNNING`
- `UPLOADING`
- `DONE`
- `FAILED`

### State Transitions

- `PENDING -> RUNNING`
- `RUNNING -> UPLOADING`
- `UPLOADING -> DONE`
- `PENDING -> FAILED`
- `RUNNING -> FAILED`
- `UPLOADING -> FAILED`

### Upload States

- `not_started`
- `uploading`
- `uploaded`
- `upload_failed`

### Lifecycle Rules

- Every persisted task must retain both `status` and `statusReason`.
- Every lifecycle transition must emit an audit record.
- `UPLOADING` represents the post-sampling stage where retained artifacts are being staged, uploaded, indexed, or normalized into analysis inputs.

## 2. Run Evidence Bundle

Represents the evidence retained for a diagnosis task.

### Components

- Flame graph tree
- Ranked hotspot list
- Metric set
- Insight list
- Timeline events
- Symbolized hotspot and stack-frame context
- Collector logs
- Artifact list
- Collection-path provenance

### Relationships

- Each diagnosis task owns one evidence bundle.
- An evidence bundle can contain zero or more artifacts.
- An evidence bundle may be partial when the run fails early.
- The evidence bundle must remain linked to the retained `targetContext` so the user can verify whether the run came from direct PID attach or managed fallback.

## 3. Collector Provenance

Represents how the selected collector actually captured evidence for a run.

### Core Fields

- `taskId`
- `collector`
- `mode`
- `reason`
- `sourceKind`
- `expectedArtifacts`
- `retainedArtifacts`
- `notes`

### Rules

- Provenance must distinguish preferred real capture, partial real capture, and fallback capture.
- Provenance must survive even when task execution fails before a full evidence bundle is produced.
- Provenance is part of the trust signal for reasoner output and comparison quality.

## 4. Symbolized Location

Represents the best available readable mapping for a hotspot or stack frame.

### Core Fields

- `symbol`
- `module`
- `file`
- `line`
- `column`
- `mappingState`
- `mappingSource`

### Rules

- Symbolized locations may be complete, partial, inferred, or unavailable.
- The system must preserve the distinction between retained evidence and inferred readability improvements.
- Missing mappings must remain explicit to avoid overstating confidence.

## 5. Artifact

Represents a retained file or previewable output from a diagnosis run.

### Core Fields

- `taskId`
- `kind`
- `label`
- `path`
- `createdAt`
- `sizeBytes`
- `source`
- `previewMode`
- `previewSummary`
- `offlineRequired`

### Expected Kinds

- Interactive profile outputs
- Collapsed stack outputs
- Normalized reports
- Logs
- Raw collector byproducts

### Rules

- Artifacts remain associated with the originating diagnosis task.
- Artifact metadata must be sufficient for the UI to label and preview the item when possible.
- Artifact absence is valid for failed or partial runs, but the task must still explain what evidence is available.
- Artifacts that cannot be previewed inline must still expose enough metadata to explain how they support diagnosis.

## 6. Audit Record

Represents an immutable event in the task execution history.

### Core Fields

- `id`
- `taskId`
- `at`
- `type`
- `actor`
- `severity`
- `message`
- `detail`
- `metadata`

### Rules

- Audit records are append-only.
- A task can have many audit records.
- Audit records must preserve enough context to explain lifecycle changes, stop events, indexing, and failures.

## 7. Agent Summary

Represents one independent Agent visible to the Server.

### Core Fields

- `id`
- `label`
- `status`
- `heartbeatState`
- `registeredAt`
- `lastHeartbeatAt`
- `lastSeenAt`
- `staleAfterSeconds`
- `platform`
- `arch`
- `nodeVersion`
- `hostPid`
- `currentTaskId`
- `notes`
- `collectors`

### Lifecycle Rules

- Agent lifecycle must distinguish `online` and `offline`.
- Heartbeat health must distinguish `healthy`, `stale`, and `lost`.
- Heartbeat timeout must eventually transition an Agent to `offline` and emit an audit record.
- Agent recovery after heartbeat loss must remain auditable.

## 8. Continuous Profile Slice

Represents one low-frequency retained slice from a continuous profiling window.

### Core Fields

- `id`
- `taskId`
- `agentId`
- `target`
- `collector`
- `scenario`
- `startedAt`
- `endedAt`
- `sampleCount`
- `sampleSource`
- `status`
- `artifactPaths`
- `summary`

### Rules

- Continuous slices are retained independently from the final aggregate task view.
- Slice status may be `ready`, `partial`, or `failed`.
- Slice metadata must preserve enough time-window context for later playback or comparison.

## 9. Run Comparison

Represents analysis between a current task and a compatible baseline task.

### Core Fields

- `baselineId`
- `currentId`
- `verdict`
- `summary`
- `confidenceDelta`
- `totalPressureDelta`
- `metricDeltas`
- `hotspotShift`
- `hotspotChanges`
- `driver`
- `evidence`

### Compatibility Rules

- Runs are comparable only when they share the same logical target, collector, and scenario scope.
- Retained process context must remain visible so the system can warn when logically grouped runs were collected from different real processes or attach paths.
- Comparison can exist only if both runs are retained in history.
- Comparison may remain partially explained when evidence or symbolization depth differs across runs, but the limitation must be visible.

## 10. Trend History

Represents the ordered sequence of comparable runs for one scope.

### Core Fields

- `taskId`
- `scope`
- `summary`
- `historySummary`
- `latestComparison`
- `points`
- `metricSeries`
- `hotspotChanges`
- `transitions`
- `currentStreak`
- `latestDriver`

### Rules

- Trend history is scoped to one target, one collector, and one scenario.
- Trend summaries should preserve real-process context instead of implying that every grouped run came from the same exact PID or attach path.
- The current task acts as the focus point for the returned history sequence.
- Trend history may be empty or trivial when no earlier comparable runs exist.

## 11. Reasoner Output

Represents the user-facing diagnostic narrative.

### Core Fields

- `mode`
- `summary`
- `findings`
- `citations`
- `generatedAt`
- `guardrailStatus`
- `rejectedCitations`
- `fallbackReason`

### Rules

- Every finding must map to retained evidence.
- The system must distinguish between fallback reasoning and model-backed reasoning.
- Unsupported conclusions must be blocked rather than inferred.
- Response validation failures must preserve the evidence bundle and produce a safe degraded output rather than unverifiable attribution.

## 12. Linux / Demo Constraints

- The current Linux-demo-ready round remains local-first and single-user.
- Independent Agent, Linux-first collectors, and continuous profiling structures must preserve enough metadata for reproducible demos even when the local machine cannot execute every collector path directly.
- Platform or permission limits are valid, but the retained state, provenance, and audit trail must explain when a collector fell back or could not complete.
