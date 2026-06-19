# Data Model: Linux Real Process Attach Proof

## Diagnosis Task

- **Purpose**: One diagnosis run for a logical target and a live Linux process.
- **Key fields**: task id, created at, status, scenario, collector id, logical label, target type, PID, process name, command summary, attach source, attach decision, evidence references.
- **Relationships**: Owns one target context, one collector provenance record, many artifacts, many audit events, and optional comparison/trend links.

## Target Context

- **Purpose**: The persisted identity of what the system actually sampled.
- **Key fields**: target type, logical label, attach source, PID, process name, command summary, language hint, selection source, comparability key.
- **Relationships**: Belongs to one diagnosis task and is referenced by comparisons and trend summaries.

## Local Process Snapshot

- **Purpose**: The process-list row shown to the user before task creation.
- **Key fields**: PID, name, command summary, runtime hint, owner hint when available, process state.
- **Relationships**: Used as the selected input for PID/process-picker task creation.

## Collector Provenance

- **Purpose**: The explanation of how a collector attached to the live process or why it degraded.
- **Key fields**: collector id, path class, real-attach flag, fallback reason, platform note, privilege note, evidence references.
- **Relationships**: One per run; rendered in task detail and comparison safety checks.

## Evidence Bundle

- **Purpose**: The set of retained evidence the user can inspect after the run.
- **Key fields**: artifact ids, preview availability, flame graph references, raw capture summaries, audit ids, reasoner snapshot ids.
- **Relationships**: Owned by one diagnosis task and consumed by analysis, compare, and trend views.

## Comparison Record

- **Purpose**: The persisted result of comparing two runs.
- **Key fields**: baseline task id, current task id, compatibility flag, attach-source delta, process-identity delta, driver summary, warning list.
- **Relationships**: Derived from two diagnosis tasks and surfaced in the UI.

## Validation Record

- **Purpose**: Saved evidence that the Linux attach proof was executed.
- **Key fields**: host context, service start command, selected target, collector used, result class, fallback reason, proof timestamps.
- **Relationships**: Referenced by quickstart and smoke validation outputs.
