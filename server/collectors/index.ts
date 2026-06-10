import { createCollectorRegistry } from './base.js';
import { perfCollector } from './perf.js';
import { pySpyCollector } from './pyspy.js';

export const collectorRegistry = createCollectorRegistry([perfCollector, pySpyCollector]);

export const collectorCapabilities = collectorRegistry.list();
