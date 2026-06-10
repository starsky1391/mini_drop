import type { CollectorArtifact } from './types.js';
import { artifactLabel, writeArtifact, writeJsonArtifact } from './runtime-utils.js';

type CollectorPhase = 'prepare' | 'capture' | 'normalize' | 'fallback' | 'complete';

export function createCollectorSession(taskId: string, prefix: string, notes: string[]) {
  const artifacts: CollectorArtifact[] = [];
  const logs = notes.map((note) => formatLog('prepare', note));

  return {
    artifacts,
    logs,
    log(phase: CollectorPhase, message: string) {
      logs.push(formatLog(phase, message));
    },
    addArtifact(kind: CollectorArtifact['kind'], path: string, label: string) {
      artifacts.push({ kind, path, label });
      return path;
    },
    async writeTextArtifact(kind: CollectorArtifact['kind'], suffix: string, content: string, label: string) {
      const path = await writeArtifact(taskId, `${artifactLabel(prefix, suffix)}${extensionForKind(kind)}`, content);
      artifacts.push({ kind, path, label });
      return path;
    },
    async writeJsonArtifact(kind: CollectorArtifact['kind'], suffix: string, content: unknown, label: string) {
      const path = await writeJsonArtifact(taskId, `${artifactLabel(prefix, suffix)}.json`, content);
      artifacts.push({ kind, path, label });
      return path;
    },
    async flushLogs() {
      const path = await writeArtifact(taskId, `${artifactLabel(prefix, 'collector-log')}.log`, logs.join('\n'));
      artifacts.push({ kind: 'log', path, label: `${prefix} collector log` });
      return path;
    },
  };
}

function formatLog(phase: CollectorPhase, message: string) {
  return `[${phase}] ${message}`;
}

function extensionForKind(kind: CollectorArtifact['kind']) {
  switch (kind) {
    case 'speedscope':
    case 'report':
      return '.json';
    case 'log':
      return '.log';
    default:
      return '.txt';
  }
}
