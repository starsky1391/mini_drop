# Research: Local Mini-Drop

## Decision 1: Keep the first release local-first and single-user

- **Decision**: Deliver the current feature as a single-machine, single-user workflow.
- **Rationale**: This matches the agreed phase boundary and keeps the team focused on proving the task lifecycle, evidence capture, comparison flow, and grounded diagnosis experience before remote orchestration concerns are introduced.
- **Alternatives considered**:
  - Multi-user local deployment: rejected because it adds permissions, tenancy, and concurrent state concerns that do not improve the current learning and validation goals.
  - Remote agent deployment now: rejected because it would shift effort away from stabilizing the local core loop.

## Decision 2: Use a managed local runner instead of a remote agent

- **Decision**: Keep task execution inside a managed local runner abstraction for this phase.
- **Rationale**: The managed runner is sufficient to start collectors, observe lifecycle transitions, persist evidence, and support local validation without inventing a remote control protocol early.
- **Alternatives considered**:
  - Dedicated remote agent process: rejected because it introduces deployment, trust, and communications work before the local workflow is fully proven.
  - Manual shell-only execution: rejected because the product needs a repeatable system flow rather than ad hoc operator commands.

## Decision 3: Prioritize real perf and py-spy collection paths

- **Decision**: Make perf and py-spy the two collectors that must reach stable real execution paths in this phase, while async-profiler and ebpf keep extension-ready plugin slots.
- **Rationale**: Two working real collectors are enough to validate plugin design, retained artifacts, comparison logic, and UI evidence surfaces without stretching current scope too thin.
- **Alternatives considered**:
  - Stabilize all collectors equally: rejected because it would slow down progress on the primary local workflow.
  - Keep all collectors synthetic: rejected because the team explicitly wants real collector integration to replace pure simulation.

## Decision 4: Persist task history and evidence on the local file system

- **Decision**: Retain task state, artifacts, audit trails, indexes, and reasoner snapshots in local storage.
- **Rationale**: Local persistence is enough for a basic functional version, supports browser inspection and restart recovery, and keeps operational overhead low.
- **Alternatives considered**:
  - SQLite or another embedded database for all state: rejected for now because the current needs are met by simpler local persistence and explicit artifact files.
  - Remote object storage: rejected because the current phase avoids remote deployment dependencies.

## Decision 5: Keep the reasoner behind an external API adapter boundary

- **Decision**: Design the reasoner as an external API-backed capability with a safe stub fallback that can be swapped without changing task and evidence workflows.
- **Rationale**: This preserves the intended long-term integration shape while allowing the current phase to remain usable even if model access is not configured.
- **Alternatives considered**:
  - Hard-code only a local stub forever: rejected because the product direction requires API-based model integration.
  - Block all progress until the real model integration is finished: rejected because the evidence pipeline and UI can be validated independently first.

## Decision 6: Require evidence-grounded conclusions and visible capture provenance

- **Decision**: Treat evidence grounding and collection-path provenance as first-class product behavior.
- **Rationale**: Users need to know whether a conclusion came from captured samples, fallback outputs, or partial evidence, especially in a diagnosis tool that may influence debugging effort.
- **Alternatives considered**:
  - Hide fallback behavior behind generic summaries: rejected because it weakens trust and makes diagnostic output harder to validate.
  - Allow narrative conclusions without evidence mapping: rejected because the agreed product behavior explicitly forbids unverifiable attribution.

## Decision 7: Keep comparison and trends in the main investigation flow

- **Decision**: Present baseline comparison, hotspot movement, metric drift, and short history sequences directly from the task detail experience.
- **Rationale**: The most important analysis questions happen while reviewing a selected run, so users should not need a separate subsystem to see whether behavior changed over time.
- **Alternatives considered**:
  - Delay trends until a later release: rejected because trend review is already a required part of the current feature scope.
  - Build a separate reporting workspace first: rejected because it would fragment the core diagnosis flow too early.

## Decision 8: Treat symbolization as an evidence-readability layer, not a full debug-symbol service

- **Decision**: Improve symbol, module, file, and line readability from retained evidence without introducing a production-grade symbolization backend in this round.
- **Rationale**: The current product gap is readability, not distributed symbol-service scale. A lighter symbolization layer raises trust and usability without forcing new infrastructure.
- **Alternatives considered**:
  - Build a complete symbolization service now: rejected because it is too large for the current local enhancement phase.
  - Leave readable-location quality unchanged: rejected because it keeps hotspots harder to act on and weakens the value of richer analysis.

## Decision 9: Advance async-profiler and ebpf through usable local execution stages

- **Decision**: Keep perf and py-spy as the stable real paths while moving async-profiler and ebpf from extension-only placeholders toward usable local execution with explicit platform limits and auditable fallback.
- **Rationale**: This extends the plugin model and evidence surfaces without pretending all collectors are equally mature on every host.
- **Alternatives considered**:
  - Hold async-profiler and ebpf at placeholder status: rejected because the next round explicitly aims to expand real collector capability.
  - Require them to be fully production-ready immediately: rejected because platform variability would over-expand scope for this round.

## Decision 10: Deepen the existing task detail flow instead of introducing a separate analysis workspace

- **Decision**: Add stronger baseline, trend, hotspot-shift, and artifact-linking behavior inside the existing task detail flow.
- **Rationale**: Users already investigate from the current detail page. Deepening that flow preserves the local diagnosis loop and avoids splitting context across new surfaces.
- **Alternatives considered**:
  - Create a separate advanced-analysis page: rejected because it would duplicate context and raise UX complexity too early.
  - Limit the round to backend analysis only: rejected because many of the intended gains are only useful if visible in the operator workflow.

## Decision 11: Make repeatable local validation a first-class delivery requirement

- **Decision**: Treat repeated local validation across launch, inspect, compare, and fallback paths as part of the feature outcome, not just a release-time checklist.
- **Rationale**: A local-first tool loses value quickly if it works once but becomes brittle across repeated task creation or restarts.
- **Alternatives considered**:
  - Validate only build and unit tests: rejected because that misses real workflow regressions in task execution and retained evidence inspection.
  - Rely on ad hoc manual smoke runs: rejected because the next round explicitly aims to improve stability and recovery.
