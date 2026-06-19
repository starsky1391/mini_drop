# Feature Specification: Linux Real Process Attach Proof

**Feature Branch**: `[003-linux-real-process-attach]`

**Created**: 2026-06-17

**Status**: Draft

**Input**: User description: "生成 spec, clarify, plan, task。当前重点不是再跑 managed workload 的流程，而是证明 Linux 上能真实 attach 一个用户启动的服务进程；需要清楚看到目标对象、采样路径、平台限制和 fallback 原因，并把 perf、py-spy、eBPF、async-profiler 的真实 attach / partial-real / fallback 差异说清楚。"

## Clarifications

### Session 2026-06-17

- Q: 这一轮要证明的核心对象是什么？ → A: Linux 上用户启动的真实服务进程，而不是 managed workload 或仅仅跑通流程。
- Q: 真实目标的输入方式是什么？ → A: 继续支持逻辑 label、手工 PID 和本机进程列表选择三种入口，不引入自动服务发现。
- Q: 这一轮最重要的可见结果是什么？ → A: 用户能在任务详情中清楚看到真实目标身份、attach 来源、采样路径、平台限制和 fallback 原因。
- Q: Collector 的验证优先级是什么？ → A: 优先证明 Linux 上的真实 attach 和证据保留，perf 与 py-spy 先成为强证明路径，eBPF 与 async-profiler 保持透明的 partial-real / fallback 说明。

## Delivery Alignment Note

The current Mini-Drop already supports local task creation, collector plugins, evidence-backed analysis, compare/trend review, and a process-selection UI. This round narrows the goal to a sharper proof: on Linux, a user can start a real service, select that live process, and see Mini-Drop attach to that external process with provenance that is visibly different from a managed-workload fallback.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attach to a real Linux service process (Priority: P1)

A backend engineer or SRE can start a Linux service on the local machine, select it by PID or from the process list, launch a diagnosis task, and confirm the task is attached to that real process rather than a synthetic workflow.

**Why this priority**: This is the core proof that Mini-Drop can diagnose a real service process on Linux, which is the main gap the team wants to close next.

**Independent Test**: Start a local Linux service, select it in Mini-Drop by PID or process picker, launch a task, and verify the task detail shows the live PID, process name, command line, attach source, and lifecycle state.

**Acceptance Scenarios**:

1. **Given** a Linux service is already running, **When** the user selects it by PID or process picker, **Then** the task records the real process identity and the attach source as an external process path.
2. **Given** a task targets a real process, **When** the user opens the task detail view, **Then** the UI shows the target identity, attach decision, and whether the run stayed real or degraded.
3. **Given** the process exits or becomes unavailable during attach, **When** the task finishes, **Then** the system explains the failure or downgrade and preserves the surviving evidence.

---

### User Story 2 - Prove collector behavior against the external process (Priority: P2)

The operator can see which collectors truly attached to the Linux service process, which ones stayed partial, and which ones had to fall back, so the evidence chain stays honest across `perf`, `py-spy`, `eBPF`, and `async-profiler`.

**Why this priority**: Real-process attach is only credible if collector outcomes are explicit and consistent enough to compare.

**Independent Test**: Run representative tasks against the same Linux service using different collectors and confirm the task detail distinguishes real attach, partial-real capture, and fallback-only output.

**Acceptance Scenarios**:

1. **Given** a supported collector can attach to the live Linux service, **When** the run completes, **Then** the task detail shows the real attach path and preserved collector provenance.
2. **Given** a collector cannot fully attach on the current host, **When** the run degrades, **Then** the UI explains the platform limitation and shows what evidence was retained.
3. **Given** two collectors run against the same service process, **When** the user compares the results, **Then** the system clearly exposes differences in evidence quality, attach source, and symbolization confidence.

---

### User Story 3 - Repeat the Linux proof reliably (Priority: P3)

The team can repeat the real-process attach demo, validation, and regression checks without guessing whether the system actually sampled the intended live service.

**Why this priority**: The feature is only useful if the proof can be rerun and explained consistently on demand.

**Independent Test**: Follow the Linux quickstart, run the attach proof more than once, and confirm the same target-selection, attach provenance, and collector-path signals appear each time.

**Acceptance Scenarios**:

1. **Given** the Linux demo steps are followed twice, **When** the user replays the proof, **Then** the workflow still finds the live process, launches the task, and records the same attach provenance shape.
2. **Given** the user compares two runs from the same logical target, **When** the process identity or attach source differs, **Then** the system warns that the runs are only partially comparable.
3. **Given** the validation script runs on a Linux host, **When** the proof completes, **Then** the recorded result distinguishes real attach, partial-real capture, and fallback behavior explicitly.

### Edge Cases

- The selected PID no longer exists by the time the collector starts.
- The process picker shows a service that later restarts under a new PID.
- The host can list the process, but the collector cannot attach due to permissions.
- One collector attaches successfully while another can only retain partial evidence.
- Two runs share the same label but not the same live process identity.
- A fallback run retains artifacts, but the task detail must still make the downgrade obvious.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a user to create a diagnosis task for a live Linux service process using a logical label, a manual PID, or a local process picker.
- **FR-002**: System MUST preserve and display the effective target context for each task, including target type, attach source, PID, process name, and command line summary when available.
- **FR-003**: System MUST classify each run as real attach, partial-real, fallback-only, or failed, and MUST show the reason for the classification.
- **FR-004**: System MUST preserve the difference between a managed-workload task and a real-process task so users can tell which object was actually sampled.
- **FR-005**: System MUST expose the selected process list with enough identity data for a user to choose the intended Linux service.
- **FR-006**: System MUST retain collector provenance for each task, including which collector path ran, what degraded, and which evidence survived.
- **FR-007**: System MUST make Linux platform limits visible before or during task execution when they affect attach success.
- **FR-008**: System MUST keep task history, audit records, and retained artifacts available after completion or failure.
- **FR-009**: System MUST make evidence-backed conclusions traceable back to the real process, collector path, artifacts, and audit records used in the run.
- **FR-010**: System MUST allow comparison of two runs only when their logical target and attach context are sufficiently compatible, and MUST warn when process identity or attach source differs materially.
- **FR-011**: System MUST keep symbolization and hotspot readability honest by clearly marking unknown, partial, or synthetic mappings.
- **FR-012**: System MUST support repeatable Linux validation steps that can prove attach behavior on a user-started service process without requiring a new control plane or auto-discovery system.

### Key Entities *(include if feature involves data)*

- **Diagnosis Task**: A user-initiated run with a logical target, target type, process context, collector choice, lifecycle state, and evidence bundle.
- **Target Context**: The retained description of what was actually sampled, including label, target type, PID, process name, command line, and attach source.
- **Local Process Snapshot**: A process-list entry used by the picker, with PID, name, command summary, and runtime hints.
- **Collector Provenance**: The retained explanation of how a collector attached or degraded and what evidence it produced.
- **Evidence Bundle**: The set of artifacts, audit records, summaries, and analysis outputs tied to one task.
- **Comparison Record**: The retained summary of a comparison between two runs, including compatibility warnings and driver notes.
- **Validation Record**: The saved proof that a Linux attach workflow was run and classified as real, partial-real, fallback-only, or failed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create and launch a diagnosis task against a live Linux service process in under 1 minute from the main console.
- **SC-002**: 100% of completed tasks clearly show the real target identity or a visible reason why the attach could not stay real.
- **SC-003**: For every downgraded run, the task detail view shows both the downgrade reason and at least one surviving evidence surface.
- **SC-004**: Users can distinguish managed-workload runs from real-process runs without reading source code or server logs.
- **SC-005**: When two runs target the same live service process, the user can see whether they are fully comparable or only partially comparable within one investigation flow.
- **SC-006**: The Linux proof workflow can be rerun at least twice in the same environment without requiring hidden manual repair of task history or evidence directories.

## Assumptions

- Linux is the primary environment for this proof round.
- The real service process is started by the user locally on the same machine Mini-Drop is running on.
- Auto service discovery is intentionally out of scope for this round.
- `perf` and `py-spy` are expected to provide the strongest proof paths first, while `eBPF` and `async-profiler` remain transparent about host limitations.
- Evidence-only reasoning remains mandatory even when collector quality differs.
