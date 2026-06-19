# Quickstart: Tool-Grounded Smart Attribution

## Prerequisites

- Existing Mini-Drop local environment is available.
- A completed task with flamegraph, collector metadata, and optional baseline context exists.
- Model access is configured through the current reasoner API settings, or `MINI_DROP_REASONER_MODE=stub` is used for local validation.

## 1. Start the app

```powershell
npm run dev
```

## 2. Prepare a task with evidence

1. Create or open a completed diagnosis task.
2. Make sure the task has flamegraph data, collector provenance, and at least one retained artifact.
3. If possible, select a second run as baseline so the attribution can compare change.

## 3. Inspect the grounded attribution output

Open the task detail view and confirm:

- The summary only references retained evidence.
- Each finding shows at least one valid citation.
- The tool trace shows what was called and what came back.
- Rejected citations are visible and explained.
- Baseline-aware observations are separated from single-run observations.

## 4. Validation commands

```powershell
npm run typecheck
npm run test
npm run build
```

Then run the grounded attribution smoke:

```powershell
npm run smoke:reasoner-tool-grounded
```

If you need a safe offline path:

```powershell
$env:MINI_DROP_REASONER_MODE='stub'
npm run smoke:reasoner-tool-grounded
```

If you need to validate the degraded path explicitly, start the server in `external` mode with a mock or intentionally constrained provider response, then run:

```powershell
$env:MINI_DROP_REASONER_EXPECT_DEGRADED='1'
npm run smoke:reasoner-tool-grounded -- --degraded
```

Expected degraded signals:

- `fallbackReason` is non-empty
- at least one tool invocation is `rejected` or `failed`
- all findings remain `context-only`
- unsupported or stale citations are filtered out instead of being published

## 5. Known limits

- If evidence is sparse, the system should still return a safe fallback explanation.
- If a tool is unavailable or times out, the trace should still preserve what happened before the failure.
- If a citation cannot be mapped back to evidence, it should be rejected rather than displayed as verified.

## 6. Validation Record

Track the following after implementation:

- `typecheck`, `test`, and `build` status
- grounded attribution smoke result
- whether citations were all traceable
- whether any tool invocation had to be downgraded

### Latest local validation

- `npm.cmd run typecheck` passed
- `npm.cmd run test` passed
- `npm.cmd run build` passed
- `npm.cmd run smoke:reasoner-tool-grounded` passed when the server was started in the same PowerShell session on `http://127.0.0.1:8799`
- degraded attribution regression paths are covered in `tests/run-tests.ts` and `tests/agent-integration.test.ts`

### Latest grounded smoke notes

- task id: `dd61a4d2-8b03-4ba8-8d9c-dcb327d1303a`
- mode: `disabled`
- available tools: `get_task_evidence_bundle`, `get_baseline_context`, `get_artifact_excerpt`, `validate_citations`
- tool trace count: `3`
- citations: `none`

This confirms the grounded snapshot contract is present even when the reasoner is disabled or safely downgraded.

### Degraded validation notes

- Unsupported tool requests are recorded as rejected tool invocations and do not escape the registry boundary.
- Unmapped or stale citations are retained only in `rejectedCitationDetails`, never as accepted findings.
- If the provider returns only sparse narrative without verified citations, the snapshot safely degrades to `context-only` findings plus an explicit `fallbackReason`.
