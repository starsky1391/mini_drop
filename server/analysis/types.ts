import type { CollectorOutcome } from '../collectors/types.js';
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
  supportingFrames: SymbolizedFrame[];
}

export interface NormalizedRun {
  title: string;
  summary: string;
  metrics: TaskMetrics;
  sampleCount: number;
  sampleSource: string;
  hotspots: NormalizedHotspot[];
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
