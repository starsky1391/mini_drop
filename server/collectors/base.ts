import type { CollectorPlugin } from './types.js';

export function createCollectorRegistry(plugins: CollectorPlugin[]) {
  const registry = new Map(plugins.map((plugin) => [plugin.capability.id, plugin] as const));

  return {
    list() {
      return plugins.map((plugin) => plugin.capability);
    },
    entries() {
      return [...registry.entries()];
    },
    values() {
      return [...registry.values()];
    },
    get(id: CollectorPlugin['capability']['id']) {
      return registry.get(id) ?? null;
    },
  };
}
