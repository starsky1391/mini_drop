import type { CollectorOutcome } from '../collectors/types.js';
import type { TaskDetail } from '../../shared/types.js';
import {
  normalizeStackEvidence,
  placeholderProfileEvidence,
  symbolizeCollectorFrame,
  type NormalizedHotspot,
  type NormalizedRun,
} from './types.js';

export function normalizeCollectorOutcome(task: TaskDetail, outcome: CollectorOutcome): NormalizedRun {
  const fallbackHotspots = task.topFunctions;
  const evidence =
    outcome.sample.evidence ??
    outcome.report.evidence ??
    placeholderProfileEvidence(inferSourceKind(outcome.sample.rawSignal));

  const sourceEntries = evidence.hotspots.length
    ? evidence.hotspots
    : (outcome.report.topFunctions.length ? outcome.report.topFunctions : fallbackHotspots).map((entry, index) => {
        const leaf = symbolizeFallback(entry.name, entry.module, index);
        return {
          name: entry.name,
          module: entry.module,
          percent: entry.percent,
          sampleWeight: entry.percent,
          sampleCount: Math.max(1, Math.round((outcome.sample.sampleCount || 1) * Math.max(entry.percent, 1) / 100)),
          threadCount: 0,
          threadLabels: [],
          leaf: {
            name: leaf.displayName,
            symbol: leaf.symbol,
            module: leaf.module,
            file: leaf.file,
            line: leaf.line,
            sourceHint: leaf.sourceHint,
          },
          callers: [],
          representativeStack: [
            {
              name: leaf.displayName,
              symbol: leaf.symbol,
              module: leaf.module,
              file: leaf.file,
              line: leaf.line,
              sourceHint: leaf.sourceHint,
            },
          ],
        };
      });

  const hotspots: NormalizedHotspot[] = sourceEntries.map((entry, index) => ({
    name: entry.name,
    percent: entry.percent,
    module: entry.module,
    rank: index + 1,
    frame: symbolizeCollectorFrame(entry.leaf),
    sampleWeight: entry.sampleWeight,
    sampleCount: entry.sampleCount,
    threadCount: entry.threadCount,
    threadLabels: entry.threadLabels,
    supportingFrames: entry.callers.map(symbolizeCollectorFrame),
    representativeStack: entry.representativeStack.map(symbolizeCollectorFrame),
  }));

  return {
    title: outcome.report.title,
    summary: outcome.report.summary,
    metrics: outcome.report.metrics,
    sampleCount: outcome.sample.sampleCount,
    sampleSource: outcome.sample.rawSignal,
    usedRealData: evidence.usedRealData,
    sourceKind: evidence.sourceKind,
    threadCount: evidence.threadCount,
    stackCount: evidence.stackCount,
    hotspots,
    topStacks: evidence.topStacks.map(normalizeStackEvidence),
  };
}

function symbolizeFallback(name: string, modulePath: string, rank: number) {
  const normalizedModule = modulePath || 'unknown/module';
  const normalizedSource = normalizedModule.replace(/\\/g, '/');
  const segments = normalizedSource.split('/').filter(Boolean);
  const file = segments.at(-1) ?? normalizedModule;
  const sourceHint = segments.length > 1 ? segments.slice(0, -1).join('/') : normalizedSource;
  const syntheticLine = inferSyntheticLine(name, rank);
  const symbol = demangleSymbol(name);

  return {
    displayName: name,
    symbol,
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

function inferSourceKind(rawSignal: string) {
  if (rawSignal.includes('perf')) {
    return 'perf-script';
  }
  if (rawSignal.includes('py-spy')) {
    return 'speedscope';
  }
  if (rawSignal.includes('python')) {
    return 'python-stack-sampling';
  }
  return 'collector-fallback';
}
