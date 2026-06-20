# Tasks: Agent-Aligned Readiness

**Input**: Design documents from `/specs/005-agent-aligned-readiness/`

**Prerequisites**: plan.md, spec.md

**Tests**: Include regression tests because this round fixes correctness and wording regressions.

**Organization**: Tasks are grouped by user story so readiness correctness and perf reporting can be delivered independently.

## Phase 1: Setup (Shared Context)

**Purpose**: Align the spec artifacts and shared payload surface for the fix round.

- [X] T001 Update active feature pointer and shared catalog response shape in `shared/types.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the server-side readiness aggregation path used by all catalog consumers.

- [X] T002 Implement agent-aware collector readiness loader in `server/services/task-service.ts`
- [X] T003 Route `/api/catalog` through the new readiness loader in `server/routes/catalog-routes.ts`

**Checkpoint**: Catalog can now distinguish Agent-sourced readiness from server-local fallback probing.

---

## Phase 3: User Story 1 - See the right collector environment (Priority: P1) 🎯 MVP

**Goal**: Catalog readiness reflects the real registered Agent environment when available.

**Independent Test**: Register an online Agent with collector snapshots and confirm catalog returns that source instead of server-local probe results.

### Tests for User Story 1

- [X] T004 [P] [US1] Add readiness source regression test in `tests/run-tests.ts`

### Implementation for User Story 1

- [X] T005 [US1] Add readiness source metadata to catalog payload in `server/routes/catalog-routes.ts`
- [X] T006 [US1] Keep fallback notes explicit when no Agent readiness exists in `server/services/task-service.ts`

**Checkpoint**: A reviewer can tell whether readiness came from Agent truth or server fallback.

---

## Phase 4: User Story 2 - Read partial-real perf reports correctly (Priority: P2)

**Goal**: perf partial-real runs are reported as real artifact retention with partial degradation, not broad fallback.

**Independent Test**: Simulate partial-real perf assessments and confirm report/notes no longer imply that no real collection happened.

### Tests for User Story 2

- [X] T007 [P] [US2] Add perf partial-real wording regression test in `tests/run-tests.ts`

### Implementation for User Story 2

- [X] T008 [US2] Update perf report summary wording in `server/collectors/perf.ts`
- [X] T009 [US2] Update perf partial-real assessment notes in `server/collectors/perf.ts`

**Checkpoint**: perf partial-real output now communicates “real + degraded” instead of “still fallback”.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validate the round and keep local docs in sync.

- [X] T010 [P] Preserve the browser-safe platform fix and Linux runbook changes in `shared/catalog.ts` and `docs/linux-runbook.md`
- [X] T011 Run regression validation in `tests/run-tests.ts` plus `npm run typecheck`, `npm run test`, and `npm run build`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup
- **User Story 1 (Phase 3)**: Depends on Foundational
- **User Story 2 (Phase 4)**: Depends on Foundational, but can proceed independently of US1 UI consumers
- **Polish (Phase 5)**: Depends on all desired story work

### Parallel Opportunities

- T004 and T007 can be written in parallel once the intended behavior is agreed.
- T008 and T009 can be completed together in the same collector file.
- T010 can be preserved independently while the main fix work is underway.

## Implementation Strategy

### MVP First

1. Complete T001-T003.
2. Complete T004-T006 and verify catalog truthfulness.
3. Stop and validate the readiness-source fix.

### Incremental Delivery

1. Ship agent-aligned catalog readiness first.
2. Then tighten perf partial-real wording.
3. Finish with regression validation and local docs preservation.
