import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { collectorRegistry } from '../collectors/index.js';
import { probeLinuxPrivilegeSupport } from '../collectors/linux-privileged.js';
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

export async function probeAllAgentCollectors(): Promise<AgentEnvironmentProbe> {
  const collectors = collectorRegistry.values();
  const availabilities = await Promise.all(collectors.map((plugin) => probeCollectorAvailability(plugin)));
  const notes = [
    `agent platform=${process.platform} arch=${process.arch} node=${process.version}`,
    `probed ${availabilities.length} collector(s) for agent registration`,
  ];

  return {
    collectedAt: new Date().toISOString(),
    host: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
    },
    collectors: availabilities,
    notes,
  };
}

async function probeCollectorAvailability(plugin: CollectorPlugin): Promise<AgentCollectorAvailability> {
  if (!plugin.capability.supportsRealCollection) {
    return {
      collector: plugin.capability.id,
      supported: false,
      available: false,
      readiness: 'unavailable',
      detail: 'Real collection is not enabled for this plugin yet.',
    };
  }

  if (plugin.capability.id === 'perf') {
    if (process.platform !== 'linux') {
      return {
        collector: plugin.capability.id,
        supported: false,
        available: false,
        readiness: 'deferred-for-linux-proof',
        detail: `tool=perf platform=${process.platform} requires linux；当前 collector 标记为 deferred-for-linux-proof，等待后续 Linux 现场验证。`,
      };
    }

    const privilege = await probeLinuxPrivilegeSupport();
    if (!privilege.canRunPrivilegedCollectors) {
      return {
        collector: plugin.capability.id,
        supported: true,
        available: false,
        readiness: 'fallback-only',
        detail: `tool=perf available=true ${privilege.detail} 当前 Linux 主机缺少可用的提权路径，因此 perf 仍会退回 fallback。`,
      };
    }

    return annotateProbeDetail(
      await commandAvailability(plugin.capability.id, 'perf', ['--version'], 'preferred'),
      `${privilege.detail} 在 Linux 上优先用于 native / Go / C++ 演示；如果 perf script 无法归一化，仍会保留 perf.data 与 script 产物用于 partial-real 审计，并可由 smoke:perf-linux 做专门验证。`,
    );
  }

  if (plugin.capability.id === 'py-spy') {
    const privilege = process.platform === 'linux' ? await probeLinuxPrivilegeSupport() : null;
    return annotateProbeDetail(
      await firstAvailableCommand(
        plugin.capability.id,
        pySpyProbeCandidates(),
        ['--version'],
        'preferred',
      ),
      process.platform === 'linux'
        ? `${privilege?.detail ?? 'linux privilege probe unavailable'} py-spy 在 Linux 上会优先尝试真实 attach；如果宿主机存在 ptrace 限制，会通过已配置的 sudo 路径执行。若 speedscope 归一化失败，也会保留真实 artifact 并标记为 partial-real。`
        : '当前是最稳定的 Python assignment demo 路径；如果 speedscope 归一化失败，也会保留真实 artifact 并标记为 partial-real。',
    );
  }

  if (plugin.capability.id === 'async-profiler') {
    const command = process.env.MINI_DROP_ASYNC_PROFILER_BIN || 'asprof';
    return annotateProbeDetail(
      await commandAvailability(plugin.capability.id, command, ['--help'], 'preferred'),
      '当目标运行时与权限允许时支持 JVM PID attach；如果 collapsed artifact 可保留但归一化不完整，会标记为 partial-real 而不是直接丢成 fallback。',
    );
  }

  if (plugin.capability.id === 'ebpf') {
    if (process.platform !== 'linux') {
      return {
        collector: plugin.capability.id,
        supported: false,
        available: false,
        readiness: 'deferred-for-linux-proof',
        detail: `tool=bpftrace platform=${process.platform} requires linux；当前 collector 标记为 deferred-for-linux-proof，等待后续 Linux 现场验证。`,
      };
    }

    const privilege = await probeLinuxPrivilegeSupport();
    if (!privilege.canRunPrivilegedCollectors) {
      return {
        collector: plugin.capability.id,
        supported: true,
        available: false,
        readiness: 'fallback-only',
        detail: `tool=bpftrace available=true ${privilege.detail} 当前 Linux 主机缺少可用的提权路径，因此 eBPF 仍会退回 fallback。`,
      };
    }

    const command = process.env.MINI_DROP_BPFTRACE_BIN || 'bpftrace';
    return annotateProbeDetail(
      await commandAvailability(plugin.capability.id, command, ['--version'], 'partial-real'),
      `${privilege.detail} 在 Linux 上支持面向 PID 的 raw snapshot；当 bpftrace 输出可解析时会提升到结构化热点，否则仍保留原始证据并标记为 partial-real，并可由 smoke:ebpf-linux 复核。`,
    );
  }

  return {
      collector: plugin.capability.id,
      supported: false,
      available: false,
      readiness: 'unavailable',
      detail: '这个 collector 目前还没有实现 agent 侧探测逻辑。',
    };
  }

async function commandAvailability(
  collector: AgentCollectorAvailability['collector'],
  command: string,
  args: string[],
  readiness: AgentCollectorAvailability['readiness'],
): Promise<AgentCollectorAvailability> {
  const invocation = `${command} ${args.join(' ')}`.trim();
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
      readiness,
      detail: `tool=${invocation} available=true ${summary || 'probe responded successfully.'}`.trim(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : `${command} probe failed`;
    return {
      collector,
      supported: true,
      available: false,
      readiness: 'fallback-only',
      detail: `tool=${invocation} available=false ${message}`,
    };
  }
}

async function firstAvailableCommand(
  collector: AgentCollectorAvailability['collector'],
  commands: string[],
  args: string[],
  readiness: AgentCollectorAvailability['readiness'],
) {
  let lastFailure: AgentCollectorAvailability | null = null;
  for (const command of commands) {
    const availability = await commandAvailability(collector, command, args, readiness);
    if (availability.available) {
      return availability;
    }
    lastFailure = availability;
  }

  return lastFailure ?? {
    collector,
    supported: true,
    available: false,
    readiness: 'fallback-only',
    detail: `tool=${commands.join(' | ')} available=false no probe command candidates were configured`,
  };
}

function pySpyProbeCandidates() {
  const candidates = new Set<string>();
  const configured = process.env.MINI_DROP_PYSPY_BIN?.trim();
  if (configured) {
    candidates.add(configured);
  }
  candidates.add('py-spy');
  if (process.platform === 'linux') {
    candidates.add(`${os.homedir()}/.local/bin/py-spy`);
  }
  return [...candidates];
}

function annotateProbeDetail(
  availability: AgentCollectorAvailability,
  suffix: string,
): AgentCollectorAvailability {
  return {
    ...availability,
    detail: `${availability.detail} ${suffix}`.trim(),
  };
}
