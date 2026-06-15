# Feature Specification: Collector Maturity Alignment

**Feature Branch**: `[002-collector-maturity]`

**Created**: 2026-06-15

**Status**: Draft

**Input**: User description: "先 git 到仓库，然后处理这两个差距。第一个是 eBPF 必须真跑，如果这件事需要 Linux 环境，就先不在这一轮做，只处理第二个：真实多采集器成熟度不均衡。现在最稳的是 py-spy；perf、async-profiler、eBPF 已经接好了框架和部分真实链路，但还没有全部达到同一成熟度。针对这一点生成 spec、clarify、plan。"

## Clarifications

### Session 2026-06-15

- Q: 这一轮是否包含 “eBPF 必须真跑” 的现场强证明？ → A: 不包含。这一轮明确不承担 Linux 现场 eBPF 真跑验收，只为后续 Linux 演示轮补齐多采集器成熟度基础。
- Q: 这一轮的最高优先级是什么？ → A: 最高优先级是缩小 `py-spy`、`perf`、`async-profiler`、`eBPF` 之间的成熟度差距，重点提升 readiness、真实链路透明度、产物质量和失败说明。
- Q: 这一轮是否引入新的系统边界，例如远端 Linux Agent、多机调度或租户能力？ → A: 不引入，继续保持本机单机单用户交付边界。
- Q: 这一轮的成功标准更偏向哪类结果？ → A: 更偏向“采集器能力对齐与验证稳定性”，而不是继续扩 UI 页面数量或做新的控制面能力。

## Delivery Alignment Note

The previous round completed a locally usable Mini-Drop with Web UI, API Service, independent local Agent, collector plugins, evidence-backed analysis, comparison/trend review, continuous profiling basics, and an evidence-only reasoner boundary. This round narrows scope to one problem: bring the collector layer closer to a coherent multi-collector platform instead of a `py-spy`-led experience with weaker secondary collectors.

This round explicitly does **not** claim Linux eBPF field-proof completion. Instead, it prepares for that future Linux validation by improving collector readiness modeling, artifact retention quality, failure semantics, process-target behavior, and UI transparency across collectors.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose a collector with clearer trust signals (Priority: P1)

An engineer launching a diagnosis task can understand before execution how mature each collector is on the current host, what kind of real data path it can retain, and what downgrade or fallback risk exists.

**Why this priority**: The current product is hardest to trust when one collector is clearly stronger than the others but the UI and task flow do not communicate that difference precisely enough.

**Independent Test**: Open the task creation flow on the current host, inspect readiness/provenance information for `py-spy`, `perf`, `async-profiler`, and `eBPF`, then launch tasks and verify the resulting task detail matches the expected collector-path semantics.

**Acceptance Scenarios**:

1. **Given** the current machine cannot support all collectors equally, **When** the user selects a collector, **Then** the UI shows the collector’s current readiness, likely capture path, and major platform limits before task launch.
2. **Given** a collector degrades from preferred real mode to partial-real or fallback, **When** the task finishes, **Then** the task detail clearly states what actually ran, what was retained, and why the downgrade happened.
3. **Given** two collectors are available for the same target language, **When** the user compares them operationally, **Then** the system shows why one is currently more trustworthy than the other without requiring source inspection.

---

### User Story 2 - Review collector-specific evidence more consistently (Priority: P2)

After a task completes, the user can inspect collector-specific artifacts, hotspot evidence, symbolization quality, and result summaries in a way that feels consistent across `py-spy`, `perf`, `async-profiler`, and `eBPF`.

**Why this priority**: A multi-collector platform only feels real if users can move between collectors without losing basic expectations around evidence shape, artifact discoverability, and error explanation.

**Independent Test**: Run representative tasks across the currently supported collectors and confirm that artifact previews, result indexes, collector provenance, and symbolization surfaces are all present and comparable in structure.

**Acceptance Scenarios**:

1. **Given** two tasks use different collectors, **When** the user opens their detail views, **Then** both tasks expose artifact summaries, retained evidence, and symbolization status through a consistent layout and vocabulary.
2. **Given** a collector produces only partial evidence, **When** the user reviews the result, **Then** the task detail keeps that partial evidence visible instead of collapsing into an opaque failure.
3. **Given** a collector emits a collector-specific artifact type, **When** the user opens artifacts, **Then** the system provides the best available preview metadata, inline summary, or offline-review hint for that artifact.

---

### User Story 3 - Validate collectors with a repeatable maturity matrix (Priority: P3)

The team can rerun a collector-focused validation loop and quickly see which collectors are stable, which are degraded, and which still depend on future Linux proof.

**Why this priority**: Mature multi-collector support needs a repeatable validation matrix, not just ad hoc smoke success on the best-supported collector.

**Independent Test**: Run a documented validation pass that exercises collector readiness, process-target behavior, artifact retention, compare/trend compatibility, and failure semantics, then confirm the resulting record distinguishes stable, partial, and deferred collector paths.

**Acceptance Scenarios**:

1. **Given** the current host only supports some collectors strongly, **When** the validation matrix runs, **Then** the resulting record explicitly separates stable collectors from partial or deferred ones.
2. **Given** a collector path is known to require Linux proof later, **When** validation finishes on a non-Linux host, **Then** the output marks that collector as deferred rather than falsely complete.
3. **Given** collectors share common APIs but differ in runtime semantics, **When** regression coverage runs, **Then** the tests still verify the common contract and the important collector-specific edge cases.

### Edge Cases

- A collector is selectable in the UI but currently only supports fallback on the active platform.
- A process target is valid for one collector but unsuitable for another because the runtime or attach method differs.
- A collector retains raw data but not enough normalized evidence to produce a full hotspot summary.
- A collector finishes with partial artifacts and a valid reason, but not a complete flame-graph-grade dataset.
- Two collectors can both run against the same target but produce different levels of symbolization and previewability.
- A smoke script passes for the strongest collector while weaker collectors silently regress in readiness or artifact retention quality.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose readiness information for `py-spy`, `perf`, `async-profiler`, and `eBPF` before task launch.
- **FR-002**: System MUST distinguish collector readiness in at least three states: stable/preferred, partial-real, and fallback-only or deferred.
- **FR-003**: System MUST preserve the actual collector path used by each task and show it in task detail output.
- **FR-004**: System MUST explain why a collector degraded or fell back, using language visible to the user instead of only server-side logs.
- **FR-005**: System MUST retain collector-specific artifacts and expose enough metadata to compare artifact quality across collectors.
- **FR-006**: System MUST preserve partial collector evidence when available rather than treating all non-ideal runs as fully opaque failures.
- **FR-007**: System MUST expose symbolization quality consistently across collectors so users can distinguish full mappings from partial or synthetic mappings.
- **FR-008**: System MUST present collector provenance, artifact summaries, and result indexes in a consistent task detail structure regardless of which collector ran.
- **FR-009**: System MUST preserve process-target compatibility signals so users can understand whether a collector was a good fit for the requested runtime and attach mode.
- **FR-010**: System MUST document which collectors are currently stable on the active host and which remain partial or deferred pending Linux proof.
- **FR-011**: System MUST support a repeatable collector-focused validation workflow that can be rerun after collector or analysis changes.
- **FR-012**: System MUST keep current system scope limited to local single-machine use and MUST NOT require remote Linux infrastructure in this round.
- **FR-013**: System MUST preserve evidence-only constraints in downstream analysis and reasoner output even when collector evidence quality differs.

### Key Entities *(include if feature involves data)*

- **Collector Capability Snapshot**: The host-specific description of a collector’s current readiness, limits, likely data path, and validation status.
- **Collector Provenance Record**: The persisted description of what the collector actually executed, which artifacts it retained, and why it stayed real, became partial, or fell back.
- **Collector Artifact Summary**: The normalized summary of a collector’s retained files, previewability, and offline review hints.
- **Collector Validation Matrix Entry**: The recorded outcome of a collector-focused regression or smoke check, including host context, target context, result class, and deferred notes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can identify the current maturity state of each available collector from the launch flow without reading source code or raw logs.
- **SC-002**: 100% of completed or failed tasks show the collector path actually used and a visible downgrade or fallback reason when relevant.
- **SC-003**: For every supported collector path, the task detail view exposes at least one retained artifact or evidence summary instead of an empty result shell.
- **SC-004**: At least one repeatable validation pass can classify collector behavior into stable, partial, fallback-only, or deferred states on the active host.
- **SC-005**: Users can compare two tasks from different collectors and still find provenance, artifact, symbolization, and evidence surfaces in a predictable structure.
- **SC-006**: Deferred Linux-only proof items are clearly labeled as deferred rather than implicitly treated as complete.

## Assumptions

- Linux-only eBPF field proof remains a later round and is not part of this scope.
- `py-spy` is still expected to be the strongest collector on the current Windows host during this round.
- `perf`, `async-profiler`, and `eBPF` can still improve meaningfully through readiness modeling, artifact retention, preview quality, and failure semantics even before Linux proof.
- The current round values operational transparency and repeatability more than adding new collector types or new UI pages.
