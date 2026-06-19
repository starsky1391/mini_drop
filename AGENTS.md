<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/004-tool-grounded-attribution/plan.md`
<!-- SPECKIT END -->

## Agent Context: Tool-Grounded Smart Attribution (004-tool-grounded-attribution)

This round focuses on making Mini-Drop's reasoner tool-bounded and fully auditable so attribution conclusions stay verifiable.

### Core Goal

- LLM 只能调用预先定义的只读工具
- 每次归因都必须保留工具调用轨迹和引用校验结果
- 结论必须能映射回保留证据或工具返回值
- 不允许把未验证的断言当成确认根因
- 继续保留 evidence-only guardrail 和外部 API 接入边界

### Scope Boundaries

- 仍然是单机单用户闭环
- 不做远端控制面、多租户、自动服务发现
- 不做自由形式工具调用或任意网络抓取
- 不把模型输出伪装成已验证结论
- 继续保持现有 compare/trend/history 能力

### Key Files

- `specs/004-tool-grounded-attribution/spec.md` - Feature scope and acceptance criteria
- `specs/004-tool-grounded-attribution/plan.md` - Implementation plan and workstreams
- `specs/004-tool-grounded-attribution/tasks.md` - Dependency-ordered execution tasks
- `specs/004-tool-grounded-attribution/contracts/reasoner-tool-contract.md` - Tool registry and citation contract
- `server/llm/index.ts` - Reasoner input shaping, tool restriction, citation filtering, and fallback behavior
- `server/llm/types.ts` - Reasoner input/output and trace types
- `server/services/task-service.ts` - Task snapshot assembly and reasoner sidecar loading
- `shared/types.ts` - Shared task, evidence, and trace types
- `src/App.tsx` - Reasoner trace and citation visibility
- `src/ui-model.ts` - Detail-tab behavior for the attribution panel

### Validation

```bash
npm run typecheck
npm run test
npm run build
npm run smoke:reasoner-tool-grounded
npm run smoke:compare-trend
npm run smoke:continuous-profile
```
