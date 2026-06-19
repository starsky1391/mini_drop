# Tasks: Tool-Grounded Smart Attribution

**Input**: Design documents from `/specs/004-tool-grounded-attribution/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: This round explicitly requires validation of tool restrictions, citation safety, and degraded fallback behavior.

**Organization**: Tasks are grouped by user story so each slice can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Include exact file paths in every implementation task

## Path Conventions

- Server and orchestration code: `server/`
- Shared contracts and types: `shared/`
- Browser UI: `src/`
- Automated validation: `tests/`, `scripts/`
- Feature documentation: `specs/004-tool-grounded-attribution/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Anchor the new round around tool-grounded attribution rather than the earlier evidence-only summary behavior.

- [X] T001 [P] Create feature docs and contract scaffolding under `specs/004-tool-grounded-attribution/`
- [X] T002 [P] Update `.specify/feature.json` and `AGENTS.md` to point at `specs/004-tool-grounded-attribution/plan.md`
- [X] T003 [P] Extend shared reasoner and trace types in `shared/types.ts` and `server/llm/types.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core tool-registry and trace persistence plumbing that all user stories depend on.

**⚠️ CRITICAL**: No user story work should be considered complete until this phase is done.

- [X] T004 [P] Define the allowed reasoner tool registry and schema helpers in `server/llm/tool-registry.ts` and `server/llm/index.ts`
- [X] T005 [P] Persist tool invocation trace data in `server/storage/layout.ts` and `server/storage/repository.ts`
- [X] T006 [P] Add citation validation and evidence-map helpers in `server/llm/index.ts`

**Checkpoint**: The system can represent tool calls and citation checks before deeper UI and smoke work begins.

---

## Phase 3: User Story 1 - Generate grounded attribution (Priority: P1) 🎯 MVP

**Goal**: Let the reasoner consume structured evidence, invoke only declared tools, and produce verified findings with traceable citations.

**Independent Test**: Run grounded attribution on a completed task and confirm every published finding maps to retained evidence or tool-returned facts.

### Tests for User Story 1

- [X] T007 [P] [US1] Add regression coverage for grounded attribution input shaping and tool-restricted outputs in `tests/run-tests.ts`
- [X] T008 [P] [US1] Add smoke coverage for grounded attribution generation in `scripts/smoke-reasoner-tool-grounded.mjs`

### Implementation for User Story 1

- [X] T009 [P] [US1] Build structured attribution input from flamegraph, collector metadata, artifact excerpts, and baseline context in `server/services/task-service.ts` and `server/llm/index.ts`
- [X] T010 [US1] Implement bounded tool-call execution and verified finding generation in `server/llm/index.ts`

**Checkpoint**: The model can only reason through declared tools and the output remains evidence-backed.

---

## Phase 4: User Story 2 - Inspect the attribution trace (Priority: P2)

**Goal**: Make the tool trace, accepted citations, rejected citations, and evidence jumps visible in the task detail experience.

**Independent Test**: Open a finished task and verify the UI shows tool calls, citation validation results, and jump links back to evidence.

### Tests for User Story 2

- [X] T011 [P] [US2] Add API regression coverage for tool trace and citation validation fields in `tests/run-tests.ts`
- [X] T012 [P] [US2] Add UI smoke coverage for the attribution trace panel in `scripts/smoke-reasoner-tool-grounded.mjs`

### Implementation for User Story 2

- [X] T013 [P] [US2] Expose tool trace and citation validation data through `server/routes/task-routes.ts`, `server/services/task-service.ts`, and `shared/types.ts`
- [X] T014 [P] [US2] Render the trace, accepted citations, rejected citations, and evidence links in `src/App.tsx`, `src/ui-model.ts`, and `src/styles.css`
- [X] T015 [US2] Add evidence jump anchors for grounded findings in `src/App.tsx`

**Checkpoint**: Users can audit how each conclusion was assembled without opening logs.

---

## Phase 5: User Story 3 - Fail safely when evidence is insufficient (Priority: P3)

**Goal**: Preserve trace and explain limitations when tools fail, baseline is absent, or evidence is too sparse for a stronger conclusion.

**Independent Test**: Simulate unsupported tools, timeouts, or sparse evidence and confirm the system returns a safe fallback explanation instead of an uncited root cause.

### Tests for User Story 3

- [X] T016 [P] [US3] Add regression coverage for unsupported tools, stale citations, and sparse evidence in `tests/agent-integration.test.ts` and `tests/run-tests.ts`
- [X] T017 [P] [US3] Add degraded-attribution smoke coverage in `scripts/smoke-reasoner-tool-grounded.mjs`

### Implementation for User Story 3

- [X] T018 [US3] Harden external API adapter and fallback reporting in `server/llm/index.ts`
- [X] T019 [US3] Update quickstart with normal and degraded validation paths in `specs/004-tool-grounded-attribution/quickstart.md`

**Checkpoint**: The system remains safe even when tool execution or evidence quality is imperfect.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finish the round with recorded validation and cross-cutting cleanup.

- [X] T020 [P] Record `npm run typecheck`, `npm run test`, `npm run build`, and grounded attribution smoke results in `specs/004-tool-grounded-attribution/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational; defines the MVP proof.
- **User Story 2 (Phase 4)**: Depends on Foundational and benefits from User Story 1 stabilization.
- **User Story 3 (Phase 5)**: Depends on Foundational and benefits from User Story 1 and User Story 2 visibility.
- **Polish (Phase 6)**: Depends on the desired user stories being implemented.

### User Story Dependencies

- **User Story 1 (P1)**: First delivery slice; no dependency on later stories.
- **User Story 2 (P2)**: Can proceed after Foundational, but works best once User Story 1 stabilizes the grounded output shape.
- **User Story 3 (P3)**: Can proceed after Foundational, but benefits from User Story 1 and User Story 2 improvements.

### Within Each User Story

- Tests and smoke updates before or alongside implementation.
- Shared server reasoning work before UI-only improvements.
- Trace persistence before comparison or trend presentation.
- Story validation before moving to the next priority.

### Parallel Opportunities

- `T001`, `T002`, and `T003` can run in parallel once the scope is fixed.
- `T007`, `T008`, and `T009` can run in parallel because they split across tests, smoke, and input shaping.
- `T013`, `T014`, and `T015` can run in parallel because they focus on different surfaces.
- `T016` and `T017` can run in parallel before `T018` integrates the final fallback behavior.

## Parallel Example: User Story 1

```text
T007 [US1] Add regression coverage for grounded attribution input shaping and tool-restricted outputs in tests/run-tests.ts
T008 [US1] Add smoke coverage for grounded attribution generation in scripts/smoke-reasoner-tool-grounded.mjs
T009 [US1] Build structured attribution input from flamegraph, collector metadata, artifact excerpts, and baseline context in server/services/task-service.ts and server/llm/index.ts
```

## Parallel Example: User Story 2

```text
T013 [US2] Expose tool trace and citation validation data through server/routes/task-routes.ts, server/services/task-service.ts, and shared/types.ts
T014 [US2] Render the trace, accepted citations, rejected citations, and evidence links in src/App.tsx, src/ui-model.ts, and src/styles.css
T015 [US2] Add evidence jump anchors for grounded findings in src/App.tsx
```

## Parallel Example: User Story 3

```text
T016 [US3] Add regression coverage for unsupported tools, stale citations, and sparse evidence in tests/agent-integration.test.ts and tests/run-tests.ts
T017 [US3] Add degraded-attribution smoke coverage in scripts/smoke-reasoner-tool-grounded.mjs
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Validate that grounded attribution only emits verified conclusions.

### Incremental Delivery

1. Define the tool contract and trace persistence.
2. Produce grounded attribution from structured evidence.
3. Surface the trace and citation checks in the UI.
4. Harden safe fallback behavior for sparse evidence or tool failure.

### Parallel Team Strategy

With multiple contributors:

1. One lane handles shared tool types and persistence (`T001`-`T006`).
2. One lane handles grounded attribution generation (`T007`-`T010`).
3. One lane handles trace UI and evidence linking (`T011`-`T015`).
4. One lane handles safety, smoke coverage, and docs (`T016`-`T020`).

## Notes

- Every task follows the required checklist format.
- Each user story remains independently testable and demoable.
- This task list intentionally focuses on tool-grounded attribution rather than replacing the existing reasoner or compare/trend system.
