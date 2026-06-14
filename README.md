# Mini-Drop

Mini-Drop 是内部生产版 Drop 的本地压缩复刻版本，当前聚焦单机单用户闭环，覆盖任务发起、独立 Agent 执行、采样产物落盘、火焰图查看、对比趋势分析和 evidence-only 诊断报告。

## 当前交付状态

- Web UI、API Service、本机独立 Agent、Collector 插件层、Analysis Engine、Storage、Reasoner 边界已经贯通。
- `perf`、`py-spy`、`async-profiler`、`eBPF` 都保留统一插件接口；当前 Windows 主机上 `py-spy` 是最稳定的真实链路，其他采集器会明确暴露平台限制与 fallback。
- 任务支持 `PENDING`、`RUNNING`、`UPLOADING`、`DONE`、`FAILED`，并保留审计记录、artifact 索引、continuous profiling slice 和 reasoner snapshot。

## 本地启动

```powershell
npm install
npm run typecheck
npm run test
npm run build
npm start
```

默认 UI 地址是 `http://127.0.0.1:8787/`。

如果当前 PowerShell 因执行策略拦截了 `npm.ps1`，可以直接改用 `npm.cmd`：

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
npm.cmd run start
```

如果要单独启动本机 Agent：

```powershell
$env:MINI_DROP_AGENT_ID='local-agent-1'
$env:MINI_DROP_AGENT_LABEL='local-agent'
$env:MINI_DROP_AGENT_BASE_URL='http://127.0.0.1:8787'
node dist/server/server/agent/index.js
```

## Docker / Demo

- `Dockerfile` 和 `docker-compose.yml` 已提供 `mini-drop-server` + `mini-drop-agent` 双服务启动形态。
- Linux 或容器环境可用 `scripts/bootstrap-demo.sh` 和 `scripts/docker-demo.sh` 做演示启动。
- 当前仓库所在环境里已通过 `docker compose config` 校验 compose 配置；若 Docker daemon 未启动，则无法在本机完成 `docker compose up` 实跑。

## Reasoner 配置

- 默认建议先用 `MINI_DROP_REASONER_MODE=stub` 跑本地闭环，确保 evidence-only 输出稳定。
- 若要接入外部 API，可直接提供环境变量，或在 `config/local-ai-models.json` 中放置 OpenAI-compatible 模型配置。
- 当前实现优先读取 `MINI_DROP_REASONER_CONFIG_PATH`，未设置时默认读取 `config/local-ai-models.json`。
- 即使外部 API 超时、响应不合法或引用了不存在的 evidence id，系统也会安全降级，不会输出不可验证归因。

## 验证命令

```powershell
npm run typecheck
npm run test
npm run build
npm run validate:offline-agent
```

常用 smoke：

```powershell
npm run smoke:api
npm run smoke:create-task
npm run smoke:process-target
$env:MINI_DROP_EXPECT_REASONER_FALLBACK='1'
npm run smoke:compare-trend
npm run smoke:continuous-profile
```

如果 PowerShell 环境无法直接执行 `npm run ...`，同样可以把上面的命令替换成 `npm.cmd run ...`。

更完整的验证矩阵、Linux 前置条件、采集器说明与 Agent 启动步骤见 [specs/001-local-mini-drop/quickstart.md](/C:/1Project/project_web/drop/specs/001-local-mini-drop/quickstart.md)。
