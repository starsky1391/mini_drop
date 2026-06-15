import type {
  CollectorId,
  CollectorInfo,
  CollectorProvenanceMode,
  CollectorReadinessStatus,
  ReasonerMode,
  ScenarioDefinition,
  ScenarioId,
  SymbolizationMappingState,
  TaskStatus,
  TaskTargetType,
  TaskUploadState,
} from './types.js';

export const collectors: CollectorInfo[] = [
  {
    id: 'perf',
    name: 'perf Sampler',
    displayNameZh: 'perf 采样',
    languageCoverage: ['C++', 'Go', 'Java'],
    latencyLabel: 'Low overhead',
    latencyLabelZh: '低开销',
    note: 'Best first choice for CPU dominated native services.',
    noteZh: '适合优先诊断 CPU 占主导的原生服务。',
    supportsRealCollection: true,
    expectedMaturityOnCurrentHost: process.platform === 'linux' ? 'stable' : 'deferred',
    maturityNote: 'Requires Linux for real stack capture.',
    maturityNoteZh: process.platform === 'linux' ? '当前平台支持真实 perf 采集。' : '当前非 Linux 平台，perf 真实采集延期到后续 Linux 验证轮。',
  },
  {
    id: 'py-spy',
    name: 'py-spy',
    displayNameZh: 'py-spy',
    languageCoverage: ['Python'],
    latencyLabel: 'Near-zero instrumentation',
    latencyLabelZh: '接近零侵入',
    note: 'Great for interpreter hot loops and async wait time.',
    noteZh: '适合定位解释器热点循环和异步等待。',
    supportsRealCollection: true,
    expectedMaturityOnCurrentHost: 'stable',
    maturityNote: 'Most stable collector on current host.',
    maturityNoteZh: '当前平台上最稳定的采集器。',
  },
  {
    id: 'async-profiler',
    name: 'async-profiler',
    displayNameZh: 'async-profiler',
    languageCoverage: ['Java', 'Kotlin'],
    latencyLabel: 'Production friendly',
    latencyLabelZh: '线上友好',
    note: 'Strong for JVM CPU, lock, allocation, and wall-clock views.',
    noteZh: '适合 JVM 的 CPU、锁、分配和 wall-clock 诊断。',
    supportsRealCollection: true,
    expectedMaturityOnCurrentHost: process.platform !== 'win32' ? 'stable' : 'partial',
    maturityNote: process.platform !== 'win32' ? 'Fully supported on non-Windows platforms.' : 'Partial on Windows; requires non-Windows for full JVM attach.',
    maturityNoteZh: process.platform !== 'win32' ? '非 Windows 平台完全支持。' : 'Windows 上部分支持；完整 JVM attach 需要非 Windows 平台。',
  },
  {
    id: 'ebpf',
    name: 'eBPF Probe Set',
    displayNameZh: 'eBPF Probe Set',
    languageCoverage: ['Linux services'],
    latencyLabel: 'Kernel-aware tracing',
    latencyLabelZh: '内核态可观测',
    note: 'Useful for syscall-heavy and cross-process contention analysis.',
    noteZh: '适合 syscall 密集型场景和跨进程争用分析。',
    supportsRealCollection: true,
    expectedMaturityOnCurrentHost: process.platform === 'linux' ? 'partial' : 'deferred',
    maturityNote: 'Linux-only; deferred on non-Linux hosts.',
    maturityNoteZh: process.platform === 'linux' ? 'Linux 上部分支持（需要 root 和 BCC/bpftrace）。' : '仅 Linux 支持；当前平台延期到后续 Linux 验证轮。',
  },
];

export const targetTypes: Array<{
  id: TaskTargetType;
  label: string;
  description: string;
}> = [
  {
    id: 'label',
    label: '逻辑目标',
    description: '只填写逻辑目标标识，按当前 managed workload 路径运行。',
  },
  {
    id: 'pid',
    label: '指定 PID',
    description: '手动输入真实进程 PID，并尽量直接 attach 到该进程。',
  },
  {
    id: 'process',
    label: '选择进程',
    description: '从本机进程列表选择目标，保留 PID 和命令摘要作为证据。',
  },
];

export const taskLifecycleStatuses: Array<{
  id: TaskStatus;
  label: string;
  description: string;
}> = [
  {
    id: 'PENDING',
    label: '排队中',
    description: '任务已经创建，正在等待 runner 或 Agent 领取执行。',
  },
  {
    id: 'RUNNING',
    label: '运行中',
    description: '采集器已经启动，正在目标进程或 managed workload 上采样。',
  },
  {
    id: 'UPLOADING',
    label: '上传中',
    description: '采样结果正在落盘、上传、索引或转换成可分析产物。',
  },
  {
    id: 'DONE',
    label: '已完成',
    description: '采样、产物保留和分析已经完成，可以直接复核证据。',
  },
  {
    id: 'FAILED',
    label: '失败',
    description: '任务未能完成，仍需保留失败原因、审计记录和已有证据。',
  },
];

export const taskUploadStates: Array<{
  id: TaskUploadState;
  label: string;
  description: string;
}> = [
  {
    id: 'not_started',
    label: '未上传',
    description: '任务还在排队或采集中，尚未进入产物暂存或上传阶段。',
  },
  {
    id: 'uploading',
    label: '上传中',
    description: '采样产物正在暂存、上传、索引或等待 server 继续分析。',
  },
  {
    id: 'uploaded',
    label: '已上传',
    description: '采样产物已经保留并可继续生成最终分析结果。',
  },
  {
    id: 'upload_failed',
    label: '上传失败',
    description: '采样产物没有完整上传成功，但任务仍可能保留部分证据。',
  },
];

export const collectorReadinessStatuses: Array<{
  id: CollectorReadinessStatus;
  label: string;
  description: string;
}> = [
  {
    id: 'preferred',
    label: '首选真实链路',
    description: '当前平台与依赖满足条件，可优先走 Linux-first 的真实采集路径。',
  },
  {
    id: 'partial-real',
    label: '部分真实链路',
    description: '可以保留部分真实采样证据，但仍存在平台、权限或解析层面的降级。',
  },
  {
    id: 'fallback-only',
    label: '仅 fallback',
    description: '当前环境无法走首选真实链路，只能使用 managed workload 或 synthetic fallback。',
  },
  {
    id: 'unavailable',
    label: '不可用',
    description: '当前平台或依赖条件下无法使用该采集器。',
  },
];

export const collectorProvenanceModes: Array<{
  id: CollectorProvenanceMode;
  label: string;
  description: string;
}> = [
  {
    id: 'real',
    label: '真实链路',
    description: '采样命中了首选真实路径，并保留了可分析的真实产物。',
  },
  {
    id: 'partial-real',
    label: '部分真实',
    description: '保留了部分真实产物或真实原始信号，但最终结果带有可见降级。',
  },
  {
    id: 'fallback',
    label: 'fallback',
    description: '未能完成真实链路采样，结果来自 fallback 路径或 synthetic 产物。',
  },
];

export const symbolizationMappingStates: Array<{
  id: SymbolizationMappingState;
  label: string;
  description: string;
}> = [
  {
    id: 'full',
    label: '完整映射',
    description: '已保留符号、文件和行号，可直接对应到较可信的代码位置。',
  },
  {
    id: 'file-only',
    label: '仅文件级',
    description: '保留了文件或路径信息，但缺少准确行号。',
  },
  {
    id: 'module-only',
    label: '仅模块级',
    description: '只有模块或二进制级别的可读信息，定位精度有限。',
  },
  {
    id: 'synthetic',
    label: '合成映射',
    description: '当前显示依赖 synthetic fallback 或派生标签，不能等同真实源码映射。',
  },
  {
    id: 'unknown',
    label: '未知映射',
    description: '没有足够证据恢复可读位置，需要结合原始产物进一步核对。',
  },
];

export const reasonerModes: Array<{
  id: ReasonerMode;
  label: string;
  description: string;
}> = [
  {
    id: 'disabled',
    label: '已禁用',
    description: '只保留证据包，不尝试生成模型摘要。',
  },
  {
    id: 'stub',
    label: '本地安全 stub',
    description: '使用内置 evidence-only 逻辑输出安全摘要，适合本地回归和离线演示。',
  },
  {
    id: 'external',
    label: '外部 API',
    description: '通过外部 LLM API 生成摘要，但必须经过 schema 校验与 citation 过滤。',
  },
];

export const scenarios: ScenarioDefinition[] = [
  {
    id: 'cpu_hot',
    name: 'CPU Hot Path',
    displayNameZh: 'CPU 热路径',
    targetLanguage: 'Go / C++',
    targetLanguageZh: 'Go / C++',
    summary: '单条计算路径占据了大部分 CPU 时间，正在把服务推向饱和。',
    summaryZh: '单条计算路径占据大部分 CPU 时间，推动服务走向饱和。',
    signal: 'CPU bound',
    signalZh: 'CPU 受限',
    cpu: 91,
    blocked: 4,
    gc: 2,
    syscalls: 3,
    confidence: 0.95,
    primaryFinding: 'parseBatch 和 checksumLoop 消耗了大部分采样 CPU 时间。',
    recommendation: '拆分热点循环、减少分配，并确认关键路径上的向量化优化是否生效。',
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
    displayNameZh: '锁竞争',
    targetLanguage: 'Java / C++',
    targetLanguageZh: 'Java / C++',
    summary: '线程把大量时间花在等待同一把锁上，整体前进效率很差。',
    summaryZh: '线程大量时间等待同一把锁，整体前进速度很差。',
    signal: 'Blocked on mutex',
    signalZh: '阻塞在 mutex',
    cpu: 53,
    blocked: 38,
    gc: 4,
    syscalls: 5,
    confidence: 0.91,
    primaryFinding: '请求扇出过程中，worker 线程在 queueLock 后面被串行化了。',
    recommendation: '降低锁粒度、批量更新共享状态，并确认负载下争用是否消失。',
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
    displayNameZh: 'GC 压力',
    targetLanguage: 'Java / Kotlin',
    targetLanguageZh: 'Java / Kotlin',
    summary: '运行时把越来越多的时间花在回收短生命周期对象上。',
    summaryZh: '运行时花越来越多时间回收短生命周期对象。',
    signal: 'GC pressure',
    signalZh: 'GC 压力',
    cpu: 64,
    blocked: 9,
    gc: 27,
    syscalls: 3,
    confidence: 0.89,
    primaryFinding: '每次停顿前分配速率都会飙升，并把延迟推高到预算之外。',
    recommendation: '减少请求路径中的对象抖动、复用 buffer，并对比修复前后的停顿时间。',
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
    displayNameZh: 'Python 热循环',
    targetLanguage: 'Python',
    targetLanguageZh: 'Python',
    summary: '解释器时间集中在一个反复遍历 Python 对象的紧密循环里。',
    summaryZh: '解释器时间集中在一个反复遍历 Python 对象的紧密循环里。',
    signal: 'Interpreter bound',
    signalZh: '解释器受限',
    cpu: 72,
    blocked: 7,
    gc: 5,
    syscalls: 6,
    confidence: 0.93,
    primaryFinding: 'frame evaluation 与 list traversal 主导了整个画像。',
    recommendation: '把热点路径迁到向量化操作、缓存解析字段，或把循环下沉到 native code。',
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

export function getTargetTypeOption(targetType: TaskTargetType) {
  return targetTypes.find((item) => item.id === targetType) ?? targetTypes[0];
}

export function isCollectorId(value: string): value is CollectorId {
  return collectors.some((collector) => collector.id === value);
}

export function isScenarioId(value: string): value is ScenarioId {
  return scenarios.some((scenario) => scenario.id === value);
}

export function isTaskTargetType(value: string): value is TaskTargetType {
  return targetTypes.some((item) => item.id === value);
}
