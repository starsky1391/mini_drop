import type { TaskCreateInput } from '../../shared/types.js';
import type { CollectorPlugin } from '../collectors/types.js';
import { probeAgentEnvironment } from './probe.js';
import { createAgentRunController } from './run-registry.js';
import type { AgentManagedCollection } from './types.js';

export async function prepareManagedCollection(
  taskId: string,
  input: TaskCreateInput,
  plugin: CollectorPlugin,
): Promise<AgentManagedCollection> {
  const controller = createAgentRunController(taskId, input);
  controller.transition('probing', `Preparing ${plugin.capability.name} for ${input.target}.`);

  const probe = await probeAgentEnvironment(plugin);
  controller.attachProbe(probe);
  for (const note of probe.notes) {
    controller.log(note);
  }

  controller.transition('ready', `Agent prepared ${plugin.capability.id} with ${probe.collectors.length} probe result(s).`);
  return { controller, plugin, probe };
}
