# Implementation Plan: Linux Real Process Attach Proof

**Branch**: `[003-linux-real-process-attach]` | **Date**: 2026-06-17 | **Spec**: [spec.md](C:\1Project\project_web\drop\specs\003-linux-real-process-attach\spec.md)

**Input**: Feature specification from `/specs/003-linux-real-process-attach/spec.md`

## Summary

Prove Mini-Drop can diagnose a user-started Linux service process directly. This round keeps the existing local console, API, collector plugins, task history, and evidence-backed analysis, but makes the external-process path first-class: the user must be able to pick a live Linux PID or process, see the actual attach provenance, and understand whether the run stayed real, became partial-real, or fell back.

## Next Round Focus

1. Make live Linux service processes first-class diagnosis targets.
2. Surface attach provenance, process identity, and downgrade reasons clearly in the UI and persisted task data.
3. Prove real attach behavior for `perf` and `py-spy` first, while keeping `eBPF` and `async-profiler` transparent about host limits.
4. Tighten comparison and trend compatibility so cross-run analysis warns when process identity or attach source differs.
5. Add repeatable Linux smoke and quickstart steps that validate the attach proof end-to-end.

## Technical Context

**Language/Version**: TypeScript on Node.js 22.x for server and web UI

**Primary Dependencies**: React, Vite, Express, TypeScript, tsx, built-in Node test runner

**Storage**: Local filesystem-based task, artifact, audit, process-snapshot, and validation-record persistence

**Testing**: Typecheck, automated tests, build verification, Linux smoke scripts, and repeatable attach-proof validation

**Target Platform**: Linux-first proof path, with current local development still supported

**Project Type**: Local diagnosis console with browser UI, HTTP API service, independent local Agent process, collector plugin layer, and retained evidence storage

**Performance Goals**: Keep process discovery, task creation, task detail loading, and repeatable smoke validation responsive enough for interactive diagnosis

**Constraints**: Single-machine, single-user scope only; no multi-tenant auth; no remote control plane; no auto service discovery; no unverifiable model output

**Scale/Scope**: One operator, a small set of local Linux services, and enough retained evidence to support repeated review and comparison

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Stay within local single-user delivery scope.
- Preserve evidence-only reasoning and traceable conclusions.
- Keep the Linux proof honest about platform and permission limits.
- Result: **PASS** for planning.

## Project Structure

### Documentation (this feature)

```text
specs/003-linux-real-process-attach/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── http-api.yaml
└── tasks.md
```

### Source Code (repository root)

```text
server/
├── agent/
├── analysis/
├── collectors/
├── llm/
├── routes/
├── services/
└── storage/

shared/
└── shared type definitions and collector catalog

src/
└── browser UI entry, task console, detail surfaces, and styling

tests/
└── automated validation for process discovery, attach provenance, comparisons, and smoke workflows

scripts/
└── Linux smoke, process attach proof, and repeatability checks
```

**Structure Decision**: Keep the current single-repo architecture and extend the existing process discovery, collector, analysis, UI, and validation paths in place.

## Implementation Notes

1. Extend the current target model so real-process sampling is not only a UI option but a persisted diagnosis identity with attach provenance.
2. Improve process discovery so the picker exposes enough identity data to select the intended Linux service process confidently.
3. Keep collector plugins unified, but make external attach behavior, fallback behavior, and platform limits more visible for the user.
4. Treat comparison compatibility as part of the diagnosis contract so runs with different process identities or attach sources do not look equally comparable.
5. Add repeatable Linux smoke coverage that proves the path on a user-started service process, then record that proof in quickstart documentation.

## Workstreams

### Workstream 1: Real Process Target Model

- Make PID and process-picker inputs first-class persisted target context
- Preserve process name, command summary, and attach source
- Distinguish real-process tasks from managed-workload tasks in storage and UI

### Workstream 2: Collector Attach Proof

- Tighten `perf` and `py-spy` real-process attach reporting
- Keep `eBPF` and `async-profiler` transparent when they cannot fully attach
- Preserve collector provenance and downgrade reasons in task detail

### Workstream 3: UI and Evidence Review

- Show target identity and attach provenance clearly in task detail
- Surface real vs fallback collector state directly in the investigation flow
- Warn when comparison or trend review crosses incompatible target identities

### Workstream 4: Repeatable Linux Validation

- Add smoke scripts for Linux service attach proof
- Add regression coverage for process exit, permission denied, and PID reuse
- Document the repeatable demo path in quickstart and README

## Out of Scope for This Round

- Auto service discovery
- Remote Linux control plane
- Multi-user or tenant isolation
- New collector families beyond the current four
- Replacing the existing analysis and compare/trend system
