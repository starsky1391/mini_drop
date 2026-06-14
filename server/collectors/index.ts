import { createCollectorRegistry } from './base.js';
import { asyncProfilerCollector } from './async-profiler.js';
import { ebpfCollector } from './ebpf.js';
import { perfCollector } from './perf.js';
import { pySpyCollector } from './pyspy.js';

export const collectorRegistry = createCollectorRegistry([
  perfCollector,
  pySpyCollector,
  asyncProfilerCollector,
  ebpfCollector,
]);

export const collectorCapabilities = collectorRegistry.list();
