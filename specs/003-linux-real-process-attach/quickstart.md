# Quickstart: Linux Real Process Attach Proof

## Prerequisites

- A Linux machine where you can start a local service process.
- Node.js 22.x and project dependencies installed.
- Access to `perf` and `py-spy` on the Linux host when you want the strongest proof paths.
- Optional: permissions needed for `perf` or other privileged attach modes, depending on host policy.

## 1. Start a real Linux service

Use any long-lived local service you control. A simple example is:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Record the PID and process name with:

```bash
ps -ef | grep http.server
```

## 2. Start Mini-Drop

```bash
npm run dev
```

If you prefer separate processes:

```bash
npm run dev:server
npm run dev:client
```

## 3. Launch a real-process task

1. Open the Mini-Drop UI.
2. Select `PID` or `进程选择`.
3. Pick the live Linux service you started.
4. Launch a task with `perf` or `py-spy` first, then compare other collectors.

## 4. What should be visible

- The task detail shows the real PID, process name, and command line summary.
- The attach source shows that the run came from a live Linux process path.
- Any downgrade shows a visible reason instead of silently hiding the limitation.
- Retained artifacts and audit records stay linked to the same live process context.

## 5. Validation commands

Run the local checks first:

```bash
npm run typecheck
npm run test
npm run build
```

Then run the Linux proof and smoke checks:

```bash
npm run smoke:create-task
npm run smoke:process-target
npm run smoke:linux-real-process-attach
npm run smoke:perf-linux
npm run smoke:compare-trend
npm run smoke:continuous-profile
```

If you want to pin the exact live process:

```bash
MINI_DROP_TARGET_PID=12345 MINI_DROP_EXPECT_REAL_ATTACH=1 npm run smoke:linux-real-process-attach
```

Useful overrides:

- `MINI_DROP_TARGET_PID`: force one exact PID
- `MINI_DROP_TARGET_NAME`: logical target label shown in history
- `MINI_DROP_TARGET_LANGUAGE`: language used in task creation
- `MINI_DROP_TARGET_COLLECTOR`: collector to prove, default `py-spy`
- `MINI_DROP_TARGET_SCENARIO`: scenario id used for the run
- `MINI_DROP_EXPECT_REAL_ATTACH=1`: fail the smoke if the run degrades into fallback

## 6. Known limits

- If the host lacks the needed attach permissions, the UI should explain the downgrade rather than pretending the attach was real.
- If the service exits before capture begins, the run should preserve the failure reason and whatever evidence survived.
- If a comparison crosses different process identities, the system should warn that the runs are only partially comparable.

## 7. Validation Record

### Local verification

- `npm run typecheck` passed
- `npm run test` passed
- `npm run build` passed

### Linux proof run on Ubuntu 24.04.4 LTS

- SSH access used a dedicated temporary key: `C:\1Project\project_web\drop\.tmp\codex-linux-vm.key`
- A real Linux service process was started with `python3 -m http.server 8000 --bind 127.0.0.1`
- `npm run smoke:perf-linux` passed with `sampleSource=native-stack-sampling:perf-script`
- `npm run smoke:linux-real-process-attach` passed with `sampleSource=python-stack-sampling:py-spy:partial`
- The real-process smoke retained live process metadata:
  - `targetType=process`
  - `attachSource=process-selection`
  - `processInfo.pid=2955`
  - `processInfo.name=python3`
  - `processInfo.commandSummary=python3 -m http.server 8000 --bind 127.0.0.1`

### Notes from the Linux proof

- `perf` reached `real` provenance on the Ubuntu host.
- `py-spy` attached to the live PID and retained real process metadata, but the run still reported `partial-real` because hotspot shaping keeps some fallback interpretation.
- The proof flow now distinguishes live process attach from managed workload fallback explicitly.
