import path from 'node:path';
import type { TaskDetail } from '../../shared/types.js';
import type {
  CollectorFrameEvidence,
  CollectorHotspotEvidence,
  CollectorProfileEvidence,
  CollectorStackEvidence,
} from './types.js';

type Hotspot = TaskDetail['topFunctions'][number];

interface ParsedFrame extends CollectorFrameEvidence {}

interface WeightedStack {
  frames: ParsedFrame[];
  weight: number;
  threadLabel: string | null;
}

interface SpeedscopeFrame {
  name?: string;
  file?: string;
  line?: number;
  col?: number;
}

interface SampledProfile {
  type: 'sampled';
  name?: string;
  unit?: string;
  weights?: number[];
  samples: number[][];
}

interface EventedProfile {
  type: 'evented';
  name?: string;
  unit?: string;
  events: Array<{
    type: 'O' | 'C';
    at: number;
    frame: number;
  }>;
}

interface SpeedscopeFile {
  shared?: {
    frames?: SpeedscopeFrame[];
  };
  profiles?: Array<SampledProfile | EventedProfile>;
}

interface HotspotAccumulator {
  leaf: ParsedFrame;
  weight: number;
  sampleCount: number;
  threadLabels: Set<string>;
  callers: Map<string, { frame: ParsedFrame; weight: number }>;
  bestStack: { frames: ParsedFrame[]; weight: number } | null;
}

export interface ParsedProfileSummary {
  sampleCount: number;
  topFunctions: Hotspot[];
  collapsedStacks: string;
  usedRealData: boolean;
  evidence: CollectorProfileEvidence;
}

export function parsePerfScript(text: string): ParsedProfileSummary | null {
  const blocks = text
    .split(/\r?\n\r?\n/g)
    .map((block) => block.trimEnd())
    .filter(Boolean);
  const samples: WeightedStack[] = [];

  for (const block of blocks) {
    const rawLines = block.split(/\r?\n/g).filter((line) => line.trim().length > 0);
    if (rawLines.length === 0) {
      continue;
    }

    const header = parsePerfHeader(rawLines[0] ?? '');
    const frameLines = rawLines.slice(1).filter((line) => /^\s/.test(line));
    if (frameLines.length === 0) {
      continue;
    }

    const frames = frameLines
      .map(parsePerfFrame)
      .filter((frame): frame is ParsedFrame => frame !== null)
      .reverse();

    if (frames.length === 0) {
      continue;
    }

    samples.push({
      frames,
      weight: header.weight,
      threadLabel: header.threadLabel,
    });
  }

  return summarizeStacks(samples, 'perf-script');
}

export function parseSpeedscopeProfile(text: string): ParsedProfileSummary | null {
  let parsed: SpeedscopeFile;
  try {
    parsed = JSON.parse(text) as SpeedscopeFile;
  } catch {
    return null;
  }

  const frames = parsed.shared?.frames ?? [];
  const samples: WeightedStack[] = [];

  for (const profile of parsed.profiles ?? []) {
    const threadLabel = sanitizeThreadLabel(profile.name);
    if (profile.type === 'sampled') {
      for (let index = 0; index < profile.samples.length; index += 1) {
        const sampleFrames = toFrames(profile.samples[index] ?? [], frames);
        if (sampleFrames.length === 0) {
          continue;
        }

        samples.push({
          frames: sampleFrames,
          weight: Math.max(1, profile.weights?.[index] ?? 1),
          threadLabel,
        });
      }
      continue;
    }

    const stack: number[] = [];
    let previousAt: number | null = null;
    for (const event of profile.events) {
      if (previousAt !== null && stack.length > 0) {
        const duration = Math.max(1, event.at - previousAt);
        const eventFrames = toFrames(stack, frames);
        if (eventFrames.length > 0) {
          samples.push({
            frames: eventFrames,
            weight: duration,
            threadLabel,
          });
        }
      }

      if (event.type === 'O') {
        stack.push(event.frame);
      } else if (event.type === 'C' && stack.length > 0) {
        stack.pop();
      }

      previousAt = event.at;
    }
  }

  return summarizeStacks(samples, 'speedscope');
}

export function mergeHotspots(primary: Hotspot[], fallback: Hotspot[], limit = 4): Hotspot[] {
  const ordered: Hotspot[] = [];
  const seen = new Set<string>();

  for (const item of [...primary, ...fallback]) {
    const key = `${item.name}::${item.module}`;
    if (seen.has(key)) {
      continue;
    }
    ordered.push(item);
    seen.add(key);
    if (ordered.length >= limit) {
      break;
    }
  }

  return ordered;
}

export function buildCollapsedFromHotspots(title: string, hotspots: Hotspot[], leafSuffixes: string[]) {
  const lines: string[] = [];
  hotspots.forEach((hotspot, index) => {
    const primaryWeight = Math.max(1, Math.round(hotspot.percent * 0.6));
    const secondaryWeight = Math.max(1, Math.round(hotspot.percent * 0.35));
    const tertiaryWeight = Math.max(1, Math.round(hotspot.percent * 0.15));
    const suffixA = leafSuffixes[index % leafSuffixes.length] ?? 'support';
    const suffixB = leafSuffixes[(index + 1) % leafSuffixes.length] ?? 'worker';

    lines.push(`${title};${hotspot.name};${suffixA} ${primaryWeight}`);
    lines.push(`${title};${hotspot.name};${suffixB} ${secondaryWeight}`);
    lines.push(`${title};${hotspot.name};misc ${tertiaryWeight}`);
  });

  return lines.join('\n');
}

function parsePerfHeader(line: string) {
  const trimmed = line.trim();
  const match = trimmed.match(
    /^(?<thread>.+?)\s+(?<pid>\d+)(?:\/(?<tid>\d+))?(?:\s+\[(?<cpu>\d+)\])?\s+[\d.]+:\s+(?:(?<period>\d+)\s+)?(?<event>[^:]+):/,
  );

  if (!match?.groups) {
    return { threadLabel: null, weight: 1 };
  }

  const thread = match.groups.thread?.trim() ?? '';
  const pid = match.groups.pid?.trim() ?? '';
  const tid = match.groups.tid?.trim() ?? '';
  const threadLabel = sanitizeThreadLabel(
    tid && tid !== pid ? `${thread} ${pid}/${tid}` : thread || (pid ? `pid ${pid}` : ''),
  );
  const weight = Math.max(1, Number(match.groups.period ?? '1') || 1);

  return { threadLabel, weight };
}

function parsePerfFrame(line: string): ParsedFrame | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const moduleMatch = trimmed.match(/\(([^()]+)\)\s*$/);
  const moduleName = moduleMatch?.[1]?.trim() || 'unknown/module';
  const beforeModule = moduleMatch ? trimmed.slice(0, moduleMatch.index).trim() : trimmed;
  const addressMatch = beforeModule.match(/^(?<address>0x[0-9a-f]+|[0-9a-f]+)\s+/i);
  const address = addressMatch?.groups?.address ?? null;
  const withoutAddress = addressMatch ? beforeModule.slice(addressMatch[0].length).trim() : beforeModule;

  const source = extractSourceLocation(withoutAddress);
  const symbolArea = source ? withoutAddress.slice(0, source.index).trim() : withoutAddress;
  const symbol = sanitizeSymbol(symbolArea);
  if (!symbol) {
    return null;
  }

  const sourceHint = source?.path ?? moduleName;
  const file = source?.path ? path.basename(source.path) : basenameOrSelf(moduleName);

  return {
    name: symbol,
    symbol,
    module: moduleName,
    file,
    line: source?.line ?? null,
    sourceHint,
    address,
  };
}

function toFrames(indexes: number[], frames: SpeedscopeFrame[]): ParsedFrame[] {
  return indexes
    .map((index) => {
      const frame = frames[index];
      const symbol = sanitizeFrameName(frame?.name);
      if (!symbol) {
        return null;
      }

      const sourcePath = frame?.file?.trim() || deriveModuleFromName(symbol);
      return {
        name: symbol,
        symbol,
        module: deriveModuleFromPathOrName(sourcePath, symbol),
        file: basenameOrSelf(sourcePath),
        line: typeof frame?.line === 'number' ? frame.line : null,
        sourceHint: sourcePath,
        address: null,
      } as ParsedFrame;
    })
    .filter((frame): frame is ParsedFrame => frame !== null);
}

function summarizeStacks(samples: WeightedStack[], sourceKind: string): ParsedProfileSummary | null {
  if (samples.length === 0) {
    return null;
  }

  const hotspotWeights = new Map<string, HotspotAccumulator>();
  const collapsedWeights = new Map<string, CollectorStackEvidence>();
  const threadLabels = new Set<string>();
  let totalWeight = 0;

  for (const sample of samples) {
    if (sample.frames.length === 0 || sample.weight <= 0) {
      continue;
    }

    totalWeight += sample.weight;
    if (sample.threadLabel) {
      threadLabels.add(sample.threadLabel);
    }

    const leaf = sample.frames[sample.frames.length - 1]!;
    const leafKey = frameKey(leaf);
    const current = hotspotWeights.get(leafKey) ?? {
      leaf,
      weight: 0,
      sampleCount: 0,
      threadLabels: new Set<string>(),
      callers: new Map<string, { frame: ParsedFrame; weight: number }>(),
      bestStack: null,
    };

    current.weight += sample.weight;
    current.sampleCount += 1;
    if (sample.threadLabel) {
      current.threadLabels.add(sample.threadLabel);
    }

    const callers = sample.frames.slice(Math.max(0, sample.frames.length - 4), sample.frames.length - 1).reverse();
    for (const caller of callers) {
      const key = frameKey(caller);
      const existing = current.callers.get(key);
      if (existing) {
        existing.weight += sample.weight;
      } else {
        current.callers.set(key, { frame: caller, weight: sample.weight });
      }
    }

    if (!current.bestStack || sample.weight > current.bestStack.weight) {
      current.bestStack = {
        frames: sample.frames.slice(),
        weight: sample.weight,
      };
    }

    hotspotWeights.set(leafKey, current);

    const stackKey = sample.frames.map((frame) => frame.symbol).join(';');
    const stackEvidence = collapsedWeights.get(stackKey);
    if (stackEvidence) {
      stackEvidence.weight += sample.weight;
    } else {
      collapsedWeights.set(stackKey, {
        key: stackKey,
        weight: sample.weight,
        threadLabel: sample.threadLabel,
        frames: sample.frames,
      });
    }
  }

  if (totalWeight <= 0) {
    return null;
  }

  const hotspots = [...hotspotWeights.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 6)
    .map((entry) => toHotspotEvidence(entry, totalWeight));

  const topFunctions = hotspots.map((hotspot) => ({
    name: hotspot.name,
    percent: hotspot.percent,
    module: hotspot.module,
  }));

  const topStacks = [...collapsedWeights.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 6)
    .map((stack) => ({
      key: stack.key,
      weight: Math.max(1, Math.round(stack.weight)),
      threadLabel: stack.threadLabel,
      frames: stack.frames.map((frame) => ({ ...frame })),
    }));

  const collapsedStacks = topStacks
    .map((stack) => `${stack.frames.map((frame) => frame.symbol).join(';')} ${stack.weight}`)
    .join('\n');

  return {
    sampleCount: samples.length,
    topFunctions,
    collapsedStacks,
    usedRealData: true,
    evidence: {
      sourceKind,
      usedRealData: true,
      sampleCount: samples.length,
      stackCount: collapsedWeights.size,
      threadCount: threadLabels.size,
      topStacks,
      hotspots,
      collapsedStacks,
    },
  };
}

function toHotspotEvidence(entry: HotspotAccumulator, totalWeight: number): CollectorHotspotEvidence {
  const callers = [...entry.callers.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 3)
    .map((item) => ({ ...item.frame }));
  const representativeStack = entry.bestStack?.frames.map((frame) => ({ ...frame })) ?? [{ ...entry.leaf }];

  return {
    name: entry.leaf.symbol,
    module: entry.leaf.module,
    percent: Math.max(1, Math.round((entry.weight / totalWeight) * 100)),
    sampleWeight: Math.max(1, Math.round(entry.weight)),
    sampleCount: entry.sampleCount,
    threadCount: entry.threadLabels.size,
    leaf: { ...entry.leaf },
    callers,
    representativeStack,
    threadLabels: [...entry.threadLabels].sort(),
  };
}

function extractSourceLocation(text: string) {
  const match = text.match(/(?<path>(?:[A-Za-z]:)?[^():\s]+(?:[\\/][^():\s]+)+)(?::(?<line>\d+))?/);
  if (!match?.groups?.path) {
    return null;
  }

  return {
    index: match.index ?? 0,
    path: match.groups.path,
    line: match.groups.line ? Number(match.groups.line) : null,
  };
}

function sanitizeSymbol(symbolArea: string) {
  if (!symbolArea) {
    return null;
  }

  const tokens = symbolArea.split(/\s+/).filter(Boolean);
  const candidate = tokens.at(-1) ?? symbolArea.trim();
  const normalized = candidate
    .replace(/^\[[^[\]]+\]$/, '')
    .replace(/\+0x[0-9a-f]+$/i, '')
    .replace(/\+0x?[0-9a-f]+\/0x?[0-9a-f]+$/i, '')
    .trim();

  if (!normalized || normalized === '-' || normalized === 'unknown' || normalized === '[unknown]') {
    return null;
  }

  return normalized;
}

function sanitizeFrameName(name: string | undefined) {
  if (!name) {
    return null;
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\s+/g, ' ');
}

function sanitizeThreadLabel(name: string | undefined) {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}

function deriveModuleFromPathOrName(sourcePath: string, symbol: string) {
  if (sourcePath.includes('/')) {
    const dirname = path.posix.dirname(sourcePath.replace(/\\/g, '/'));
    return dirname === '.' ? sourcePath : dirname;
  }

  return deriveModuleFromName(symbol);
}

function deriveModuleFromName(name: string) {
  if (name.includes('/')) {
    const normalized = name.replace(/\\/g, '/');
    return path.posix.dirname(normalized);
  }
  if (name.includes('::')) {
    return name.split('::')[0] || 'python';
  }
  if (name.includes('.')) {
    return name.split('.').slice(0, -1).join('.') || 'python';
  }
  return 'python';
}

function basenameOrSelf(value: string) {
  const normalized = value.replace(/\\/g, '/');
  return path.posix.basename(normalized) || value;
}

function frameKey(frame: CollectorFrameEvidence) {
  return `${frame.symbol}::${frame.module}::${frame.file}::${frame.line ?? 'n/a'}`;
}
