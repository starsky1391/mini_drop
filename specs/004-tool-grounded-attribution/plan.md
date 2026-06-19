# Implementation Plan: Tool-Grounded Smart Attribution

**Branch**: `[004-tool-grounded-attribution]` | **Date**: 2026-06-17 | **Spec**: [spec.md](C:\1Project\project_web\drop\specs\004-tool-grounded-attribution\spec.md)

**Input**: Feature specification from `/specs/004-tool-grounded-attribution/spec.md`

## Summary

Extend the current evidence-only reasoner so it can only reason through a curated tool registry. The model should consume structured flamegraph, collector metadata, artifact excerpts, and baseline context, invoke declared tools only, and persist a complete trace of accepted and rejected citations alongside the final attribution.

## Technical Context

**Language/Version**: TypeScript on Node.js 22.x for server and web UI

**Primary Dependencies**: Existing React, Vite, Express, shared type definitions, current reasoner pipeline, and local filesystem persistence

**Storage**: Local filesystem snapshots for task data, reasoner traces, artifacts, and validation records

**Testing**: Typecheck, unit/integration tests, build verification, and smoke coverage for grounded attribution and citation safety

**Target Platform**: Local web app in the current development environment; model access remains API-based when enabled

**Project Type**: Local diagnosis console with browser UI, HTTP API service, and persisted evidence snapshots

**Performance Goals**: Keep attribution runs interactive enough for diagnosis and keep trace rendering immediate after completion

**Constraints**: Single-user scope, evidence-only conclusions, no arbitrary tool execution, no uncited root-cause claims, preserve current compare/trend/history behavior

**Scale/Scope**: One operator, one task context at a time, with a small curated tool registry

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Preserve the current single-user local scope.
- Keep all conclusions traceable to evidence and tool outputs.
- Do not introduce a separate control plane or free-form agent action.
- Result: **PASS** for planning.

## Project Structure

### Documentation (this feature)

```text
specs/004-tool-grounded-attribution/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── reasoner-tool-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
server/
├── llm/
├── services/
├── routes/
└── storage/

shared/
└── shared type definitions and collector/reasoner catalog

src/
└── browser UI entry, task console, detail surfaces, and styling

tests/
└── automated validation for tool-grounded attribution, citations, and fallback behavior

scripts/
└── smoke checks for grounded attribution and degraded safety paths
```

**Structure Decision**: Keep the existing single-repo architecture and extend the current reasoner, storage, UI, and validation paths in place.

## Implementation Notes

1. Add a bounded tool registry that exposes only read-only evidence and validation helpers.
2. Structure reasoner input from flamegraphs, collector metadata, artifact excerpts, and baseline context before the model runs.
3. Persist the full tool trace so users can inspect how a conclusion was assembled.
4. Keep citation filtering strict: accepted citations must map to retained evidence or tool-returned facts.
5. Preserve safe fallback behavior when evidence is sparse or tool execution fails.
6. Reuse existing compare/trend data instead of inventing a separate history pipeline.

## Workstreams

### Workstream 1: Evidence Shaping

- Build structured attribution input from current task evidence
- Add tool registry and schema helpers
- Keep baseline context optional but first-class

### Workstream 2: Tool-Grounded Reasoning

- Execute only declared tools
- Persist tool invocation trace and validation results
- Reject unsupported or unverifiable citations

### Workstream 3: UI and Trace Review

- Show tool trace in task detail
- Distinguish verified claims from general summary text
- Expose rejected citations and fallback reasons clearly

### Workstream 4: Safety and Validation

- Add tests for unsupported tool requests and stale citations
- Add smoke coverage for grounded attribution and degraded fallback
- Record validation results in the quickstart guide

## Out of Scope for This Round

- Free-form model browsing
- New remote control plane
- Arbitrary internet access
- Autonomous remediation actions
- Replacing the existing task, compare, or trend system
