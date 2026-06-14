# Feature Specification: Local Mini-Drop

**Feature Branch**: `[001-local-mini-drop]`

**Created**: 2026-06-11

**Status**: Draft

**Input**: User description: "系统需要把当前已完成的本机 UI、API、独立 Agent、任务状态机、火焰图、对比趋势和 evidence-only reasoner 能力，进一步收敛成更适合 Linux 演示和真实服务诊断的版本；用户除了继续发起 managed workload 任务，还需要更稳定地诊断本机真实进程，并清楚看到目标对象、采样路径、平台限制和 fallback 原因；系统需要把 Linux 环境下的真实采集链路提升为一等公民，优先强化 perf、py-spy、eBPF、async-profiler 在可用环境中的真实演示能力；任务完成后，用户不仅可以查看火焰图、热点函数、诊断结论、采样产物和审计记录，还需要更容易地核对“结论对应哪些证据、哪些产物、哪些对比结果”；同一逻辑目标下，系统需要更稳定地支持历史对比、连续剖析窗口回放、基线选择和趋势归因；系统需要补强本地与 Linux 演示环境下的启动、验证和回归能力，确保一次搭起后可以重复完成 create task、agent execution、artifact review、compare、trend、continuous-profile 的闭环；诊断结论必须继续坚持 evidence-only，外部 LLM 即使接入真实 API，也不能输出无法映射到采样证据、热点、指标、产物或审计链路的归因内容。"

## Clarifications

### Session 2026-06-14

- Q: 下一轮的部署与系统边界是什么？ → A: 下一轮仍然围绕单机单用户闭环，不引入多租户、权限体系、远端多机调度或完整生产级控制面。
- Q: 当前独立 Agent 的阶段目标是什么？ → A: 当前独立 Agent 形态继续保留，但重点从“能跑通”提升到“Linux 演示稳定、状态透明、异常可追踪、可重复验证”。
- Q: 下一轮的最高优先级是什么？ → A: 下一轮优先级最高的是 Linux 演示闭环，而不是继续扩展大量新 UI 页面。
- Q: Collector 的推进顺序是什么？ → A: perf、py-spy 继续做稳定主链路；eBPF、async-profiler 优先提升真实可演示性、平台探测能力和 fallback 透明度。
- Q: 当前真实进程 attach 的入口边界是什么？ → A: 当前真实进程 attach 仍以手动 PID、进程选择和逻辑 label 三种入口为主，不引入复杂自动服务发现。
- Q: LLM 的下一轮边界是什么？ → A: LLM 继续按外部 API 接入边界设计，下一轮允许真正接入配置模型，但必须保留 timeout、response 校验、citation 过滤、evidence-only guardrail 和失败降级。
- Q: Symbolization 的目标是什么？ → A: 下一轮对 Symbolization 的目标是“更可读、更少 unknown、更好地关联模块/文件/行号”，而不是建设完整生产级符号服务。
- Q: Continuous Profiling 的目标是什么？ → A: 下一轮对 Continuous Profiling 的目标是“更稳定的切片保留、窗口回放、历史对比”，而不是做完整持续采样平台。
- Q: Docker 与 quickstart 的交付目标是什么？ → A: Docker 与 quickstart 的目标是“可演示、可复跑、可说明前置条件”，当前允许在无 daemon 环境下只完成静态配置校验和文档闭环。
- Q: 诊断结论在这一轮必须满足什么约束？ → A: 所有结论仍必须保持 evidence-only，任何 reasoner 输出都必须能映射回任务对象、采样路径、热点、指标、产物或审计记录。

## Delivery Alignment Note

The previous round established a working local Mini-Drop console with independent Agent support, evidence-grounded task analysis, flame-graph review, compare/trend views, and continuous profiling basics. This round tightens those capabilities into a Linux-demo-ready diagnosis workflow that is more credible for real service troubleshooting and closer to the internal Drop product direction.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run a stable Linux-first diagnosis workflow (Priority: P1)

A backend engineer or SRE can create a diagnosis task against a managed workload or a real local process and reliably understand what actually ran, which collector path was used, and whether the capture stayed on the preferred real path, degraded to partial-real, or fell back.

**Why this priority**: The platform is only credible for Linux demo and real-service troubleshooting if operators can trust the execution path, the target object, and the retained evidence before reading any downstream analysis.

**Independent Test**: Start the system with a local server and independent Agent, run diagnosis tasks against both a managed workload and a real process, and confirm the final task view clearly exposes target identity, capture path, platform limitations, fallback reasons, and retained artifacts.

**Acceptance Scenarios**:

1. **Given** a user creates a diagnosis task for a logical target, manual PID, or selected process, **When** the task is accepted, **Then** the system records and shows the effective target context, attach source, and execution lifecycle from queue to terminal state.
2. **Given** a collector cannot remain on its preferred Linux real path, **When** the run degrades to partial-real or fallback, **Then** the task detail surface explains the degradation reason, what evidence still survived, and what limitation applied.
3. **Given** the independent Agent registers, leases work, uploads results, or becomes stale, **When** the user inspects the task and agent state, **Then** the UI and audit trail expose the relevant state transitions and recovery or failure reasons.

---

### User Story 2 - Verify evidence and artifacts more directly (Priority: P2)

After a task finishes, the user can inspect artifacts, evidence, hotspots, and reasoner output in one flow and can more easily verify that each conclusion is supported by retained stack evidence, metrics, previews, and comparison context.

**Why this priority**: The product’s value depends on fast trust-building. Operators need to go from diagnostic narrative back to hard evidence without leaving the core investigation flow.

**Independent Test**: Open a completed run, review the task detail page, and confirm that artifact previews, hotspot context, reasoner citations, and comparison/trend evidence can all be cross-checked from the same task detail workflow.

**Acceptance Scenarios**:

1. **Given** a completed or failed run retains artifacts and logs, **When** the user opens the task detail view, **Then** the system presents those items with enough preview or summary information to decide whether deeper offline inspection is needed.
2. **Given** a task shows a reasoner summary or finding, **When** the user reviews that finding, **Then** the UI makes it easy to map the conclusion back to visible metrics, hotspots, artifacts, audit events, or comparison evidence from the same run.
3. **Given** symbolization is partial or some frames remain unknown, **When** the user reviews hotspot details or flame-graph labels, **Then** the system clearly distinguishes complete mappings from partial or fallback-readable mappings instead of masking uncertainty.

---

### User Story 3 - Review history and continuous profiling more reliably (Priority: P3)

When multiple runs exist for the same logical target, the user can compare them, replay a continuous profiling window, select baselines more confidently, and understand which recent changes are driving the trend.

**Why this priority**: The next increase in usefulness comes from supporting repeat diagnosis and regression review, not just one-off snapshots.

**Independent Test**: Produce at least two comparable runs for the same logical target and one continuous-profile history window, then confirm the system supports baseline selection, hotspot movement review, trend explanation, and history-slice replay from one coherent flow.

**Acceptance Scenarios**:

1. **Given** two compatible runs exist, **When** the user selects a baseline, **Then** the system shows metric changes, hotspot changes, dominant trend driver, and compatibility warnings if the runs differ in attach source or process identity.
2. **Given** continuous profiling slices exist for the same logical target, **When** the user opens the history window, **Then** the system presents the slice sequence and lets the user understand what changed over time rather than only listing raw task IDs.
3. **Given** history exists but some slices or runs have incomplete evidence, **When** the user inspects the trend output, **Then** the system preserves surviving evidence while making scope limits and comparability constraints explicit.

### Edge Cases

- A user chooses a collector that is available in the UI but unsupported on the current platform, requiring an explicit partial-real or fallback explanation.
- A task attaches to a real process that exits mid-run or becomes unavailable before the collector can finish.
- The Agent is healthy enough to register but later stops heartbeating, leaving leased work or stale status that must still be explained cleanly.
- A collector retains raw output but fails later normalization or symbolization steps, leaving partial evidence rather than a clean success/failure split.
- A task has artifacts that are too large or too raw for inline preview and must be surfaced as offline-review items.
- Multiple runs share the same logical target but differ in process identity, attach source, or collector fidelity, making comparison only partially trustworthy.
- The external LLM API is configured but times out, returns malformed output, or cites evidence IDs that do not exist in the retained evidence bundle.
- Docker compose files are valid, but the local environment lacks a working daemon, so the demo can only be verified through static config validation and documented fallback steps.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a user to create a diagnosis task for a logical target, manual PID, or selected local process.
- **FR-002**: System MUST retain and display the effective target context for each task, including target type, attach source, and best available process identity summary.
- **FR-003**: System MUST represent each task with lifecycle states that cover at least `PENDING`, `RUNNING`, `UPLOADING`, `DONE`, and `FAILED`.
- **FR-004**: System MUST preserve diagnosis tasks in history so the user can reopen completed, failed, or partially retained runs after restart.
- **FR-005**: System MUST preserve and expose audit records for task creation, dispatch, collection, upload, failure, and agent state transitions.
- **FR-006**: System MUST show whether each collector ran on a preferred real path, a partial-real path, or a fallback path, and MUST expose the reason for any downgrade.
- **FR-007**: System MUST treat Linux real collection as a first-class path and MUST make Linux platform readiness and command availability visible for supported collectors.
- **FR-008**: System MUST preserve retained artifacts, logs, previews, and result indexes with enough metadata for the user to identify and verify each retained item.
- **FR-009**: System MUST provide a task detail view that displays summary, hotspots, flame graph, evidence, artifacts, audit records, and diagnostic conclusion for a selected run.
- **FR-010**: System MUST make it easier for a user to verify which evidence supports a conclusion by linking reasoner output, hotspots, metrics, artifacts, or comparison data within the same investigation flow.
- **FR-011**: System MUST allow users to compare compatible runs for the same logical target and diagnosis scope.
- **FR-012**: System MUST preserve history and trend context for compatible runs and MUST expose compatibility warnings when attach source, process identity, or evidence scope differs materially.
- **FR-013**: System MUST preserve continuous profiling slices and support history-window replay for the same logical target and diagnosis scope.
- **FR-014**: System MUST support baseline selection and trend explanation for repeated runs without hiding incomplete or partially comparable evidence.
- **FR-015**: System MUST expose the best available readable hotspot and frame mapping, including module, file, and line information when derivable from retained evidence.
- **FR-016**: System MUST make incomplete symbolization explicit so users can distinguish trusted mappings from partial, synthetic, or unknown labels.
- **FR-017**: System MUST support an external LLM API integration boundary for diagnostic reasoning without changing the core evidence-review workflow.
- **FR-018**: System MUST validate model responses and filter invalid citations so no displayed conclusion cites evidence that is not present in the retained evidence bundle.
- **FR-019**: System MUST keep a safe fallback diagnostic mode when the external LLM API is unavailable, malformed, or disabled.
- **FR-020**: System MUST ensure every displayed diagnosis conclusion remains evidence-only and traceable to retained metrics, hotspots, artifacts, logs, trend output, or audit records.
- **FR-021**: System MUST remain usable as a local single-machine, single-user system without requiring remote multi-agent coordination, multi-user auth, or tenant separation.
- **FR-022**: System MUST support repeatable startup, smoke validation, and regression checks across local and Linux demo workflows.
- **FR-023**: System MUST provide documented startup and validation guidance for local, Linux-demo, and Docker-based replay paths, including known environment limits.

### Key Entities *(include if feature involves data)*

- **Diagnosis Task**: A user-initiated run that defines the logical target, target type, effective process context, collector, scenario, lifecycle state, timestamps, capture-path status, and summary result.
- **Target Context**: The retained description of what the task actually sampled, including logical label, target type, attach source, process identity, and attach decision explanation.
- **Agent State**: The persisted status of an independent Agent, including registration details, heartbeat health, current lease, collector readiness, and offline or recovery timestamps.
- **Collector Provenance**: The structured explanation of how a collector ran, which path it used, what limitations applied, and what evidence was retained.
- **Run Evidence Bundle**: The set of metrics, hotspots, flame-graph data, symbolized stack context, artifacts, logs, audit events, and comparison evidence associated with a diagnosis run.
- **Artifact Record**: A retained file, preview, or summary item from a diagnosis task, including kind, previewability, metadata, and path information.
- **Continuous Profile Slice**: A retained time-bounded slice of diagnosis evidence for a logical target and scope, used for history-window playback and trend review.
- **Run Comparison**: A structured view of differences between two compatible runs, including verdict, metric shifts, hotspot movement, dominant driver, compatibility warnings, and explanation text.
- **Trend History**: The ordered set of compatible runs or slices for the same logical target and diagnosis scope, including trend summaries, transitions, slice sequence, and current streak context.
- **Reasoner Output**: A diagnostic narrative with summary, findings, citations, guardrail state, and fallback reason, constrained to retained evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create and launch a diagnosis task for a managed workload or real process in under 1 minute from the main console.
- **SC-002**: 100% of accepted diagnosis tasks remain visible in history and show a visible current or terminal lifecycle state.
- **SC-003**: For every completed or failed run, the task detail page exposes at least one verifiable evidence surface from hotspots, flame graph, artifacts, logs, audit records, comparison output, or continuous-profile history.
- **SC-004**: For every run that degrades from a preferred collector path, the user can identify the downgrade reason and retained evidence source from the task detail workflow without opening server code or raw files first.
- **SC-005**: When at least two compatible runs exist for the same logical target, a user can identify the baseline, dominant trend driver, and main hotspot or metric change from one investigation flow.
- **SC-006**: Continuous profiling history replay shows at least the latest two compatible slices or runs for a logical target when those slices exist.
- **SC-007**: 100% of displayed diagnostic findings cite retained evidence IDs that exist in the corresponding evidence bundle.
- **SC-008**: The external LLM path can fail, time out, or be disabled without causing the diagnostic workflow to emit unverifiable conclusions.
- **SC-009**: Re-running the local validation workflow across at least two consecutive cycles does not require manual repair of state directories, task history, or test data to preserve the normal path.
- **SC-010**: A user can follow documented local or Linux-demo startup steps and complete create task, agent execution, artifact review, compare, trend, and continuous-profile validation in one repeatable session.

## Assumptions

- The current release still targets a single local operator using the platform on one machine at a time.
- Linux is the preferred environment for demonstrating the strongest real-collector path fidelity.
- Windows and other non-Linux hosts may continue to rely on partial-real or fallback paths for some collectors, but those limits must stay visible and auditable.
- Historical tasks, slices, and evidence remain locally retained until explicit retention policies are introduced in a later round.
- Some symbolization quality limits will continue to depend on retained evidence quality and available runtime metadata rather than a dedicated production symbol service.
- Docker-based demo steps are part of the documented delivery path even when the current host environment cannot run containers directly.
- External model providers may differ in schema, latency, and stability; the platform must normalize those differences behind a stable evidence-only reasoning boundary.
