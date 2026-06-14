import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { once } from 'node:events';
import type { CollectorId, ScenarioId, TaskMetrics } from '../../shared/types.js';
import { resolveDataRoot } from '../storage/data-root.js';

const workloadDir = path.join(resolveDataRoot(), 'workloads');
const workloadPath = path.join(workloadDir, 'mini_drop_workload.py');

export interface WorkloadSpec {
  scenario: ScenarioId;
  collector: CollectorId;
  durationSeconds: number;
  reportFile: string;
  target: string;
}

export interface WorkloadReport {
  scenario: ScenarioId;
  collector: CollectorId;
  target: string;
  title: string;
  duration_ms: number;
  result: number;
  metrics: TaskMetrics;
  top_functions: Array<{
    name: string;
    percent: number;
    module: string;
  }>;
  summary: string;
}

export interface WorkloadProcess {
  pid: number;
  reportFile: string;
  stdout: Promise<string>;
  stderr: Promise<string>;
  completion: Promise<{ code: number; signal: NodeJS.Signals | null; report: WorkloadReport | null }>;
}

export async function ensureWorkloadScript() {
  await fs.mkdir(workloadDir, { recursive: true });
  try {
    await fs.access(workloadPath);
  } catch {
    await fs.writeFile(workloadPath, buildWorkloadScript(), 'utf8');
  }
  return workloadPath;
}

export function buildWorkloadArgs(spec: WorkloadSpec) {
  return [
    workloadPath,
    '--scenario',
    spec.scenario,
    '--collector',
    spec.collector,
    '--duration',
    String(spec.durationSeconds),
    '--report-file',
    spec.reportFile,
    '--target',
    spec.target,
  ];
}

export async function startWorkloadProcess(spec: WorkloadSpec): Promise<WorkloadProcess> {
  await ensureWorkloadScript();
  const pythonBin = process.env.MINI_DROP_PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const reportFile = path.resolve(spec.reportFile);
  const child = spawn(pythonBin, buildWorkloadArgs({ ...spec, reportFile }), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk;
  });

  const completion = (async () => {
    const [code, signal] = (await once(child, 'exit')) as [number, NodeJS.Signals | null];
    const report = await readWorkloadReport(reportFile);
    return { code, signal, report };
  })();

  const stdoutPromise = new Promise<string>((resolve) => child.once('close', () => resolve(stdout)));
  const stderrPromise = new Promise<string>((resolve) => child.once('close', () => resolve(stderr)));

  return {
    pid: child.pid ?? 0,
    reportFile,
    stdout: stdoutPromise,
    stderr: stderrPromise,
    completion,
  };
}

export async function readWorkloadReport(reportFile: string): Promise<WorkloadReport | null> {
  try {
    const raw = await fs.readFile(reportFile, 'utf8');
    return JSON.parse(raw) as WorkloadReport;
  } catch {
    return null;
  }
}

function buildWorkloadScript() {
  return `#!/usr/bin/env python3
import argparse
import json
import math
import os
import threading
import time


def scenario_profile(name: str):
    if name == "lock_contention":
        return {
            "title": "Lock Contention",
            "cpu": 53,
            "blocked": 38,
            "gc": 4,
            "syscalls": 5,
            "top_functions": [
                {"name": "QueueLock::lock", "percent": 41, "module": "sync/queue_lock.cpp"},
                {"name": "dispatchWork", "percent": 23, "module": "service/scheduler.cpp"},
                {"name": "awaitPermit", "percent": 12, "module": "service/rate_limiter.cpp"},
                {"name": "flushMetrics", "percent": 8, "module": "observability/metrics.cpp"},
            ],
        }
    if name == "gc_pressure":
        return {
            "title": "GC Pressure",
            "cpu": 64,
            "blocked": 9,
            "gc": 27,
            "syscalls": 3,
            "top_functions": [
                {"name": "ObjectAllocator::new", "percent": 31, "module": "runtime/memory.cpp"},
                {"name": "youngGenCollect", "percent": 27, "module": "runtime/gc.cpp"},
                {"name": "serializeResponse", "percent": 14, "module": "api/codec.cpp"},
                {"name": "mergeSpan", "percent": 10, "module": "telemetry/span.cpp"},
            ],
        }
    if name == "python_hot_loop":
        return {
            "title": "Python Hot Loop",
            "cpu": 72,
            "blocked": 7,
            "gc": 5,
            "syscalls": 6,
            "top_functions": [
                {"name": "frame_eval", "percent": 39, "module": "python/ceval.c"},
                {"name": "walk_rows", "percent": 22, "module": "app/rows.py"},
                {"name": "parse_message", "percent": 13, "module": "app/parser.py"},
                {"name": "emit_metrics", "percent": 8, "module": "infra/metrics.py"},
            ],
        }
    return {
        "title": "CPU Hot Path",
        "cpu": 91,
        "blocked": 4,
        "gc": 2,
        "syscalls": 3,
        "top_functions": [
            {"name": "parseBatch", "percent": 36, "module": "ingest/decoder.cc"},
            {"name": "checksumLoop", "percent": 24, "module": "ingest/hash.cc"},
            {"name": "compressPayload", "percent": 14, "module": "io/compress.cc"},
            {"name": "writeResponse", "percent": 9, "module": "net/http.cc"},
        ],
    }


def busy_spin(seconds: float):
    deadline = time.time() + seconds
    values = []
    x = 0.123456
    while time.time() < deadline:
        for _ in range(25000):
            x = math.sin(x) * math.cos(x) + math.sqrt(abs(x) + 1.0)
            values.append(x)
            if len(values) > 2500:
                values.pop(0)
    return values[-32:]


def lock_work(seconds: float):
    lock = threading.Lock()
    state = {"value": 0}
    deadline = time.time() + seconds

    def worker():
        while time.time() < deadline:
            with lock:
                state["value"] += 1
                for _ in range(8000):
                    state["value"] += 1

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return state["value"]


def gc_pressure(seconds: float):
    deadline = time.time() + seconds
    payload = []
    while time.time() < deadline:
        payload = [{"n": i, "value": i * 2, "text": "x" * 128} for i in range(5000)]
        payload = [item for item in payload if item["n"] % 3 != 0]
    return len(payload)


def python_hot_loop(seconds: float):
    deadline = time.time() + seconds
    rows = [{"a": i, "b": i + 1, "c": i * 2} for i in range(2000)]
    total = 0
    while time.time() < deadline:
        for row in rows:
            total += row["a"] + row["b"] + row["c"]
            total %= 100000
    return total


def run_scenario(name: str, seconds: float):
    if name == "lock_contention":
        return lock_work(seconds)
    if name == "gc_pressure":
        return gc_pressure(seconds)
    if name == "python_hot_loop":
        return python_hot_loop(seconds)
    return busy_spin(seconds)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--collector", required=True)
    parser.add_argument("--duration", required=True, type=int)
    parser.add_argument("--report-file", required=True)
    parser.add_argument("--target", required=True)
    args = parser.parse_args()

    profile = scenario_profile(args.scenario)
    start = time.time()
    result = run_scenario(args.scenario, max(1, args.duration))
    duration = time.time() - start
    report = {
        "scenario": args.scenario,
        "collector": args.collector,
        "target": args.target,
        "title": profile["title"],
        "duration_ms": int(duration * 1000),
        "result": result,
        "metrics": {
            "cpu": profile["cpu"],
            "blocked": profile["blocked"],
            "gc": profile["gc"],
            "syscalls": profile["syscalls"],
        },
        "top_functions": profile["top_functions"],
        "summary": f"{args.collector} collected {args.scenario} with a real workload process.",
    }

    os.makedirs(os.path.dirname(args.report_file), exist_ok=True)
    with open(args.report_file, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)

    print("MINI_DROP_WORKLOAD:" + json.dumps(report))


if __name__ == "__main__":
    main()
`;
}
