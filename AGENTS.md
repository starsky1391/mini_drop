<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/005-agent-aligned-readiness/plan.md`
<!-- SPECKIT END -->

## Agent Context: Agent-Aligned Readiness (005-agent-aligned-readiness)

This round focuses on making Mini-Drop's collector readiness and perf partial-real reporting align with the real execution environment so diagnosis decisions stay trustworthy.

### Core Goal

- collector readiness 要优先反映已注册 Agent 的真实环境
- 没有可用 Agent 时，才明确回退到 server 本机 probe
- perf partial-real 必须表达“真实产物已保留 + 部分降级”
- 不再用误导性的 fallback 表述覆盖真实采样结果
- 继续保持现有 compare/trend/history/reasoner 能力不回退

### Scope Boundaries

- 仍然是单机单用户闭环
- 不做远端控制面、多租户或自动服务发现
- 不重做整个 Agent 调度架构
- 不在这一轮解决 Docker host PID namespace 的完整 attach 设计
- 不扩展新的 collector 能力，只修正现有可见口径

### Key Files

- `specs/005-agent-aligned-readiness/spec.md` - Feature scope and acceptance criteria
- `specs/005-agent-aligned-readiness/plan.md` - Implementation plan and workstreams
- `specs/005-agent-aligned-readiness/tasks.md` - Dependency-ordered execution tasks
- `server/routes/catalog-routes.ts` - Catalog payload generation and readiness exposure
- `server/services/task-service.ts` - Agent list loading and readiness source selection
- `server/collectors/perf.ts` - perf partial-real assessment and summary wording
- `shared/types.ts` - Shared catalog response shape
- `tests/run-tests.ts` - Regression coverage for readiness source and perf wording

### Validation

```bash
npm run typecheck
npm run test
npm run build
```
