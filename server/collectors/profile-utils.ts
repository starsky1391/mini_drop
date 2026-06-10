import type { TaskDetail } from '../../shared/types.js';

type Hotspot = TaskDetail['topFunctions'][number];

interface ParsedFrame {
  name: string;
  module: string;
}

interface WeightedStack {
  frames: ParsedFrame[];
  weight: number;
}

interface SpeedscopeFrame {
  name?: string;
  file?: string;
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

export interface ParsedProfileSummary {
  sampleCount: number;
  topFunctions: Hotspot[];
  collapsedStacks: string;
  usedRealData: boolean;
}

export function parsePerfScript(text: string): ParsedProfileSummary | null {
  const blocks = text
    .split(/\r?\n\r?\n/g)
    .map((block) => block.trim())
    .filter(Boolean);
  const samples: WeightedStack[] = [];

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/g)
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const frameLines = lines.filter((line) => /^\s/.test(line));
    if (frameLines.length === 0) {
      continue;
    }

    const frames = frameLines
      .map(parsePerfFrame)
      .filter((frame): frame is ParsedFrame => frame !== null)
      .reverse();

    if (frames.length > 0) {
      samples.push({ frames, weight: 1 });
    }
  }

  return summarizeStacks(samples);
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
    if (profile.type === 'sampled') {
      for (let index = 0; index < profile.samples.length; index += 1) {
        const sampleFrames = toFrames(profile.samples[index] ?? [], frames);
        if (sampleFrames.length === 0) {
          continue;
        }
        samples.push({
          frames: sampleFrames,
          weight: profile.weights?.[index] ?? 1,
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
          samples.push({ frames: eventFrames, weight: duration });
        }
      }

      if (event.type === 'O') {
        stack.push(event.frame);
      } else if (event.type === 'C') {
        stack.pop();
      }

      previousAt = event.at;
    }
  }

  return summarizeStacks(samples);
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

function parsePerfFrame(line: string): ParsedFrame | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const moduleMatch = trimmed.match(/\(([^()]+)\)\s*$/);
  const moduleName = moduleMatch?.[1] ?? 'unknown';
  const withoutModule = moduleMatch ? trimmed.slice(0, moduleMatch.index).trim() : trimmed;
  const tokens = withoutModule.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  let name = tokens[tokens.length - 1] ?? 'unknown';
  if (/^0x[0-9a-f]+$/i.test(name) || /^[0-9a-f]+$/i.test(name)) {
    name = tokens[tokens.length - 2] ?? name;
  }

  name = name.replace(/\+0x[0-9a-f]+$/i, '').replace(/^\[unknown\]$/, 'unknown');

  if (!name || name === '-' || name === 'unknown') {
    return null;
  }

  return { name, module: moduleName };
}

function toFrames(indexes: number[], frames: SpeedscopeFrame[]): ParsedFrame[] {
  return indexes
    .map((index) => {
      const frame = frames[index];
      const name = sanitizeFrameName(frame?.name);
      if (!name) {
        return null;
      }

      return {
        name,
        module: frame?.file?.trim() || deriveModuleFromName(name),
      };
    })
    .filter((frame): frame is ParsedFrame => frame !== null);
}

function summarizeStacks(samples: WeightedStack[]): ParsedProfileSummary | null {
  if (samples.length === 0) {
    return null;
  }

  const leafWeights = new Map<string, { hotspot: Hotspot; weight: number }>();
  const collapsedWeights = new Map<string, number>();
  let totalWeight = 0;

  for (const sample of samples) {
    if (sample.frames.length === 0 || sample.weight <= 0) {
      continue;
    }

    totalWeight += sample.weight;
    const leaf = sample.frames[sample.frames.length - 1]!;
    const leafKey = `${leaf.name}::${leaf.module}`;
    const currentLeaf = leafWeights.get(leafKey);
    if (currentLeaf) {
      currentLeaf.weight += sample.weight;
    } else {
      leafWeights.set(leafKey, {
        hotspot: {
          name: leaf.name,
          module: leaf.module,
          percent: 0,
        },
        weight: sample.weight,
      });
    }

    const stackKey = sample.frames.map((frame) => frame.name).join(';');
    collapsedWeights.set(stackKey, (collapsedWeights.get(stackKey) ?? 0) + sample.weight);
  }

  if (totalWeight <= 0) {
    return null;
  }

  const topFunctions = [...leafWeights.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 6)
    .map(({ hotspot, weight }) => ({
      ...hotspot,
      percent: Math.max(1, Math.round((weight / totalWeight) * 100)),
    }));

  const collapsedStacks = [...collapsedWeights.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([stack, weight]) => `${stack} ${Math.max(1, Math.round(weight))}`)
    .join('\n');

  return {
    sampleCount: samples.length,
    topFunctions,
    collapsedStacks,
    usedRealData: true,
  };
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

function deriveModuleFromName(name: string) {
  if (name.includes('/')) {
    const parts = name.split('/');
    return parts.slice(0, -1).join('/') || 'python';
  }
  if (name.includes('::')) {
    return name.split('::')[0] || 'python';
  }
  if (name.includes('.')) {
    return name.split('.').slice(0, -1).join('.') || 'python';
  }
  return 'python';
}
