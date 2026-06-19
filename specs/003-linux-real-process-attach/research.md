# Research: Linux Real Process Attach Proof

## 1. Target Identity Model

- **Decision**: Keep the logical label, target type, PID, and process snapshot together as the canonical target context.
- **Rationale**: The logical label supports history grouping, while the live process snapshot proves which object was actually sampled.
- **Alternatives considered**: Auto-discover by service name was rejected because it obscures the real attach target and adds scope risk.

## 2. Process Discovery

- **Decision**: Use a local process list plus manual PID entry as the primary selection model.
- **Rationale**: This is simple enough for repeatable Linux demo use and keeps the proof tied to a visible live process.
- **Alternatives considered**: Path-based auto detection or service registry integration would be harder to explain and test.

## 3. Real Attach Proof

- **Decision**: Treat the task as a real-process proof only when the persisted target context, collector provenance, and retained artifacts all agree on the same live process.
- **Rationale**: This avoids false positives where a task exists but did not actually attach to the intended service.
- **Alternatives considered**: Considering any successful task launch as proof was rejected because it would not distinguish managed-workload fallback from a true Linux attach.

## 4. Collector Behavior

- **Decision**: Make `perf` and `py-spy` the strongest proof paths first, while keeping `eBPF` and `async-profiler` transparent about Linux host limits and partial-real fallback.
- **Rationale**: The team wants a stable proof of external attach now without pretending every collector has the same maturity.
- **Alternatives considered**: Trying to equalize all collectors immediately would delay the proof round and blur the difference between real and partial paths.

## 5. Comparison Rules

- **Decision**: Compare runs only when logical target and attach context are sufficiently compatible, and show warnings when process identity differs.
- **Rationale**: Two runs against different live PIDs may look similar but are not equally trustworthy.
- **Alternatives considered**: Silent comparison across all tasks was rejected because it would hide important evidence-scope differences.

## 6. Validation Shape

- **Decision**: Add repeatable Linux smoke coverage around one user-started service process, one task launch, and one attach-proven detail review.
- **Rationale**: The feature’s value depends on being able to replay the proof with the same visible steps.
- **Alternatives considered**: Pure unit coverage was rejected because it would not prove the Linux attach path end-to-end.
