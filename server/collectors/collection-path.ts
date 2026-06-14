import { summarizeArtifactRetention } from './runtime-utils.js';

export interface CollectionPathDecision {
  collector: string;
  mode: 'real' | 'partial-real' | 'fallback';
  command: string | null;
  reason: string;
  sourceKind: string;
  rawSignal: string;
  expectedArtifacts: string[];
  notes?: string[];
}

type SessionLike = {
  log(phase: 'prepare' | 'capture' | 'normalize' | 'fallback' | 'complete', message: string): void;
  writeJsonArtifact(kind: 'report', suffix: string, content: unknown, label: string): Promise<string>;
  listArtifacts(): Array<{ kind: string; label: string; path: string }>;
};

export function buildCollectionPathSummary(
  decision: CollectionPathDecision,
  retention?: { retained: string[]; matched: string[]; missing: string[] },
) {
  const commandText = decision.command ? ` command=${decision.command}` : '';
  const modeText =
    decision.mode === 'real'
      ? 'real'
      : decision.mode === 'partial-real'
        ? 'partial-real'
        : 'fallback';
  const retentionText = retention
    ? ` retained=${retention.retained.length}/${decision.expectedArtifacts.length} matched=${retention.matched.length}${retention.missing.length > 0 ? ` missing=${retention.missing.join(', ')}` : ''}`
    : '';
  return `collection-path mode=${modeText} source=${decision.sourceKind}${commandText}${retentionText} reason=${decision.reason}`;
}

export async function persistCollectionPathDecision(session: SessionLike, decision: CollectionPathDecision) {
  const retention = summarizeArtifactRetention(
    decision.expectedArtifacts,
    session.listArtifacts().map((artifact) => artifact.label),
  );
  const notes = [...(decision.notes ?? [])];
  if (decision.mode === 'partial-real') {
    notes.push('This run retained real collector artifacts, but hotspot shaping or normalization still used a fallback-assisted path.');
  }
  if (retention.missing.length > 0) {
    notes.push(`Expected artifacts still missing at summary time: ${retention.missing.join(', ')}.`);
  }
  session.log(
    decision.mode === 'real' ? 'capture' : decision.mode === 'partial-real' ? 'normalize' : 'fallback',
    buildCollectionPathSummary(decision, retention),
  );
  return session.writeJsonArtifact(
    'report',
    'collection-path',
    {
      collector: decision.collector,
      mode: decision.mode,
      command: decision.command,
      reason: decision.reason,
      sourceKind: decision.sourceKind,
      rawSignal: decision.rawSignal,
      expectedArtifacts: decision.expectedArtifacts,
      retainedArtifacts: retention.retained,
      matchedArtifacts: retention.matched,
      missingArtifacts: retention.missing,
      notes,
      generatedAt: new Date().toISOString(),
    },
    'Collection path summary',
  );
}
