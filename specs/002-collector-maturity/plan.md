# Implementation Plan: Collector Maturity Alignment

**Branch**: `[002-collector-maturity]` | **Date**: 2026-06-15 | **Spec**: [spec.md](C:\1Project\project_web\drop\specs\002-collector-maturity\spec.md)

**Input**: Feature specification from `/specs/002-collector-maturity/spec.md`

## Summary

This round does not attempt to prove Linux eBPF collection live. Instead, it upgrades Mini-Drop’s collector layer from “`py-spy` is clearly strongest, others are uneven” to “multi-collector behavior is understandable, auditable, and repeatably validated.” The focus is collector maturity alignment: readiness modeling, provenance quality, artifact consistency, symbolization transparency, and a repeatable validation matrix.

## Technical Direction

1. Continue using the current Node.js + Express + React architecture without introducing new deployment surfaces.
2. Keep the current collector plugin interface and work inside `server/collectors/`, `server/analysis/`, `server/services/`, and the task detail UI rather than redesigning orchestration.
3. Separate collector maturity into explicit classes:
   - stable / preferred
   - partial-real
   - fallback-only
   - deferred-for-linux-proof
4. Improve launch-time readiness communication so the user understands collector suitability before execution, not only after inspecting artifacts.
5. Improve task-detail parity so each collector produces comparable provenance, artifact, and symbolization surfaces even when fidelity differs.
6. Expand regression and smoke coverage around collector-specific paths so a weaker collector cannot silently drift while `py-spy` still passes.

## Technical Context

**Language/Version**: TypeScript on Node.js 22.x for server and web UI

**Primary Dependencies**: React, Vite, Express, TypeScript, tsx, built-in Node test runner

**Storage**: Local filesystem-based task, artifact, audit, provenance, and continuous-profile persistence

**Testing**: Typecheck, automated tests, build verification, smoke scripts, collector-path validation, and documented local replay

**Target Platform**: Current active development host first, with explicit collector maturity labeling; Linux-only eBPF field proof is deferred

**Constraints**:

- No new remote Linux control plane in this round
- No claim of fully complete Linux eBPF现场 proof
- No weakening of evidence-only analysis guarantees
- Keep local single-user scope

## Constitution Check

- Stay inside local single-user scope.
- Preserve evidence-only conclusions.
- Prefer repeatable validation over implicit assumptions about collector fidelity.
- Result: **PASS**

## Implementation Notes

1. Extend shared collector vocabulary in `shared/types.ts` and `shared/catalog.ts` so maturity classes can express “deferred Linux proof” rather than only “fallback”.
2. Improve collector-specific readiness probes in:
   - `server/collectors/perf.ts`
   - `server/collectors/pyspy.ts`
   - `server/collectors/async-profiler.ts`
   - `server/collectors/ebpf.ts`
   - `server/agent/probe.ts`
3. Normalize provenance and retained artifact semantics in:
   - `server/collectors/collection-path.ts`
   - `server/artifact-preview.ts`
   - `server/storage/repository.ts`
   - `server/services/task-service.ts`
4. Improve collector-specific result readability in:
   - `server/analysis/normalize.ts`
   - `server/analysis/narrative.ts`
   - `server/collectors/profile-utils.ts`
5. Surface collector maturity more clearly in the UI:
   - launch flow collector readiness
   - task detail provenance and artifact quality
   - symbolization confidence and deferred-proof notes
6. Expand validation so collector maturity is part of the regression contract, not only an informal observation.

## Workstreams

### Workstream 1: Collector Readiness Model

- Add explicit maturity classes and host suitability notes
- Separate “fallback because broken” from “deferred because Linux proof is out of scope here”
- Make process-target compatibility more explicit per collector

### Workstream 2: Collector Provenance and Artifact Parity

- Improve retained artifact summaries for weaker collectors
- Ensure task detail surfaces are structurally consistent across collectors
- Keep partial evidence visible and auditable

### Workstream 3: Symbolization and Evidence Consistency

- Align hotspot readability across collectors
- Reduce ambiguity when mappings are partial or synthetic
- Ensure analysis text reflects evidence confidence instead of overclaiming

### Workstream 4: Validation Matrix

- Expand tests and smoke scripts so each collector path is classified
- Record stable / partial / fallback / deferred outcomes
- Keep the validation guide honest about what is and is not proven on the active host

## Out of Scope for This Round

- Linux现场 eBPF 异常注入与强证明
- Remote Linux VM orchestration
- New collector families beyond the current four
- Multi-user or remote control plane expansion
