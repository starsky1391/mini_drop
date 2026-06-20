# Mini-Drop

Mini-Drop 是内部生产版 Drop 的本地压缩复刻版本，当前聚焦单机单用户闭环，覆盖任务发起、独立 Agent 执行、采样产物落盘、火焰图查看、对比趋势分析和 evidence-only 诊断报告。

## 当前交付状态

- Web UI、API Service、本机独立 Agent、Collector 插件层、Analysis Engine、Storage、Reasoner 边界已经贯通。
- `perf`、`py-spy`、`async-profiler`、`eBPF` 都保留统一插件接口；当前 Windows 主机上 `py-spy` 是最稳定的真实链路，其他采集器会明确暴露平台限制与 fallback。
- 任务支持 `PENDING`、`RUNNING`、`UPLOADING`、`DONE`、`FAILED`，并保留审计记录、artifact 索引、continuous profiling slice 和 reasoner snapshot。
- **Collector Maturity Alignment** (002-collector-maturity) 已完成：引入了 `deferred-for-linux-proof` 成熟度状态，UI 可清晰区分 stable / partial / fallback / deferred 四类采集器，并附带平台适配说明。

## 本地启动

```powershell
npm install
npm run typecheck
npm run test
npm run build
npm start
```

默认 UI 地址是 `http://127.0.0.1:8787/`。如果宿主机上的 `8787` 被占用或被系统保留，可以只改宿主机映射端口，不改容器内端口：

```powershell
$env:MINI_DROP_HOST_PORT='18787'
docker compose up -d
```

随后访问 `http://127.0.0.1:18787/`。

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
- 评审推荐路径是 `docker compose up -d` 后执行 `make demo`，它会使用 `docker-compose.ebpf-demo.yml` 启动一个内置 Go demo target，并打印可在 Mini-Drop Web UI 中选择的真实 PID。
- 当前仓库所在环境里已通过 `docker compose config` 校验 compose 配置；若 Docker daemon 未启动，则无法在本机完成 `docker compose up` 实跑。

### Linux eBPF Demo

在干净 Linux 机器上：

```bash
git clone https://github.com/starsky1391/mini_drop.git
cd mini_drop
docker compose up -d
make demo
```

`make demo` 会启动：

- `mini-drop-server`
- `mini-drop-agent`，使用 eBPF demo 权限和 `bpftrace` 工具镜像
- `mini-drop-demo-target`，仓库内置 Go HTTP 服务，带 CPU 和 IO 压力端点

默认打开 `http://127.0.0.1:8787/`。如果设置了 `MINI_DROP_HOST_PORT`，就改为访问对应端口，例如 `http://127.0.0.1:18787/`。然后使用 `make demo` 输出的 PID 创建任务：

- Target type: `pid` 或 `process`
- Language: `Go`
- Collector: `eBPF`
- Scenario: `cpu_hot`

制造波动：

```bash
make demo-load
make demo-io
make demo-sched
```

硬件 / 内核 / 权限要求：

- 推荐 Ubuntu 22.04+，Linux 5.8+；Linux 6.x 更稳。
- 需要 Docker Engine 和 `docker compose` plugin。
- 需要 GNU Make 或兼容 `make`。
- `make demo` 的 eBPF agent 使用 privileged container、`pid: host`、`CAP_BPF`、`CAP_PERFMON`、`SYS_ADMIN`、`SYS_PTRACE`、unconfined AppArmor 和 unconfined seccomp。
- 如果宿主机禁用 BPF、缺少 tracing/debugfs 挂载，或安全策略禁止 privileged container，eBPF 会降级并在任务详情中显示原因。

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
npm run smoke:linux-real-process-attach
$env:MINI_DROP_EXPECT_REASONER_FALLBACK='1'
npm run smoke:compare-trend
npm run smoke:continuous-profile
```

如果 PowerShell 环境无法直接执行 `npm run ...`，同样可以把上面的命令替换成 `npm.cmd run ...`。

如果你要做 Linux 真实服务进程 attach proof，推荐先启动一个本机长生命周期服务，例如：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

然后执行：

```bash
npm run smoke:linux-real-process-attach
```

可选环境变量：

- `MINI_DROP_TARGET_PID`: 指定要 attach 的真实 PID
- `MINI_DROP_TARGET_NAME`: 逻辑目标名，默认 `linux-real-process-smoke`
- `MINI_DROP_TARGET_LANGUAGE`: 目标语言，默认 `Python`
- `MINI_DROP_TARGET_COLLECTOR`: 采集器，默认 `py-spy`
- `MINI_DROP_TARGET_SCENARIO`: 诊断场景，默认 `python_hot_loop`
- `MINI_DROP_EXPECT_REAL_ATTACH=1`: 要求这次 proof 必须不是 fallback

更完整的验证矩阵、Linux 前置条件、采集器说明与 Agent 启动步骤见 [specs/003-linux-real-process-attach/quickstart.md](/C:/1Project/project_web/drop/specs/003-linux-real-process-attach/quickstart.md) 和 [specs/002-collector-maturity/quickstart.md](/C:/1Project/project_web/drop/specs/002-collector-maturity/quickstart.md)。
