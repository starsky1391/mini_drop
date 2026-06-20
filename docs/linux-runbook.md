# Mini-Drop Linux Demo Runbook

这份文档只保留 Linux 演示真正需要的最短路径，目标是在一台干净 Linux 机器上，快速把 Mini-Drop 跑起来并完成一次真实采集演示。

## 目标

你最终需要完成这条闭环：

1. `git clone` 仓库
2. 启动 Mini-Drop
3. 启动内置 demo 目标
4. 在 Web UI 里对真实 PID 发起任务
5. 制造负载波动
6. 在页面中看到任务状态、火焰图、产物、对比趋势和诊断结果

## 前置要求

- Ubuntu 22.04+，推荐 Ubuntu 24.04
- Linux 5.8+，推荐 Linux 6.x
- Docker Engine
- `docker compose` plugin
- GNU Make
- `curl`

如果 `perf` / `bpftrace` 需要 `sudo`，先执行仓库自带的一键权限脚本：

```bash
bash scripts/setup-linux-collector-sudo.sh --user "$USER" --apply-sysctl
```

只预览即将写入的 sudoers 内容：

```bash
bash scripts/setup-linux-collector-sudo.sh --user "$USER" --print-only
```

如果要演示 eBPF，宿主机还需要允许：

- privileged container
- `pid: host`
- `CAP_BPF`
- `CAP_PERFMON`
- `SYS_ADMIN`
- `SYS_PTRACE`
- `apparmor:unconfined`
- `seccomp:unconfined`

## 标准启动

```bash
git clone https://github.com/starsky1391/mini_drop.git
cd mini_drop
docker compose up -d
make demo
```

如果宿主机 `8787` 端口不可用：

```bash
MINI_DROP_HOST_PORT=18787 docker compose up -d
MINI_DROP_HOST_PORT=18787 make demo
```

`make demo` 正常会打印：

- Mini-Drop UI 地址
- demo target 健康检查地址
- 真实目标 PID

## 打开页面

浏览器打开：

```text
http://127.0.0.1:<MINI_DROP_HOST_PORT or 8787>/
```

## 发起演示任务

推荐配置：

- Target type: `pid` 或 `process`
- PID: `make demo` 打印出的 PID
- Language: `Go`
- Collector: `eBPF`
- Scenario: `cpu_hot`

如果你要演示 Linux `perf`，把 Collector 改成 `perf` 即可。

## 制造波动

先做一次安静基线任务，然后再制造波动并发第二次任务。

服务负载：

```bash
make demo-load
```

IO 抖动：

```bash
make demo-io
```

调度抖动：

```bash
make demo-sched
```

推荐演示顺序：

1. 基线任务
2. `make demo-load`
3. 第二次任务
4. 如需强调 IO / 调度，再执行 `make demo-io` 或 `make demo-sched`
5. 展示 compare / trend / artifacts / audit / reasoner

## 重点展示什么

- 任务生命周期：`PENDING` -> `RUNNING` -> `UPLOADING` -> `DONE` / `FAILED`
- 真实目标 PID 和目标上下文
- 采集路径、`sampleSource`、fallback / partial-real / real
- 火焰图
- 热点函数
- artifacts
- 审计记录
- compare / trend
- evidence-only reasoner 输出

## 收尾

日常收尾：

```bash
make demo-down
```

全量清理：

```bash
docker compose -f docker-compose.yml -f docker-compose.ebpf-demo.yml down --rmi local -v --remove-orphans
docker builder prune -af
```

如果当前用户没有 Docker 权限：

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.ebpf-demo.yml down --rmi local -v --remove-orphans
sudo docker builder prune -af
```

## 常见问题

### `make demo` 很慢

第一次构建 `Dockerfile.ebpf-demo` 和 `demo/go-service/Dockerfile` 会比较慢，尤其是在首次拉镜像和安装依赖时。

### `perf` / `eBPF` fallback

优先检查：

1. 是否已经执行 `setup-linux-collector-sudo.sh`
2. `perf_event_paranoid` 是否过高
3. 宿主机是否允许 BPF / tracing
4. 任务详情里的 `collectionPathSummary`、`sampleSource`、artifact 和 audit 是否显示了具体失败原因

### 页面打开后报 `process is not defined`

通常是旧镜像或旧前端 bundle，重新构建即可：

```bash
docker compose up --build -d
```
