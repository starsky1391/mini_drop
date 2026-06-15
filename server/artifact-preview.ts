import path from 'node:path';
import type { ArtifactKind, ArtifactPreviewMode, CollectorId } from '../shared/types.js';

export interface ArtifactPreviewMetadata {
  mode: ArtifactPreviewMode;
  mimeType: string;
  previewable: boolean;
  previewHint: string;
  collectorParity?: {
    collector: CollectorId;
    supportedKinds: ArtifactKind[];
    parityLevel: 'full' | 'partial' | 'limited';
  };
}

export function buildArtifactPreviewMetadata(filePath: string, kind: ArtifactKind, collector?: CollectorId): ArtifactPreviewMetadata {
  const mode = inferPreviewMode(filePath);
  return {
    mode,
    mimeType: inferMimeType(filePath, mode),
    previewable: mode !== 'unsupported',
    previewHint: buildPreviewHint(kind, mode, collector),
    collectorParity: collector ? buildCollectorParity(collector, kind) : undefined,
  };
}

function buildCollectorParity(collector: CollectorId, kind: ArtifactKind): ArtifactPreviewMetadata['collectorParity'] {
  const parityMap: Record<CollectorId, { supportedKinds: ArtifactKind[]; parityLevel: 'full' | 'partial' | 'limited' }> = {
    'py-spy': {
      supportedKinds: ['speedscope', 'collapsed-stacks', 'report', 'log'],
      parityLevel: 'full',
    },
    'perf': {
      supportedKinds: ['raw', 'collapsed-stacks', 'report', 'log'],
      parityLevel: 'full',
    },
    'async-profiler': {
      supportedKinds: ['collapsed-stacks', 'report', 'log'],
      parityLevel: 'partial',
    },
    'ebpf': {
      supportedKinds: ['raw', 'collapsed-stacks', 'report', 'log'],
      parityLevel: 'partial',
    },
  };

  const config = parityMap[collector] ?? { supportedKinds: [], parityLevel: 'limited' as const };
  return {
    collector,
    supportedKinds: config.supportedKinds,
    parityLevel: config.parityLevel,
  };
}

export function inferPreviewMode(filePath: string): ArtifactPreviewMode {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    return 'json';
  }
  if (
    ['.txt', '.log', '.data', '.folded', '.collapsed', '.jsonl', '.ndjson', '.md', '.yml', '.yaml', '.svg'].includes(ext) ||
    ext === ''
  ) {
    return 'text';
  }
  return 'unsupported';
}

function inferMimeType(filePath: string, mode: ArtifactPreviewMode) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    return 'application/json';
  }
  if (ext === '.svg') {
    return 'image/svg+xml';
  }
  if (ext === '.yml' || ext === '.yaml') {
    return 'application/yaml';
  }
  if (ext === '.md') {
    return 'text/markdown';
  }
  if (ext === '.jsonl' || ext === '.ndjson') {
    return 'application/x-ndjson';
  }
  return mode === 'unsupported' ? 'application/octet-stream' : 'text/plain';
}

function buildPreviewHint(kind: ArtifactKind, mode: ArtifactPreviewMode, collector?: CollectorId) {
  if (mode === 'unsupported') {
    return 'Offline tooling required for this retained artifact.';
  }

  const collectorHint = collector ? ` (${collector} collector)` : '';

  switch (kind) {
    case 'speedscope':
      return `Preview the retained profile payload${collectorHint} before opening it in a dedicated profile viewer.`;
    case 'collapsed-stacks':
      return `Inspect normalized stack lines${collectorHint} directly in the browser.`;
    case 'report':
      return `Review the normalized collector report${collectorHint} inline.`;
    case 'log':
      return `Read the retained execution log${collectorHint} inline.`;
    default:
      return `Inspect the retained raw artifact${collectorHint} inline when possible.`;
  }
}
