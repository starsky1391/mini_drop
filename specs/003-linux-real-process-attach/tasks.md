# Tasks: Linux Real Process Attach Proof

**Input**: Design documents from `/specs/003-linux-real-process-attach/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: This round explicitly requires Linux smoke validation, real-process regression coverage, and comparison safety checks because the scope is about proving an external live process attach path.

**Organization**: Tasks are grouped by user story so each proof slice can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no blocking dependency)
- **[Story]**: Which story the task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in every implementation task

## Path Conventions

- Server and orchestration code: `server/`
- Shared contracts and types: `shared/`
- Browser UI: `src/`
- Automated validation: `tests/`, `scripts/`
- Feature documentation: `specs/003-linux-real-process-attach/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Anchor the round around Linux real-process attach proof rather than the earlier managed-workload focus.

- [X] T001 [P] Refresh shared target context and attach-source vocabulary in `shared/types.ts` and `shared/catalog.ts`
- [X] T002 [P] Add the HTTP API contract for process listing and task creation in `specs/003-linux-real-process-attach/contracts/http-api.yaml`
- [X] T003 Update the Linux proof guide and known-limits notes in `specs/003-linux-real-process-attach/quickstart.md` and `README.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core process-discovery and provenance plumbing that all user stories depend on.

**⚠️ CRITICAL**: No user story work should be considered complete until this phase is done.

- [X] T004 Normalize real-process target context persistence in `server/services/task-service.ts`, `server/process-discovery.ts`, and `server/storage/repository.ts`
- [X] T005 [P] Strengthen Linux process discovery output in `server/process-discovery.ts` and `server/routes/process-routes.ts`
- [X] T006 [P] Add explicit attach provenance and downgrade classification in `server/analysis.ts`, `server/execution.ts`, `server/collectors/collection-path.ts`, and `server/notes.ts`

**Checkpoint**: The system can represent and persist a live Linux process target consistently before deeper UI and collector work begins.

---

## Phase 3: User Story 1 - Attach to a real Linux service process (Priority: P1) 🎯 MVP

**Goal**: Let the user start a Linux service, select it by PID or process picker, and see the task record the live process identity and attach source.

**Independent Test**: Start a local Linux service, select it in Mini-Drop, launch a task, and confirm the detail view shows PID, process name, command summary, attach source, and lifecycle state.

### Tests for User Story 1

- [X] T007 [P] [US1] Add regression coverage for PID/process selection and target-context persistence in `tests/run-tests.ts` and `tests/agent-integration.test.ts`
- [X] T008 [P] [US1] Add smoke coverage for Linux process selection and attach provenance in `scripts/smoke-create-task.mjs` and `scripts/smoke-compare-trend.mjs`

### Implementation for User Story 1

- [X] T009 [P] [US1] Update the process picker and PID entry flow in `src/App.tsx`, `src/ui-model.ts`, and `src/styles.css`
- [X] T010 [US1] Surface live target identity and attach source in task detail and history views in `src/App.tsx` and `src/ui-model.ts`

**Checkpoint**: Users can create and inspect a real-process diagnosis task on Linux with visible target identity and attach provenance.

---

## Phase 4: User Story 2 - Prove collector behavior against the external process (Priority: P2)

**Goal**: Show which collectors truly attached to the Linux service process and which ones degraded or fell back.

**Independent Test**: Run representative tasks against the same Linux service using different collectors and confirm real attach, partial-real, and fallback behavior is explicit.

### Tests for User Story 2

- [X] T011 [P] [US2] Add collector-path regression coverage for external Linux process attach in `tests/run-tests.ts`
- [X] T012 [P] [US2] Add dedicated Linux perf attach smoke in `scripts/smoke-perf-linux.mjs` and `scripts/smoke-create-task.mjs`

### Implementation for User Story 2

- [X] T013 [P] [US2] Improve perf external attach proof and retained provenance in `server/collectors/perf.ts` and `server/collectors/collection-path.ts`
- [X] T014 [P] [US2] Improve py-spy external attach proof and retained provenance in `server/collectors/pyspy.ts` and `server/collectors/collection-path.ts`
- [X] T015 [P] [US2] Keep eBPF and async-profiler transparent about Linux limits in `server/collectors/ebpf.ts`, `server/collectors/async-profiler.ts`, and `server/agent/probe.ts`
- [X] T016 [US2] Update task detail evidence chain and real-vs-fallback summaries in `src/App.tsx`, `src/flamegraph-utils.ts`, and `src/ui-model.ts`

**Checkpoint**: Collector output now makes external attach, partial-real capture, and fallback distinctions visible on Linux.

---

## Phase 5: User Story 3 - Repeat the Linux proof reliably (Priority: P3)

**Goal**: Make the Linux attach proof repeatable so the same workflow can be rerun and audited without guesswork.

**Independent Test**: Follow the Linux quickstart twice and confirm the proof still finds the service, launches the task, and records the same attach-provenance shape.

### Tests for User Story 3

- [X] T017 [P] [US3] Add repeatability coverage for process exit, permission denied, and PID reuse in `tests/run-tests.ts` and `tests/agent-integration.test.ts`
- [X] T018 [P] [US3] Add a full Linux proof smoke loop in `scripts/smoke-linux-real-process-attach.mjs`, `scripts/smoke-compare-trend.mjs`, and `scripts/smoke-continuous-profile.mjs`

### Implementation for User Story 3

- [X] T019 [P] [US3] Add comparison safety checks and history notes for process identity changes in `server/comparison.ts`, `server/trends.ts`, and `server/notes.ts`
- [X] T020 [US3] Finalize quickstart and README validation guidance for repeatable Linux real-process attach proof in `specs/003-linux-real-process-attach/quickstart.md` and `README.md`

**Checkpoint**: The Linux attach proof can be rerun and explained consistently.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finish the proof round with validation recording and cross-cutting cleanup.

- [X] T021 [P] Run and record `npm run typecheck`, `npm run test`, and `npm run build` in `specs/003-linux-real-process-attach/quickstart.md`
- [X] T022 [P] Run and record the Linux proof smoke matrix in `specs/003-linux-real-process-attach/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational; defines the MVP proof.
- **User Story 2 (Phase 4)**: Depends on Foundational and benefits from User Story 1 target-context stabilization.
- **User Story 3 (Phase 5)**: Depends on Foundational and benefits from User Story 1 and User Story 2 visibility work.
- **Polish (Phase 6)**: Depends on the desired user stories being implemented.

### User Story Dependencies

- **User Story 1 (P1)**: First delivery slice; no dependency on later stories.
- **User Story 2 (P2)**: Can proceed after Foundational, but works best once User Story 1 stabilizes the live target context.
- **User Story 3 (P3)**: Can proceed after Foundational, but benefits from User Story 1 and User Story 2 improvements.

### Within Each User Story

- Tests and smoke updates before or alongside implementation.
- Shared server process-context work before UI-only improvements.
- Collector provenance and attach reporting before comparison or trend presentation.
- Story validation before moving to the next priority.

### Parallel Opportunities

- `T001`, `T002`, and `T005` can run in parallel once the scope is fixed.
- `T007`, `T008`, and `T009` can run in parallel because they split across tests and UI surfaces.
- `T013`, `T014`, and `T015` can run in parallel because they focus on different collectors.
- `T017` and `T018` can run in parallel before `T019` integrates the comparison safety checks.

## Parallel Example: User Story 1

```text
T007 [US1] Add regression coverage for PID/process selection and target-context persistence in tests/run-tests.ts and tests/agent-integration.test.ts
T008 [US1] Add smoke coverage for Linux process selection and attach provenance in scripts/smoke-create-task.mjs and scripts/smoke-compare-trend.mjs
T009 [US1] Update the process picker and PID entry flow in src/App.tsx, src/ui-model.ts, and src/styles.css
```

## Parallel Example: User Story 2

```text
T013 [US2] Improve perf external attach proof and retained provenance in server/collectors/perf.ts and server/collectors/collection-path.ts
T014 [US2] Improve py-spy external attach proof and retained provenance in server/collectors/pyspy.ts and server/collectors/collection-path.ts
T015 [US2] Keep eBPF and async-profiler transparent about Linux limits in server/collectors/ebpf.ts, server/collectors/async-profiler.ts, and server/agent/probe.ts
```

## Parallel Example: User Story 3

```text
T017 [US3] Add repeatability coverage for process exit, permission denied, and PID reuse in tests/run-tests.ts and tests/agent-integration.test.ts
T018 [US3] Add a full Linux proof smoke loop in scripts/smoke-linux-real-process-attach.mjs, scripts/smoke-compare-trend.mjs, and scripts/smoke-continuous-profile.mjs
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Validate that the task detail view clearly shows the live Linux process identity and attach source.

### Incremental Delivery

1. Re-anchor docs and shared vocabulary around real-process attach proof.
2. Strengthen target-context persistence and process discovery.
3. Deliver visible Linux attach provenance for the main proof path.
4. Add collector-path transparency and fallback honesty.
5. Finish with repeatable Linux smoke and documentation.

### Parallel Team Strategy

With multiple contributors:

1. One lane handles shared target-context and process-discovery updates (`T001`-`T006`).
2. One lane handles Linux real-process selection and UI visibility (`T007`-`T010`).
3. One lane handles collector attach proof and provenance (`T011`-`T016`).
4. One lane handles repeatability, comparison safety, and docs (`T017`-`T022`).

## Notes

- Every task follows the required checklist format.
- Each user story remains independently testable and demoable.
- This task list intentionally focuses on Linux external process attach proof rather than redoing the managed-workload baseline.
