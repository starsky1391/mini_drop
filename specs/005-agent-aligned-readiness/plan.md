# Implementation Plan: Agent-Aligned Readiness

**Branch**: `[005-agent-aligned-readiness]` | **Date**: 2026-06-20 | **Spec**: [spec.md](C:\1Project\project_web\drop\specs\005-agent-aligned-readiness\spec.md)

**Input**: Feature specification from `/specs/005-agent-aligned-readiness/spec.md`

## Summary

Fix two trust-breaking gaps in Mini-Drop’s local Linux demo flow: catalog readiness must reflect the actual registered Agent environment instead of server-local guesses, and perf partial-real outcomes must be reported as real artifact retention with partial normalization rather than broad fallback wording.

## Technical Context

**Language/Version**: TypeScript on Node.js 22.x for server and web UI

**Primary Dependencies**: Existing Express routes, task-service Agent registry, shared type definitions, collector assessment helpers, React task detail UI

**Storage**: Local filesystem snapshots for tasks, Agent state, artifacts, and audit data

**Testing**: `npm run typecheck`, `npm run test`, `npm run build`

**Target Platform**: Local Mini-Drop web app with Linux demo support and optional containerized Agent

**Project Type**: Local diagnosis console with browser UI, API service, and Agent-backed collectors

**Performance Goals**: Keep catalog loading and report generation interactive; no additional heavy background scans

**Constraints**: Single-user scope, agent-first truthfulness, additive API changes only, no control-plane redesign

**Scale/Scope**: One operator, a small number of local Agents, and one active readiness source exposed at a time

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Preserve the current single-user local scope.
- Improve traceability and truthfulness of collector reporting rather than introducing speculative automation.
- Keep compatibility with existing compare/trend/reasoner flows.
- Result: **PASS** for this round.

## Project Structure

### Documentation (this feature)

```text
specs/005-agent-aligned-readiness/
├── plan.md
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
server/
├── routes/
│   └── catalog-routes.ts
├── services/
│   └── task-service.ts
└── collectors/
    └── perf.ts

shared/
└── types.ts

tests/
└── run-tests.ts
```

**Structure Decision**: Reuse the existing server/service/collector split and make additive changes only, because this round is about correcting current semantics rather than introducing new subsystems.

## Implementation Notes

1. Move catalog readiness aggregation behind a service function that prefers online Agent snapshots.
2. Expose readiness-source metadata in the shared catalog payload so UI and audit text can stay explicit.
3. Adjust perf partial-real summaries and assessment notes so retained native artifacts are described as real evidence with degraded normalization.
4. Cover the new behavior with focused tests around readiness source selection and perf wording.

## Workstreams

### Workstream 1: Agent-Aligned Catalog Readiness

- Read current Agent snapshots from the task-service/store layer
- Prefer online Agent collector availability over server-local probes
- Fall back to server-local probes only when no Agent readiness exists

### Workstream 2: perf Partial-Real Reporting

- Update perf report summary wording
- Update collection-path notes for empty or partially normalized script output
- Preserve `partial-real` classification without overstating fallback

### Workstream 3: Validation

- Add regression tests for readiness-source selection
- Add regression tests for perf partial-real note wording
- Re-run typecheck, tests, and build

## Out of Scope for This Round

- Multi-Agent readiness arbitration or weighted merge logic
- PID discovery across container namespaces
- New collector capabilities
- Major UI redesign
- Remote deployment or control-plane changes
