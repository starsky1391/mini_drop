import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { getScenario } from '../../shared/catalog.js';
import type { CollectorOutcome, CollectorPlugin } from './types.js';
import { artifactLabel, artifactPath, ensureArtifactDir } from './runtime-utils.js';
import { readWorkloadReport, startWorkloadProcess } from './workload.js';
import { resolveRuntimeProfile } from './scenario-runtime.js';
import { buildCollapsedFromHotspots, mergeHotspots, parsePerfScript } from './profile-utils.js';
import type { ParsedProfileSummary } from './profile-utils.js';
import { createCollectorSession } from './session.js';

const execFileAsync = promisify(execFile);

export const perfCollector: CollectorPlugin = {
  capability: {
    id: 'perf',
    name: 'perf',
    languages: ['C++', 'Go', 'Java'],
    description: 'Capture native process stacks using perf record + perf script.',
    supportsRealCollection: true,
  },
  async collect(context) {
    const profile = resolveRuntimeProfile(context);
    const scenario = getScenario(context.scenario);
    const durationSeconds = Math.max(5, Math.ceil(profile.durationMs / 1000));
    const session = createCollectorSession(context.taskId, 'perf', profile.notes);
    await ensureArtifactDir(context.taskId);

    const reportFile = artifactPath(context.taskId, `${artifactLabel('workload', 'report')}.json`);
    const workload = await startWorkloadProcess({
      scenario: context.scenario,
      collector: context.collector,
      durationSeconds,
      reportFile,
      target: context.target,
    });
    session.log('prepare', `workload pid=${workload.pid}`);

    const perfDataPath = artifactPath(context.taskId, `${artifactLabel('perf', 'record')}.data`);
    let parsedProfile: ParsedProfileSummary | null = null;

    try {
      if (process.platform === 'linux') {
        const recordArgs = [
          'record',
          '-F',
          String(profile.sampleRate),
          '-g',
          '-o',
          perfDataPath,
          '-p',
          String(workload.pid),
          '--',
          'sleep',
          String(durationSeconds),
        ];
        const perfRecord = await execFileAsync('perf', recordArgs);
        session.log('capture', perfRecord.stderr?.trim() || 'perf record completed.');

        const perfScript = await execFileAsync('perf', ['script', '-i', perfDataPath]);
        const scriptPath = await session.writeTextArtifact('raw', 'script', perfScript.stdout, 'perf script output');
        parsedProfile = parsePerfScript(perfScript.stdout);
        session.log(
          parsedProfile?.usedRealData ? 'normalize' : 'fallback',
          parsedProfile?.usedRealData
            ? `perf script normalized into ${parsedProfile.sampleCount} stack samples.`
            : 'perf script was captured but did not yield parseable stack samples.',
        );
        session.addArtifact('raw', perfDataPath, 'perf.data');
        session.log('capture', `raw script saved at ${scriptPath}`);
      } else {
        await fs.writeFile(perfDataPath, 'perf unsupported on this platform, falling back to synthetic stacks.', 'utf8');
        session.addArtifact('raw', perfDataPath, 'perf.data');
        session.log('fallback', 'perf is not available on this platform; fallback sample file created.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'perf command failed';
      session.log('fallback', `perf execution fallback: ${message}`);
      await fs.writeFile(perfDataPath, `perf unavailable: ${message}`, 'utf8');
      session.addArtifact('raw', perfDataPath, 'perf.data');
    }

    const [completion, workloadStdout, workloadStderr] = await Promise.all([
      workload.completion,
      workload.stdout,
      workload.stderr,
    ]);
    const fallbackReport = completion.report ?? (await readWorkloadReport(reportFile));
    const report = fallbackReport ?? buildSyntheticReport(context.collector, context.target, scenario.name, scenario.topFunctions[0].name, durationSeconds);
    const topFunctions = mergeHotspots(parsedProfile?.topFunctions ?? [], report.top_functions, 4);
    const collectorReport = {
      ...report,
      top_functions: topFunctions,
      summary: parsedProfile?.usedRealData
        ? `${report.summary} Real perf stacks were parsed from ${parsedProfile.sampleCount} samples.`
        : `${report.summary} Synthetic or workload-derived hotspots were used as a fallback.`,
    };
    const collapsedStacks =
      parsedProfile?.collapsedStacks ||
      buildCollapsedFromHotspots(collectorReport.title, topFunctions, [
        'pthread_mutex_lock',
        'decodeFields',
        'compressPayload',
        'writeResponse',
      ]);

    const reportPath = await session.writeJsonArtifact('report', 'collector-report', collectorReport, 'Collector report');
    await session.writeTextArtifact('collapsed-stacks', 'collapsed', collapsedStacks, 'Collapsed stacks');
    if (workloadStdout.trim()) {
      await session.writeTextArtifact('log', 'workload-stdout', workloadStdout, 'workload stdout');
    }
    if (workloadStderr.trim()) {
      await session.writeTextArtifact('log', 'workload-stderr', workloadStderr, 'workload stderr');
    }
    session.log(completion.code === 0 ? 'complete' : 'fallback', completion.code === 0 ? 'workload finished cleanly.' : `workload exit code=${completion.code}`);
    await session.flushLogs();

    const sampleCount = parsedProfile?.sampleCount ?? Math.max(1, Math.round(collectorReport.duration_ms / 32));
    return {
      status: 'analyzing',
      progress: 72,
      artifacts: session.artifacts,
      sample: {
        sampleCount,
        topFunctions,
        metrics: collectorReport.metrics,
        summary: collectorReport.summary,
        rawSignal: parsedProfile?.usedRealData ? 'native-stack-sampling:perf-script' : 'native-stack-sampling:fallback',
        workloadReportPath: reportPath,
        evidence: parsedProfile?.evidence,
      },
      report: {
        scenario: context.scenario,
        collector: context.collector,
        target: context.target,
        title: collectorReport.title,
        durationMs: collectorReport.duration_ms,
        result: collectorReport.result,
        metrics: collectorReport.metrics,
        topFunctions,
        summary: collectorReport.summary,
        evidence: parsedProfile?.evidence,
      },
      logs: session.logs,
    };
  },
};

function buildSyntheticReport(
  collector: string,
  target: string,
  title: string,
  topFunction: string,
  durationSeconds: number,
) {
  const metrics = scenarioMetrics(title);
  return {
    scenario: title,
    collector,
    target,
    title,
    duration_ms: durationSeconds * 1000,
    result: 1,
    metrics,
    top_functions: [
      { name: topFunction, percent: 36, module: 'synthetic/module.cpp' },
      { name: 'support', percent: 18, module: 'synthetic/support.cpp' },
      { name: 'misc', percent: 14, module: 'synthetic/misc.cpp' },
      { name: 'io', percent: 10, module: 'synthetic/io.cpp' },
    ],
    summary: `${title} collected with synthetic fallback.`,
  };
}

function scenarioMetrics(title: string) {
  if (title.includes('Lock')) {
    return { cpu: 53, blocked: 38, gc: 4, syscalls: 5 };
  }
  if (title.includes('GC')) {
    return { cpu: 64, blocked: 9, gc: 27, syscalls: 3 };
  }
  if (title.includes('Python')) {
    return { cpu: 72, blocked: 7, gc: 5, syscalls: 6 };
  }
  return { cpu: 91, blocked: 4, gc: 2, syscalls: 3 };
}
