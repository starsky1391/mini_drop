# Tasks: Collector Maturity Alignment

**Input**: Design documents from `/specs/002-collector-maturity/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: This round explicitly requires collector-focused regression coverage, smoke validation, and a documented maturity matrix because the scope is about closing gaps between collectors rather than adding only new UI surfaces.

**Organization**: Tasks are grouped by user story so each maturity improvement can be implemented, validated, and demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependency)
- **[Story]**: Which story the task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in every implementation task

## Path Conventions

- Server and collector orchestration: `server/`
- Shared contracts and maturity vocabulary: `shared/`
- Browser UI: `src/`
- Validation and smoke: `tests/`, `scripts/`
- Feature documentation: `specs/002-collector-maturity/`

---

## Phase 1: Setup

**Purpose**: Re-anchor the next execution round around collector maturity alignment instead of the already completed Linux-demo-ready general round.

- [X] T001 Update `specs/002-collector-maturity/spec.md`, `specs/002-collector-maturity/plan.md`, and `specs/002-collector-maturity/tasks.md` references in repo-facing docs such as `README.md` and `AGENTS.md`
- [X] T002 [P] Refresh shared collector maturity vocabulary in `shared/types.ts` and `shared/catalog.ts` so stable, partial, fallback, and deferred-for-linux-proof states are first-class concepts

---

## Phase 2: Foundational

**Purpose**: Build the maturity model and normalization hooks that all collector-specific improvements depend on.

**⚠️ CRITICAL**: No user story should be considered complete until this phase is done.

- [X] T003 Normalize collector maturity and deferred-proof modeling in `server/collectors/base.ts`, `server/collectors/types.ts`, `server/analysis/types.ts`, and `shared/types.ts`
- [X] T004 [P] Strengthen agent-side collector probe semantics in `server/agent/probe.ts`, `server/agent/types.ts`, and `server/routes/catalog-routes.ts`
- [X] T005 [P] Extend artifact/result-index storage for collector maturity summaries in `server/artifact-preview.ts`, `server/storage/repository.ts`, `server/storage/layout.ts`, and `server/services/task-service.ts`
- [X] T006 [P] Add regression helpers for collector-path assertions in `tests/run-tests.ts` and `tests/setup-test-env.mjs`

**Checkpoint**: The system can express collector maturity consistently before deeper collector and UI work begins.

---

## Phase 3: User Story 1 - Choose a collector with clearer trust signals (Priority: P1) 🎯 MVP

**Goal**: Make launch-time and run-time collector trust signals clearer so the user can understand which collectors are strong, weak, partial, or deferred on the current host.

**Independent Test**: Open the launch flow, inspect readiness information for all collectors, run tasks with more than one collector, and confirm task details accurately reflect the actual maturity/path semantics that were shown before launch.

### Tests for User Story 1

- [X] T007 [P] [US1] Add collector readiness and deferred-proof regression coverage in `tests/run-tests.ts`
- [X] T008 [P] [US1] Extend smoke coverage for launch-time readiness and collector-path visibility in `scripts/smoke-compare-trend.mjs`

### Implementation for User Story 1

- [X] T009 [P] [US1] Improve per-collector readiness classification and deferred-proof signaling in `server/collectors/perf.ts`, `server/collectors/pyspy.ts`, `server/collectors/async-profiler.ts`, `server/collectors/ebpf.ts`, and `server/agent/probe.ts`
- [X] T010 [P] [US1] Improve attach-fit and downgrade reasoning for process targets in `server/process-discovery.ts`, `server/services/task-service.ts`, and `server/collectors/collection-path.ts`
- [X] T011 [US1] Surface collector maturity, platform fit, and deferred-proof notes in `src/App.tsx`, `src/ui-model.ts`, and `src/styles.css`

**Checkpoint**: Users can choose collectors with clearer expectations and can verify post-run that those expectations matched reality.

---

## Phase 4: User Story 2 - Review collector-specific evidence more consistently (Priority: P2)

**Goal**: Make collector-specific artifacts, provenance, and symbolization feel consistent across collectors even when fidelity differs.

**Independent Test**: Run representative tasks across the supported collectors and confirm artifact panels, provenance cards, symbolization summaries, and partial-evidence handling feel structurally consistent.

### Tests for User Story 2

- [X] T012 [P] [US2] Add collector artifact parity and partial-evidence regression coverage in `tests/run-tests.ts`
- [X] T013 [P] [US2] Extend smoke coverage for artifact preview parity and collector-specific retained evidence in `scripts/smoke-compare-trend.mjs`

### Implementation for User Story 2

- [X] T014 [P] [US2] Improve collector artifact summaries and preview metadata consistency in `server/artifact-preview.ts`, `server/services/task-service.ts`, and `server/storage/repository.ts`
- [X] T015 [P] [US2] Improve collector-specific symbolization and hotspot confidence language in `server/analysis/normalize.ts`, `server/analysis/narrative.ts`, and `server/collectors/profile-utils.ts`
- [X] T016 [US2] Refine task-detail provenance, artifact parity, and partial-evidence presentation in `src/App.tsx`, `src/flamegraph-utils.ts`, and `src/styles.css`

**Checkpoint**: Switching between collectors no longer feels like switching between completely different product quality levels.

---

## Phase 5: User Story 3 - Validate collectors with a repeatable maturity matrix (Priority: P3)

**Goal**: Make collector maturity repeatable and explicit through tests, smoke scripts, and documentation rather than informal observation.

**Independent Test**: Run the documented collector-focused matrix and confirm the outputs classify stable, partial, fallback, and deferred collector states on the active host.

### Tests for User Story 3

- [X] T017 [P] [US3] Add collector-matrix regression coverage in `tests/run-tests.ts` and `tests/agent-integration.test.ts`
- [X] T018 [P] [US3] Extend smoke coverage for multi-collector classification in `scripts/smoke-compare-trend.mjs`, `scripts/smoke-continuous-profile.mjs`, and `scripts/validate-offline-agent.mjs`

### Implementation for User Story 3

- [X] T019 [P] [US3] Add collector maturity matrix summaries to server outputs in `server/routes/catalog-routes.ts`, `server/routes/task-routes.ts`, `server/services/task-service.ts`, and `server/notes.ts`
- [X] T020 [P] [US3] Improve validation record generation and deferred-proof documentation in `README.md` and `specs/002-collector-maturity/plan.md`
- [X] T021 [US3] Update `specs/002-collector-maturity/quickstart.md` with a collector maturity replay matrix that explicitly separates stable, partial, fallback-only, and Linux-deferred states

**Checkpoint**: Collector maturity can be re-verified repeatedly and communicated honestly to reviewers and future contributors.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finish the maturity-alignment round with full task closure and validation.

- [X] T022 [P] Re-run `npm.cmd run typecheck`, `npm.cmd run test`, and `npm.cmd run build`, then record results in `specs/002-collector-maturity/quickstart.md`
- [X] T023 [P] Run and record collector-focused smoke validation in `specs/002-collector-maturity/quickstart.md`, including `npm.cmd run smoke:api`, `npm.cmd run smoke:create-task`, `npm.cmd run smoke:process-target`, `npm.cmd run smoke:compare-trend`, `npm.cmd run smoke:continuous-profile`, and `npm.cmd run validate:offline-agent`

---

## Phase 7: Linux Real-Collector Follow-up

**Purpose**: Turn the remaining Linux collector gaps into explicit execution tasks instead of keeping them as feature-level goals.

- [X] T024 [P] Add real Linux `py-spy` validation in `scripts/smoke-create-task.mjs`, `scripts/smoke-compare-trend.mjs`, `scripts/smoke-continuous-profile.mjs`, `server/agent/probe.ts`, and `specs/002-collector-maturity/quickstart.md` so Ubuntu runs can detect installed `py-spy`, classify Python collection as real instead of fallback, and record the install / restart / revalidation flow for the Linux agent
- [X] T025 [P] Improve `eBPF` raw-snapshot parsing in `server/collectors/ebpf.ts`, `server/collectors/profile-utils.ts`, `server/analysis/normalize.ts`, `server/analysis/narrative.ts`, and `tests/run-tests.ts` so `bpftrace-raw` evidence produces stronger structured hotspots, reduces fallback-shaped ranking, and moves Linux `eBPF` runs closer to true real-sample interpretation
- [X] T026 [P] Add dedicated Linux `perf` attach proof in `scripts/smoke-perf-linux.mjs`, `package.json`, `server/collectors/perf.ts`, `server/agent/probe.ts`, and `specs/002-collector-maturity/quickstart.md` so native / Go / C++ profiling has a repeatable `smoke:perf-linux` path that verifies privileged attach, retained artifacts, and collector provenance on Ubuntu

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all story work.
- **User Story 1 (Phase 3)**: Depends on Foundational; defines the MVP for this round.
- **User Story 2 (Phase 4)**: Depends on Foundational and benefits from User Story 1 readiness/provenance alignment.
- **User Story 3 (Phase 5)**: Depends on Foundational and benefits from User Story 1 and User Story 2 parity work.
- **Polish (Phase 6)**: Depends on desired user stories being implemented.

### User Story Dependencies

- **User Story 1 (P1)**: First delivery slice; no dependency on later stories.
- **User Story 2 (P2)**: Can proceed after Foundational, but works best once readiness and downgrade semantics are clearer.
- **User Story 3 (P3)**: Can proceed after Foundational, but benefits from both readiness alignment and artifact/result parity.

### Within Each User Story

- Regression and smoke updates before or alongside implementation.
- Shared server maturity modeling before UI-only explanation work.
- Collector-specific provenance and artifact normalization before validation-matrix documentation.

### Parallel Opportunities

- `T003`, `T004`, `T005`, and `T006` can run in parallel once scope is fixed.
- `T009` and `T010` can run in parallel because they focus on collector readiness versus attach-fit reasoning.
- `T014` and `T015` can run in parallel before `T016` integrates them into the task-detail flow.
- `T019`, `T020`, and `T021` can run in parallel once the user-story behavior stabilizes.
- `T024`, `T025`, and `T026` can run in parallel because they target distinct Linux proof gaps.

---

## Parallel Example: User Story 1

```text
T009 [US1] Improve per-collector readiness classification in server/collectors/perf.ts, pyspy.ts, async-profiler.ts, ebpf.ts
T010 [US1] Improve attach-fit and downgrade reasoning in server/process-discovery.ts, server/services/task-service.ts, and server/collectors/collection-path.ts
T008 [US1] Extend smoke coverage for readiness and collector-path visibility in scripts/smoke-compare-trend.mjs
```

## Parallel Example: User Story 2

```text
T014 [US2] Improve collector artifact summaries in server/artifact-preview.ts, server/services/task-service.ts, and server/storage/repository.ts
T015 [US2] Improve symbolization and hotspot confidence language in server/analysis/normalize.ts, server/analysis/narrative.ts, and server/collectors/profile-utils.ts
T013 [US2] Extend smoke coverage for artifact preview parity in scripts/smoke-compare-trend.mjs
```

## Parallel Example: User Story 3

```text
T019 [US3] Add collector maturity matrix summaries to server outputs
T020 [US3] Improve validation record generation in README.md and specs/002-collector-maturity/plan.md
T021 [US3] Update specs/002-collector-maturity/quickstart.md with the collector maturity replay matrix
```

## Parallel Example: Linux Real-Collector Follow-up

```text
T024 Add real Linux py-spy validation and reclassification across smoke scripts, probe logic, and quickstart
T025 Improve eBPF raw-snapshot parsing and hotspot structuring across collector, analysis, and regression files
T026 Add a dedicated smoke:perf-linux proof path across scripts, package.json, probe logic, and quickstart
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Validate that users can understand collector maturity and downgrade semantics before and after launch.

### Incremental Delivery

1. Re-anchor docs and vocabulary around collector maturity alignment.
2. Strengthen foundational maturity modeling and storage/index semantics.
3. Deliver clearer readiness and downgrade trust signals.
4. Deliver collector-specific artifact and evidence parity.
5. Deliver a repeatable collector-focused validation matrix.
6. Finish with full validation recording.

### Parallel Team Strategy

With multiple contributors:

1. One lane handles shared maturity vocabulary, probe semantics, and storage/index updates (`T002`-`T006`).
2. One lane handles readiness classification and attach-fit semantics (`T007`-`T011`).
3. One lane handles artifact parity and symbolization consistency (`T012`-`T016`).
4. One lane handles validation matrix, docs, and replay guidance (`T017`-`T023`).
5. One lane handles Linux real-collector follow-up proof (`T024`-`T026`).

---

## Notes

- Tasks deliberately avoid re-implementing the already completed local Mini-Drop baseline.
- This round focuses on reducing collector maturity asymmetry and making deferred Linux proof explicit rather than pretending it is already complete.
- The remaining Linux follow-up tasks are intentionally phrased as execution work, not feature goals, so they can be assigned directly.
