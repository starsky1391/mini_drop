import type { CollectorOutcome } from '../collectors/types.js';
import type { TaskDetail } from '../../shared/types.js';
import type { NormalizedHotspot, NormalizedRun, SymbolizedFrame } from './types.js';

export function normalizeCollectorOutcome(task: TaskDetail, outcome: CollectorOutcome): NormalizedRun {
  const fallbackHotspots = task.topFunctions;
  const hotspots = (outcome.report.topFunctions.length ? outcome.report.topFunctions : fallbackHotspots).map((entry, index, list) => {
    const frame = symbolizeFrame(entry.name, entry.module, index);
    return {
      name: entry.name,
      percent: entry.percent,
      module: entry.module,
      rank: index + 1,
      frame,
      supportingFrames: list
        .filter((_, peerIndex) => peerIndex !== index)
        .slice(0, 2)
        .map((peer, peerIndex) => symbolizeFrame(peer.name, peer.module, peerIndex + 1)),
    } satisfies NormalizedHotspot;
  });

  return {
    title: outcome.report.title,
    summary: outcome.report.summary,
    metrics: outcome.report.metrics,
    sampleCount: outcome.sample.sampleCount,
    sampleSource: outcome.sample.rawSignal,
    hotspots,
  };
}

export function symbolizeFrame(name: string, modulePath: string, rank: number): SymbolizedFrame {
  const normalizedModule = modulePath || 'unknown/module';
  const segments = normalizedModule.split(/[\\/]/).filter(Boolean);
  const file = segments.at(-1) ?? normalizedModule;
  const sourceHint = segments.length > 1 ? segments.slice(0, -1).join('/') : normalizedModule;
  const syntheticLine = inferSyntheticLine(name, rank);

  return {
    displayName: name,
    symbol: demangleSymbol(name),
    module: normalizedModule,
    file,
    line: syntheticLine,
    sourceHint,
  };
}

function demangleSymbol(symbol: string) {
  return symbol.replace(/::/g, ' -> ').replace(/_/g, ' ');
}

function inferSyntheticLine(name: string, rank: number) {
  const seed = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return 40 + ((seed + rank * 17) % 220);
}
