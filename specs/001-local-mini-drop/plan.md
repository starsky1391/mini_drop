# Implementation Plan: Local Mini-Drop

**Branch**: `[001-local-mini-drop]` | **Date**: 2026-06-14 | **Spec**: [spec.md](C:\1Project\project_web\drop\specs\001-local-mini-drop\spec.md)

**Input**: Feature specification from `/specs/001-local-mini-drop/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Advance Mini-Drop from a working local compressed reproduction into a Linux-demo-ready diagnosis platform: preserve the completed UI, API, independent Agent, task state machine, flame-graph review, compare/trend analysis, and evidence-only reasoning flow, while strengthening real collector fidelity, external LLM integration boundaries, evidence readability, and repeatable startup and validation workflows.

## Next Round Focus

1. Promote Linux real collection from a supported path into the primary demo workflow, with clearer preferred, partial-real, and fallback semantics.
2. Make the independent Agent workflow more stable, more transparent, and easier to validate repeatedly in local and Linux-demo setups.
3. Improve evidence verification in task details so users can move from conclusion to artifacts, hotspots, comparisons, and audit records more directly.
4. Strengthen continuous profiling history windows, baseline selection, and trend review for repeated diagnosis runs.
5. Improve symbolization readability without introducing a separate production-grade symbol service.
6. Wire in a real external LLM API path while preserving strict evidence-only guardrails and safe fallback behavior.
7. Tighten startup, smoke, Docker, and quickstart paths so the system can be demoed and replayed more predictably.

## Technical Context

**Language/Version**: TypeScript for both server and web UI on Node.js 22.x

**Primary Dependencies**: React, Vite, Express, TypeScript, tsx, built-in Node test runner

**Reasoner Integration**: External API boundary with provider configuration, timeout handling, response schema validation, citation filtering, and a safe local fallback mode that stays evidence-only

**Storage**: Local file system storage for task metadata, task snapshots, artifact indexes, audit trails, reasoner snapshots, agent state, and continuous profile slices

**Testing**: TypeScript typecheck, Node-based automated tests, production build verification, smoke scripts for API and task workflows, offline-agent validation, and Docker compose config validation

**Target Platform**: Linux-first demo path, with local Windows development still supported and explicit collector fallback semantics preserved

**Project Type**: Local diagnosis console with browser UI, HTTP API service, independent local Agent process, collector plugin layer, and retained evidence storage

**Performance Goals**: Keep task creation, task detail loading, evidence navigation, and repeated validation cycles responsive enough for interactive diagnosis and demo replay

**Constraints**: Single-machine, single-user scope only; no multi-tenant auth; no remote multi-agent scheduler; no dedicated symbol service; no unverifiable model output; Docker replay may be documented even when the current environment cannot run a daemon

**Scale/Scope**: Dozens of local historical runs, a small set of collector plugins, one active operator, and enough retained evidence to support repeated review, comparison, trend analysis, and continuous-window playback

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- The current constitution file is still effectively a template, so it does not define stricter project-specific gates yet.
- This round keeps the provisional gates:
  - Stay within local single-user delivery scope.
  - Preserve evidence-only reasoning and traceable conclusions.
  - Maintain repeatable validation for build, API, Agent, collectors, and evidence review flows.
- Result: **PASS** for planning.

## Project Structure

### Documentation (this feature)

```text
specs/001-local-mini-drop/
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
└── shared catalog and type definitions

src/
└── browser UI entry, task console, detail surfaces, and styling

tests/
└── automated validation for collectors, agent flow, comparisons, trends, and profiling windows

data/
├── persisted state
├── retained artifacts
├── audits
├── indexes
└── reasoner snapshots
```

**Structure Decision**: Keep the current single-repo architecture and evolve it in place, with targeted improvements in collectors, analysis, Agent flow, evidence review, and validation scripts rather than restructuring the application.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Implementation Notes

1. Frontend continues to use the current Vite + React app without a large redesign; the focus is task detail evidence linkage, artifact verification, continuous-profile review, and Linux demo state communication.
2. Server continues to use the current Node.js + Express service and extends the existing `task`, `agent`, `artifact`, `audit`, `compare`, `trend`, `reasoner`, and `continuous-profile` surfaces rather than introducing a second orchestration layer.
3. Storage remains file-system-based, but this round strengthens data-root isolation, artifact indexing, reasoner snapshots, and retained slices so local validation and demo replay are more stable.
4. Collector plugins keep the current unified interface; `perf` and `py-spy` remain the main real-capture paths while `eBPF` and `async-profiler` improve platform probing, command readiness visibility, and transparent fallback reporting.
5. The independent Agent remains the current local-process shape and gets stronger registration, heartbeat, offline recovery, lease visibility, upload-state handling, and exception traces.
6. Analysis continues to use the current comparison, trend, normalization, and narrative layers, with this round emphasizing history-window clarity, stronger driver explanations, and better evidence alignment.
7. Symbolization continues as an enhancement inside the current normalization and narrative pipeline, prioritizing fewer unknown or synthetic placeholders and better module/file/line readability.
8. LLM integration remains behind an external API boundary and adds provider configuration precedence, timeout handling, schema validation, citation filtering, and failure-safe downgrade behavior.
9. Validation continues to center on `typecheck`, `test`, `build`, and smoke, while expanding explicit support for Linux demo replay, Docker config validation, Agent execution, and continuous-profile history review.

## Technical Direction

1. Frontend continues with the existing Vite + React stack and improves evidence linkage, artifact preview flow, continuous-profile review, and Linux-demo status communication in the task detail experience.
2. Server continues with the existing Node.js + Express stack and enriches Linux real-path reporting, error reasons, and demo-grade validation semantics on top of current diagnosis APIs.
3. Storage stays on the local file system and focuses on stronger data directory isolation, artifact indexes, reasoner snapshots, and retained continuous slices rather than introducing a database.
4. Collector plugins keep the shared interface and deepen `perf` / `py-spy` real-path stability while improving `eBPF` / `async-profiler` platform detection, command availability probing, and partial-real transparency.
5. Agent execution keeps the current independent local process shape and improves registration, heartbeat, offline recovery, leased-task clarity, upload transitions, and retained logs for Linux demos.
6. Analysis continues with the current comparison, trend, and narrative structure and focuses on more readable history windows, stronger hotspot movement explanation, and better evidence correlation.
7. Symbolization remains embedded in the current pipeline and prioritizes readability improvements over introducing a separate production-grade symbol service.
8. LLM reasoning continues through the external API boundary and adds model config ingestion, timeout handling, schema validation, citation filtering, and safe fallback output constraints.
9. Validation stays centered on `typecheck + test + build + smoke` and expands to Linux-demo scripts, Docker config validation, independent Agent replay, and continuous-profile history checks.

## Next Round Workstreams

1. Improve Linux demo stability and error reporting for `perf`, `py-spy`, `eBPF`, and `async-profiler`.
2. Connect a real external LLM API configuration path without weakening evidence-only guardrails.
3. Strengthen task detail artifact preview, evidence jumps, reasoner citation review, and continuous-profile history playback.
4. Improve symbolization readability and reduce `unknown` and `synthetic` placeholders in hotspot and trend explanations.
5. Increase Agent and data-directory isolation stability for local testing, repeated smoke runs, and demo replay.
6. Complete stronger quickstart and validation coverage across local, Linux-demo, and Docker-oriented workflows.
