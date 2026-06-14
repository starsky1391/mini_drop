# Quickstart: Local Mini-Drop

## Goal

验证 Mini-Drop 当前这一轮已经具备本地可运行的交付闭环：独立 Agent、可审计任务状态机、连续剖析窗口、真实/partial/fallback 采集路径说明、火焰图查看、对比趋势分析，以及可重复的本地与 Docker 演示入口。

## Prerequisites

- Node.js 22.x
- 已安装项目依赖
- 可运行当前应用的本机环境
- 若要验证真实采集，需准备一个可安全采样的本机进程
- 若要验证 Linux-first 真实链路，建议在 Linux 主机或容器中运行
- Windows 主机上当前推荐以 `py-spy` 真实链路为主，`perf` / `eBPF` 会明确显示 fallback，`async-profiler` 依赖 JVM 与二进制可用性

## Setup

1. Install dependencies:

```powershell
npm install
```

如果当前 PowerShell 因执行策略拦截了 `npm.ps1`，请改用 `npm.cmd install`。下面所有 `npm run ...` 命令也都可以等价替换成 `npm.cmd run ...`。

2. Verify static quality gates:

```powershell
npm run typecheck
npm run test
npm run build
```

3. Start the local application:

```powershell
npm start
```

4. Start a local Agent in another terminal:

```powershell
$env:MINI_DROP_AGENT_ID = 'quickstart-agent'
$env:MINI_DROP_AGENT_LABEL = 'quickstart-agent'
$env:MINI_DROP_AGENT_BASE_URL = 'http://127.0.0.1:8787'
node dist/server/server/agent/index.js
```

5. Open the UI in a browser:

```text
http://localhost:8787/
```

主界面文案应以中文为主，`py-spy`、`perf`、`async-profiler`、`eBPF`、`MCP`、`PID` 等技术名词保持原文。

## Docker Demo

Linux / 容器环境可使用：

```powershell
docker compose up --build mini-drop-server mini-drop-agent
```

或：

```powershell
sh scripts/docker-demo.sh
```

当前开发环境已通过 `docker compose config` 语法校验；若本机 Docker daemon 未启动，则需要先启动 Docker Desktop / daemon 后再执行实际容器运行。

## Reasoner Configuration

默认建议先用安全本地模式完成回归；若要启用外部 API 适配层，可设置：

```powershell
$env:MINI_DROP_REASONER_MODE = 'external'
$env:MINI_DROP_REASONER_ENDPOINT = 'https://your-reasoner-endpoint'
$env:MINI_DROP_REASONER_API_KEY = 'optional-api-key'
$env:MINI_DROP_REASONER_MODEL = 'optional-model-name'
```

也可以直接准备 `config/local-ai-models.json`，或通过 `MINI_DROP_REASONER_CONFIG_PATH` 指向自定义配置文件。若外部 API 不可用、超时或返回非法 payload，Mini-Drop 会保留 evidence bundle 并输出安全 fallback 摘要，而不会伪造结论。

## Validation Scenarios

### Scenario 1: Launch and observe a diagnosis task

1. Open the main console.
2. Choose one target mode: logical target, manual PID, or process selection.
3. Fill in the logical target scope, language, collector, and scenario.
4. When using PID or process selection, confirm the retained process summary matches the intended sampled object.
5. Launch a diagnosis task.
6. Confirm the task appears in the task stream and reaches a visible lifecycle state.

**Expected outcome**:

- A new task is created and visible in the stream.
- The task shows its target mode, attach provenance, and retained process metadata when available.
- The task remains available in local history after completion or failure.

### Scenario 2: Inspect deeper task evidence

1. Open a completed or failed task from the task stream.
2. Review the task detail page.
3. Confirm the page shows summary, hotspot information, flame graph, readable location context, artifacts, and audit information when available.

**Expected outcome**:

- Evidence surfaces are visible from one detail view.
- Failed tasks still explain what evidence was retained and what went wrong.
- Hotspots expose the best available readable symbol or source context and clearly label any missing mapping.

### Scenario 3: Compare runs and review trend history

1. Ensure at least two comparable runs exist for the same target and scope.
2. Select a baseline from the task detail comparison area.
3. Review metric changes, hotspot movement, and history sequence.

**Expected outcome**:

- The comparison area shows a verdict and highlights what changed.
- The comparison area shows readable baseline/current hotspot locations, mapping state, and strongest driver evidence.
- The history area shows the run sequence, strongest recent driver, hotspot change cards, or clearly explains why no baseline exists.

### Scenario 4: Verify collector provenance and fallback visibility

1. Launch one run against a real PID or selected process and one run that falls back to the managed workload path.
2. Open the corresponding task detail pages.
3. Confirm the UI explains which process or managed target actually ran, what evidence was retained, and why the collector fidelity changed when applicable.

**Expected outcome**:

- Collector provenance remains visible for successful, partial, and fallback runs.
- The user can distinguish requested attach intent from the final attach path before trusting downstream analysis.
- The user can distinguish a preferred capture result from a reduced-fidelity result before trusting downstream analysis.

### Scenario 5: Verify evidence-grounded diagnostic output

1. Open the reasoner panel for a completed or failed run.
2. Review the summary and cited evidence.
3. Confirm that the narrative maps to visible metrics, hotspots, artifacts, logs, or audit records.

**Expected outcome**:

- The conclusion remains grounded in retained evidence.
- If model-backed reasoning is unavailable, the fallback mode still stays explainable and safe.

### Scenario 6: Repeat the local validation loop

1. Create at least two comparable runs for the same scope.
2. Inspect their artifacts and comparison output.
3. Restart the application and reopen the same runs.
4. Confirm the history, artifacts, audit trail, and comparison context remain usable.

**Expected outcome**:

- The normal local workflow remains stable across repeated create-and-review cycles.
- Restarting the app does not hide prior task summaries or retained evidence references.

## API Smoke Checks

With the app running, verify the main surfaces:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/tasks
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8787/api/processes
```

Create a sample task:

```powershell
$body = @{
  target = 'quickstart@local'
  targetType = 'label'
  language = 'Python'
  collector = 'py-spy'
  scenario = 'python_hot_loop'
} | ConvertTo-Json

Invoke-WebRequest -UseBasicParsing `
  -Method Post `
  -Uri http://127.0.0.1:8787/api/tasks `
  -ContentType 'application/json' `
  -Body $body
```

## Latest Validation Record

Validated locally on 2026-06-14 for the current Linux-demo-ready round with:

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
$env:PORT='8799'
$env:MINI_DROP_REASONER_MODE='stub'
npm.cmd run start
node dist/server/server/agent/index.js
$env:MINI_DROP_WAIT_MS='120000'
npm.cmd run smoke:api
npm.cmd run smoke:create-task
npm.cmd run smoke:process-target
$env:MINI_DROP_EXPECT_REASONER_FALLBACK='1'
npm.cmd run smoke:compare-trend
npm.cmd run smoke:continuous-profile
npm.cmd run validate:offline-agent
docker compose config
```

Observed results:

- `typecheck`、`test`、`build` 全部通过。
- `GET /api/health`、`/api/tasks`、`/api/processes` smoke 全部通过。
- 独立 Agent 在隔离端口 `8799` 上成功注册并持续出现在 `/api/agents` 列表中。
- `smoke:create-task` 成功创建任务；任务可被独立 Agent 领取并推进到终态。
- `smoke:process-target` 成功创建 PID 任务；在本机 Windows 环境中可稳定保留 PID / attach metadata，实际终态可能是 `DONE` 或 `FAILED`，但采样路径会明确显示为 `managed-fallback`，对应 fallback 原因也可审计、可见。
- `smoke:compare-trend` 成功返回 compare、trend、artifact preview、reasoner snapshot 与 continuous history 数据。
- `smoke:continuous-profile` 成功验证 task scope 与 history scope 的 slice 窗口。
- `validate:offline-agent` 成功验证 Agent stale -> offline -> heartbeat recovery 行为。
- `docker compose config` 成功；当前环境会额外输出读取 `C:\\Users\\COLORFUL\\.docker\\config.json` 的 access warning，但不影响 compose 配置静态校验结果。当前环境未实际执行 `docker compose up`，因为 daemon 不可用。
- 在当前 Windows PowerShell 环境中，直接执行 `npm run ...` 可能被 `npm.ps1` 执行策略拦截；改用 `npm.cmd run ...` 后可稳定完成整套验证。

Current status:

- 本地 API / Agent / Smoke / 回归验证完成。
- Docker 配置已完成静态校验，等待可用 daemon 环境做容器级实跑。

## Repeatable Validation Matrix

Re-run this matrix whenever compare/trend, persistence, artifact preview, or reasoner behavior changes:

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
$env:PORT='8799'
$env:MINI_DROP_REASONER_MODE='stub'
$env:MINI_DROP_WAIT_MS='120000'
npm.cmd run start
node dist/server/server/agent/index.js
npm.cmd run smoke:api
npm.cmd run smoke:create-task
npm.cmd run smoke:process-target
$env:MINI_DROP_EXPECT_REASONER_FALLBACK='1'
npm.cmd run smoke:compare-trend
npm.cmd run smoke:continuous-profile
npm.cmd run validate:offline-agent
docker compose config
```

And verify:

- 至少两次同 scope 运行可被 reopen，并能进入同一 compare / trend / continuous scope。
- PID attach、无效 PID、managed fallback 都可本地复现。
- Artifact preview、preview fallback、审计链与 reasoner snapshot 都可从任务详情流中检查。
- Agent 列表可见 online / offline / stale 恢复行为。
- Reasoner 输出即使在 stub / external fallback 模式下也保持 evidence-only。
- 若本机 Docker daemon 可用，应额外执行 `docker compose up --build mini-drop-server mini-drop-agent` 做容器级回放。

## References

- Spec: [spec.md](C:\1Project\project_web\drop\specs\001-local-mini-drop\spec.md)
- Data model: [data-model.md](C:\1Project\project_web\drop\specs\001-local-mini-drop\data-model.md)
- API contract: [http-api.yaml](C:\1Project\project_web\drop\specs\001-local-mini-drop\contracts\http-api.yaml)
