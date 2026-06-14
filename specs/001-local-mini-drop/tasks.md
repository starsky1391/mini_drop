# Tasks: Local Mini-Drop

**Input**: Design documents from `/specs/001-local-mini-drop/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: This round explicitly requires regression, smoke, Linux-demo validation, Agent abnormal-path coverage, and external LLM guardrail validation.

**Organization**: Tasks are grouped by user story so each story can be implemented, validated, and demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependency)
- **[Story]**: Which story the task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in every implementation task

## Path Conventions

- Server and orchestration code: `server/`
- Shared contracts and types: `shared/`
- Browser UI: `src/`
- Automated validation: `tests/`, `scripts/`
- Feature documentation: `specs/001-local-mini-drop/`
- Demo and packaging files: repo root plus `scripts/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Re-anchor the next round around the new Linux-demo-ready scope before implementation starts.

- [X] T001 Update `specs/001-local-mini-drop/spec.md`, `specs/001-local-mini-drop/plan.md`, and `specs/001-local-mini-drop/quickstart.md` so the new Linux-demo, external LLM, evidence-verification, and continuous-profile goals are reflected consistently
- [X] T002 [P] Refresh shared terminology and enums for Linux demo readiness, evidence verification, symbolization readability, and external reasoner status in `shared/types.ts` and `shared/catalog.ts`
- [X] T003 [P] Update `README.md`, `scripts/bootstrap-demo.sh`, and `scripts/docker-demo.sh` so local, Linux-demo, and Docker replay entry points match the new round scope

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that must be stable before user-story work can proceed safely.

**⚠️ CRITICAL**: No user story should be considered complete until this phase is done.

- [X] T004 Strengthen data-root isolation and retained-output layout in `server/storage/data-root.ts`, `server/storage/layout.ts`, `server/store.ts`, and `server/storage/repository.ts`
- [X] T005 [P] Harden Agent lifecycle state persistence and recovery semantics in `server/agent/index.ts`, `server/agent/run-registry.ts`, `server/agent/types.ts`, and `server/services/task-service.ts`
- [X] T006 [P] Normalize collector-path, upload-state, and retained-evidence status modeling in `server/execution.ts`, `server/analysis.ts`, `server/collectors/base.ts`, and `shared/types.ts`
- [X] T007 [P] Tighten regression isolation for local validation runs in `tests/setup-test-env.mjs`, `tests/run-tests.ts`, and `tests/agent-integration.test.ts`
- [X] T008 [P] Align round-level contracts and data model expectations in `specs/001-local-mini-drop/contracts/http-api.yaml` and `specs/001-local-mini-drop/data-model.md`

**Checkpoint**: Data isolation, Agent persistence, collector-path semantics, and validation scaffolding are ready.

---

## Phase 3: User Story 1 - Run a stable Linux-first diagnosis workflow (Priority: P1) 🎯 MVP

**Goal**: Make Linux-demo diagnosis credible by stabilizing real-process runs, collector-path reporting, Agent transitions, and retained target context.

**Independent Test**: Start server plus independent Agent, launch managed-workload and real-process tasks, and confirm the final task detail clearly shows target identity, collector path, platform limits, and auditable lifecycle transitions.

### Tests for User Story 1

- [X] T009 [P] [US1] Add Linux-demo and real-process execution coverage in `tests/run-tests.ts` and `tests/agent-integration.test.ts`
- [X] T010 [P] [US1] Extend smoke coverage for target context and collector-path visibility in `scripts/smoke-compare-trend.mjs` and `scripts/validate-offline-agent.mjs`

### Implementation for User Story 1

- [X] T011 [P] [US1] Strengthen real-process target handling and attach provenance in `server/process-discovery.ts`, `server/services/task-service.ts`, and `server/routes/process-routes.ts`
- [X] T012 [P] [US1] Improve Linux real-path stability and downgrade reporting for `perf` and `py-spy` in `server/collectors/perf.ts`, `server/collectors/pyspy.ts`, and `server/collectors/collection-path.ts`
- [X] T013 [P] [US1] Improve `eBPF` and `async-profiler` readiness, platform probing, and partial-real transparency in `server/collectors/ebpf.ts`, `server/collectors/async-profiler.ts`, and `server/agent/probe.ts`
- [X] T014 [US1] Refine Agent registration, heartbeat, stale detection, lease clarity, and upload transitions in `server/routes/agent-routes.ts`, `server/services/task-service.ts`, and `server/execution.ts`
- [X] T015 [US1] Update Linux-demo lifecycle and target-context surfaces in `src/App.tsx`, `src/styles.css`, and `src/ui-model.ts`

**Checkpoint**: Linux-first diagnosis runs and Agent lifecycle are stable and auditable enough for an MVP demo.

---

## Phase 4: User Story 2 - Verify evidence and artifacts more directly (Priority: P2)

**Goal**: Let users trace conclusions back to artifacts, metrics, hotspots, comparisons, and audit records more directly from the task detail flow.

**Independent Test**: Open a completed run and confirm artifact previews, evidence anchors, hotspot context, and reasoner support can all be cross-checked from one detail view.

### Tests for User Story 2

- [X] T016 [P] [US2] Add evidence-linkage and artifact-preview regression coverage in `tests/run-tests.ts`
- [X] T017 [P] [US2] Extend smoke verification for artifact preview and evidence-backed detail inspection in `scripts/smoke-compare-trend.mjs`

### Implementation for User Story 2

- [X] T018 [P] [US2] Improve artifact indexing, preview metadata, and retained evidence summaries in `server/artifact-preview.ts`, `server/storage/repository.ts`, and `server/services/task-service.ts`
- [X] T019 [P] [US2] Improve symbolization readability and hotspot explanation quality in `server/analysis/normalize.ts`, `server/analysis/narrative.ts`, and `server/collectors/profile-utils.ts`
- [X] T020 [P] [US2] Strengthen task detail evidence assembly and reasoner linkage in `server/comparison.ts`, `server/trends.ts`, and `server/llm/index.ts`
- [X] T021 [US2] Refine artifact preview, evidence jump points, hotspot readability, and audit/reasoner linking in `src/App.tsx`, `src/styles.css`, and `src/flamegraph-utils.ts`

**Checkpoint**: Task details support faster evidence verification and clearer hotspot/artifact review.

---

## Phase 5: User Story 3 - Review history and continuous profiling more reliably (Priority: P3)

**Goal**: Make repeated diagnosis runs easier to compare by improving baseline selection, trend narration, and continuous-profile history replay.

**Independent Test**: Produce at least two compatible runs plus continuous-profile slices for one logical target, then verify baseline selection, trend explanation, and slice history replay all work coherently.

### Tests for User Story 3

- [X] T022 [P] [US3] Add continuous-profile history-window and comparability regression coverage in `tests/run-tests.ts`
- [X] T023 [P] [US3] Extend smoke coverage for continuous-profile replay and trend history in `scripts/smoke-continuous-profile.mjs` and `scripts/smoke-compare-trend.mjs`

### Implementation for User Story 3

- [X] T024 [P] [US3] Strengthen continuous-profile slice retention and window loading in `server/profiling-slices.ts`, `server/storage/repository.ts`, and `server/routes/task-routes.ts`
- [X] T025 [P] [US3] Improve comparison compatibility warnings, history summaries, and driver explanations in `server/comparison.ts` and `server/trends.ts`
- [X] T026 [US3] Refine baseline selection, history replay, and continuous-profile presentation in `src/App.tsx`, `src/styles.css`, and `src/ui-model.ts`

**Checkpoint**: Repeated diagnosis workflows support clearer trend interpretation and more stable slice replay.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finish the Linux-demo-ready round with external LLM integration, validation, and documentation closure.

- [X] T027 [P] Connect real external LLM provider configuration, timeout handling, schema validation, and citation filtering in `server/llm/index.ts`, `server/llm/types.ts`, and `config/`
- [X] T028 [P] Add external reasoner configuration and guardrail validation coverage in `tests/run-tests.ts`
- [X] T029 [P] Update `README.md` and `specs/001-local-mini-drop/quickstart.md` with local, Linux-demo, and Docker replay instructions plus known environment limits
- [X] T030 [P] Run and record the full validation matrix in `specs/001-local-mini-drop/quickstart.md` after verifying `npm run typecheck`, `npm run test`, `npm run build`, `npm run smoke:api`, `npm run smoke:create-task`, `npm run smoke:process-target`, `npm run smoke:compare-trend`, `npm run smoke:continuous-profile`, `npm run validate:offline-agent`, and `docker compose config`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all story work.
- **User Story 1 (Phase 3)**: Depends on Foundational; defines the MVP for this round.
- **User Story 2 (Phase 4)**: Depends on Foundational and benefits from stable collector-path and Agent semantics.
- **User Story 3 (Phase 5)**: Depends on Foundational and benefits from stronger evidence and slice retention.
- **Polish (Phase 6)**: Depends on the desired user stories being implemented.

### User Story Dependencies

- **User Story 1 (P1)**: First delivery slice; no dependency on later stories.
- **User Story 2 (P2)**: Can proceed after Foundational, but works best once User Story 1 stabilizes target context and retained evidence paths.
- **User Story 3 (P3)**: Can proceed after Foundational, but benefits from User Story 1 and User Story 2 improvements to evidence retention and readability.

### Within Each User Story

- Tests and smoke updates before or alongside implementation.
- Collector and backend evidence changes before UI-only improvements.
- Data retention and comparability logic before trend and replay presentation.
- Story validation before moving to the next story’s polish.

### Parallel Opportunities

- `T004`, `T005`, `T006`, `T007`, and `T008` can run in parallel once the round scope is fixed.
- `T011`, `T012`, and `T013` can run in parallel because they cover separate target and collector layers.
- `T018`, `T019`, and `T020` can run in parallel because they split across artifact, symbolization, and evidence-assembly layers.
- `T024` and `T025` can run in parallel before `T026` integrates the UI presentation.
- `T027`, `T028`, `T029`, and `T030` can run in parallel once the core round behavior stabilizes.

---

## Parallel Example: User Story 1

```text
T011 [US1] Strengthen real-process target handling in server/process-discovery.ts and server/services/task-service.ts
T012 [US1] Improve perf and py-spy Linux real-path stability in server/collectors/perf.ts and server/collectors/pyspy.ts
T013 [US1] Improve eBPF and async-profiler readiness reporting in server/collectors/ebpf.ts and server/collectors/async-profiler.ts
```

## Parallel Example: User Story 2

```text
T018 [US2] Improve artifact indexing and preview metadata in server/artifact-preview.ts and server/storage/repository.ts
T019 [US2] Improve symbolization readability in server/analysis/normalize.ts and server/collectors/profile-utils.ts
T020 [US2] Strengthen evidence assembly in server/comparison.ts, server/trends.ts, and server/llm/index.ts
```

## Parallel Example: User Story 3

```text
T024 [US3] Strengthen continuous-profile slice retention in server/profiling-slices.ts and server/routes/task-routes.ts
T025 [US3] Improve comparison compatibility and history summaries in server/comparison.ts and server/trends.ts
T023 [US3] Extend smoke coverage for continuous-profile replay in scripts/smoke-continuous-profile.mjs
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Validate Linux-demo diagnosis flow, real-process target clarity, and Agent state transparency before moving deeper.

### Incremental Delivery

1. Re-anchor docs, shared vocabulary, and validation scope.
2. Strengthen foundational isolation, Agent state, and collector-path semantics.
3. Deliver Linux-first diagnosis stability and auditable target context.
4. Deliver stronger artifact/evidence verification and symbolization readability.
5. Deliver more reliable history replay, baseline review, and continuous profiling windows.
6. Finish with external LLM guardrails, docs, and full validation recording.

### Parallel Team Strategy

With multiple contributors:

1. One lane handles foundational isolation, Agent lifecycle, and contracts (`T004`-`T008`).
2. One lane handles Linux collector stability and target-context work (`T009`-`T015`).
3. One lane handles evidence review, symbolization, and UI detail flow (`T016`-`T021`).
4. One lane handles continuous profiling, trend replay, external LLM, and final validation (`T022`-`T030`).

---

## Notes

- Every task follows the required checklist format.
- Each user story remains independently testable and demoable.
- This task list intentionally replaces the previous completed round so the next `/speckit-implement` run operates on the new Linux-demo enhancement scope rather than the already-finished delivery-alignment round.
