import path from 'node:path';
import type { ArtifactKind, ArtifactPreviewMode } from '../shared/types.js';

export interface ArtifactPreviewMetadata {
  mode: ArtifactPreviewMode;
  mimeType: string;
  previewable: boolean;
  previewHint: string;
}

export function buildArtifactPreviewMetadata(filePath: string, kind: ArtifactKind): ArtifactPreviewMetadata {
  const mode = inferPreviewMode(filePath);
  return {
    mode,
    mimeType: inferMimeType(filePath, mode),
    previewable: mode !== 'unsupported',
    previewHint: buildPreviewHint(kind, mode),
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

function buildPreviewHint(kind: ArtifactKind, mode: ArtifactPreviewMode) {
  if (mode === 'unsupported') {
    return 'Offline tooling required for this retained artifact.';
  }

  switch (kind) {
    case 'speedscope':
      return 'Preview the retained profile payload before opening it in a dedicated profile viewer.';
    case 'collapsed-stacks':
      return 'Inspect normalized stack lines directly in the browser.';
    case 'report':
      return 'Review the normalized collector report inline.';
    case 'log':
      return 'Read the retained execution log inline.';
    default:
      return 'Inspect the retained raw artifact inline when possible.';
  }
}
