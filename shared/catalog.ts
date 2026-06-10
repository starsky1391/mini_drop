import type { CollectorId, CollectorInfo, ScenarioDefinition, ScenarioId } from './types.js';

export const collectors: CollectorInfo[] = [
  {
    id: 'perf',
    name: 'perf Sampler',
    languageCoverage: ['C++', 'Go', 'Java'],
    latencyLabel: 'Low overhead',
    note: 'Best first choice for CPU dominated native services.',
    supportsRealCollection: true,
  },
  {
    id: 'py-spy',
    name: 'py-spy',
    languageCoverage: ['Python'],
    latencyLabel: 'Near-zero instrumentation',
    note: 'Great for interpreter hot loops and async wait time.',
    supportsRealCollection: true,
  },
  {
    id: 'async-profiler',
    name: 'async-profiler',
    languageCoverage: ['Java', 'Kotlin'],
    latencyLabel: 'Production friendly',
    note: 'Strong for JVM CPU, lock, allocation, and wall-clock views.',
    supportsRealCollection: false,
  },
  {
    id: 'ebpf',
    name: 'eBPF Probe Set',
    languageCoverage: ['Linux services'],
    latencyLabel: 'Kernel-aware tracing',
    note: 'Useful for syscall-heavy and cross-process contention analysis.',
    supportsRealCollection: false,
  },
];

export const scenarios: ScenarioDefinition[] = [
  {
    id: 'cpu_hot',
    name: 'CPU Hot Path',
    targetLanguage: 'Go / C++',
    summary: 'A single compute path dominates CPU time and pushes the service into saturation.',
    signal: 'CPU bound',
    cpu: 91,
    blocked: 4,
    gc: 2,
    syscalls: 3,
    confidence: 0.95,
    primaryFinding: 'parseBatch and checksumLoop consume most sampled CPU time.',
    recommendation: 'Split the hot loop, reduce allocations, and verify vectorized operations on the critical path.',
    topFunctions: [
      { name: 'parseBatch', percent: 36, module: 'ingest/decoder.cc' },
      { name: 'checksumLoop', percent: 24, module: 'ingest/hash.cc' },
      { name: 'compressPayload', percent: 14, module: 'io/compress.cc' },
      { name: 'writeResponse', percent: 9, module: 'net/http.cc' },
    ],
    flameGraph: {
      name: 'requestBatch',
      value: 100,
      color: '#1f6feb',
      children: [
        {
          name: 'parseBatch',
          value: 36,
          color: '#22c55e',
          children: [
            { name: 'tokenize', value: 12, color: '#34d399' },
            { name: 'decodeFields', value: 24, color: '#10b981' },
          ],
        },
        {
          name: 'checksumLoop',
          value: 24,
          color: '#f59e0b',
          children: [
            { name: 'crc32', value: 10, color: '#fbbf24' },
            { name: 'normalizeBuffer', value: 14, color: '#f59e0b' },
          ],
        },
        {
          name: 'compressPayload',
          value: 14,
          color: '#38bdf8',
          children: [
            { name: 'deflateChunk', value: 8, color: '#7dd3fc' },
            { name: 'flushStream', value: 6, color: '#0ea5e9' },
          ],
        },
        { name: 'writeResponse', value: 9, color: '#c084fc' },
        { name: 'misc', value: 17, color: '#64748b' },
      ],
    },
  },
  {
    id: 'lock_contention',
    name: 'Lock Contention',
    targetLanguage: 'Java / C++',
    summary: 'Threads spend a large share of time waiting on a single lock and make poor forward progress.',
    signal: 'Blocked on mutex',
    cpu: 53,
    blocked: 38,
    gc: 4,
    syscalls: 5,
    confidence: 0.91,
    primaryFinding: 'Worker threads are serialized behind queueLock during request fan-out.',
    recommendation: 'Reduce lock granularity, batch shared-state updates, and confirm contention disappears under load.',
    topFunctions: [
      { name: 'QueueLock::lock', percent: 41, module: 'sync/queue_lock.cpp' },
      { name: 'dispatchWork', percent: 23, module: 'service/scheduler.cpp' },
      { name: 'awaitPermit', percent: 12, module: 'service/rate_limiter.cpp' },
      { name: 'flushMetrics', percent: 8, module: 'observability/metrics.cpp' },
    ],
    flameGraph: {
      name: 'dispatchRequests',
      value: 100,
      color: '#0f766e',
      children: [
        {
          name: 'QueueLock::lock',
          value: 41,
          color: '#ef4444',
          children: [
            { name: 'pthread_mutex_lock', value: 28, color: '#f87171' },
            { name: 'backoffSpin', value: 13, color: '#dc2626' },
          ],
        },
        {
          name: 'dispatchWork',
          value: 23,
          color: '#14b8a6',
          children: [
            { name: 'selectWorker', value: 11, color: '#2dd4bf' },
            { name: 'pushTask', value: 12, color: '#0d9488' },
          ],
        },
        { name: 'awaitPermit', value: 12, color: '#f59e0b' },
        { name: 'flushMetrics', value: 8, color: '#60a5fa' },
        { name: 'misc', value: 16, color: '#64748b' },
      ],
    },
  },
  {
    id: 'gc_pressure',
    name: 'GC Pressure',
    targetLanguage: 'Java / Kotlin',
    summary: 'The runtime spends a growing amount of time reclaiming short-lived allocations.',
    signal: 'GC pressure',
    cpu: 64,
    blocked: 9,
    gc: 27,
    syscalls: 3,
    confidence: 0.89,
    primaryFinding: 'Allocation rate spikes before every pause and pushes latency out of budget.',
    recommendation: 'Reduce object churn in the request path, reuse buffers, and compare pause time before and after the fix.',
    topFunctions: [
      { name: 'ObjectAllocator::new', percent: 31, module: 'runtime/memory.cpp' },
      { name: 'youngGenCollect', percent: 27, module: 'runtime/gc.cpp' },
      { name: 'serializeResponse', percent: 14, module: 'api/codec.cpp' },
      { name: 'mergeSpan', percent: 10, module: 'telemetry/span.cpp' },
    ],
    flameGraph: {
      name: 'handleRequest',
      value: 100,
      color: '#2563eb',
      children: [
        {
          name: 'ObjectAllocator::new',
          value: 31,
          color: '#a855f7',
          children: [
            { name: 'allocNode', value: 11, color: '#c084fc' },
            { name: 'allocBuffer', value: 20, color: '#9333ea' },
          ],
        },
        {
          name: 'youngGenCollect',
          value: 27,
          color: '#f97316',
          children: [
            { name: 'scanRoots', value: 9, color: '#fb923c' },
            { name: 'evacuate', value: 18, color: '#ea580c' },
          ],
        },
        { name: 'serializeResponse', value: 14, color: '#14b8a6' },
        { name: 'mergeSpan', value: 10, color: '#eab308' },
        { name: 'misc', value: 18, color: '#64748b' },
      ],
    },
  },
  {
    id: 'python_hot_loop',
    name: 'Python Hot Loop',
    targetLanguage: 'Python',
    summary: 'Interpreter time is concentrated in a tight loop that repeatedly walks Python objects.',
    signal: 'Interpreter bound',
    cpu: 72,
    blocked: 7,
    gc: 5,
    syscalls: 6,
    confidence: 0.93,
    primaryFinding: 'frame evaluation and list traversal dominate the profile.',
    recommendation: 'Move the hot path to vectorized operations, cache parsed fields, or offload the loop to native code.',
    topFunctions: [
      { name: 'frame_eval', percent: 39, module: 'python/ceval.c' },
      { name: 'walk_rows', percent: 22, module: 'app/rows.py' },
      { name: 'parse_message', percent: 13, module: 'app/parser.py' },
      { name: 'emit_metrics', percent: 8, module: 'infra/metrics.py' },
    ],
    flameGraph: {
      name: 'processRows',
      value: 100,
      color: '#f97316',
      children: [
        {
          name: 'frame_eval',
          value: 39,
          color: '#a855f7',
          children: [
            { name: 'LOAD_FAST', value: 15, color: '#c084fc' },
            { name: 'CALL_FUNCTION', value: 24, color: '#9333ea' },
          ],
        },
        {
          name: 'walk_rows',
          value: 22,
          color: '#06b6d4',
          children: [
            { name: 'iterate_chunks', value: 9, color: '#22d3ee' },
            { name: 'build_records', value: 13, color: '#0891b2' },
          ],
        },
        { name: 'parse_message', value: 13, color: '#f59e0b' },
        { name: 'emit_metrics', value: 8, color: '#4ade80' },
        { name: 'misc', value: 18, color: '#64748b' },
      ],
    },
  },
];

export function getScenario(scenarioId: ScenarioDefinition['id']) {
  return scenarios.find((scenario) => scenario.id === scenarioId) ?? scenarios[0];
}

export function getCollector(collectorId: CollectorInfo['id']) {
  return collectors.find((collector) => collector.id === collectorId) ?? collectors[0];
}

export function isCollectorId(value: string): value is CollectorId {
  return collectors.some((collector) => collector.id === value);
}

export function isScenarioId(value: string): value is ScenarioId {
  return scenarios.some((scenario) => scenario.id === value);
}
