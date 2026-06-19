# Reasoner Tool Contract

This contract defines the only tools the model may use when producing a grounded attribution result.

## Contract Rules

- Tools are read-only.
- Each tool must return data that can be persisted and audited.
- The model may not invent new tool names at runtime.
- Citations must map back to either a tool return value or already retained evidence.
- Any unsupported tool request must be rejected and recorded.

## Tool Inventory

| Tool | Purpose | Input | Output | Notes |
|------|---------|-------|--------|-------|
| `get_task_evidence_bundle` | Return the current task's retained evidence surfaces | Task id | Flamegraph, collector metadata, artifacts, audit summary | Primary evidence source |
| `get_baseline_context` | Return baseline comparison context | Task id + baseline id | Compatibility warnings, metric deltas, hotspot shift summary | Optional if baseline absent |
| `get_artifact_excerpt` | Return a short preview from a retained artifact | Artifact id | Preview text, truncation state, source path | Must stay within retained artifact boundary |
| `validate_citations` | Verify model citations against available evidence | Citation list + evidence bundle | Accepted citations, rejected citations, reasons | Final safety gate |

## Output Expectations

- Findings must include a support trail.
- Unsupported citations must be rejected or downgraded.
- If the evidence is insufficient, the response must explicitly say so.
- The final summary must never present an uncited root cause as verified.
