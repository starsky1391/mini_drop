export type CollectorFailureKind =
  | 'timeout'
  | 'permission'
  | 'tool-unavailable'
  | 'output-unparseable'
  | 'missing-artifact'
  | 'platform-unsupported'
  | 'unknown';

export type CollectorFailureStage = 'prepare' | 'capture' | 'normalize' | 'artifact-check';

export interface CollectorFailureMetadata {
  failureKind?: CollectorFailureKind;
  failureStage?: CollectorFailureStage;
  failureDetail?: string;
}

export function classifyPlatformUnsupportedFailure(detail: string): CollectorFailureMetadata {
  return {
    failureKind: 'platform-unsupported',
    failureStage: 'prepare',
    failureDetail: trimFailureDetail(detail),
  };
}

export function classifyToolUnavailableFailure(detail: string): CollectorFailureMetadata {
  return {
    failureKind: 'tool-unavailable',
    failureStage: 'prepare',
    failureDetail: trimFailureDetail(detail),
  };
}

export function classifyMissingArtifactFailure(detail: string): CollectorFailureMetadata {
  return {
    failureKind: 'missing-artifact',
    failureStage: 'artifact-check',
    failureDetail: trimFailureDetail(detail),
  };
}

export function classifyOutputUnparseableFailure(detail: string): CollectorFailureMetadata {
  return {
    failureKind: 'output-unparseable',
    failureStage: 'normalize',
    failureDetail: trimFailureDetail(detail),
  };
}

export function classifyCommandFailure(
  message: string,
  stage: CollectorFailureStage,
): CollectorFailureMetadata {
  const normalized = message.toLowerCase();
  let failureKind: CollectorFailureKind = 'unknown';

  if (normalized.includes('timed out')) {
    failureKind = 'timeout';
  } else if (
    normalized.includes('permission denied') ||
    normalized.includes('operation not permitted') ||
    normalized.includes('access denied') ||
    normalized.includes('perf_event_paranoid') ||
    normalized.includes('sudo')
  ) {
    failureKind = 'permission';
  } else if (
    normalized.includes('enoent') ||
    normalized.includes('not found') ||
    normalized.includes('unavailable')
  ) {
    failureKind = 'tool-unavailable';
  }

  return {
    failureKind,
    failureStage: stage,
    failureDetail: trimFailureDetail(message),
  };
}

function trimFailureDetail(detail: string, limit = 280) {
  const normalized = detail.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}
