import type {
  CollectorFrameEvidence,
  CollectorOutcome,
  CollectorProfileEvidence,
  CollectorStackEvidence,
} from '../collectors/types.js';
import type {
  ComparisonTrend,
  FlameNode,
  TaskComparison,
  TaskDetail,
  TaskEvent,
  TaskFinding,
  TaskMetrics,
  TrendInsight,
} from '../../shared/types.js';

export interface SymbolizedFrame {
  displayName: string;
  symbol: string;
  module: string;
  file: string;
  line: number | null;
  sourceHint: string;
}

export interface NormalizedHotspot {
  name: string;
  percent: number;
  module: string;
  rank: number;
  frame: SymbolizedFrame;
  sampleWeight: number;
  sampleCount: number;
  threadCount: number;
  threadLabels: string[];
  supportingFrames: SymbolizedFrame[];
  representativeStack: SymbolizedFrame[];
}

export interface NormalizedRun {
  title: string;
  summary: string;
  metrics: TaskMetrics;
  sampleCount: number;
  sampleSource: string;
  usedRealData: boolean;
  sourceKind: string;
  threadCount: number;
  stackCount: number;
  hotspots: NormalizedHotspot[];
  topStacks: NormalizedStack[];
}

export interface NormalizedStack {
  key: string;
  weight: number;
  threadLabel: string | null;
  frames: SymbolizedFrame[];
}

export interface AnalysisContext {
  task: TaskDetail;
  outcome: CollectorOutcome;
  comparison: TaskComparison | null;
  run: NormalizedRun;
}

export interface TrendDriver {
  label: string;
  trend: ComparisonTrend;
  delta: number;
  evidence: string;
}

export interface AnalysisNarrative {
  confidence: number;
  primaryFinding: string;
  analysisSummary: string;
  trendSummary: string;
  timeline: TaskEvent[];
  findings: TaskFinding[];
  insights: TrendInsight[];
  flameGraph: FlameNode;
  trendDriver: TrendDriver | null;
}

export function symbolizeCollectorFrame(frame: CollectorFrameEvidence): SymbolizedFrame {
  return {
    displayName: frame.name,
    symbol: frame.symbol,
    module: frame.module,
    file: frame.file,
    line: frame.line,
    sourceHint: frame.sourceHint,
  };
}

export function normalizeStackEvidence(stack: CollectorStackEvidence): NormalizedStack {
  return {
    key: stack.key,
    weight: stack.weight,
    threadLabel: stack.threadLabel,
    frames: stack.frames.map(symbolizeCollectorFrame),
  };
}

export function placeholderProfileEvidence(sourceKind: string): CollectorProfileEvidence {
  return {
    sourceKind,
    usedRealData: false,
    sampleCount: 0,
    stackCount: 0,
    threadCount: 0,
    topStacks: [],
    hotspots: [],
    collapsedStacks: '',
  };
}
