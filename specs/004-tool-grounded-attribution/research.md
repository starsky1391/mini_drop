# Research: Tool-Grounded Smart Attribution

## Decision 1: Keep the existing reasoner boundary

- **Decision**: Extend the current reasoner pipeline instead of creating a separate service.
- **Rationale**: The repo already has snapshot persistence, citation filtering, and external API mode; a new service would duplicate the same lifecycle and make audit trails harder to follow.
- **Alternatives considered**: A separate attribution microservice; rejected because it would split evidence, tool trace, and task history across two systems.

## Decision 2: Use a curated read-only tool registry

- **Decision**: Limit the model to a small set of declared tools that only expose retained evidence, baseline context, artifact excerpts, and citation validation.
- **Rationale**: Tool restriction is the core safety boundary for verifiable attribution.
- **Alternatives considered**: Free-form retrieval and arbitrary tool execution; rejected because they weaken traceability and make hallucinations harder to audit.

## Decision 3: Persist tool trace with the reasoner snapshot

- **Decision**: Save each tool invocation, returned summary, and validation outcome alongside the final summary and findings.
- **Rationale**: Users need to inspect not just the answer, but the evidence path that produced it.
- **Alternatives considered**: Logging only to server logs; rejected because it is not visible in the product and is harder to reproduce.

## Decision 4: Preserve current citation filtering and fallback behavior

- **Decision**: Reuse the existing evidence-only guardrail and add tool-aware validation on top.
- **Rationale**: The current behavior already rejects unsafe citations; the new feature should strengthen that behavior, not replace it.
- **Alternatives considered**: Allowing model-authored citations first and filtering later; rejected because it increases risk of uncited claims surfacing.

## Decision 5: Keep baseline context optional but first-class

- **Decision**: Support attribution with or without a baseline, but make baseline-aware conclusions more explicit when available.
- **Rationale**: Users still need useful conclusions when there is no comparable baseline, yet baseline context improves attribution quality.
- **Alternatives considered**: Hard-requiring a baseline for every run; rejected because it would block useful single-run analysis.
