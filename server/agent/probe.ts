import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CollectorPlugin } from '../collectors/types.js';
import type { AgentCollectorAvailability, AgentEnvironmentProbe } from './types.js';

const execFileAsync = promisify(execFile);

export async function probeAgentEnvironment(plugin: CollectorPlugin): Promise<AgentEnvironmentProbe> {
  const availability = await probeCollectorAvailability(plugin);
  const notes = [
    `agent platform=${process.platform} arch=${process.arch} node=${process.version}`,
    `collector ${plugin.capability.id}: ${availability.detail}`,
  ];

  return {
    collectedAt: new Date().toISOString(),
    host: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
    },
    collectors: [availability],
    notes,
  };
}

async function probeCollectorAvailability(plugin: CollectorPlugin): Promise<AgentCollectorAvailability> {
  if (!plugin.capability.supportsRealCollection) {
    return {
      collector: plugin.capability.id,
      supported: false,
      available: false,
      detail: 'Real collection is not enabled for this plugin yet.',
    };
  }

  if (plugin.capability.id === 'perf') {
    if (process.platform !== 'linux') {
      return {
        collector: plugin.capability.id,
        supported: false,
        available: false,
        detail: 'perf requires Linux; this agent will rely on the collector fallback path.',
      };
    }

    return commandAvailability(plugin.capability.id, 'perf', ['--version']);
  }

  if (plugin.capability.id === 'py-spy') {
    return commandAvailability(plugin.capability.id, 'py-spy', ['--version']);
  }

  return {
    collector: plugin.capability.id,
    supported: false,
    available: false,
    detail: 'No agent-side probe is implemented for this collector yet.',
  };
}

async function commandAvailability(
  collector: AgentCollectorAvailability['collector'],
  command: string,
  args: string[],
): Promise<AgentCollectorAvailability> {
  try {
    const result = await execFileAsync(command, args, { timeout: 5000 });
    const summary = [result.stdout, result.stderr]
      .filter(Boolean)
      .map((part) => part.trim())
      .find(Boolean);

    return {
      collector,
      supported: true,
      available: true,
      detail: summary || `${command} responded successfully.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${command} probe failed`;
    return {
      collector,
      supported: true,
      available: false,
      detail: message,
    };
  }
}
