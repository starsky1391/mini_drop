import { useEffect, useMemo, useState } from 'react';
import type {
  CollectorInfo,
  ScenarioDefinition,
  TaskArtifact,
  TaskComparison,
  TaskCreateInput,
  TaskDetail,
  TaskSummary,
  FlameNode,
} from '../shared/types';

type CatalogResponse = {
  collectors: CollectorInfo[];
  scenarios: ScenarioDefinition[];
  collectorNotes: string[];
};

type TasksResponse = {
  tasks: TaskDetail[];
};

type ComparisonResponse = {
  comparison: TaskComparison;
};

type HotspotMovement = {
  name: string;
  module: string;
  before: number;
  after: number;
  delta: number;
  tone: 'improved' | 'regressed' | 'flat' | 'new';
  summary: string;
};

type EvidenceCitation = {
  label: string;
  evidence: string;
};

const defaultForm: TaskCreateInput = {
  target: 'orders-api@node-3',
  language: 'Go',
  collector: 'perf',
  scenario: 'cpu_hot',
};

const statusOrder: Record<TaskSummary['status'], number> = {
  queued: 0,
  running: 1,
  analyzing: 2,
  done: 3,
  failed: 4,
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function statusTone(status: TaskSummary['status']) {
  switch (status) {
    case 'done':
      return 'green';
    case 'running':
      return 'cyan';
    case 'analyzing':
      return 'amber';
    case 'failed':
      return 'rose';
    default:
      return 'slate';
  }
}

function verdictTone(verdict: TaskComparison['verdict'] | 'neutral') {
  switch (verdict) {
    case 'regression':
      return 'rose';
    case 'improvement':
      return 'green';
    case 'mixed':
      return 'amber';
    default:
      return 'slate';
  }
}

function artifactTone(kind: TaskArtifact['kind']) {
  switch (kind) {
    case 'speedscope':
      return 'cyan';
    case 'collapsed-stacks':
      return 'amber';
    case 'report':
      return 'green';
    case 'log':
      return 'rose';
    default:
      return 'slate';
  }
}

function maxDepth(node: FlameNode, depth = 0): number {
  if (!node.children?.length) return depth;
  return Math.max(depth, ...node.children.map((child) => maxDepth(child, depth + 1)));
}

function flattenFlameGraph(node: FlameNode) {
  const rows: Array<{ node: FlameNode; depth: number; x: number; width: number; path: string }> = [];
  const walk = (current: FlameNode, depth: number, x: number, width: number, path: string) => {
    rows.push({ node: current, depth, x, width, path });
    let cursor = x;
    for (const child of current.children ?? []) {
      const childWidth = width * (child.value / current.value);
      walk(child, depth + 1, cursor, childWidth, `${path}/${child.name}`);
      cursor += childWidth;
    }
  };
  walk(node, 0, 0, 1000, node.name);
  return rows;
}

function describeArtifact(artifact: TaskArtifact) {
  switch (artifact.kind) {
    case 'speedscope':
      return 'Interactive stack profile ready for speedscope-style inspection once artifact serving is wired.';
    case 'collapsed-stacks':
      return 'Collapsed stack format suitable for flame graph generation and stack aggregation checks.';
    case 'report':
      return 'Normalized collector report that the analysis layer used to build metrics and findings.';
    case 'log':
      return 'Collector or execution log captured alongside the run for audit and debugging.';
    default:
      return 'Raw collector output preserved for follow-up parsing and offline verification.';
  }
}

function artifactPreviewLabel(artifact: TaskArtifact) {
  switch (artifact.kind) {
    case 'speedscope':
      return 'Open in profile viewer';
    case 'collapsed-stacks':
      return 'Inspect collapsed stack lines';
    case 'report':
      return 'Inspect normalized report';
    case 'log':
      return 'Read execution log';
    default:
      return 'Inspect raw collector output';
  }
}

function pathTail(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.slice(-3).join(' / ');
}

function deriveHotspotMovements(current: TaskDetail | null, baseline: TaskDetail | null) {
  if (!current || !baseline) {
    return [] as HotspotMovement[];
  }

  const currentMap = new Map(current.topFunctions.map((item) => [item.name, item]));
  const baselineMap = new Map(baseline.topFunctions.map((item) => [item.name, item]));
  const names = Array.from(new Set([...baseline.topFunctions.slice(0, 4).map((item) => item.name), ...current.topFunctions.slice(0, 4).map((item) => item.name)]));

  return names.map((name) => {
    const before = baselineMap.get(name)?.percent ?? 0;
    const after = currentMap.get(name)?.percent ?? 0;
    const delta = Number((after - before).toFixed(1));
    let tone: HotspotMovement['tone'] = 'flat';
    let summary = 'Hotspot share stayed essentially flat across the two runs.';

    if (before === 0 && after > 0) {
      tone = 'new';
      summary = `New hotspot surfaced in the current run at ${formatPercent(after)} of sampled time.`;
    } else if (after === 0 && before > 0) {
      tone = 'improved';
      summary = `Previous hotspot disappeared from the current top stack set after dropping from ${formatPercent(before)}.`;
    } else if (delta >= 3) {
      tone = 'regressed';
      summary = `Hotspot expanded by ${formatPercent(Math.abs(delta))} and now accounts for ${formatPercent(after)}.`;
    } else if (delta <= -3) {
      tone = 'improved';
      summary = `Hotspot cooled by ${formatPercent(Math.abs(delta))} and now accounts for ${formatPercent(after)}.`;
    }

    return {
      name,
      module: currentMap.get(name)?.module ?? baselineMap.get(name)?.module ?? 'unknown',
      before,
      after,
      delta,
      tone,
      summary,
    };
  });
}

function buildReasonerDraft(task: TaskDetail, comparison: TaskComparison | null, baselineTask: TaskDetail | null) {
  const dominant = task.topFunctions[0];
  const worstMetric = [...comparison?.metricDeltas ?? []]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  const citations: EvidenceCitation[] = [
    {
      label: 'Hotspot evidence',
      evidence: dominant
        ? `${dominant.name} in ${dominant.module} owns ${dominant.percent}% of the sampled time.`
        : 'No top hotspot was available.',
    },
    {
      label: 'Runtime pressure',
      evidence: `CPU ${task.metrics.cpu}%, blocked ${task.metrics.blocked}%, GC ${task.metrics.gc}%, syscalls ${task.metrics.syscalls}%.`,
    },
    {
      label: 'Sample provenance',
      evidence: `${task.sampleCount} samples captured from ${task.sampleSource}.`,
    },
  ];

  if (comparison && baselineTask) {
    citations.push({
      label: 'Baseline delta',
      evidence: `${comparison.summary} ${comparison.changedHotspot}`,
    });
  }

  if (task.artifacts[0]) {
    citations.push({
      label: 'Artifact trail',
      evidence: `${task.artifacts[0].label} stored at ${pathTail(task.artifacts[0].path)}.`,
    });
  }

  const bullets = [
    task.reportSummary,
    comparison?.summary ?? task.trendSummary,
    task.findings[0]?.recommendation ?? 'Use the captured artifacts as the basis for the next validation run.',
  ].filter(Boolean);

  const emphasis = worstMetric
    ? `${worstMetric.label} moved by ${formatPercent(Math.abs(worstMetric.delta))} between the two runs.`
    : 'No baseline metric drift was available, so the draft stays anchored on the single-run evidence.';

  return {
    title: 'LLM reasoning preview',
    summary: `${task.primaryFinding} ${emphasis}`,
    bullets,
    citations,
  };
}

function FlameGraph({ root }: { root: FlameNode }) {
  const rows = useMemo(() => flattenFlameGraph(root), [root]);
  const height = (maxDepth(root) + 1) * 42 + 12;

  return (
    <svg className="flamegraph" viewBox={`0 0 1000 ${height}`} role="img" aria-label="Performance flame graph">
      {rows.map(({ node, depth, x, width, path }) => {
        const barY = height - (depth + 1) * 42;
        const fill = node.color ?? 'var(--frame-muted)';
        const label = `${node.name} (${node.value})`;
        return (
          <g key={path}>
            <rect x={x} y={barY} width={width} height={34} rx={10} fill={fill} opacity={depth === 0 ? 0.95 : 0.88} />
            {width > 72 ? (
              <text x={x + 10} y={barY + 21} className="flame-label">
                {label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <article className={`stat-card stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function App() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [tasks, setTasks] = useState<TaskDetail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<TaskComparison | null>(null);
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string | null>(null);
  const [form, setForm] = useState<TaskCreateInput>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function loadAll() {
      try {
        const [catalogRes, tasksRes] = await Promise.all([fetch('/api/catalog'), fetch('/api/tasks')]);
        const nextCatalog = (await catalogRes.json()) as CatalogResponse;
        const nextTasks = (await tasksRes.json()) as TasksResponse;
        if (ignore) return;
        setCatalog(nextCatalog);
        setTasks(nextTasks.tasks.sort((a, b) => statusOrder[b.status] - statusOrder[a.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
        setSelectedId((current) => current ?? nextTasks.tasks[0]?.id ?? null);
        setBaselineId((current) => current ?? nextTasks.tasks[1]?.id ?? nextTasks.tasks[0]?.id ?? null);
        setLoading(false);
      } catch (fetchError) {
        if (!ignore) {
          setError(fetchError instanceof Error ? fetchError.message : 'Unable to load Mini-Drop');
          setLoading(false);
        }
      }
    }

    loadAll();
    const timer = window.setInterval(loadAll, 2000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!catalog) {
      return;
    }

    const compatible = catalog.collectors.filter((collector) => collector.languageCoverage.includes(form.language));
    if (compatible.length > 0 && !compatible.some((collector) => collector.id === form.collector)) {
      setForm((current) => ({ ...current, collector: compatible[0].id }));
    }
  }, [catalog, form.collector, form.language]);

  useEffect(() => {
    let ignore = false;

    async function loadComparison() {
      if (!selectedId || !baselineId || selectedId === baselineId) {
        setComparison(null);
        return;
      }

      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(selectedId)}/compare/${encodeURIComponent(baselineId)}`);
        if (!response.ok) {
          setComparison(null);
          return;
        }
        const data = (await response.json()) as ComparisonResponse;
        if (!ignore) {
          setComparison(data.comparison);
        }
      } catch {
        if (!ignore) {
          setComparison(null);
        }
      }
    }

    loadComparison();
    return () => {
      ignore = true;
    };
  }, [baselineId, selectedId, tasks]);

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null;
  const baselineTask = tasks.find((task) => task.id === baselineId) ?? tasks[1] ?? null;

  useEffect(() => {
    setSelectedArtifactPath(selectedTask?.artifacts[0]?.path ?? null);
  }, [selectedTask?.id]);

  const activeTasks = tasks.filter((task) => task.status === 'running' || task.status === 'queued' || task.status === 'analyzing').length;
  const doneTasks = tasks.filter((task) => task.status === 'done').length;
  const avgConfidence = tasks.length
    ? Math.round((tasks.reduce((sum, task) => sum + task.confidence, 0) / tasks.length) * 100)
    : 0;

  const compatibleCollectors = useMemo(
    () => catalog?.collectors.filter((collector) => collector.languageCoverage.includes(form.language)) ?? [],
    [catalog, form.language],
  );

  const hotspotMovements = useMemo(
    () => deriveHotspotMovements(selectedTask, baselineTask),
    [baselineTask, selectedTask],
  );

  const reasonerDraft = useMemo(
    () => (selectedTask ? buildReasonerDraft(selectedTask, comparison, baselineTask) : null),
    [baselineTask, comparison, selectedTask],
  );

  const selectedArtifact = selectedTask?.artifacts.find((artifact) => artifact.path === selectedArtifactPath) ?? selectedTask?.artifacts[0] ?? null;

  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? 'Failed to create task');
      }
      const data = (await response.json()) as { task: TaskDetail };
      setTasks((current) => [data.task, ...current.filter((task) => task.id !== data.task.id)]);
      setSelectedId(data.task.id);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="shell booting">Warming up Mini-Drop...</div>;
  }

  return (
    <div className="shell">
      <aside className="hero-panel">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Mini-Drop</p>
            <h1>Performance diagnosis, compressed into one crisp control plane.</h1>
          </div>
          <div className="status-pill">Live profiling demo</div>
        </div>

        <p className="lede">
          Launch a diagnostic run, watch the task move through the lifecycle, and inspect the resulting
          flame graph plus evidence-backed findings.
        </p>

        <div className="stat-grid">
          <StatCard label="Tasks active" value={String(activeTasks)} hint="queued, running, or analyzing" tone="cyan" />
          <StatCard label="Tasks done" value={String(doneTasks)} hint="ready for review" tone="green" />
          <StatCard label="Avg confidence" value={`${avgConfidence}%`} hint="analysis certainty" tone="amber" />
        </div>

        <form className="launch-form" onSubmit={submitTask}>
          <div className="form-intro">
            <h2>Launch diagnosis</h2>
            <p>Pick a target, keep collector-language combinations compatible, and start a new evidence trail.</p>
          </div>

          <label>
            Target service
            <input
              value={form.target}
              onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
              placeholder="orders-api@node-3"
            />
          </label>

          <div className="form-row">
            <label>
              Language
              <select
                value={form.language}
                onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}
              >
                <option>Go</option>
                <option>Java</option>
                <option>Python</option>
                <option>C++</option>
              </select>
            </label>

            <label>
              Collector
              <select
                value={form.collector}
                onChange={(event) =>
                  setForm((current) => ({ ...current, collector: event.target.value as TaskCreateInput['collector'] }))
                }
              >
                {catalog?.collectors.map((collector) => (
                  <option key={collector.id} value={collector.id}>
                    {collector.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Scenario
            <select
              value={form.scenario}
              onChange={(event) =>
                setForm((current) => ({ ...current, scenario: event.target.value as TaskCreateInput['scenario'] }))
              }
            >
              {catalog?.scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name}
                </option>
              ))}
            </select>
          </label>

          <div className="compatibility-card">
            <span>Compatible collectors</span>
            <div className="chip-row">
              {compatibleCollectors.map((collector) => (
                <span
                  key={collector.id}
                  className={`micro-chip ${collector.id === form.collector ? 'micro-chip-active' : ''}`}
                >
                  {collector.name}
                </span>
              ))}
              {compatibleCollectors.length === 0 ? <span className="micro-chip">No exact collector match</span> : null}
            </div>
          </div>

          <button type="submit" disabled={submitting}>
            {submitting ? 'Launching...' : 'Launch diagnosis'}
          </button>
        </form>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className="notes-card">
          <h2>Collector notes</h2>
          <ul>
            {catalog?.collectorNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      </aside>

      <main className="workspace">
        <section className="section-block">
          <div className="section-head">
            <h2>Task stream</h2>
            <span>{tasks.length} diagnostics tracked</span>
          </div>

          <div className="task-list">
            {tasks.map((task) => (
              <button
                key={task.id}
                className={`task-item ${task.id === selectedId ? 'selected' : ''}`}
                onClick={() => setSelectedId(task.id)}
              >
                <div className="task-topline">
                  <strong>{task.title}</strong>
                  <span className={`tone tone-${statusTone(task.status)}`}>{task.status}</span>
                </div>
                <p>
                  {task.collectorName} • {task.scenarioName} • {task.language}
                </p>
                <div className="task-progress">
                  <span>Progress</span>
                  <div className="progress-track">
                    <div className={`progress-fill tone-${statusTone(task.status)}`} style={{ width: `${task.progress}%` }} />
                  </div>
                  <strong>{task.progress}%</strong>
                </div>
                <div className="task-meta">
                  <span>{task.target}</span>
                  <span>{formatTime(task.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        {selectedTask ? (
          <>
            <section className="section-block report-panel">
              <div className="section-head">
                <div>
                  <h2>{selectedTask.reportTitle}</h2>
                  <p className="section-subtitle">{selectedTask.primaryFinding}</p>
                </div>
                <div className="header-badges">
                  <span className={`tone tone-${statusTone(selectedTask.status)}`}>{selectedTask.status}</span>
                  <span className="tone tone-green">{Math.round(selectedTask.confidence * 100)}% confidence</span>
                </div>
              </div>

              <div className="summary-grid">
                <article className="summary-card">
                  <span>Run scope</span>
                  <strong>{selectedTask.collectorName}</strong>
                  <small>
                    {selectedTask.scenarioName} on {selectedTask.target}
                  </small>
                </article>
                <article className="summary-card">
                  <span>Sample source</span>
                  <strong>{selectedTask.sampleSource}</strong>
                  <small>{selectedTask.sampleCount} samples captured</small>
                </article>
                <article className="summary-card">
                  <span>Trend posture</span>
                  <strong>{selectedTask.baselineComparison?.verdict ?? 'neutral'}</strong>
                  <small>{selectedTask.trendSummary}</small>
                </article>
              </div>

              <p className="report-summary">{selectedTask.reportSummary}</p>
              <p className="report-summary">{selectedTask.analysisSummary}</p>

              <div className="metric-strip">
                <StatCard label="CPU" value={`${selectedTask.metrics.cpu}%`} hint="sampled utilization" tone="cyan" />
                <StatCard label="Blocked" value={`${selectedTask.metrics.blocked}%`} hint="lock or wait time" tone="rose" />
                <StatCard label="GC" value={`${selectedTask.metrics.gc}%`} hint="runtime pause share" tone="amber" />
                <StatCard label="Syscalls" value={`${selectedTask.metrics.syscalls}%`} hint="kernel crossings" tone="green" />
              </div>

              <div className="finding-list">
                {selectedTask.findings.map((finding) => (
                  <article key={finding.title} className={`finding finding-${finding.severity}`}>
                    <div className="finding-head">
                      <strong>{finding.title}</strong>
                      <span>{finding.severity}</span>
                    </div>
                    <p>{finding.evidence}</p>
                    <small>{finding.recommendation}</small>
                  </article>
                ))}
              </div>
            </section>

            <section className="section-block comparison-panel">
              <div className="section-head">
                <h2>Run comparison</h2>
                <span>Baseline vs current</span>
              </div>

              <div className="comparison-controls">
                <label>
                  Baseline run
                  <select value={baselineId ?? ''} onChange={(event) => setBaselineId(event.target.value || null)}>
                    <option value="">Choose baseline</option>
                    {tasks
                      .filter((task) => task.id !== selectedTask.id)
                      .map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.title}
                        </option>
                      ))}
                  </select>
                </label>
                <div className={`comparison-summary verdict-${verdictTone(comparison?.verdict ?? 'neutral')}`}>
                  <strong>{comparison?.verdict ?? 'neutral'}</strong>
                  <p>{comparison?.summary ?? 'Select another run to compare pressure and hotspot movement.'}</p>
                </div>
              </div>

              {comparison && baselineTask ? (
                <>
                  <div className="comparison-grid">
                    <article className="comparison-card">
                      <span>Current vs baseline</span>
                      <strong>{comparison.totalPressureDelta > 0 ? '+' : ''}{comparison.totalPressureDelta.toFixed(1)} pressure</strong>
                      <small>{comparison.changedHotspot}</small>
                    </article>
                    <article className="comparison-card">
                      <span>Confidence delta</span>
                      <strong>{comparison.confidenceDelta > 0 ? '+' : ''}{comparison.confidenceDelta.toFixed(1)}%</strong>
                      <small>Compared with {baselineTask.reportTitle}</small>
                    </article>
                    <article className="comparison-card comparison-wide">
                      <span>Metric shifts</span>
                      <div className="comparison-metrics">
                        {comparison.metricDeltas.map((metric) => (
                          <div key={metric.metric} className={`comparison-metric metric-${metric.trend}`}>
                            <strong>{metric.label}</strong>
                            <span>
                              {metric.before}% → {metric.after}% ({metric.delta > 0 ? '+' : ''}
                              {metric.delta.toFixed(1)}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  </div>

                  <div className="movement-grid">
                    {hotspotMovements.map((movement) => (
                      <article key={movement.name} className={`movement-card movement-${movement.tone}`}>
                        <div className="movement-head">
                          <strong>{movement.name}</strong>
                          <span>{movement.delta > 0 ? '+' : ''}{movement.delta.toFixed(1)}%</span>
                        </div>
                        <p>{movement.summary}</p>
                        <small>
                          {movement.module} • {movement.before}% → {movement.after}%
                        </small>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
            </section>

            <section className="section-block artifact-panel">
              <div className="section-head">
                <h2>Artifacts and logs</h2>
                <span>{selectedTask.artifacts.length} artifacts retained</span>
              </div>

              <div className="artifact-workspace">
                <div className="artifact-list">
                  {selectedTask.artifacts.map((artifact) => (
                    <button
                      key={`${artifact.kind}-${artifact.path}`}
                      className={`artifact-card artifact-${artifactTone(artifact.kind)} ${selectedArtifact?.path === artifact.path ? 'artifact-selected' : ''}`}
                      onClick={() => setSelectedArtifactPath(artifact.path)}
                    >
                      <div className="artifact-head">
                        <strong>{artifact.label}</strong>
                        <span>{artifact.kind}</span>
                      </div>
                      <p>{describeArtifact(artifact)}</p>
                      <small>{pathTail(artifact.path)}</small>
                    </button>
                  ))}
                </div>

                <article className="artifact-preview">
                  <div className="artifact-preview-head">
                    <div>
                      <span className="preview-label">Selected artifact</span>
                      <h3>{selectedArtifact?.label ?? 'No artifact selected'}</h3>
                    </div>
                    {selectedArtifact ? <span className={`tone tone-${artifactTone(selectedArtifact.kind)}`}>{selectedArtifact.kind}</span> : null}
                  </div>

                  {selectedArtifact ? (
                    <>
                      <p>{describeArtifact(selectedArtifact)}</p>
                      <div className="preview-meta">
                        <div>
                          <span>Artifact path</span>
                          <strong>{selectedArtifact.path}</strong>
                        </div>
                        <div>
                          <span>Suggested action</span>
                          <strong>{artifactPreviewLabel(selectedArtifact)}</strong>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p>Select an artifact card to review how this run was persisted for offline analysis.</p>
                  )}

                  <div className="collector-logs">
                    {selectedTask.collectorLogs.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </article>
              </div>
            </section>

            <section className="section-block flame-panel">
              <div className="section-head">
                <h2>Flame graph</h2>
                <span>{selectedTask.signal}</span>
              </div>
              <FlameGraph root={selectedTask.flameGraph} />
            </section>

            <section className="section-block evidence-panel">
              <div className="section-head">
                <h2>Evidence chain</h2>
                <span>Task timeline and ranked hotspots</span>
              </div>

              <div className="timeline">
                {selectedTask.timeline.map((event) => (
                  <article key={`${event.at}-${event.title}`} className="timeline-item">
                    <time>{formatTime(event.at)}</time>
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.detail}</p>
                    </div>
                  </article>
                ))}
              </div>

              <div className="function-table">
                <div className="table-head">
                  <span>Hot function</span>
                  <span>Share</span>
                  <span>Module</span>
                </div>
                {selectedTask.topFunctions.map((fn) => (
                  <div key={fn.name} className="table-row">
                    <span>{fn.name}</span>
                    <span>{fn.percent}%</span>
                    <span>{fn.module}</span>
                  </div>
                ))}
              </div>

              <div className="insight-list">
                {selectedTask.insights.map((insight) => (
                  <article key={insight.title} className={`insight-card insight-${insight.direction}`}>
                    <strong>{insight.title}</strong>
                    <p>{insight.evidence}</p>
                    <small>{insight.attribution}</small>
                  </article>
                ))}
              </div>
            </section>

            {reasonerDraft ? (
              <section className="section-block reasoner-panel">
                <div className="section-head">
                  <h2>{reasonerDraft.title}</h2>
                  <span>Rule-backed until API model is connected</span>
                </div>

                <div className="reasoner-shell">
                  <article className="reasoner-summary">
                    <span>Draft summary</span>
                    <strong>{reasonerDraft.summary}</strong>
                    <ul className="reasoner-bullets">
                      {reasonerDraft.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  </article>

                  <article className="citation-panel">
                    <span>Evidence citations</span>
                    <div className="citation-list">
                      {reasonerDraft.citations.map((citation) => (
                        <div key={citation.label} className="citation-card">
                          <strong>{citation.label}</strong>
                          <p>{citation.evidence}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <section className="section-block empty-state">
            <h2>No task selected yet</h2>
            <p>Create a run to inspect how the evidence chain appears end to end.</p>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
