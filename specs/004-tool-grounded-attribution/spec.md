# Feature Specification: Tool-Grounded Smart Attribution

**Feature Branch**: `[004-tool-grounded-attribution]`

**Created**: 2026-06-17

**Status**: Draft

**Input**: User description: "智能归因：把火焰图、采集元数据、历史 baseline 结构化喂给 LLM，但 LLM 只能调用你定义的工具，产出可验证的归因结论。"

## Clarifications

### Session 2026-06-17

- Q: 这一轮是不是要重做一整套新的 reasoner？ → A: 不是，继续沿用当前 evidence-only reasoner、external API 接口和 citation 过滤边界，只补强成工具受限、trace 可审计的归因回路。
- Q: LLM 可以访问哪些信息？ → A: 只能访问任务内已保留的火焰图、collector 元数据、artifact 摘要、baseline 上下文和你显式定义的只读工具返回值。
- Q: 这一轮最重要的交付结果是什么？ → A: 让每条归因结论都能追溯到证据或工具返回值，并且在 UI 中直接看到工具调用轨迹、接受引用和拒绝引用。
- Q: 外部模型接入方式是否变化？ → A: 不变化，继续按 API 方式接入，但模型执行必须被工具白名单和 evidence-only guardrail 约束。

## Delivery Alignment Note

Mini-Drop 现阶段已经具备 evidence-only reasoner、external API 接入、citation 过滤、comparison/trend 上下文和 task-level snapshot。这个特性不是重做一套 reasoner，而是把 LLM 的可用信息收敛成受控工具集，并把每次工具调用、引用校验和最终结论一起保留下来，方便用户验证“为什么这么说”。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Generate grounded attribution (Priority: P1)

诊断人员在完成一次任务后，可以让系统基于火焰图、采集元数据和历史 baseline 生成可验证的归因结论；LLM 只能调用受限工具，不能直接编造根因或引用不存在的证据。

**Why this priority**: 这是智能归因的核心价值。如果不能保证结论可验证，这一特性就没有意义。

**Independent Test**: 对一个已完成任务触发归因流程，检查每条结论都能映射到保留证据或工具返回值，且没有无法追溯的断言。

**Acceptance Scenarios**:

1. **Given** 一个包含火焰图、热点、collector 元数据和 baseline 的完成任务，**When** 归因流程运行，**Then** 输出的摘要和结论都只引用已保留的证据。
2. **Given** LLM 尝试输出未被证据支持的根因，**When** 系统归一化结果，**Then** 这些断言会被拒绝、降级或标记为不可信，并记录原因。
3. **Given** 任务没有可用 baseline，**When** 归因流程运行，**Then** 系统仍然给出单次运行归因，但会明确说明 baseline 缺失。

---

### User Story 2 - Inspect the attribution trace (Priority: P2)

诊断人员可以查看 LLM 调用了哪些工具、工具拿到了什么证据、哪些引用被接受或拒绝，以及最终结论是如何拼出来的。

**Why this priority**: 只有把工具轨迹和引用校验展示出来，用户才可以真正核对“可验证”这件事。

**Independent Test**: 打开任务详情中的归因面板，检查工具调用轨迹、证据引用和拒绝引用都可见，并且能跳转回对应证据。

**Acceptance Scenarios**:

1. **Given** 一次归因已经完成，**When** 用户打开详情页，**Then** 可以看到工具调用顺序、输入输出摘要和校验结果。
2. **Given** 某条结论引用了证据，**When** 用户点击该引用，**Then** 页面可以跳转到对应证据位置。
3. **Given** 某些引用被过滤掉，**When** 用户查看归因面板，**Then** 系统会展示被拒绝的引用及其原因。

---

### User Story 3 - Fail safely when evidence is insufficient (Priority: P3)

当工具不可用、证据不足或 baseline 不可比较时，系统不会伪造结论，而是返回安全降级结果并保留完整 trace，便于后续复核。

**Why this priority**: 智能归因必须“宁可少说，也不能乱说”。

**Independent Test**: 模拟工具超时、证据稀疏或 baseline 缺失，确认系统仍返回安全结果，并明确说明限制。

**Acceptance Scenarios**:

1. **Given** 工具调用超时，**When** 归因流程结束，**Then** 系统保留已有 trace，并说明本次没有足够信息得出更强结论。
2. **Given** 模型请求了不在白名单里的工具，**When** 系统处理该请求，**Then** 该请求被拒绝且不会影响已保留证据。
3. **Given** 证据不足以支持明确归因，**When** 系统输出结果，**Then** 只返回安全摘要和限制说明，不返回未经验证的根因。

### Edge Cases

- 工具返回的 citation id 不在当前任务证据包内。
- baseline 存在，但与当前任务的比较上下文不兼容。
- 某条 evidence 只有局部信息，足以支持观察结论，但不足以支持根因判断。
- LLM 输出了多个互相冲突的解释。
- 归因流程中途切换了模型配置，但 trace 仍必须可追踪。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST build a structured attribution input from task flamegraph data, collector metadata, artifact excerpts, and baseline context before invoking the model.
- **FR-002**: System MUST constrain the model to a declared set of tools and MUST reject any request outside that set.
- **FR-003**: System MUST persist each tool invocation, including tool name, inputs, returned data summary, and validation result.
- **FR-004**: System MUST accept only citations that map to returned tool output or already retained evidence.
- **FR-005**: System MUST filter, reject, or downgrade unsupported, stale, or unverifiable citations.
- **FR-006**: System MUST distinguish verified claims from general narrative so that uncited statements are not presented as confirmed conclusions.
- **FR-007**: System MUST expose the attribution trace, accepted citations, rejected citations, and fallback reason in the task detail experience.
- **FR-008**: System MUST preserve enough trace and evidence to audit the attribution result after the fact.
- **FR-009**: System MUST return a safe degraded result when evidence is sparse, baseline is unavailable, or a tool fails.
- **FR-010**: System MUST keep compatibility with existing task history, compare, and trend features so prior diagnosis data remains usable.
- **FR-011**: System MUST clearly mark which statements are tool-backed and which are only contextual summaries.
- **FR-012**: System MUST prevent tool errors from producing uncited or unverifiable root-cause claims.

### Key Entities *(include if feature involves data)*

- **Attribution Session**: One reasoner run for a task, including its inputs, output, and tool trace.
- **Tool Registry**: The declared set of tools the model is allowed to call, together with each tool's contract.
- **Tool Invocation**: A single call to one tool, including parameters, returned payload, and validation outcome.
- **Verified Claim**: A conclusion supported by one or more retained evidence items or tool-returned facts.
- **Citation Map**: The mapping from model citations to evidence ids, tool outputs, or rejected citations.
- **Baseline Context**: The comparison context that helps the model judge change, regression, or stability.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of published findings in a grounded attribution run can be mapped to retained evidence or a tool-returned fact.
- **SC-002**: 100% of completed attribution sessions store a readable tool trace and citation validation result.
- **SC-003**: When the model proposes an unsupported citation or claim, the system rejects or downgrades it instead of presenting it as verified.
- **SC-004**: Users can inspect the complete attribution chain from task detail without consulting server logs.
- **SC-005**: If evidence is insufficient, the system always returns a safe fallback explanation instead of an uncited root cause.

## Assumptions

- The allowed tool set is small, curated, and read-only.
- External model access remains API-based, but the model cannot directly browse arbitrary data sources.
- Existing evidence-only guardrails stay in place and are strengthened rather than replaced.
- Baseline context may be absent; single-run attribution must still work.
- Tool outputs are persisted for later audit and review.
