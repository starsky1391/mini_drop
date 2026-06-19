# Data Model: Tool-Grounded Smart Attribution

## Attribution Session

- **Purpose**: One grounded reasoner run for a task.
- **Key fields**: session id, task id, model mode, prompt context, tool trace, summary, findings, citations, rejected citations, fallback reason, generated at.
- **Relationships**: Belongs to one task and references many tool invocations.

## Tool Registry Entry

- **Purpose**: The declared tool contract the model may use.
- **Key fields**: tool name, purpose, allowed input shape, output shape, allowed evidence kinds, safety notes.
- **Relationships**: Used by one or more attribution sessions and enforced by validation.

## Tool Invocation

- **Purpose**: A single model-requested tool call.
- **Key fields**: invocation id, tool name, request payload, response summary, status, validation result, started at, ended at.
- **Relationships**: Belongs to one attribution session.

## Verified Claim

- **Purpose**: A conclusion that survived citation and evidence validation.
- **Key fields**: title, detail, support evidence ids, source tool invocations, confidence label, rejection note if downgraded.
- **Relationships**: Emerges from one attribution session and may be rendered in the UI.

## Citation Map

- **Purpose**: How citations from the model map to retained evidence.
- **Key fields**: citation id, acceptance state, mapped evidence id, rejection reason.
- **Relationships**: Belongs to one attribution session and supports trace inspection.

## Baseline Context

- **Purpose**: The comparison context that helps the model reason about change.
- **Key fields**: baseline task id, compatibility warnings, key metric deltas, hotspot shift summary, selected driver.
- **Relationships**: Read by attribution sessions when available.
