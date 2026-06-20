# Feature Specification: Agent-Aligned Readiness

**Feature Branch**: `[005-agent-aligned-readiness]`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "修复 collector readiness 显示错环境，以及修复 perf 报告里‘当前报告仍依赖 fallback’这种误导性表述；同时生成本轮的 specify、clarify、plan、task。"

## Clarifications

### Session 2026-06-20

- Q: 这一轮最核心的问题是采集器不可用，还是展示口径错误？ → A: 优先修复展示口径错误，让 UI 和报告先准确表达“实际在哪个环境探测、真实产物保留到了什么程度”。
- Q: readiness 应该以哪个环境为准？ → A: 优先以已注册并在线的 Agent 环境为准；只有没有可用 Agent 时，才回退到 server 本机探测。
- Q: perf partial-real 应该如何表达？ → A: 明确说明真实 perf 采样产物已经保留，但结构化热点或归一化仍有降级，而不是直接把整份报告说成 fallback。

## Delivery Alignment Note

本轮不是新加采集器功能，而是修正 Mini-Drop 当前最容易误导用户的两处表达：一处是 collector readiness 探测环境错位，另一处是 perf 的 partial-real 结果被过度描述成 fallback。目标是让 UI、审计和报告文本都更贴近真实执行情况。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the right collector environment (Priority: P1)

诊断人员查看任务发起页或 collector readiness 区域时，能够看到“当前可用性”到底来自已注册 Agent，还是来自 server 本机 fallback 探测，不会把容器内 server 环境误认为真实采样环境。

**Why this priority**: 如果 readiness 来源错了，用户会误判采集器是否可用，连任务发起前的判断都会失真。

**Independent Test**: 注册一个带 collector 能力的 Agent 后访问 catalog，确认 readiness 来源切换为 Agent；在没有可用 Agent 时，确认才回退到 server 本机 probe。

**Acceptance Scenarios**:

1. **Given** 系统中存在一个在线且已注册 collector 能力的 Agent，**When** 用户查看 catalog，**Then** readiness 以该 Agent 的 collector 状态为准，并清楚标识来源。
2. **Given** 当前没有可用 Agent，**When** 用户查看 catalog，**Then** 系统回退到 server 本机探测，并明确说明这是 fallback 探测来源。

---

### User Story 2 - Read partial-real perf reports correctly (Priority: P2)

诊断人员查看 perf 任务报告时，能够区分“完全 fallback”和“真实 perf 产物已保留但归一化不完整”的差异，不会因为文案误导而否定已经完成的真实采样。

**Why this priority**: 这直接影响 Linux 演示与 collector 成熟度判断，也是当前用户最困惑的点。

**Independent Test**: 构造 perf partial-real 结果，确认报告总结和 collection notes 明确表达“真实采样 + 部分降级”，而不是“仍依赖 fallback”。

**Acceptance Scenarios**:

1. **Given** perf record 完成且保留了 perf.data，但 perf script 未完全归一化，**When** 报告生成，**Then** 文案说明这是 partial-real，而不是纯 fallback。
2. **Given** perf script 产生了部分真实证据但未完整结构化，**When** 用户查看路径说明，**Then** 页面会提示保留了真实 artifact，建议结合离线产物复核。

### Edge Cases

- 存在多个 Agent 时，系统需要选择一个清晰的 readiness 来源，而不是混杂多个口径。
- Agent 在线但未上报 collector 列表时，不能误报为真实可用。
- perf real artifact 保留成功，但热点榜仍主要依赖 fallback shaping 时，必须继续标记为 partial-real。
- server 和 Agent 对同一 collector 的可用性不一致时，必须优先暴露实际执行环境的结论。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST compute collector readiness from a registered, online Agent when such an Agent has reported collector availability.
- **FR-002**: System MUST fall back to server-local collector probing only when no suitable Agent readiness snapshot is available.
- **FR-003**: System MUST expose whether collector readiness came from an Agent or from server-local fallback probing.
- **FR-004**: System MUST preserve the existing collector readiness detail fields so the UI can continue to explain support, availability, and readiness state.
- **FR-005**: System MUST distinguish perf partial-real outcomes from full fallback outcomes in report summaries and collection-path notes.
- **FR-006**: System MUST describe retained real perf artifacts as auditable evidence even when hotspot normalization is incomplete.
- **FR-007**: System MUST avoid language that implies “no real collection happened” when real perf artifacts were retained.
- **FR-008**: System MUST keep compatibility with existing task detail, audit, and artifact views while improving the wording and source labeling.

### Key Entities *(include if feature involves data)*

- **Collector Readiness Source**: The environment that produced the readiness snapshot, such as an online Agent or a server-local fallback probe.
- **Agent Readiness Snapshot**: The last reported collector availability set from a registered Agent.
- **Perf Partial-Real Outcome**: A task result where real perf artifacts were retained but structured normalization or hotspot shaping was incomplete.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When an online Agent with collector readiness is present, catalog responses always identify the Agent as the readiness source.
- **SC-002**: When no Agent readiness is available, catalog responses always identify the server fallback source instead of silently mixing contexts.
- **SC-003**: perf partial-real reports no longer describe retained real artifacts as pure fallback outcomes.
- **SC-004**: A reviewer can tell from UI payloads and saved report text whether a collector’s “not ready” state came from the real execution environment or a fallback probe.

## Assumptions

- A single online Agent readiness snapshot is sufficient for the current single-user local workflow.
- This round improves correctness of readiness and report wording, not multi-Agent scheduling or weighted selection.
- Existing UI can consume additive catalog fields without requiring a full redesign.
