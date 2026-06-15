import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

export interface LinuxPrivilegeSupportSnapshot {
  platform: NodeJS.Platform;
  perfEventParanoid: number | null;
  sudoMode: 'none' | 'sudo-nopasswd' | 'sudo-password';
  requiresPrivilegeForPerfLike: boolean;
  canRunPrivilegedCollectors: boolean;
  detail: string;
}

interface RunLinuxCommandOptions {
  stdinText?: string;
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LinuxCommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  invokedWith: 'direct' | 'sudo-nopasswd' | 'sudo-password';
}

let privilegeProbePromise: Promise<LinuxPrivilegeSupportSnapshot> | null = null;

export function classifyLinuxPrivilegeSupport(input: {
  platform: NodeJS.Platform;
  perfEventParanoid: number | null;
  sudoMode: LinuxPrivilegeSupportSnapshot['sudoMode'];
}) {
  const requiresPrivilegeForPerfLike =
    input.platform === 'linux' && input.perfEventParanoid !== null ? input.perfEventParanoid > 2 : input.platform === 'linux';
  const canRunPrivilegedCollectors =
    input.platform === 'linux' &&
    (!requiresPrivilegeForPerfLike || input.sudoMode === 'sudo-nopasswd' || input.sudoMode === 'sudo-password');

  const detailParts = [`platform=${input.platform}`];
  if (input.perfEventParanoid !== null) {
    detailParts.push(`perf_event_paranoid=${input.perfEventParanoid}`);
  }
  detailParts.push(`sudo=${input.sudoMode}`);
  if (input.platform !== 'linux') {
    detailParts.push('linux privilege probe unavailable on non-linux host');
  } else if (canRunPrivilegedCollectors) {
    detailParts.push(
      requiresPrivilegeForPerfLike
        ? 'linux perf/eBPF collectors can run through a configured privileged path'
        : 'linux perf/eBPF collectors can run directly without an extra privileged path',
    );
  } else if (requiresPrivilegeForPerfLike) {
    detailParts.push('linux perf/eBPF collectors still require sudo or a lower perf_event_paranoid setting');
  } else {
    detailParts.push('linux perf/eBPF collectors can run directly');
  }

  return {
    platform: input.platform,
    perfEventParanoid: input.perfEventParanoid,
    sudoMode: input.sudoMode,
    requiresPrivilegeForPerfLike,
    canRunPrivilegedCollectors,
    detail: detailParts.join(' '),
  } satisfies LinuxPrivilegeSupportSnapshot;
}

export async function probeLinuxPrivilegeSupport() {
  privilegeProbePromise ??= (async () => {
    if (process.platform !== 'linux') {
      return classifyLinuxPrivilegeSupport({
        platform: process.platform,
        perfEventParanoid: null,
        sudoMode: 'none',
      });
    }

    const perfEventParanoid = await readPerfEventParanoid();
    let sudoMode: LinuxPrivilegeSupportSnapshot['sudoMode'] = 'none';

    if (await canRunSudoNoPassword()) {
      sudoMode = 'sudo-nopasswd';
    } else if (await canRunSudoWithConfiguredPassword()) {
      sudoMode = 'sudo-password';
    }

    return classifyLinuxPrivilegeSupport({
      platform: process.platform,
      perfEventParanoid,
      sudoMode,
    });
  })();

  return privilegeProbePromise;
}

export async function runLinuxCollectorCommand(
  command: string,
  args: string[],
  options: RunLinuxCommandOptions & {
    requirePrivilege?: boolean;
  } = {},
) {
  const support = await probeLinuxPrivilegeSupport();
  const shouldUseSudo =
    process.platform === 'linux' &&
    (options.requirePrivilege || support.requiresPrivilegeForPerfLike) &&
    support.canRunPrivilegedCollectors;

  if (shouldUseSudo && support.sudoMode === 'sudo-nopasswd') {
    return runCommand('sudo', ['-n', command, ...args], {
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      env: options.env,
      invokedWith: 'sudo-nopasswd',
    });
  }

  if (shouldUseSudo && support.sudoMode === 'sudo-password') {
    const password = process.env.MINI_DROP_LINUX_SUDO_PASSWORD ?? '';
    return runCommand('sudo', ['-S', '-p', '', command, ...args], {
      stdinText: `${password}\n`,
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      env: options.env,
      invokedWith: 'sudo-password',
    });
  }

  return runCommand(command, args, {
    timeoutMs: options.timeoutMs,
    cwd: options.cwd,
    env: options.env,
    invokedWith: 'direct',
  });
}

async function canRunSudoNoPassword() {
  try {
    const result = await runCommand('sudo', ['-n', 'true'], {
      timeoutMs: 3_000,
      invokedWith: 'sudo-nopasswd',
    });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function canRunSudoWithConfiguredPassword() {
  const password = process.env.MINI_DROP_LINUX_SUDO_PASSWORD ?? '';
  if (!password.trim()) {
    return false;
  }

  try {
    const result = await runCommand('sudo', ['-S', '-p', '', 'true'], {
      stdinText: `${password}\n`,
      timeoutMs: 3_000,
      invokedWith: 'sudo-password',
    });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function readPerfEventParanoid() {
  try {
    const raw = await fs.readFile('/proc/sys/kernel/perf_event_paranoid', 'utf8');
    const value = Number(raw.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function runCommand(
  command: string,
  args: string[],
  options: RunLinuxCommandOptions & { invokedWith: LinuxCommandResult['invokedWith'] },
) {
  return new Promise<LinuxCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);

    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, options.timeoutMs)
        : null;

    if (options.stdinText) {
      child.stdin.write(options.stdinText);
    }
    child.stdin.end();

    child.on('close', (code, signal) => {
      if (timer) {
        clearTimeout(timer);
      }

      if (timedOut) {
        reject(new Error(`${command} ${args.join(' ')} timed out after ${options.timeoutMs}ms`));
        return;
      }

      resolve({
        stdout,
        stderr,
        code,
        signal,
        invokedWith: options.invokedWith,
      });
    });
  });
}
