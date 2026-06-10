import type { ReasonerEvidenceItem, ReasonerInput, ReasonerOutput, ReasonerSnapshot, ReasonerTaskShape } from './types.js';

export function buildReasonerSnapshot(task: ReasonerTaskShape): ReasonerSnapshot {
  const input = buildReasonerInput(task);
  const mode = process.env.MINI_DROP_REASONER_MODE === 'stub' ? 'stub' : 'disabled';
  return {
    input,
    output: mode === 'stub' ? buildStubReasonerOutput(input) : buildDisabledReasonerOutput(input),
  };
}

function buildReasonerInput(task: ReasonerTaskShape): ReasonerInput {
  const evidence: ReasonerEvidenceItem[] = [
    metricEvidence('cpu', 'CPU pressure', task.metrics.cpu),
    metricEvidence('blocked', 'Blocked time', task.metrics.blocked),
    metricEvidence('gc', 'GC pressure', task.metrics.gc),
    metricEvidence('syscalls', 'Syscall share', task.metrics.syscalls),
  ];

  task.topFunctions.slice(0, 3).forEach((fn, index) => {
    evidence.push({
      id: `hotspot-${index + 1}`,
      kind: 'hotspot',
      label: fn.name,
      detail: `${fn.name} accounts for ${fn.percent}% of sampled time in ${fn.module}.`,
      value: fn.percent,
    });
  });

  task.findings.slice(0, 3).forEach((finding, index) => {
    evidence.push({
      id: `finding-${index + 1}`,
      kind: 'finding',
      label: finding.title,
      detail: `${finding.evidence} Recommendation: ${finding.recommendation}`,
    });
  });

  if (task.baselineComparison) {
    evidence.push({
      id: 'comparison-baseline',
      kind: 'comparison',
      label: `Baseline ${task.baselineComparison.verdict}`,
      detail: `${task.baselineComparison.summary} ${task.baselineComparison.changedHotspot}`,
    });
  }

  task.artifacts.slice(0, 2).forEach((artifact, index) => {
    evidence.push({
      id: `artifact-${index + 1}`,
      kind: 'artifact',
      label: artifact.label,
      detail: `${artifact.kind} stored at ${artifact.path}.`,
    });
  });

  const latestEvent = task.timeline.at(-1);
  if (latestEvent) {
    evidence.push({
      id: 'timeline-latest',
      kind: 'timeline',
      label: latestEvent.title,
      detail: latestEvent.detail,
    });
  }

  return {
    taskId: task.id,
    reportTitle: task.reportTitle,
    reportSummary: task.reportSummary,
    target: task.target,
    collector: task.collectorName,
    scenario: task.scenarioName,
    evidence,
    guardrails: [
      'Only cite evidence ids that are present in the input bundle.',
      'If evidence is insufficient, say the conclusion is limited.',
      'Do not invent source files, line numbers, or stack frames.',
    ],
  };
}

function metricEvidence(id: string, label: string, value: number): ReasonerEvidenceItem {
  return {
    id: `metric-${id}`,
    kind: 'metric',
    label,
    detail: `${label} is ${value}%.`,
    value,
  };
}

function buildDisabledReasonerOutput(input: ReasonerInput): ReasonerOutput {
  return {
    mode: 'disabled',
    summary: `LLM reasoner is disabled. Stored ${input.evidence.length} evidence items for a future grounded pass.`,
    findings: [],
    citations: [],
    generatedAt: new Date().toISOString(),
    guardrailStatus: 'enforced',
  };
}

function buildStubReasonerOutput(input: ReasonerInput): ReasonerOutput {
  const hotspot = input.evidence.find((item) => item.kind === 'hotspot');
  const comparison = input.evidence.find((item) => item.kind === 'comparison');
  const cpu = input.evidence.find((item) => item.id === 'metric-cpu');
  const findings = [
    hotspot
      ? {
          title: 'Dominant hotspot',
          detail: `${hotspot.label} is the clearest hot path in the stored evidence bundle.`,
          citations: [hotspot.id],
        }
      : null,
    comparison
      ? {
          title: 'Baseline comparison',
          detail: comparison.detail,
          citations: [comparison.id],
        }
      : null,
    cpu
      ? {
          title: 'CPU context',
          detail: cpu.detail,
          citations: [cpu.id],
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    mode: 'stub',
    summary:
      findings[0]?.detail ??
      'The stored evidence bundle does not yet support a stronger grounded summary.',
    findings,
    citations: findings.flatMap((item) => item.citations),
    generatedAt: new Date().toISOString(),
    guardrailStatus: 'enforced',
  };
}
