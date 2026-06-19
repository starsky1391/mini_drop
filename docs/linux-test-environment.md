# Mini-Drop Linux Test Environment

Date: 2026-06-17

## Purpose

This document records the currently validated Ubuntu VM environment for Mini-Drop Linux smoke runs, so future implementation rounds can reuse the same host directly instead of rediscovering SSH access, project paths, installed tools, and startup commands.

## Access

- Host type: local Ubuntu VM
- SSH entry:
  - `ssh -i C:\1Project\project_web\drop\.tmp\codex-linux-vm.key -p 2222 admin@127.0.0.1`
- Auth mode: dedicated temporary SSH key stored in the workspace
- Remote user: `admin`

## Remote Host

- OS: Ubuntu Server 24.04.4 LTS
- Kernel: `Linux ubuntu 6.8.0-124-generic`
- Node.js: `v22.22.3`
- npm: `10.9.8`
- Python: `3.12.3`

## Mini-Drop Project Location

- Remote repo path: `/home/admin/work/mini_drop`
- Remote branch observed during the latest validation: `main`
- Latest observed commit during the environment snapshot: `0b20554 feat(002-collector-maturity): implement collector maturity alignment`

## Installed / Observed Linux Tools

- `perf`: available at `/usr/bin/perf`
- `bpftrace`: previously validated on this VM in the Linux collector follow-up round
- `py-spy`: installed for the `admin` user in the Linux validation environment

Note:

- A later one-line tool probe only printed `perf` before exiting, but this VM has already been used successfully for `py-spy` and `bpftrace` proof flows in earlier validated runs and in the current attach-proof round.

## Reusable Startup Commands

From `/home/admin/work/mini_drop`:

```bash
./scripts/restart-linux-server.sh /home/admin/work/mini_drop admin123456
./scripts/restart-linux-agent.sh /home/admin/work/mini_drop admin123456
```

Expected logs:

- server: `/tmp/mini-drop-server.log`
- agent: `/tmp/mini-drop-agent.log`

Latest observed healthy startup lines:

- `Mini-Drop API listening on http://localhost:8787 (production)`
- `[mini-drop-agent] starting linux-agent (linux-agent-1) against http://127.0.0.1:8787`

## Reusable Real Target Process

For Linux real-process attach proof, a known-good target is:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

This target was used successfully in the latest `process-selection` / `PID attach` validation round.

## Reusable Validation Commands

From `/home/admin/work/mini_drop`:

```bash
npm run build
npm run smoke:perf-linux
npm run smoke:compare-trend
npm run smoke:continuous-profile
```

For real-process attach:

```bash
MINI_DROP_TARGET_PID=<pid> MINI_DROP_EXPECT_REAL_ATTACH=1 node scripts/smoke-linux-real-process-attach.mjs
```

## Latest Validated Results

### Linux Real-Process Attach Round

- `perf` proof passed as `real`
  - `sampleSource=native-stack-sampling:perf-script`
- `py-spy` real-process attach proof passed against a real `python3 -m http.server` PID
  - `targetType=process`
  - `attachSource=process-selection`
  - retained real `pid/name/commandSummary`
  - result class: `partial-real`
  - `sampleSource=python-stack-sampling:py-spy:partial`

### Prior Linux Collector Validation Round

See [linux-collector-validation-summary.md](/C:/1Project/project_web/drop/docs/linux-collector-validation-summary.md) for:

- real Linux `py-spy`
- real Linux `perf`
- partial-real Linux `eBPF`

## How Future Rounds Should Use This

When a future task asks for Linux validation or collector proof:

1. Reuse the SSH entry in this document directly.
2. Assume `/home/admin/work/mini_drop` is the default remote repo path.
3. Reuse `restart-linux-server.sh` and `restart-linux-agent.sh` before smoke runs.
4. Use the `python3 -m http.server 8000 --bind 127.0.0.1` target first unless the new round requires another workload.
5. Only re-check missing tools if a command actually fails.

This avoids repeating “should we install or prepare the Linux environment first?” when the same VM is being reused.
