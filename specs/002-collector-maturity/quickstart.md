# Collector Maturity Alignment - Quickstart

**Feature**: Collector Maturity Alignment  
**Branch**: `002-collector-maturity`  
**Date**: 2026-06-15

## Collector Maturity Matrix

This document describes the current maturity state of each collector on the active host.

### Current Platform

- **Platform**: Windows (development host)
- **Node.js**: 22.x
- **Architecture**: x64

### Collector Maturity States

| Collector | Expected Maturity | Readiness | Notes |
|-----------|-------------------|-----------|-------|
| **py-spy** | `stable` | `preferred` | 当前平台上最稳定的采集器。Python 解释器热点循环和异步等待诊断的首选。 |
| **async-profiler** | `partial` | `fallback-only` (Windows) | Windows 上部分支持；完整 JVM attach 需要非 Windows 平台。 |
| **perf** | `deferred` | `deferred-for-linux-proof` | 仅 Linux 支持；当前非 Linux 平台，perf 真实采集延期到后续 Linux 验证轮。 |
| **eBPF** | `deferred` | `deferred-for-linux-proof` | 仅 Linux 支持；当前非 Linux 平台，eBPF 真实采集延期到后续 Linux 验证轮。 |

### Maturity Classification

- **stable/preferred**: 采集器在当前平台上完全可用，可优先走真实采集路径。
- **partial/partial-real**: 可以保留部分真实采样证据，但仍存在平台、权限或解析层面的降级。
- **fallback/fallback-only**: 当前环境无法走首选真实链路，只能使用 managed workload 或 synthetic fallback。
- **deferred/deferred-for-linux-proof**: 该采集器需要 Linux 环境才能完成真实链路现场证明，当前平台暂不具备条件。

## Validation Commands

### Typecheck

```bash
npm run typecheck
```

### Tests

```bash
npm run test
```

### Build

```bash
npm run build
```

### Smoke Tests

```bash
# API health check
npm run smoke:api

# Create a task
npm run smoke:create-task

# Process target smoke
npm run smoke:process-target

# Compare trend smoke
npm run smoke:compare-trend

# Continuous profile smoke
npm run smoke:continuous-profile

# Validate offline agent
npm run validate:offline-agent
```

## Collector-Specific Validation

### py-spy (Stable)

```bash
# Verify py-spy is available
py-spy --version

# Create a Python task
node -e "
const base='http://127.0.0.1:8787';
fetch(base+'/api/tasks', {
  method: 'POST',
  headers: {'content-type':'application/json'},
  body: JSON.stringify({target:'test@local',language:'Python',collector:'py-spy',scenario:'python_hot_loop'})
}).then(r => r.json()).then(j => console.log(j.task?.id));
"
```

### async-profiler (Partial on Windows)

```bash
# On Windows: falls back to workload-derived evidence
# On Linux/macOS: attempts real JVM attach with asprof
```

### perf (Deferred on non-Linux)

```bash
# On Windows: marked as deferred-for-linux-proof
# On Linux: attempts perf record + perf script
```

### eBPF (Deferred on non-Linux)

```bash
# On Windows: marked as deferred-for-linux-proof
# On Linux: attempts bpftrace PID attach
```

## UI Verification

1. Open the launch flow (`http://localhost:5173`)
2. Inspect the collector readiness grid
3. Verify:
   - py-spy shows green "首选" badge
   - async-profiler shows amber/rose badge (platform-dependent)
   - perf shows purple "Linux 证明延期" badge on non-Linux
   - eBPF shows purple "Linux 证明延期" badge on non-Linux
4. Select each collector and verify maturity notes are visible

## Regression Coverage

The following test cases validate collector maturity:

- `probeAgentEnvironment defers perf and ebpf on non-linux platforms` — verifies `deferred-for-linux-proof` readiness
- `probeAgentEnvironment includes explicit command availability details for async-profiler` — verifies `fallback-only` when binary missing
- `assessPerfCollection distinguishes real captures from empty-script fallback paths` — verifies collection path assessment
- `assessPySpyCollection distinguishes retained speedscope output from placeholder fallback paths` — verifies py-spy assessment
- `assessAsyncProfilerCollection distinguishes real, partial-real, and fallback JVM capture paths` — verifies async-profiler assessment
- `assessEbpfCollection distinguishes raw-snapshot partial-real paths from fallback` — verifies eBPF assessment

## Deferred Linux Proof Items

The following items are explicitly deferred to a future Linux validation round:

1. **eBPF 现场真跑**: Linux 现场 eBPF 异常注入与强证明
2. **perf 真实链路**: Linux 上 perf record + perf script 的完整真实链路验证
3. **远程 Linux Agent**: 远程 Linux VM 编排

These items are marked as `deferred-for-linux-proof` in the codebase rather than falsely claiming completion.
