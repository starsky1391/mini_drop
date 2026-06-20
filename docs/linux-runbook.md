# Mini-Drop Linux 跑通手册

这份文档是给你自己后续反复演示、排障、录屏用的 Linux 操作手册。目标不是解释架构，而是帮助你从一台 Linux 机器出发，尽快把 Mini-Drop 跑通，并完成一次真实采集演示。

## 1. 目标

你需要最终完成下面这条闭环：

1. 在 Linux 上启动 Mini-Drop。
2. 打开 Web UI。
3. 发起一次真实任务。
4. 让真实目标进程产生波动。
5. 在页面上看到任务状态、火焰图、产物、审计、趋势和归因结果。

当前推荐优先使用两条路径：

- 评审演示路径：`git clone && docker compose up -d && make demo`
- 当前 Ubuntu VM 复用路径：直接使用已经搭好的 VM 和 SSH 登录方式继续验证

## 2. 前置要求

推荐环境：

- Ubuntu 22.04+，更推荐 Ubuntu 24.04
- Linux 内核 5.8+，更推荐 6.x
- Docker Engine
- `docker compose` plugin
- `make`
- `curl`

如果你要演示 eBPF，宿主机还需要允许：

- privileged container
- `pid: host`
- `CAP_BPF`
- `CAP_PERFMON`
- `SYS_ADMIN`
- `SYS_PTRACE`
- `apparmor:unconfined`
- `seccomp:unconfined`

## 3. 路径 A：干净 Linux 机器上的标准评审流程

这是最贴近题目要求的流程。

### 3.1 克隆仓库

```bash
git clone https://github.com/starsky1391/mini_drop.git
cd mini_drop
```

### 3.2 启动基础服务

```bash
docker compose up -d
```

这一步会先起基础的：

- `mini-drop-server`
- `mini-drop-agent`

### 3.3 启动内置 demo 目标

```bash
make demo
```

这一步会继续起：

- `mini-drop-demo-target`

并打印：

- Mini-Drop UI 地址
- demo target 健康检查地址
- 需要在 Mini-Drop 中填写的真实 PID

正常情况下你会看到类似输出：

```text
Mini-Drop UI: http://127.0.0.1:8787/
Demo target: http://127.0.0.1:18080/health
Use this PID in Mini-Drop: <pid>
Recommended task: targetType=pid/process, language=Go, collector=eBPF, scenario=cpu_hot
```

如果宿主机上的 `8787` 被占用或被系统保留，可以只改宿主机端口，不改容器内服务端口：

```bash
MINI_DROP_HOST_PORT=18787 docker compose up -d
MINI_DROP_HOST_PORT=18787 make demo
```

PowerShell 写法：

```powershell
$env:MINI_DROP_HOST_PORT='18787'
docker compose up -d
make demo
```

### 3.4 打开页面

在 Linux 本机浏览器里打开对应宿主机端口：

```text
http://127.0.0.1:<MINI_DROP_HOST_PORT or 8787>/
```

### 3.5 创建任务

在 Web UI 中推荐使用：

- Target type: `pid` 或 `process`
- PID: `make demo` 打印出的 PID
- Language: `Go`
- Collector: `eBPF`
- Scenario: `cpu_hot`

### 3.6 制造波动

你可以在另一个终端里跑下面任意命令：

```bash
make demo-load
```

```bash
make demo-io
```

```bash
make demo-sched
```

建议演示顺序：

1. 先做一次安静基线任务
2. 再跑 `make demo-load`
3. 再发起第二次任务
4. 如需强调 IO / 调度变化，再跑 `make demo-io` 或 `make demo-sched`

### 3.7 演示时重点展示什么

页面里重点看这些：

- 任务生命周期：`PENDING` -> `RUNNING` -> `UPLOADING` -> `DONE` / `FAILED`
- 真实目标 PID 和目标上下文
- 采集路径和 `sampleSource`
- 火焰图
- 热点函数
- artifact 列表
- audit 记录
- compare / trend
- reasoner 输出
- tool trace 和 citation 过滤结果

### 3.8 收尾

```bash
make demo-down
```

### 3.9 全量清理

如果你要把这套 demo 相关资源尽量清干净，包括：

- `mini-drop-server`
- `mini-drop-agent`
- `mini-drop-demo-target`
- `demo-loadgen`
- `io-jitter`
- `sched-jitter`
- compose network
- volumes
- 当前项目本地构建镜像

可以执行：

```bash
docker compose -f docker-compose.yml -f docker-compose.ebpf-demo.yml down --rmi local -v --remove-orphans
docker builder prune -af
```

如果当前用户没有 Docker 权限，就改用：

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.ebpf-demo.yml down --rmi local -v --remove-orphans
sudo docker builder prune -af
```

如果你只是日常收尾，不想删 volume 和镜像，那么继续用：

```bash
make demo-down
```

## 4. 路径 B：复用当前 Ubuntu VM

这是你现在最方便继续调试和录屏的路径。

### 4.1 当前 VM 登录方式

Windows 里用：

```powershell
ssh -i C:\1Project\project_web\drop\.tmp\codex-linux-vm.key -p 2222 admin@127.0.0.1
```

说明：

- 这是你当前已经验证可用的 SSH 入口
- 这里用的是 SSH 公钥
- 不是账号密码登录

### 4.2 当前 VM 上的重要环境信息

当前机器大致是：

- Ubuntu Server 24.04.4 LTS
- Docker 29.x
- Docker Compose 2.40.x

仓库路径曾经有两套：

- 老路径：`/home/admin/work/mini_drop`
- 干净 clone 演示路径：`/home/admin/work/mini_drop_compose_demo_20260619170424`

后续如果你要模拟评审机，优先用干净 clone 路径。

### 4.3 在 VM 上跑 compose demo

进入仓库：

```bash
cd /home/admin/work/mini_drop_compose_demo_20260619170424
```

先起基础服务：

```bash
docker compose up -d
```

再起完整 demo：

```bash
make demo
```

### 4.4 检查容器状态

```bash
docker compose -f docker-compose.yml -f docker-compose.ebpf-demo.yml ps
```

你应该看到至少这些服务：

- `mini-drop-server`
- `mini-drop-agent`
- `mini-drop-demo-target`

### 4.5 检查健康

```bash
curl http://127.0.0.1:<MINI_DROP_HOST_PORT or 8787>/api/health
```

```bash
curl http://127.0.0.1:18080/health
```

## 5. 页面打不开时怎么办

如果 Linux 容器已经起来，但你在 Windows 浏览器里打不开，通常原因不是应用没启动，而是“你访问不到 Linux 里当前映射出来的宿主机端口”。

优先级建议如下：

### 方案 1：直接在 Linux 图形桌面里打开

这是最适合演示的方式。

如果你已经装了图形桌面，就在 Linux 浏览器里直接打开当前映射端口：

```text
http://127.0.0.1:<MINI_DROP_HOST_PORT or 8787>/
```

### 方案 2：Windows 通过 RDP 远程进 Linux 桌面

如果你装了 `xrdp`，可以用 Windows 远程桌面连接 Linux。

Linux 侧检查：

```bash
systemctl status xrdp --no-pager
```

Windows 侧需要把宿主机端口转发到来宾机 `3389`，然后用远程桌面连：

```text
127.0.0.1:3390
```

### 方案 3：做 SSH 端口转发

如果你只想临时看页面，也可以做本地端口转发。

示例：

```powershell
ssh -i C:\1Project\project_web\drop\.tmp\codex-linux-vm.key -p 2222 -N -L 8787:127.0.0.1:<MINI_DROP_HOST_PORT or 8787> admin@127.0.0.1
```

然后在 Windows 浏览器打开：

```text
http://127.0.0.1:8787/
```

## 6. 真实演示时怎么发任务

### 6.1 eBPF 演示

推荐配置：

- Target type: `pid` / `process`
- Language: `Go`
- Collector: `eBPF`
- Scenario: `cpu_hot`

目标 PID 用 `make demo` 打印出来的那个。

### 6.2 py-spy 演示

如果你想演示 Python attach，可以先起一个真实 Python 进程：

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

然后拿这个 PID 去发任务。

### 6.3 perf 演示

如果你要做 Linux `perf` proof，可以在真实服务 PID 上发起：

- Collector: `perf`
- Language: `Go` 或 `C++`

然后再结合压力命令做对比。

## 7. 常用验证命令

### 7.1 本地验证

```bash
npm run build
npm run smoke:compare-trend
npm run smoke:continuous-profile
```

### 7.2 Linux 真实 attach 验证

```bash
npm run smoke:linux-real-process-attach
```

如果你要指定 PID：

```bash
MINI_DROP_TARGET_PID=<pid> MINI_DROP_EXPECT_REAL_ATTACH=1 node scripts/smoke-linux-real-process-attach.mjs
```

### 7.3 grounded reasoner 验证

```bash
npm run smoke:reasoner-tool-grounded
```

## 8. 常见问题

### 8.1 `docker compose up` 成功了，但 `make demo` 很慢

第一次构建 `Dockerfile.ebpf-demo` 和 `demo/go-service/Dockerfile` 时会比较慢，尤其是：

- `apt-get update`
- `apt-get install`
- 第一次拉基础镜像

这不一定是失败，很多时候只是网络慢。

### 8.1.1 浏览器打开页面后报 `process is not defined`

这通常不是 Linux、Docker 或浏览器本身的问题，而是前端 bundle 把只该在 Node 里使用的 `process.platform` 或 `process.env` 带进了浏览器端代码。

如果你在演示机上看到：

```text
Uncaught ReferenceError: process is not defined
```

优先处理方式：

1. 确认你拿到的是最新仓库代码。
2. 重新构建镜像或重新执行 `docker compose up --build -d`。
3. 再刷新浏览器。

这一轮里已经修复过一处实际问题：共享前端/后端都引用的 catalog 文件里，不能直接在浏览器端读取 `process.platform`。

### 8.2 Linux 里 eBPF 没有 real，而是 fallback 或 partial-real

先看任务详情里的：

- `sampleSource`
- `collectionPathSummary`
- provenance
- audit

通常原因是：

- BPF 权限不够
- tracing/debugfs 没挂好
- 宿主机安全策略拦截
- 当前链路只拿到了 raw snapshot

### 8.3 Windows 浏览器打不开 Linux 页面

优先检查：

1. Linux 容器是否健康
2. 你是不是直接访问了 Linux 内部 `127.0.0.1`
3. 有没有做 SSH 转发或 RDP 桌面访问

### 8.4 图形界面输入没反应

这通常不是 Mini-Drop 问题，而是：

- VM 没抓到键盘
- 登录 greeter 卡住
- `xrdp` / `lightdm` 会话问题

这类问题建议和 Mini-Drop 运行流程分开处理。

## 9. 最推荐的实战顺序

如果你是为了最终演示或录屏，建议直接按这个顺序：

1. 在 Linux 上 `git clone` 最新仓库
2. `docker compose up -d`
3. `make demo`
4. 在 Linux 桌面浏览器打开对应宿主机端口，例如 `http://127.0.0.1:8787/` 或 `http://127.0.0.1:18787/`
5. 用 `make demo` 打印的 PID 发一次基线任务
6. 跑 `make demo-load`
7. 再发第二次任务
8. 展示 compare / trend / artifact / audit / grounded reasoner
9. 如需强调 IO / 调度，再跑 `make demo-io` 或 `make demo-sched`

## 10. 你当前最该记住的命令

SSH 登录 VM：

```powershell
ssh -i C:\1Project\project_web\drop\.tmp\codex-linux-vm.key -p 2222 admin@127.0.0.1
```

标准演示启动：

```bash
git clone https://github.com/starsky1391/mini_drop.git
cd mini_drop
docker compose up -d
make demo
```

制造波动：

```bash
make demo-load
make demo-io
make demo-sched
```

收尾：

```bash
make demo-down
```
