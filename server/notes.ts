export const collectorNotes = [
  '默认体验会优先保留 synthetic profile，这样即使没有 root 权限也能完整演示诊断流程。',
  '每个场景都会尽量模拟真实采集器应该产出的证据链，方便先验证分析和展示闭环。',
  '当前采集链路刻意保持轻量，后续替换成原生采集器时不需要重做 UI。',
  'py-spy 是当前平台上最稳定的采集器，适合 Python 解释器热点循环和异步等待诊断。',
  'async-profiler 在 Windows 上部分支持；完整 JVM attach 需要非 Windows 平台。',
  'perf 仅 Linux 支持；当前非 Linux 平台，perf 真实采集延期到后续 Linux 验证轮。',
  'eBPF 仅 Linux 支持；当前非 Linux 平台，eBPF 真实采集延期到后续 Linux 验证轮。',
];

export const collectorMaturityMatrix = [
  {
    collector: 'py-spy',
    expectedMaturity: 'stable',
    readiness: 'preferred',
    platform: 'all',
    notes: '当前平台上最稳定的采集器。',
  },
  {
    collector: 'async-profiler',
    expectedMaturity: 'partial',
    readiness: 'fallback-only',
    platform: 'win32',
    notes: 'Windows 上部分支持；完整 JVM attach 需要非 Windows 平台。',
  },
  {
    collector: 'perf',
    expectedMaturity: 'deferred',
    readiness: 'deferred-for-linux-proof',
    platform: 'linux',
    notes: '仅 Linux 支持；当前非 Linux 平台，perf 真实采集延期到后续 Linux 验证轮。',
  },
  {
    collector: 'ebpf',
    expectedMaturity: 'deferred',
    readiness: 'deferred-for-linux-proof',
    platform: 'linux',
    notes: '仅 Linux 支持；当前非 Linux 平台，eBPF 真实采集延期到后续 Linux 验证轮。',
  },
] as const;
