import { randomUUID } from 'node:crypto';
import type {
  ReasonerInput,
  ReasonerToolDefinition,
  ReasonerToolRegistryEntry,
  ReasonerToolResult,
} from './types.js';

export function buildReasonerToolRegistry(): ReasonerToolRegistryEntry[] {
  return [getTaskEvidenceBundle(), getBaselineContext(), getArtifactExcerpt(), validateCitations()];
}

export function buildReasonerToolDefinitions(): ReasonerToolDefinition[] {
  return buildReasonerToolRegistry().map(({ name, purpose, readOnly }) => ({ name, purpose, readOnly }));
}

function getTaskEvidenceBundle(): ReasonerToolRegistryEntry {
  return {
    name: 'get_task_evidence_bundle',
    purpose: 'Return the retained evidence bundle for the current task.',
    readOnly: true,
    invoke(input) {
      const invocation = buildInvocation('get_task_evidence_bundle', input, 'returned current evidence bundle');
      return {
        invocation,
        evidenceIds: input.evidence.map((item) => item.id),
      };
    },
  };
}

function getBaselineContext(): ReasonerToolRegistryEntry {
  return {
    name: 'get_baseline_context',
    purpose: 'Return baseline compatibility and change context when it exists.',
    readOnly: true,
    invoke(input) {
      const baselineEvidence = input.evidence.filter((item) => item.id === 'comparison-baseline' || item.id.startsWith('comparison-'));
      const invocation = buildInvocation(
        'get_baseline_context',
        input,
        baselineEvidence.length > 0 ? 'returned baseline comparison context' : 'no comparable baseline available',
      );
      return {
        invocation,
        evidenceIds: baselineEvidence.map((item) => item.id),
      };
    },
  };
}

function getArtifactExcerpt(): ReasonerToolRegistryEntry {
  return {
    name: 'get_artifact_excerpt',
    purpose: 'Return a short excerpt from a retained artifact.',
    readOnly: true,
    invoke(input, args = {}) {
      const artifactId = typeof args.artifactId === 'string' ? args.artifactId : null;
      const artifactEvidence = input.evidence.filter((item) => item.id.startsWith('artifact-'));
      const invocation = buildInvocation(
        'get_artifact_excerpt',
        input,
        artifactId ? `returned excerpt for ${artifactId}` : 'artifact excerpt requested without target id',
      );
      return {
        invocation,
        evidenceIds: artifactEvidence.map((item) => item.id),
      };
    },
  };
}

function validateCitations(): ReasonerToolRegistryEntry {
  return {
    name: 'validate_citations',
    purpose: 'Validate model citations against the current evidence bundle.',
    readOnly: true,
    invoke(input, args = {}) {
      const citations = Array.isArray(args.citations) ? args.citations.filter((item): item is string => typeof item === 'string') : [];
      const accepted = citations.filter((citation) => input.evidence.some((item) => item.id === citation));
      const invocation = buildInvocation(
        'validate_citations',
        input,
        `${accepted.length}/${citations.length} citations accepted`,
      );
      return {
        invocation,
        evidenceIds: accepted,
      };
    },
  };
}

function buildInvocation(tool: ReasonerToolRegistryEntry['name'], input: ReasonerInput, responseSummary: string): ReasonerToolResult['invocation'] {
  return {
    id: randomUUID(),
    tool,
    status: 'completed',
    requestSummary: `task=${input.taskId}`,
    responseSummary,
    evidenceIds: [],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: null,
  };
}
