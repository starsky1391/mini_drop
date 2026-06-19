# Mini-Drop Linux Collector Validation Summary

Date: 2026-06-16

## Scope

This round closed the Linux follow-up work for collector maturity alignment on an Ubuntu Server 24.04.4 LTS replay host.

For the reusable VM access path, remote repo location, and default restart commands, also see [linux-test-environment.md](/C:/1Project/project_web/drop/docs/linux-test-environment.md).

Validated focus areas:

- real Linux `py-spy`
- dedicated Linux `perf` attach proof
- stronger Linux `eBPF` raw-snapshot proof
- Linux state/index recovery for queued task replay and artifact lookup

## Environment

- Host: Ubuntu Server 24.04.4 LTS
- Access path: local VM over SSH
- API: `http://127.0.0.1:8787`
- Agent mode: independent Linux agent
- Privilege path: configured `sudo-password`

## Final Outcomes

### `py-spy`

Status: validated as real

Observed results:

- `smoke:create-task` completed with `sampleSource=python-stack-sampling:py-spy`
- `smoke:compare-trend` completed with real `py-spy` evidence across compare, trend, and artifact flows
- `smoke:continuous-profile` completed with real `py-spy` evidence and retained history slices

Notes:

- Ubuntu required a privileged execution path because direct `py-spy record --pid ...` hit Linux ptrace restrictions
- The Linux probe now reports `py-spy` as `preferred` and explains the privilege path clearly

### `perf`

Status: validated as real

Observed results:

- `smoke:perf-linux` completed with `sampleSource=native-stack-sampling:perf-script`
- retained artifacts included `perf.data`, `perf script output`, collapsed stacks, and collection-path provenance
- the Linux agent probe reported `perf` as `preferred`

Notes:

- `perf` used the configured Linux privileged path and completed through `perf record + perf script`

### `eBPF`

Status: validated as partial-real

Observed results:

- `smoke:ebpf-linux` completed with `sampleSource=kernel-aware-sampling:bpftrace-raw`
- raw `bpftrace` evidence was retained successfully
- improved parsing reduced fallback-shaped hotspot interpretation

Notes:

- this host now proves retained real raw evidence
- it does not yet prove the stronger end-state of fully normalized `real` eBPF hotspot interpretation

## Supporting Engineering Changes

- Linux `py-spy` command resolution now includes `~/.local/bin/py-spy`
- Linux `py-spy` execution can use the same controlled privileged path as `perf` and `eBPF`
- staged upload finalization now tolerates slight timing lag between agent upload and server-side analysis
- task state can now rehydrate from persisted task snapshots when `state.json` or task indexes are empty or stale
- `bpftrace` raw parsing now supports stronger inline/count-based snapshot shaping
- dedicated `smoke:perf-linux` coverage was added

## Verification Snapshot

Local validation after the final code changes:

- `npm run typecheck` passed
- `npm run test` passed (`61/61`)

Linux replay validation:

- `MINI_DROP_EXPECT_REAL_PYSPY=1 npm run smoke:create-task` passed
- `MINI_DROP_EXPECT_REAL_PYSPY=1 npm run smoke:compare-trend` passed
- `MINI_DROP_EXPECT_REAL_PYSPY=1 npm run smoke:continuous-profile` completed successfully after queued work resumed
- `npm run smoke:perf-linux` completed successfully with real `perf-script` evidence
- `npm run smoke:ebpf-linux` completed successfully with retained `bpftrace-raw` evidence

## Remaining Deferred Items

- stronger eBPF现场 proof with live anomaly injection and richer structured hotspot normalization
- Linux/JVM `async-profiler` proof at the same maturity level as `py-spy` and `perf`
- remote Linux agent orchestration beyond the local replay VM
