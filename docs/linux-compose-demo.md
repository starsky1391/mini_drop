# Linux Compose Demo

This demo is the recommended review path for a clean Linux machine.

## Goal

Run Mini-Drop, a real attachable Go target process, and repeatable load generators from this repository with:

```bash
git clone https://github.com/starsky1391/mini_drop.git
cd mini_drop
docker compose up -d
make demo
```

The built-in target is `mini-drop-demo-target`, a small Go HTTP service with CPU and IO endpoints. It is intentionally included in this repository so the reviewer does not need to clone or trust a second project.

## Requirements

- OS: Ubuntu 22.04 or newer is recommended.
- Kernel: Linux 5.8+ is recommended for `CAP_BPF`; Linux 6.x is preferred.
- Docker: Docker Engine with the `docker compose` plugin.
- Make: GNU Make or a compatible `make`.
- Host tools: `curl` is used by the Makefile health checks.
- Permissions: eBPF demo mode uses a privileged agent container with `pid: host`, `CAP_BPF`, `CAP_PERFMON`, `SYS_ADMIN`, `SYS_PTRACE`, unconfined AppArmor, and unconfined seccomp.

## Start

```bash
git clone https://github.com/starsky1391/mini_drop.git
cd mini_drop
docker compose up -d
make demo
```

`make demo` starts the eBPF-capable compose overlay and prints the host PID for the demo Go service.

Open:

```text
http://127.0.0.1:8787/
```

Create a Mini-Drop task:

- Target type: `pid` or `process`
- PID: the PID printed by `make demo`
- Language: `Go`
- Collector: `eBPF`
- Scenario: `cpu_hot`

## Generate Load

Generate realistic service load against the demo Go service:

```bash
make demo-load
```

Generate raw IO jitter:

```bash
make demo-io
```

Generate scheduler jitter:

```bash
make demo-sched
```

## What To Show

- The Web UI shows the selected PID and target context.
- The task lifecycle moves through `PENDING`, `RUNNING`, `UPLOADING`, and `DONE` or `FAILED`.
- The eBPF task shows a `bpftrace` sample source when the host supports it.
- The flame graph, evidence chain, artifacts, audit log, trend view, and reasoner output are visible from the task detail tabs.
- While `make demo-load`, `make demo-io`, or `make demo-sched` runs, the collected distribution should visibly shift compared with the quieter baseline.

## Cleanup

```bash
make demo-down
```
