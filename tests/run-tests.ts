import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentRunController } from '../server/agent/run-registry.js';
import { createTaskDetail } from '../server/analysis.js';
import { normalizeCollectorOutcome } from '../server/analysis/normalize.js';
import { compareTasks } from '../server/comparison.js';
import { buildCollectionPathSummary } from '../server/collectors/collection-path.js';
import { assessAsyncProfilerCollection } from '../server/collectors/async-profiler.js';
import { assessEbpfCollection } from '../server/collectors/ebpf.js';
import { assessPerfCollection } from '../server/collectors/perf.js';
import {
  parseBpftraceSnapshot,
  parseCollapsedStacks,
  parsePerfScript,
  parseSpeedscopeProfile,
} from '../server/collectors/profile-utils.js';
import { assessPySpyCollection } from '../server/collectors/pyspy.js';
import { createQueuedTask } from '../server/analysis.js';
import { buildReasonerSnapshot } from '../server/llm/index.js';
import { filterEvidenceCitations } from '../server/llm/index.js';
import {
  buildContinuousProfileSlice,
  loadContinuousProfileWindow,
  retainTaskContinuousProfileSlice,
  saveContinuousProfileSlices,
} from '../server/profiling-slices.js';
import {
  saveTask,
  getTaskReasonerSnapshot,
  listAuditEvents,
  getTask,
  buildTaskResultIndex,
  upsertAgent,
} from '../server/store.js';
import { cancelTaskExecution, collectTaskExecution } from '../server/execution.js';
import {
  acceptAgentHeartbeat,
  acceptAgentUploadResult,
  loadArtifactPreview,
  loadLocalProcesses,
  loadTaskContinuousProfile,
  loadTaskRunState,
  pollAgentTask,
  registerAgent,
  sweepOfflineAgents,
  validateTaskCreateInput,
} from '../server/services/task-service.js';
import { readStagedCollectorOutcome } from '../server/storage/repository.js';
import { buildTaskTrends } from '../server/trends.js';
import { collectorCapabilities } from '../server/collectors/index.js';
import { probeAgentEnvironment } from '../server/agent/probe.js';
import { collectors } from '../shared/catalog.js';
import { buildFlameGraphRows, searchFlameGraph } from '../src/flamegraph-utils.js';
import { attachSourceLabel, formatProcessSummary, normalizeDetailTabSelection, visibleDetailTabs } from '../src/ui-model.js';

test('createTaskDetail returns a complete report', () => {
  const task = createTaskDetail({
    target: 'payments-api@node-7',
    language: 'Java',
    collector: 'async-profiler',
    scenario: 'gc_pressure',
  });

  assert.equal(task.status, 'DONE');
  assert.equal(task.reportTitle, 'GC 压力 诊断');
  assert.ok(task.primaryFinding.length > 0);
  assert.equal(task.findings.length, 3);
  assert.equal(task.topFunctions[0]?.name, 'ObjectAllocator::new');
  assert.ok(task.topFunctions[0]?.locationSummary);
  assert.ok(task.topFunctions[0]?.mappingState);
});

test('flamegraph utils hide the synthetic root and support focus-plus-search workflows', () => {
  const task = createTaskDetail({
    target: 'flamegraph-api@local',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });

  const rows = buildFlameGraphRows(task.flameGraph, { focusPath: null });
  assert.ok(rows.length > 0);
  assert.notEqual(rows[0]?.node.name, 'all');

  const focusRow = rows.find((row) => row.node.name === task.topFunctions[0]?.name) ?? rows[0];
  assert.ok(focusRow);

  const focusedRows = buildFlameGraphRows(task.flameGraph, { focusPath: focusRow?.path ?? null });
  assert.ok(focusedRows.length > 0);
  assert.equal(focusedRows[0]?.node.name, focusRow?.node.name);

  const matches = searchFlameGraph(task.flameGraph, (focusRow?.node.name ?? '').slice(0, 4), null);
  assert.ok(matches.length > 0);
  assert.ok(matches.some((match) => match.node.name === focusRow?.node.name));
});

test('validateTaskCreateInput resolves pid targets against a live local process', async () => {
  const parsed = await validateTaskCreateInput({
    targetType: 'pid',
    pid: process.pid,
    language: 'Node.js',
    collector: 'perf',
    scenario: 'cpu_hot',
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }

  assert.equal(parsed.value.targetType, 'pid');
  assert.equal(parsed.value.pid, process.pid);
  assert.equal(parsed.value.attachSource, 'external-pid');
  assert.equal(parsed.value.processInfo?.pid, process.pid);
  assert.ok(parsed.value.target.length > 0);
});

test('validateTaskCreateInput rejects missing local pid targets', async () => {
  const parsed = await validateTaskCreateInput({
    targetType: 'pid',
    pid: 999999999,
    language: 'Node.js',
    collector: 'perf',
    scenario: 'cpu_hot',
  });

  assert.equal(parsed.ok, false);
  if (parsed.ok) {
    throw new Error('Expected invalid PID validation failure.');
  }
  assert.equal(parsed.error.code, 'target_process_not_found');
});

test('loadLocalProcesses returns local process metadata with pid and command summaries', async () => {
  const response = await loadLocalProcesses();
  assert.ok(response.collectedAt.length > 0);
  assert.ok(Array.isArray(response.processes));
  assert.ok(response.processes.length > 0);

  const sampleProcess = response.processes.find((item) => item.pid === process.pid) ?? response.processes[0];
  assert.ok(sampleProcess);
  assert.ok(sampleProcess.pid > 0);
  assert.ok((sampleProcess.commandSummary ?? '').length > 0);
});

test('ui detail tabs hide reasoner until data exists and normalize invalid selections', () => {
  assert.deepEqual(
    visibleDetailTabs(false).map((item) => item.id),
    ['compare', 'artifacts', 'audit', 'flame', 'evidence'],
  );
  assert.deepEqual(
    visibleDetailTabs(true).map((item) => item.id),
    ['compare', 'artifacts', 'audit', 'flame', 'evidence', 'reasoner'],
  );
  assert.equal(normalizeDetailTabSelection('reasoner', false), 'compare');
  assert.equal(normalizeDetailTabSelection('artifacts', false), 'artifacts');
  assert.equal(normalizeDetailTabSelection(null, true), 'compare');
});

test('ui copy keeps Chinese labels while preserving raw technical collector names', () => {
  const displayNames = collectors.map((collector) => collector.displayNameZh);
  assert.ok(displayNames.includes('py-spy'));
  assert.ok(displayNames.includes('async-profiler'));
  assert.ok(displayNames.includes('eBPF Probe Set'));
  assert.match(attachSourceLabel('managed-fallback'), /managed workload fallback/);
  assert.match(attachSourceLabel('external-pid'), /PID/);
});

test('formatProcessSummary keeps PID and runtime hints visible in Chinese UI', () => {
  assert.equal(formatProcessSummary(null), '未保留真实进程上下文');
  assert.equal(
    formatProcessSummary({
      pid: 4321,
      name: 'node',
      command: 'node server.js',
      commandSummary: 'node server.js',
      languageHint: 'Node.js',
      alive: true,
    }),
    'PID 4321 • node • Node.js • node server.js',
  );
});

test('compareTasks detects regressions and improvements', () => {
  const baseline = createTaskDetail({
    target: 'orders-api@node-3',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });

  const current = createTaskDetail({
    target: 'orders-api@node-3',
    language: 'Go',
    collector: 'perf',
    scenario: 'lock_contention',
  });

  const comparison = compareTasks(baseline, current);

  assert.equal(comparison.baselineId, baseline.id);
  assert.equal(comparison.currentId, current.id);
  assert.equal(comparison.metricDeltas.length, 4);
  assert.ok(comparison.summary.length > 0);
  assert.equal(comparison.baseline.taskId, baseline.id);
  assert.equal(comparison.current.taskId, current.id);
  assert.ok(comparison.hotspotShift.sharedHotspots.length >= 0);
  assert.ok(Array.isArray(comparison.evidence));
});

test('parsePerfScript preserves weighted stacks and caller evidence', () => {
  const parsed = parsePerfScript(`
python3 1234/1234 [002] 1000.001: 41 cpu-clock:
        7ff6a3 parse_message+0x08 (app/parser.py)
        7ff6a2 walk_rows+0x18 (app/rows.py)
        7ff6a1 frame_eval+0x10 (python/ceval.c)

python3 1234/1234 [002] 1000.002: 21 cpu-clock:
        7ff6a4 emit_metrics+0x05 (infra/metrics.py)
        7ff6a2 walk_rows+0x18 (app/rows.py)
        7ff6a1 frame_eval+0x10 (python/ceval.c)
`);

  assert.ok(parsed);
  assert.equal(parsed.usedRealData, true);
  assert.equal(parsed.evidence.sourceKind, 'perf-script');
  assert.equal(parsed.evidence.threadCount, 1);
  assert.equal(parsed.topFunctions[0]?.name, 'parse_message');
  assert.ok(parsed.evidence.hotspots[0]?.representativeStack.length >= 2);
  assert.match(parsed.collapsedStacks, /frame_eval/);
});

test('parseSpeedscopeProfile preserves file and line evidence', () => {
  const parsed = parseSpeedscopeProfile(
    JSON.stringify({
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      shared: {
        frames: [
          { name: 'process_rows', file: 'app/rows.py', line: 12 },
          { name: 'frame_eval', file: 'python/ceval.c', line: 3021 },
          { name: 'parse_message', file: 'app/parser.py', line: 87 },
        ],
      },
      profiles: [
        {
          type: 'sampled',
          name: 'MainThread',
          unit: 'samples',
          samples: [
            [0, 1, 2],
            [0, 1, 2],
          ],
          weights: [5, 7],
        },
      ],
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed.usedRealData, true);
  assert.equal(parsed.evidence.sourceKind, 'speedscope');
  assert.equal(parsed.topFunctions[0]?.name, 'parse_message');
  assert.equal(parsed.evidence.hotspots[0]?.leaf.file, 'parser.py');
  assert.equal(parsed.evidence.hotspots[0]?.leaf.line, 87);
  assert.equal(parsed.evidence.threadCount, 1);
});

test('parseCollapsedStacks preserves weighted hotspots for collapsed collectors', () => {
  const parsed = parseCollapsedStacks(`
handleRequest;java.lang.Thread.run;com.acme.Service.process(Service.java:42) 11
handleRequest;java.lang.Thread.run;com.acme.Service.process(Service.java:42) 7
handleRequest;java.util.concurrent.ForkJoinTask.exec;com.acme.Buffer.copy(Buffer.java:18) 5
`);

  assert.ok(parsed);
  assert.equal(parsed.usedRealData, true);
  assert.equal(parsed.evidence.sourceKind, 'collapsed-stacks');
  assert.equal(parsed.topFunctions[0]?.name, 'com.acme.Service.process');
  assert.equal(parsed.evidence.hotspots[0]?.leaf.file, 'Service.java');
  assert.equal(parsed.evidence.hotspots[0]?.leaf.line, 42);
});

test('parseBpftraceSnapshot preserves normalized hotspots when raw snapshots are parseable', () => {
  const parsed = parseBpftraceSnapshot(`
@[ustack]:
    libc.so\`pthread_mutex_lock+0x1
    app.so\`decodeFields+0x3
    app.so\`compressPayload+0x8
    6

@[ustack]:
    libc.so\`pthread_mutex_lock+0x1
    app.so\`decodeFields+0x3
    app.so\`writeResponse+0x2
    3
`);

  assert.ok(parsed);
  assert.equal(parsed?.usedRealData, true);
  assert.equal(parsed?.evidence.sourceKind, 'bpftrace-raw');
  assert.equal(parsed?.topFunctions[0]?.name, 'compressPayload');
  assert.match(parsed?.collapsedStacks ?? '', /compressPayload/);
});

test('collector registry exposes async-profiler and ebpf plugins', () => {
  const ids = collectorCapabilities.map((capability) => capability.id);
  assert.ok(ids.includes('async-profiler'));
  assert.ok(ids.includes('ebpf'));
});

test('buildCollectionPathSummary describes the real or fallback branch explicitly', () => {
  const summary = buildCollectionPathSummary({
    collector: 'async-profiler',
    mode: 'fallback',
    command: 'asprof --help',
    reason: 'binary missing',
    sourceKind: 'workload-fallback',
    rawSignal: 'jvm-stack-sampling:fallback',
    expectedArtifacts: ['collapsed', 'report'],
  });

  assert.match(summary, /mode=fallback/);
  assert.match(summary, /source=workload-fallback/);
  assert.match(summary, /reason=binary missing/);
});

test('buildCollectionPathSummary preserves partial-real collection paths explicitly', () => {
  const summary = buildCollectionPathSummary({
    collector: 'ebpf',
    mode: 'partial-real',
    command: 'bpftrace --version',
    reason: 'raw snapshot retained while hotspot shaping fell back',
    sourceKind: 'bpftrace-raw',
    rawSignal: 'kernel-aware-sampling:bpftrace-raw',
    expectedArtifacts: ['raw snapshot', 'collapsed fallback'],
  });

  assert.match(summary, /mode=partial-real/);
  assert.match(summary, /source=bpftrace-raw/);
});

test('buildCollectionPathSummary can report retained-versus-missing artifacts', () => {
  const summary = buildCollectionPathSummary(
    {
      collector: 'perf',
      mode: 'fallback',
      command: 'perf record -F 99',
      reason: 'script output missing',
      sourceKind: 'workload-fallback',
      rawSignal: 'native-stack-sampling:fallback',
      expectedArtifacts: ['perf.data', 'perf script output', 'Collector report'],
    },
    {
      retained: ['perf.data', 'Collector report'],
      matched: ['perf.data', 'Collector report'],
      missing: ['perf script output'],
    },
  );

  assert.match(summary, /retained=2\/3/);
  assert.match(summary, /missing=perf script output/);
});

test('assessPerfCollection distinguishes real captures from empty-script fallback paths', () => {
  const real = assessPerfCollection({
    platform: 'linux',
    command: 'perf record -F 99',
    commandError: null,
    perfDataRecovered: false,
    scriptOutputHadFrames: true,
    parsedProfile: {
      usedRealData: true,
      sampleCount: 17,
      evidence: { sourceKind: 'perf-script' },
    } as never,
  });
  assert.equal(real.mode, 'real');
  assert.match(real.reason, /17 normalized stack sample/);

  const fallback = assessPerfCollection({
    platform: 'linux',
    command: 'perf record -F 99',
    commandError: null,
    perfDataRecovered: true,
    scriptOutputHadFrames: false,
    parsedProfile: null,
  });
  assert.equal(fallback.mode, 'fallback');
  assert.match(fallback.reason, /did not retain a usable perf\.data payload/i);

  const partial = assessPerfCollection({
    platform: 'linux',
    command: 'perf record -F 99',
    commandError: null,
    perfDataRecovered: false,
    scriptOutputHadFrames: false,
    parsedProfile: null,
  });
  assert.equal(partial.mode, 'partial-real');
  assert.match(partial.rawSignal, /perf-data:partial/);
});

test('assessPySpyCollection distinguishes retained speedscope output from placeholder fallback paths', () => {
  const real = assessPySpyCollection({
    command: 'py-spy record --pid 42',
    commandError: null,
    speedscopeRecovered: false,
    speedscopeArtifactRetained: true,
    parsedProfile: {
      usedRealData: true,
      sampleCount: 23,
      evidence: { sourceKind: 'speedscope' },
    } as never,
  });
  assert.equal(real.mode, 'real');
  assert.match(real.reason, /23 normalized stack sample/);

  const fallback = assessPySpyCollection({
    command: 'py-spy record --pid 42',
    commandError: null,
    speedscopeRecovered: true,
    speedscopeArtifactRetained: true,
    parsedProfile: null,
  });
  assert.equal(fallback.mode, 'fallback');
  assert.match(fallback.reason, /no retained speedscope payload/i);

  const partial = assessPySpyCollection({
    command: 'py-spy record --pid 42',
    commandError: null,
    speedscopeRecovered: false,
    speedscopeArtifactRetained: true,
    parsedProfile: null,
  });
  assert.equal(partial.mode, 'partial-real');
  assert.match(partial.rawSignal, /py-spy:partial/);
});

test('assessAsyncProfilerCollection distinguishes real, partial-real, and fallback JVM capture paths', () => {
  const real = assessAsyncProfilerCollection({
    command: 'asprof -d 8 -f out.collapsed -o collapsed 1234',
    commandError: null,
    requestedPid: 1234,
    collapsedArtifactRetained: true,
    parsedProfile: {
      usedRealData: true,
      sampleCount: 31,
      evidence: { sourceKind: 'async-profiler-collapsed' },
    } as never,
  });
  assert.equal(real.mode, 'real');
  assert.match(real.reason, /PID 1234/);

  const partial = assessAsyncProfilerCollection({
    command: 'asprof -d 8 -f out.collapsed -o collapsed 1234',
    commandError: null,
    requestedPid: 1234,
    collapsedArtifactRetained: true,
    parsedProfile: {
      usedRealData: false,
      sampleCount: 0,
      evidence: { sourceKind: 'async-profiler-collapsed' },
    } as never,
  });
  assert.equal(partial.mode, 'partial-real');
  assert.match(partial.reason, /collapsed artifact/i);
  assert.match(partial.rawSignal, /async-profiler:partial/);

  const fallback = assessAsyncProfilerCollection({
    command: null,
    commandError: null,
    requestedPid: 1234,
    collapsedArtifactRetained: false,
    parsedProfile: null,
  });
  assert.equal(fallback.mode, 'fallback');
  assert.match(fallback.reason, /binary was unavailable/i);
});

test('assessEbpfCollection distinguishes raw-snapshot partial-real paths from fallback', () => {
  const real = assessEbpfCollection({
    platform: 'linux',
    command: 'bpftrace -e profile:hz:99',
    commandError: null,
    rawSnapshot: '@[ustack]:\n    app`decodeFields+0x1\n    app`compressPayload+0x2\n    4',
    parsedProfile: {
      usedRealData: true,
      sampleCount: 4,
      evidence: { sourceKind: 'bpftrace-raw' },
    } as never,
    requestedPid: 4321,
  });
  assert.equal(real.mode, 'real');
  assert.match(real.reason, /normalized stack sample/);

  const partial = assessEbpfCollection({
    platform: 'linux',
    command: 'bpftrace -e profile:hz:99',
    commandError: null,
    rawSnapshot: '@[ustack]: 4',
    parsedProfile: null,
    requestedPid: 4321,
  });
  assert.equal(partial.mode, 'partial-real');
  assert.match(partial.reason, /PID 4321/);

  const fallback = assessEbpfCollection({
    platform: 'linux',
    command: 'bpftrace -e profile:hz:99',
    commandError: 'permission denied',
    rawSnapshot: '',
    parsedProfile: null,
    requestedPid: 4321,
  });
  assert.equal(fallback.mode, 'fallback');
  assert.match(fallback.reason, /permission denied/i);
});

test('probeAgentEnvironment defers perf and ebpf on non-linux platforms with explicit deferred-for-linux-proof readiness', async () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

  try {
    const perfProbe = await probeAgentEnvironment({
      capability: {
        id: 'perf',
        name: 'perf',
        languages: ['C++'],
        description: 'test plugin',
        supportsRealCollection: true,
      },
      async collect() {
        throw new Error('not used');
      },
    });

    assert.equal(perfProbe.collectors[0]?.collector, 'perf');
    assert.equal(perfProbe.collectors[0]?.readiness, 'deferred-for-linux-proof');
    assert.equal(perfProbe.collectors[0]?.available, false);
    assert.match(perfProbe.collectors[0]?.detail ?? '', /deferred-for-linux-proof/);

    const ebpfProbe = await probeAgentEnvironment({
      capability: {
        id: 'ebpf',
        name: 'eBPF',
        languages: ['Linux'],
        description: 'test plugin',
        supportsRealCollection: true,
      },
      async collect() {
        throw new Error('not used');
      },
    });

    assert.equal(ebpfProbe.collectors[0]?.collector, 'ebpf');
    assert.equal(ebpfProbe.collectors[0]?.readiness, 'deferred-for-linux-proof');
    assert.equal(ebpfProbe.collectors[0]?.available, false);
    assert.match(ebpfProbe.collectors[0]?.detail ?? '', /deferred-for-linux-proof/);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

test('probeAgentEnvironment includes explicit command availability details for async-profiler', async () => {
  const previous = process.env.MINI_DROP_ASYNC_PROFILER_BIN;
  process.env.MINI_DROP_ASYNC_PROFILER_BIN = '__mini_drop_missing_async_profiler__';

  try {
    const probe = await probeAgentEnvironment({
      capability: {
        id: 'async-profiler',
        name: 'async-profiler',
        languages: ['Java'],
        description: 'test plugin',
        supportsRealCollection: true,
      },
      async collect() {
        throw new Error('not used');
      },
    });

    assert.equal(probe.collectors[0]?.collector, 'async-profiler');
    assert.equal(probe.collectors[0]?.available, false);
    assert.equal(probe.collectors[0]?.readiness, 'fallback-only');
    assert.match(probe.collectors[0]?.detail ?? '', /tool=__mini_drop_missing_async_profiler__/);
  } finally {
    if (previous === undefined) {
      delete process.env.MINI_DROP_ASYNC_PROFILER_BIN;
    } else {
      process.env.MINI_DROP_ASYNC_PROFILER_BIN = previous;
    }
  }
});

test('cancelTaskExecution marks queued tasks as stopped and persists audit and reasoner output', async () => {
  const task = createQueuedTask({
    target: 'inventory-api@node-2',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });

  await saveTask(task);
  const canceled = await cancelTaskExecution(task.id, 'Stop requested from test.', 'user');

  assert.ok(canceled);
  assert.equal(canceled?.accepted, true);
  assert.equal(canceled?.task.status, 'FAILED');
  assert.equal(canceled?.task.reportTitle, '任务已停止');

  const savedTask = await getTask(task.id);
  assert.ok(savedTask);
  assert.equal(savedTask?.status, 'FAILED');

  const reasoner = await getTaskReasonerSnapshot(task.id);
  assert.ok(reasoner);
  assert.equal(reasoner?.input.taskId, task.id);

  const auditEvents = await listAuditEvents(task.id);
  assert.ok(auditEvents.some((event) => event.type === 'task.stop_requested'));
  assert.ok(auditEvents.some((event) => event.type === 'task.stopped'));
  assert.ok(
    auditEvents.some(
      (event) =>
        event.type === 'task.failed' &&
        ((event.detail ?? '').includes('Stop requested from test.') ||
          (event.detail ?? '').includes('任务在完成前被停止')),
    ),
  );
});

test('saveTask tolerates back-to-back task persistence without dropping state indexes', async () => {
  const first = createQueuedTask({
    target: 'repeat-save-a@node-1',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  const second = createQueuedTask({
    target: 'repeat-save-b@node-1',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });

  await Promise.all([saveTask(first), saveTask(second)]);

  const savedFirst = await getTask(first.id);
  const savedSecond = await getTask(second.id);
  assert.equal(savedFirst?.id, first.id);
  assert.equal(savedSecond?.id, second.id);
});

test('saveTask retains targetContext metadata across persistence and reload', async () => {
  const task = createQueuedTask({
    target: 'pid-target@local',
    targetType: 'pid',
    pid: process.pid,
    processInfo: {
      pid: process.pid,
      name: 'node',
      command: process.argv.join(' '),
      commandSummary: process.argv.join(' '),
      languageHint: 'Node.js',
      alive: true,
    },
    attachSource: 'external-pid',
    language: 'Node.js',
    collector: 'perf',
    scenario: 'cpu_hot',
  });

  await saveTask(task);
  const saved = await getTask(task.id);
  assert.ok(saved);
  assert.equal(saved?.targetContext.targetType, 'pid');
  assert.equal(saved?.targetContext.attachSource, 'external-pid');
  assert.equal(saved?.targetContext.processInfo?.pid, process.pid);
});

test('loadTaskRunState exposes active probe readiness while a managed runner snapshot is retained', async () => {
  const task = createQueuedTask({
    target: 'state-api@node-1',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });
  await saveTask(task);

  const controller = createAgentRunController(task.id, {
    target: task.target,
    language: task.language,
    collector: task.collector,
    scenario: task.scenario,
  });

  try {
    controller.transition('probing', 'Preparing perf.');
    controller.attachProbe({
      collectedAt: new Date().toISOString(),
      host: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        pid: process.pid,
      },
      collectors: [
        {
          collector: 'perf',
          supported: process.platform === 'linux',
          available: false,
          detail: 'tool=perf available=false simulated for test',
        },
      ],
      notes: ['probe note'],
    });
    controller.transition('ready', 'Probe complete.');

    const runState = await loadTaskRunState(task.id);
    assert.ok(runState);
    assert.equal(runState?.taskId, task.id);
    assert.equal(runState?.activeRun?.stage, 'ready');
    assert.equal(runState?.activeRun?.probe?.collectors[0]?.collector, 'perf');
    assert.equal(runState?.activeRun?.probe?.collectors[0]?.available, false);
    assert.equal(runState?.probeSummary?.[0]?.collector, 'perf');
    assert.equal(runState?.lastCollectorStage, 'ready');
    assert.equal(runState?.stopPending, false);
  } finally {
    await controller.complete('Test cleanup.');
  }
});

test('managed runner snapshot remains readable after completion for task detail replay', async () => {
  const task = createQueuedTask({
    target: 'replay-api@node-1',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });
  await saveTask(task);

  const controller = createAgentRunController(task.id, {
    target: task.target,
    language: task.language,
    collector: task.collector,
    scenario: task.scenario,
  });

  controller.transition('probing', 'Preparing perf.');
  await controller.complete('Finished replay snapshot test.');

  const runState = await loadTaskRunState(task.id);
  assert.ok(runState);
  assert.equal(runState?.activeRun?.stage, 'completed');
  assert.match(runState?.activeRun?.logs.at(-1) ?? '', /Finished replay snapshot test/);
});

test('agent poll-task keeps the leased task stable across repeated polls', async () => {
  const agentId = `agent-poll-${Date.now()}`;
  const registered = await registerAgent({
    id: agentId,
    label: 'poll-agent',
    host: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
    },
  });

  assert.equal(registered.ok, true);
  if (!registered.ok) {
    throw new Error(registered.error.message);
  }

  const older = createQueuedTask({
    target: `poll-older-${Date.now()}@local`,
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  const newer = createQueuedTask({
    target: `poll-newer-${Date.now()}@local`,
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });

  older.createdAt = '1900-01-01T00:00:00.000Z';
  older.updatedAt = older.createdAt;
  newer.createdAt = '1900-01-01T00:00:01.000Z';
  newer.updatedAt = newer.createdAt;

  await saveTask(older);
  await saveTask(newer);

  const firstPoll = await pollAgentTask(agentId);
  assert.equal(firstPoll.ok, true);
  if (!firstPoll.ok) {
    throw new Error(firstPoll.error.message);
  }
  assert.ok(firstPoll.value.task);
  assert.ok([older.id, newer.id].includes(firstPoll.value.task?.id ?? ''));

  const secondPoll = await pollAgentTask(agentId);
  assert.equal(secondPoll.ok, true);
  if (!secondPoll.ok) {
    throw new Error(secondPoll.error.message);
  }
  assert.equal(secondPoll.value.task?.id, firstPoll.value.task?.id);
});

test('agent upload-result records upload state and releases the current lease', async () => {
  const agentId = `agent-upload-${Date.now()}`;
  const registered = await registerAgent({
    id: agentId,
    label: 'upload-agent',
    host: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
    },
  });

  assert.equal(registered.ok, true);
  if (!registered.ok) {
    throw new Error(registered.error.message);
  }

  const task = createQueuedTask({
    target: `upload-target-${Date.now()}@local`,
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });
  task.createdAt = '1899-01-01T00:00:00.000Z';
  task.updatedAt = task.createdAt;
  await saveTask(task);

  const leased = await pollAgentTask(agentId);
  assert.equal(leased.ok, true);
  if (!leased.ok) {
    throw new Error(leased.error.message);
  }
  assert.equal(leased.value.task?.id, task.id);

  const staged = await collectTaskExecution(task.id, {
    target: task.target,
    language: task.language,
    collector: task.collector,
    scenario: task.scenario,
    targetType: task.targetContext.targetType,
    pid: task.targetContext.processInfo?.pid,
    processInfo: task.targetContext.processInfo,
    attachSource: task.targetContext.attachSource,
  });
  assert.equal(staged?.status, 'UPLOADING');

  const stagedRecordBeforeUpload = await readStagedCollectorOutcome(task.id);
  assert.ok(stagedRecordBeforeUpload);
  assert.equal(stagedRecordBeforeUpload?.taskId, task.id);

  const uploading = await acceptAgentUploadResult(agentId, {
    taskId: task.id,
    uploadState: 'uploading',
    note: 'collector artifacts staged',
    artifactCount: 2,
  });
  assert.equal(uploading.ok, true);

  const uploaded = await acceptAgentUploadResult(agentId, {
    taskId: task.id,
    uploadState: 'uploaded',
    note: 'upload complete',
    artifactCount: 2,
  });
  assert.equal(uploaded.ok, true);
  if (!uploaded.ok) {
    throw new Error(uploaded.error.message);
  }
  assert.match(uploaded.value.message, /上传/);

  const finalizedTask = await getTask(task.id);
  assert.ok(finalizedTask);
  assert.ok(finalizedTask?.status === 'DONE' || finalizedTask?.status === 'FAILED');
  assert.equal(finalizedTask?.uploadState, 'uploaded');

  const stagedRecordAfterUpload = await readStagedCollectorOutcome(task.id);
  assert.equal(stagedRecordAfterUpload, null);

  const heartbeat = await acceptAgentHeartbeat(agentId, {});
  assert.equal(heartbeat.ok, true);
  if (!heartbeat.ok) {
    throw new Error(heartbeat.error.message);
  }
  assert.equal(heartbeat.value.agent.currentTaskId, null);

  const auditEvents = await listAuditEvents(task.id);
  assert.ok(auditEvents.some((event) => (event.detail ?? '').includes('collector artifacts staged')));
  assert.ok(auditEvents.some((event) => event.message.includes('上传')));
  assert.ok(auditEvents.some((event) => event.message.includes('暂存')));
});

test('saveTask emits lifecycle audit when only status reason changes', async () => {
  const task = createQueuedTask({
    target: `reason-update-${Date.now()}@local`,
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });
  await saveTask(task);

  await saveTask({
    ...task,
    statusReason: '任务已经排队，正在等待更高优先级任务释放资源。',
    updatedAt: new Date().toISOString(),
  });

  const auditEvents = await listAuditEvents(task.id);
  assert.ok(auditEvents.some((event) => event.message.includes('任务生命周期原因已更新')));
  assert.ok(
    auditEvents.some(
      (event) =>
        (event.detail ?? '').includes('摘要任务还没有进入可执行生命周期') ||
        (event.detail ?? '').includes('任务已经创建，正在等待执行资源'),
    ),
  );
});

test('offline sweep marks stale agents offline and heartbeat can recover them', async () => {
  const agentId = `agent-offline-${Date.now()}`;
  const registered = await registerAgent({
    id: agentId,
    label: 'offline-agent',
    host: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
    },
  });

  assert.equal(registered.ok, true);
  if (!registered.ok) {
    throw new Error(registered.error.message);
  }

  const staleAt = new Date(Date.now() - 35_000).toISOString();
  await upsertAgent({
    ...registered.value.agent,
    status: 'online',
    heartbeatState: 'healthy',
    lastHeartbeatAt: staleAt,
    lastSeenAt: staleAt,
  });

  const swept = await sweepOfflineAgents();
  assert.ok(swept.some((agent) => agent.id === agentId));

  const recovered = await acceptAgentHeartbeat(agentId, {});
  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    throw new Error(recovered.error.message);
  }
  assert.equal(recovered.value.agent.status, 'online');
  assert.equal(recovered.value.agent.heartbeatState, 'healthy');

  const agentAudit = await listAuditEvents(`agent:${agentId}`);
  assert.ok(agentAudit.some((event) => event.message.includes('离线')));
  assert.ok(agentAudit.some((event) => event.message.includes('恢复')));
});

test('normalizeCollectorOutcome keeps fallback-readable frames explicit instead of inventing line numbers', () => {
  const task = createQueuedTask({
    target: 'fallback-api@node-1',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });

  const normalized = normalizeCollectorOutcome(task, {
    status: 'UPLOADING',
    progress: 72,
    artifacts: [],
    sample: {
      sampleCount: 12,
      topFunctions: [
        { name: 'hot_loop', percent: 51, module: 'synthetic/module.cpp' },
        { name: 'io_wait', percent: 17, module: 'unknown/module' },
      ],
      metrics: { cpu: 81, blocked: 9, gc: 2, syscalls: 8 },
      summary: 'fallback',
      rawSignal: 'native-stack-sampling:fallback',
      workloadReportPath: 'none',
    },
    report: {
      scenario: 'cpu_hot',
      collector: 'perf',
      target: task.target,
      title: 'CPU Hot',
      durationMs: 5000,
      result: 1,
      metrics: { cpu: 81, blocked: 9, gc: 2, syscalls: 8 },
      topFunctions: [
        { name: 'hot_loop', percent: 51, module: 'synthetic/module.cpp' },
        { name: 'io_wait', percent: 17, module: 'unknown/module' },
      ],
      summary: 'fallback',
    },
    logs: ['fallback'],
  });

  assert.equal(normalized.hotspots[0]?.frame.line, null);
  assert.equal(normalized.hotspots[0]?.frame.mappingState, 'synthetic');
  assert.equal(normalized.hotspots[0]?.frame.mappingSource, 'fallback');
});

test('buildTaskTrends summarizes comparable run history', () => {
  const first = createTaskDetail({
    target: 'trend-api@node-1',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });
  const second = createTaskDetail({
    target: 'trend-api@node-1',
    language: 'Go',
    collector: 'perf',
    scenario: 'lock_contention',
  });
  const third = createTaskDetail({
    target: 'trend-api@node-1',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });

  const trends = buildTaskTrends(third.id, [first, second, third]);
  assert.ok(trends);
  assert.equal(trends?.points.length, 2);
  assert.equal(trends?.metricSeries.length, 4);
  assert.equal(trends?.transitions.length, 1);
  assert.equal(trends?.historySummary.runCount, 2);
  assert.ok(trends?.summary.length);
  assert.ok(trends?.summary.includes('主导 driver') || trends?.summary.includes('历史序列'));
  assert.ok(trends?.points[1]?.topHotspotLocationSummary);
  assert.equal(trends?.points[1]?.driverEvidence, trends?.latestComparison?.driver?.evidence ?? null);
  assert.equal(trends?.hotspotChanges[0]?.baselineHotspot?.locationSummary ?? null, trends?.latestComparison?.hotspotShift.baselineTop?.locationSummary ?? null);
  assert.equal(trends?.hotspotChanges[0]?.currentHotspot?.locationSummary ?? null, trends?.latestComparison?.hotspotShift.currentTop?.locationSummary ?? null);
});

test('compareTasks explains hotspot replacement and strongest driver', () => {
  const baseline = createTaskDetail({
    target: 'checkout-api@node-7',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });
  const current = createTaskDetail({
    target: 'checkout-api@node-7',
    language: 'Go',
    collector: 'perf',
    scenario: 'gc_pressure',
  });

  const comparison = compareTasks(baseline, current);
  assert.notEqual(comparison.verdict, 'neutral');
  assert.ok(comparison.hotspotShift.kind.length > 0);
  assert.ok(typeof comparison.hotspotShift.overlapRatio === 'number');
  assert.ok(comparison.driver);
  assert.ok(comparison.metricSummary.strongest);
  assert.ok(comparison.metricSummary.regressions.length > 0 || comparison.metricSummary.improvements.length > 0);
  assert.equal(comparison.driver?.hotspotLocationSummary ?? null, comparison.hotspotShift.currentTop?.locationSummary ?? null);
  assert.equal(comparison.hotspotShift.baselineTop?.locationSummary ?? null, baseline.topFunctions[0]?.locationSummary ?? null);
  assert.equal(comparison.hotspotShift.currentTop?.locationSummary ?? null, current.topFunctions[0]?.locationSummary ?? null);
  assert.match(comparison.changedHotspot, /轮换|锚定|迁移|位置/);
  assert.match(comparison.driver?.evidence ?? '', /主热点|稳定停留|移动到了|变化到/);
});

test('compareTasks preserves readable location shifts when the hotspot name stays the same', () => {
  const baseline = createTaskDetail({
    target: 'location-api@node-1',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  const current = {
    ...createTaskDetail({
      target: 'location-api@node-1',
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
    }),
  };

  baseline.topFunctions[0] = {
    ...baseline.topFunctions[0]!,
    name: 'parse_message',
    module: 'app/parser.py',
    locationSummary: 'parser.py:87',
    mappingState: 'full',
  };
  current.topFunctions[0] = {
    ...current.topFunctions[0]!,
    name: 'parse_message',
    module: 'app/parser.py',
    locationSummary: 'parser.py:114',
    mappingState: 'full',
  };

  const comparison = compareTasks(baseline, current);
  assert.equal(comparison.hotspotShift.kind, 'module-shifted');
  assert.match(comparison.changedHotspot, /parser\.py:87/);
  assert.match(comparison.changedHotspot, /parser\.py:114/);
  assert.match(comparison.driver?.evidence ?? '', /parser\.py:87/);
  assert.match(comparison.driver?.evidence ?? '', /parser\.py:114/);
});

test('compareTasks adds compatibility warnings when process context changes materially', () => {
  const baseline = createTaskDetail({
    target: 'pid-aware@local',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  const current = createTaskDetail({
    target: 'pid-aware@local',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });

  baseline.targetContext = {
    targetType: 'pid',
    attachSource: 'external-pid',
    processInfo: {
      pid: 1111,
      name: 'python',
      command: 'python service_a.py',
      commandSummary: 'python service_a.py',
      languageHint: 'Python',
      alive: true,
    },
    attachDecision: 'Attached directly to PID 1111.',
  };
  current.targetContext = {
    targetType: 'process',
    attachSource: 'process-selection',
    processInfo: {
      pid: 2222,
      name: 'python',
      command: 'python service_b.py',
      commandSummary: 'python service_b.py',
      languageHint: 'Python',
      alive: true,
    },
    attachDecision: 'Attached from process picker to PID 2222.',
  };

  const comparison = compareTasks(baseline, current);
  assert.equal(comparison.compatibility.sameTargetType, false);
  assert.equal(comparison.compatibility.sameAttachSource, false);
  assert.equal(comparison.compatibility.sameProcessIdentity, false);
  assert.ok(comparison.compatibility.warnings.length >= 3);
  assert.match(comparison.summary, /可比性提醒：/);
  assert.equal(comparison.baseline.processContext.processInfo?.pid, 1111);
  assert.equal(comparison.current.processContext.processInfo?.pid, 2222);
});

test('buildTaskTrends excludes non-comparable tasks and exposes streak metadata', () => {
  const first = createTaskDetail({
    target: 'orders-api@node-9',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });
  const second = {
    ...createTaskDetail({
      target: 'orders-api@node-9',
      language: 'Go',
      collector: 'perf',
      scenario: 'cpu_hot',
    }),
    updatedAt: new Date(Date.parse(first.updatedAt) + 1000).toISOString(),
  };
  const ignored = createTaskDetail({
    target: 'orders-api@node-9',
    language: 'Go',
    collector: 'perf',
    scenario: 'lock_contention',
  });

  const trends = buildTaskTrends(second.id, [first, second, ignored]);
  assert.ok(trends);
  assert.equal(trends?.points.length, 2);
  assert.equal(trends?.historySummary.currentStreak.verdict, trends?.latestComparison?.verdict ?? 'initial');
  assert.ok(trends?.historySummary.focusIndex === 1);
  assert.equal(trends?.historySummary.latestDriver?.label ?? null, trends?.latestComparison?.driver?.label ?? null);
});

test('buildTaskTrends exposes process variants and compatibility warnings for mixed attach history', () => {
  const first = createTaskDetail({
    target: 'process-trend@local',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });
  const second = {
    ...createTaskDetail({
      target: 'process-trend@local',
      language: 'Go',
      collector: 'perf',
      scenario: 'cpu_hot',
    }),
    updatedAt: new Date(Date.parse(first.updatedAt) + 1000).toISOString(),
  };

  first.targetContext = {
    targetType: 'pid',
    attachSource: 'external-pid',
    processInfo: {
      pid: 3001,
      name: 'orders',
      command: './orders --port 8080',
      commandSummary: './orders --port 8080',
      languageHint: 'Go',
      alive: true,
    },
    attachDecision: 'Attached directly to PID 3001.',
  };
  second.targetContext = {
    targetType: 'process',
    attachSource: 'process-selection',
    processInfo: {
      pid: 3002,
      name: 'orders',
      command: './orders --port 9090',
      commandSummary: './orders --port 9090',
      languageHint: 'Go',
      alive: true,
    },
    attachDecision: 'Attached from process picker to PID 3002.',
  };

  const trends = buildTaskTrends(second.id, [first, second]);
  assert.ok(trends);
  assert.equal(trends?.historySummary.processVariants, 2);
  assert.ok((trends?.historySummary.attachSources ?? []).includes('external-pid'));
  assert.ok((trends?.historySummary.attachSources ?? []).includes('process-selection'));
  assert.ok((trends?.historySummary.compatibilityWarnings.length ?? 0) > 0);
  assert.equal(trends?.points[1]?.processContext.processInfo?.pid, 3002);
});

test('buildTaskResultIndex retains artifact kinds and collection provenance when available', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-drop-provenance-'));
  const collectionPathPath = path.join(tempDir, 'collection-path.json');
  await fs.writeFile(
    collectionPathPath,
    JSON.stringify(
      {
        collector: 'py-spy',
        mode: 'fallback',
        command: null,
        reason: 'py-spy not installed',
        sourceKind: 'workload-fallback',
        rawSignal: 'python-hot-loop:fallback',
        expectedArtifacts: ['report', 'log'],
        notes: ['synthetic fallback path'],
      },
      null,
      2,
    ),
    'utf8',
  );

  const task = createTaskDetail({
    target: 'provenance-api@node-1',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  task.artifacts = [
    {
      kind: 'report',
      label: 'Collection path summary',
      path: collectionPathPath,
    },
  ];

  try {
    const resultIndex = await buildTaskResultIndex(task);
    assert.deepEqual(resultIndex.artifactKinds, ['report']);
    assert.equal(resultIndex.artifactCount, task.artifacts.length);
    assert.equal(resultIndex.previewableArtifactCount, 1);
    assert.equal(resultIndex.provenance?.collector, 'py-spy');
    assert.equal(resultIndex.provenance?.reason, 'py-spy not installed');
    assert.equal(resultIndex.provenance?.artifactPath, collectionPathPath);
    assert.equal(resultIndex.symbolization?.status, 'partial');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('buildTaskResultIndex counts line-level symbolization when hotspots retain full mappings', async () => {
  const task = createTaskDetail({
    target: 'symbolized-api@node-1',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  task.topFunctions = [
    {
      name: 'parse_message',
      percent: 44,
      module: 'app/parser.py',
      locationSummary: 'parser.py:87',
      file: 'parser.py',
      line: 87,
      mappingState: 'full',
      mappingSource: 'retained',
      sourceHint: 'app/parser.py',
    },
    {
      name: 'walk_rows',
      percent: 20,
      module: 'app/rows.py',
      locationSummary: 'rows.py (line unavailable)',
      file: 'rows.py',
      line: null,
      mappingState: 'file-only',
      mappingSource: 'retained',
      sourceHint: 'app/rows.py',
    },
    {
      name: 'emit_metrics',
      percent: 11,
      module: 'synthetic/module.cpp',
      locationSummary: 'synthetic/module.cpp (synthetic fallback)',
      file: 'module.cpp',
      line: null,
      mappingState: 'synthetic',
      mappingSource: 'fallback',
      sourceHint: 'synthetic/module.cpp',
    },
  ];

  const resultIndex = await buildTaskResultIndex(task);
  assert.equal(resultIndex.symbolization?.status, 'partial');
  assert.equal(resultIndex.symbolization?.mappedHotspots, 2);
  assert.equal(resultIndex.symbolization?.lineMappedHotspots, 1);
  assert.equal(resultIndex.symbolization?.syntheticHotspots, 1);
});

test('buildReasonerSnapshot exposes the external client boundary without inventing citations', async () => {
  const previousMode = process.env.MINI_DROP_REASONER_MODE;
  const previousEndpoint = process.env.MINI_DROP_REASONER_ENDPOINT;
  const previousConfigPath = process.env.MINI_DROP_REASONER_CONFIG_PATH;
  process.env.MINI_DROP_REASONER_MODE = 'external';
  delete process.env.MINI_DROP_REASONER_ENDPOINT;
  process.env.MINI_DROP_REASONER_CONFIG_PATH = path.join(os.tmpdir(), `missing-reasoner-config-${Date.now()}.json`);

  try {
    const task = createTaskDetail({
      target: 'reasoner-api@node-1',
      language: 'Go',
      collector: 'perf',
      scenario: 'cpu_hot',
    });

    const snapshot = await buildReasonerSnapshot(task);
    assert.equal(snapshot.output.mode, 'external');
    assert.equal(snapshot.output.guardrailStatus, 'enforced');
    assert.equal(snapshot.output.citations.length, 0);
    assert.equal(snapshot.output.rejectedCitations.length, 0);
    assert.match(snapshot.output.summary, /当前已配置外部 reasoner/);
    assert.match(snapshot.output.fallbackReason ?? '', /MINI_DROP_REASONER_ENDPOINT/);
  } finally {
    if (previousMode === undefined) {
      delete process.env.MINI_DROP_REASONER_MODE;
    } else {
      process.env.MINI_DROP_REASONER_MODE = previousMode;
    }

    if (previousEndpoint === undefined) {
      delete process.env.MINI_DROP_REASONER_ENDPOINT;
    } else {
      process.env.MINI_DROP_REASONER_ENDPOINT = previousEndpoint;
    }

    if (previousConfigPath === undefined) {
      delete process.env.MINI_DROP_REASONER_CONFIG_PATH;
    } else {
      process.env.MINI_DROP_REASONER_CONFIG_PATH = previousConfigPath;
    }
  }
});

test('buildReasonerSnapshot can read OpenAI-compatible model config files and normalize chat completions', async () => {
  const previousMode = process.env.MINI_DROP_REASONER_MODE;
  const previousConfigPath = process.env.MINI_DROP_REASONER_CONFIG_PATH;
  const previousEndpoint = process.env.MINI_DROP_REASONER_ENDPOINT;
  const previousApiKey = process.env.MINI_DROP_REASONER_API_KEY;
  const previousModel = process.env.MINI_DROP_REASONER_MODEL;
  const originalFetch = globalThis.fetch;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-drop-reasoner-config-'));
  const configPath = path.join(tempDir, 'models.json');

  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        models: [
          {
            id: 'deepseek-v4-pro',
            url: 'http://127.0.0.1:8787/v1/chat/completions',
            apiKey: 'test-api-key',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.MINI_DROP_REASONER_MODE = 'external';
  process.env.MINI_DROP_REASONER_CONFIG_PATH = configPath;
  delete process.env.MINI_DROP_REASONER_ENDPOINT;
  delete process.env.MINI_DROP_REASONER_API_KEY;
  delete process.env.MINI_DROP_REASONER_MODEL;

  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: '热点集中在 parse_message，证据充分。',
                findings: [
                  {
                    title: '主热点',
                    detail: 'parse_message 占比最高。',
                    citations: ['hotspot-1'],
                  },
                  {
                    title: '非法引用',
                    detail: '这条不应该被保留。',
                    citations: ['missing-citation'],
                  },
                ],
                citations: ['hotspot-1', 'metric-cpu', 'missing-citation'],
              }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  }) as typeof fetch;

  try {
    const task = createTaskDetail({
      target: 'reasoner-config@local',
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
    });

    const snapshot = await buildReasonerSnapshot(task);
    assert.equal(snapshot.output.mode, 'external');
    assert.equal(requestBody?.model, 'deepseek-v4-pro');
    assert.ok(Array.isArray(requestBody?.messages));
    assert.equal(snapshot.output.summary, '热点集中在 parse_message，证据充分。');
    assert.deepEqual(snapshot.output.citations, ['hotspot-1', 'metric-cpu']);
    assert.deepEqual(snapshot.output.rejectedCitations, ['missing-citation']);
    assert.equal(snapshot.output.findings.length, 1);
    assert.equal(snapshot.output.findings[0]?.citations[0], 'hotspot-1');
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });

    if (previousMode === undefined) {
      delete process.env.MINI_DROP_REASONER_MODE;
    } else {
      process.env.MINI_DROP_REASONER_MODE = previousMode;
    }

    if (previousConfigPath === undefined) {
      delete process.env.MINI_DROP_REASONER_CONFIG_PATH;
    } else {
      process.env.MINI_DROP_REASONER_CONFIG_PATH = previousConfigPath;
    }

    if (previousEndpoint === undefined) {
      delete process.env.MINI_DROP_REASONER_ENDPOINT;
    } else {
      process.env.MINI_DROP_REASONER_ENDPOINT = previousEndpoint;
    }

    if (previousApiKey === undefined) {
      delete process.env.MINI_DROP_REASONER_API_KEY;
    } else {
      process.env.MINI_DROP_REASONER_API_KEY = previousApiKey;
    }

    if (previousModel === undefined) {
      delete process.env.MINI_DROP_REASONER_MODEL;
    } else {
      process.env.MINI_DROP_REASONER_MODEL = previousModel;
    }
  }
});

test('buildReasonerSnapshot carries hotspot location evidence into the grounded bundle', async () => {
  const previousMode = process.env.MINI_DROP_REASONER_MODE;
  process.env.MINI_DROP_REASONER_MODE = 'stub';

  try {
    const task = createTaskDetail({
      target: 'reasoner-hotspot@node-1',
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
    });
    task.topFunctions[0] = {
      ...task.topFunctions[0]!,
      locationSummary: 'parser.py:87',
      file: 'parser.py',
      line: 87,
      mappingState: 'full',
      mappingSource: 'retained',
      sourceHint: 'app/parser.py',
    };

    const snapshot = await buildReasonerSnapshot(task);
    const hotspot = snapshot.input.evidence.find((item) => item.id === 'hotspot-1');
    assert.ok(hotspot);
    assert.match(hotspot?.detail ?? '', /parser\.py:87/);
    assert.match(hotspot?.detail ?? '', /full 映射/);
  } finally {
    if (previousMode === undefined) {
      delete process.env.MINI_DROP_REASONER_MODE;
    } else {
      process.env.MINI_DROP_REASONER_MODE = previousMode;
    }
  }
});

test('buildReasonerSnapshot includes lifecycle status evidence for grounded output', async () => {
  const previousMode = process.env.MINI_DROP_REASONER_MODE;
  process.env.MINI_DROP_REASONER_MODE = 'stub';

  try {
    const task = createTaskDetail({
      target: 'reasoner-lifecycle@local',
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
    });
    task.status = 'UPLOADING';
    task.uploadState = 'uploaded';
    task.statusReason = 'Agent 已确认上传完成，server 正在生成最终分析结果。';

    const snapshot = await buildReasonerSnapshot(task);
    const lifecycleEvidence = snapshot.input.evidence.find((item) => item.id === 'lifecycle-status');
    assert.ok(lifecycleEvidence);
    assert.match(lifecycleEvidence?.detail ?? '', /UPLOADING/);
    assert.match(lifecycleEvidence?.detail ?? '', /uploadState=uploaded/);
    assert.match(lifecycleEvidence?.detail ?? '', /最终分析结果/);
  } finally {
    if (previousMode === undefined) {
      delete process.env.MINI_DROP_REASONER_MODE;
    } else {
      process.env.MINI_DROP_REASONER_MODE = previousMode;
    }
  }
});

test('buildReasonerSnapshot includes target-context and compatibility evidence for process-aware runs', async () => {
  const previousMode = process.env.MINI_DROP_REASONER_MODE;
  process.env.MINI_DROP_REASONER_MODE = 'stub';

  try {
    const task = createTaskDetail({
      target: 'reasoner-process@local',
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
    });
    task.targetContext = {
      targetType: 'process',
      attachSource: 'process-selection',
      processInfo: {
        pid: 9988,
        name: 'python',
        command: 'python worker.py',
        commandSummary: 'python worker.py',
        languageHint: 'Python',
        alive: true,
      },
      attachDecision: 'Attached from process picker to PID 9988.',
    };
    task.baselineComparison = {
      ...compareTasks(
        {
          ...task,
          id: `${task.id}-baseline`,
          targetContext: {
            targetType: 'pid',
            attachSource: 'external-pid',
            processInfo: {
              pid: 8877,
              name: 'python',
              command: 'python worker_old.py',
              commandSummary: 'python worker_old.py',
              languageHint: 'Python',
              alive: true,
            },
            attachDecision: 'Attached directly to PID 8877.',
          },
        },
        task,
      ),
    };

    const snapshot = await buildReasonerSnapshot(task);
    const targetContextEvidence = snapshot.input.evidence.find((item) => item.id === 'target-context');
    const compatibilityEvidence = snapshot.input.evidence.find((item) => item.id === 'comparison-compatibility-1');
    assert.ok(targetContextEvidence);
    assert.match(targetContextEvidence?.detail ?? '', /进程列表 attach|选择进程/);
    assert.match(targetContextEvidence?.detail ?? '', /PID 9988/);
    assert.ok(compatibilityEvidence);
    assert.match(compatibilityEvidence?.detail ?? '', /目标模式|PID 从|采样路径/);
    assert.ok(snapshot.output.findings.some((finding) => finding.title === '采样来源'));
  } finally {
    if (previousMode === undefined) {
      delete process.env.MINI_DROP_REASONER_MODE;
    } else {
      process.env.MINI_DROP_REASONER_MODE = previousMode;
    }
  }
});

test('buildReasonerSnapshot adds provenance, symbolization, and trend-driver evidence for uploaded runs', async () => {
  const previousMode = process.env.MINI_DROP_REASONER_MODE;
  process.env.MINI_DROP_REASONER_MODE = 'stub';

  try {
    const baseline = createTaskDetail({
      target: 'reasoner-provenance@local',
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
    });
    const current = createTaskDetail({
      target: 'reasoner-provenance@local',
      language: 'Python',
      collector: 'py-spy',
      scenario: 'cpu_hot',
    });

    current.sampleSource = 'native-stack-sampling:perf-script';
    current.uploadState = 'uploaded';
    current.baselineComparison = compareTasks(baseline, current);

    const snapshot = await buildReasonerSnapshot(current);
    const provenanceEvidence = snapshot.input.evidence.find((item) => item.id === 'provenance-path');
    const symbolizationEvidence = snapshot.input.evidence.find((item) => item.id === 'symbolization-state');
    const driverEvidence = snapshot.input.evidence.find((item) => item.id === 'trend-latest-driver');

    assert.ok(provenanceEvidence);
    assert.match(provenanceEvidence?.detail ?? '', /sampleSource=native-stack-sampling:perf-script/);
    assert.ok(symbolizationEvidence);
    assert.match(symbolizationEvidence?.detail ?? '', /full=|partial=|synthetic=/);
    assert.ok(driverEvidence);
    assert.match(driverEvidence?.detail ?? '', /变化到|主热点/);
  } finally {
    if (previousMode === undefined) {
      delete process.env.MINI_DROP_REASONER_MODE;
    } else {
      process.env.MINI_DROP_REASONER_MODE = previousMode;
    }
  }
});

test('filterEvidenceCitations removes citations that are not present in the evidence bundle', () => {
  const filtered = filterEvidenceCitations(['metric-cpu', 'missing', 'hotspot-1'], {
    evidence: [
      { id: 'metric-cpu', kind: 'metric', label: 'cpu', detail: 'cpu' },
      { id: 'hotspot-1', kind: 'hotspot', label: 'hotspot', detail: 'hotspot' },
    ],
  });

  assert.deepEqual(filtered, ['metric-cpu', 'hotspot-1']);
});

test('loadArtifactPreview treats jsonl artifacts as inline text previews', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-drop-preview-'));
  const jsonlPath = path.join(tempDir, 'collector.jsonl');
  await fs.writeFile(jsonlPath, '{"event":"start"}\n{"event":"stop"}\n', 'utf8');

  const task = createTaskDetail({
    target: 'preview-api@node-1',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  task.artifacts = [
    {
      kind: 'log',
      label: 'Collector JSONL log',
      path: jsonlPath,
    },
  ];

  try {
    await saveTask(task);
    const preview = await loadArtifactPreview(task.id, jsonlPath);
    assert.ok(preview && !('code' in preview));
    if (!preview || 'code' in preview) {
      throw new Error('Expected artifact preview response.');
    }
    assert.equal(preview.preview.mode, 'text');
    assert.match(preview.preview.content ?? '', /"event":"start"/);
    assert.ok(preview.preview.byteLength > 0);
    assert.equal(preview.preview.mimeType, 'application/x-ndjson');
    assert.match(preview.preview.summary, /execution log|retained/i);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('continuous profiling slices can be built, persisted, and reloaded as a time window', async () => {
  const task = createTaskDetail({
    target: 'continuous-api@node-1',
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  await saveTask(task);

  const sliceA = buildContinuousProfileSlice({
    task,
    startedAt: '2026-06-14T00:00:00.000Z',
    endedAt: '2026-06-14T00:05:00.000Z',
    sampleCount: 40,
    summary: 'slice-a',
    status: 'ready',
  });
  const sliceB = buildContinuousProfileSlice({
    task,
    startedAt: '2026-06-14T00:05:00.000Z',
    endedAt: '2026-06-14T00:10:00.000Z',
    sampleCount: 32,
    summary: 'slice-b',
    status: 'partial',
  });

  const saved = await saveContinuousProfileSlices(task.id, [sliceA, sliceB]);
  assert.equal(saved.window.sliceCount, 2);
  assert.equal(saved.window.from, '2026-06-14T00:00:00.000Z');
  assert.equal(saved.window.to, '2026-06-14T00:10:00.000Z');

  const loaded = await loadContinuousProfileWindow(task.id);
  assert.ok(loaded);
  assert.equal(loaded?.window.sliceCount, 2);
  assert.equal(loaded?.window.slices[0]?.summary, 'slice-a');
  assert.equal(loaded?.window.slices[1]?.summary, 'slice-b');
  assert.equal(loaded?.window.slices[0]?.status, 'ready');
  assert.equal(loaded?.window.slices[1]?.status, 'partial');
});

test('continuous profiling history window can aggregate comparable runs and apply limit filters', async () => {
  const target = `continuous-history-${Date.now()}@local`;
  const first = createTaskDetail({
    target,
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  first.createdAt = '2026-06-14T00:00:00.000Z';
  first.updatedAt = '2026-06-14T00:05:00.000Z';

  const second = createTaskDetail({
    target,
    language: 'Python',
    collector: 'py-spy',
    scenario: 'python_hot_loop',
  });
  second.createdAt = '2026-06-14T00:10:00.000Z';
  second.updatedAt = '2026-06-14T00:16:00.000Z';

  await saveTask(first);
  await saveTask(second);
  await retainTaskContinuousProfileSlice(first);
  await retainTaskContinuousProfileSlice(second);

  const historyWindow = await loadTaskContinuousProfile(second.id, { scope: 'history' });
  assert.ok(historyWindow);
  assert.equal(historyWindow?.window.sliceCount, 2);
  assert.equal(historyWindow?.window.slices[0]?.taskId, first.id);
  assert.equal(historyWindow?.window.slices[1]?.taskId, second.id);

  const limitedWindow = await loadTaskContinuousProfile(second.id, { scope: 'history', limit: 1 });
  assert.ok(limitedWindow);
  assert.equal(limitedWindow?.window.sliceCount, 1);
  assert.equal(limitedWindow?.window.slices[0]?.taskId, second.id);
});

test('collector maturity matrix classifies all four collectors correctly', async () => {
  const { collectorMaturityMatrix } = await import('../server/notes.js');
  assert.ok(collectorMaturityMatrix);
  assert.equal(collectorMaturityMatrix.length, 4);

  const pySpy = collectorMaturityMatrix.find((c) => c.collector === 'py-spy');
  assert.ok(pySpy);
  assert.equal(pySpy.expectedMaturity, 'stable');
  assert.equal(pySpy.readiness, 'preferred');

  const perfEntry = collectorMaturityMatrix.find((c) => c.collector === 'perf');
  assert.ok(perfEntry);
  assert.equal(perfEntry.expectedMaturity, 'deferred');
  assert.equal(perfEntry.readiness, 'deferred-for-linux-proof');

  const ebpfEntry = collectorMaturityMatrix.find((c) => c.collector === 'ebpf');
  assert.ok(ebpfEntry);
  assert.equal(ebpfEntry.expectedMaturity, 'deferred');
  assert.equal(ebpfEntry.readiness, 'deferred-for-linux-proof');

  const asyncProfiler = collectorMaturityMatrix.find((c) => c.collector === 'async-profiler');
  assert.ok(asyncProfiler);
  assert.ok(['partial', 'stable'].includes(asyncProfiler.expectedMaturity));
});

test('collector maturity matrix includes platform and notes for each entry', async () => {
  const { collectorMaturityMatrix } = await import('../server/notes.js');
  for (const entry of collectorMaturityMatrix) {
    assert.ok(entry.platform, `Expected platform for ${entry.collector}`);
    assert.ok(entry.notes, `Expected notes for ${entry.collector}`);
    assert.ok(entry.notes.length > 0, `Expected non-empty notes for ${entry.collector}`);
  }
});

test('artifact preview metadata includes collector parity information', async () => {
  const { buildArtifactPreviewMetadata } = await import('../server/artifact-preview.js');

  const pySpyPreview = buildArtifactPreviewMetadata('/tmp/test.json', 'speedscope', 'py-spy');
  assert.equal(pySpyPreview.collectorParity?.collector, 'py-spy');
  assert.equal(pySpyPreview.collectorParity?.parityLevel, 'full');
  assert.ok(pySpyPreview.collectorParity?.supportedKinds.includes('speedscope'));

  const perfPreview = buildArtifactPreviewMetadata('/tmp/test.data', 'raw', 'perf');
  assert.equal(perfPreview.collectorParity?.collector, 'perf');
  assert.equal(perfPreview.collectorParity?.parityLevel, 'full');
  assert.ok(perfPreview.collectorParity?.supportedKinds.includes('raw'));

  const asyncProfilerPreview = buildArtifactPreviewMetadata('/tmp/test.collapsed', 'collapsed-stacks', 'async-profiler');
  assert.equal(asyncProfilerPreview.collectorParity?.collector, 'async-profiler');
  assert.equal(asyncProfilerPreview.collectorParity?.parityLevel, 'partial');
  assert.ok(asyncProfilerPreview.collectorParity?.supportedKinds.includes('collapsed-stacks'));

  const ebpfPreview = buildArtifactPreviewMetadata('/tmp/test.txt', 'raw', 'ebpf');
  assert.equal(ebpfPreview.collectorParity?.collector, 'ebpf');
  assert.equal(ebpfPreview.collectorParity?.parityLevel, 'partial');
  assert.ok(ebpfPreview.collectorParity?.supportedKinds.includes('raw'));
});

test('artifact preview metadata collector parity is undefined when collector not provided', async () => {
  const { buildArtifactPreviewMetadata } = await import('../server/artifact-preview.js');
  const preview = buildArtifactPreviewMetadata('/tmp/test.json', 'report');
  assert.equal(preview.collectorParity, undefined);
});
