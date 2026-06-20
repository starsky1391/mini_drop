import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessListResponse, TaskProcessInfo } from '../shared/types.js';

const execFileAsync = promisify(execFile);
const commandSummaryLimit = 160;

type RawProcessRecord = {
  pid: number;
  name: string;
  command: string;
};

export async function listLocalProcesses(limit = 200): Promise<ProcessListResponse> {
  const processes = await readLocalProcesses();
  return {
    collectedAt: new Date().toISOString(),
    processes: limit > 0 ? processes.slice(0, limit) : processes,
  };
}

export async function getProcessByPid(pid: number): Promise<TaskProcessInfo | null> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  if (pid === process.pid) {
    return buildCurrentProcessInfo();
  }

  if (process.platform === 'win32') {
    const script = [
      '$ErrorActionPreference = "Stop"',
      `$proc = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId, Name, CommandLine`,
      'if ($null -eq $proc) { return }',
      '$proc | ConvertTo-Json -Compress',
    ].join('; ');
    const stdout = await runOptionalCommand('powershell', ['-NoProfile', '-Command', script]);
    return normalizeWindowsProcessRecord(parseSingleJson(stdout));
  }

  const stdout = await runOptionalCommand('ps', ['-p', String(pid), '-o', 'pid=,comm=,args=']);
  const [line] = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!line) {
    return null;
  }

  return normalizePosixProcessLine(line);
}

async function readLocalProcesses() {
  const records =
    process.platform === 'win32' ? await readWindowsProcesses() : await readPosixProcesses();

  if (!records.some((record) => record.pid === process.pid)) {
    records.push(buildCurrentProcessInfo());
  }

  return records
    .filter((record) => record.pid > 0 && (record.name || record.command))
    .sort((left, right) => left.pid - right.pid);
}

async function readWindowsProcesses() {
  const script = [
    '$ErrorActionPreference = "Stop"',
    'Get-CimInstance Win32_Process | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress',
  ].join('; ');
  const stdout = await runOptionalCommand('powershell', ['-NoProfile', '-Command', script]);
  const parsed = parseJson(stdout);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return rows
    .map(normalizeWindowsProcessRecord)
    .filter((record): record is TaskProcessInfo => record !== null);
}

async function readPosixProcesses() {
  const stdout = await runOptionalCommand('ps', ['-axo', 'pid=,comm=,args=']);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizePosixProcessLine)
    .filter((record): record is TaskProcessInfo => record !== null);
}

function normalizeWindowsProcessRecord(raw: unknown) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as {
    ProcessId?: number;
    Name?: string;
    CommandLine?: string | null;
  };

  return normalizeProcessRecord({
    pid: Number(candidate.ProcessId ?? 0),
    name: typeof candidate.Name === 'string' ? candidate.Name : '',
    command: typeof candidate.CommandLine === 'string' ? candidate.CommandLine : '',
  });
}

function normalizePosixProcessLine(line: string) {
  const match = line.match(/^(\d+)\s+(\S+)\s*(.*)$/);
  if (!match) {
    return null;
  }

  return normalizeProcessRecord({
    pid: Number(match[1]),
    name: match[2] ?? '',
    command: match[3] ?? '',
  });
}

function normalizeProcessRecord(record: RawProcessRecord): TaskProcessInfo | null {
  const pid = Number(record.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  const name = record.name.trim() || inferProcessName(record.command, pid);
  const command = record.command.trim();

  return {
    pid,
    name,
    command,
    commandSummary: summarizeCommand(command || name),
    languageHint: inferLanguageHint(name, command),
    discoveredAt: new Date().toISOString(),
    alive: true,
  };
}

function summarizeCommand(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= commandSummaryLimit) {
    return normalized;
  }
  return `${normalized.slice(0, commandSummaryLimit - 3)}...`;
}

function inferProcessName(command: string, pid: number) {
  const firstToken = command.trim().split(/\s+/)[0];
  return firstToken ? firstToken.split(/[\\/]/).at(-1) ?? `pid-${pid}` : `pid-${pid}`;
}

function inferLanguageHint(name: string, command: string) {
  const haystack = `${name} ${command}`.toLowerCase();
  if (haystack.includes('python')) {
    return 'Python';
  }
  if (haystack.includes('java') || haystack.includes('jar')) {
    return 'Java';
  }
  if (haystack.includes('node') || haystack.includes('tsx') || haystack.includes('npm')) {
    return 'Node.js';
  }
  if (haystack.includes('go')) {
    return 'Go';
  }
  if (haystack.includes('dotnet')) {
    return '.NET';
  }
  return null;
}

function buildCurrentProcessInfo(): TaskProcessInfo {
  const command = process.argv.join(' ').trim();
  const name = inferProcessName(process.argv[0] ?? process.title ?? 'node', process.pid) || process.title || 'node';
  return {
    pid: process.pid,
    name,
    command,
    commandSummary: summarizeCommand(command || name),
    languageHint: inferLanguageHint(name, command) ?? 'Node.js',
    discoveredAt: new Date().toISOString(),
    alive: true,
  };
}

async function runOptionalCommand(command: string, args: string[]) {
  try {
    const result = await execFileAsync(command, args, {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return result.stdout.trim();
  } catch {
    return '';
  }
}

function parseJson(raw: string) {
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseSingleJson(raw: string) {
  const parsed = parseJson(raw);
  if (Array.isArray(parsed)) {
    return parsed[0] ?? null;
  }
  return parsed;
}
