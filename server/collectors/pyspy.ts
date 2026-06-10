import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { getScenario } from '../../shared/catalog.js';
import type { CollectorOutcome, CollectorPlugin } from './types.js';
import { artifactLabel, artifactPath, ensureArtifactDir } from './runtime-utils.js';
import { readWorkloadReport, startWorkloadProcess } from './workload.js';
import { resolveRuntimeProfile } from './scenario-runtime.js';
import { buildCollapsedFromHotspots, mergeHotspots, parseSpeedscopeProfile } from './profile-utils.js';
import type { ParsedProfileSummary } from './profile-utils.js';
import { createCollectorSession } from './session.js';

const execFileAsync = promisify(execFile);

export const pySpyCollector: CollectorPlugin = {
  capability: {
    id: 'py-spy',
    name: 'py-spy',
    languages: ['Python'],
    description: 'Capture Python stacks with py-spy record and speedscope export.',
    supportsRealCollection: true,
  },
  async collect(context) {
    const profile = resolveRuntimeProfile(context);
    const scenario = getScenario(context.scenario);
    const durationSeconds = Math.max(5, Math.ceil(profile.durationMs / 1000));
    const session = createCollectorSession(context.taskId, 'pyspy', profile.notes);
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

    const speedscopePath = artifactPath(context.taskId, `${artifactLabel('pyspy', 'speedscope')}.json`);
    let speedscopeText = '';
    let parsedProfile: ParsedProfileSummary | null = null;

    try {
      if (await isPySpyAvailable()) {
        const pySpyArgs = [
          'record',
          '--pid',
          String(workload.pid),
          '--duration',
          String(durationSeconds),
          '--rate',
          String(profile.sampleRate),
          '--output',
          speedscopePath,
          '--format',
          'speedscope',
        ];
        const result = await execFileAsync('py-spy', pySpyArgs);
        session.log('capture', result.stderr?.trim() || 'py-spy record completed.');
        session.addArtifact('speedscope', speedscopePath, 'Speedscope profile');
        speedscopeText = await fs.readFile(speedscopePath, 'utf8');
        parsedProfile = parseSpeedscopeProfile(speedscopeText);
      } else {
        speedscopeText = JSON.stringify(buildSpeedscopePayload(scenario.name, scenario.topFunctions[0].name), null, 2);
        await fs.writeFile(speedscopePath, speedscopeText, 'utf8');
        session.addArtifact('speedscope', speedscopePath, 'Speedscope profile');
        session.log('fallback', 'py-spy unavailable; speedscope placeholder created.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'py-spy command failed';
      session.log('fallback', `py-spy execution fallback: ${message}`);
      speedscopeText = JSON.stringify(buildSpeedscopePayload(scenario.name, scenario.topFunctions[0].name), null, 2);
      await fs.writeFile(speedscopePath, speedscopeText, 'utf8');
      session.addArtifact('speedscope', speedscopePath, 'Speedscope profile');
    }

    parsedProfile ??= parseSpeedscopeProfile(speedscopeText);
    session.log(
      parsedProfile?.usedRealData ? 'normalize' : 'fallback',
      parsedProfile?.usedRealData
        ? `speedscope normalized into ${parsedProfile.sampleCount} stack samples.`
        : 'speedscope did not contain enough structured samples; workload hotspots will be used.',
    );

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
        ? `${report.summary} Real py-spy samples were normalized from ${parsedProfile.sampleCount} stack samples.`
        : `${report.summary} Synthetic or workload-derived hotspots were used as a fallback.`,
    };
    const collapsed =
      parsedProfile?.collapsedStacks ||
      buildCollapsedFromHotspots(collectorReport.title, topFunctions, ['frame_eval', 'walk_rows', 'parse_message', 'emit_metrics']);

    const reportPath = await session.writeJsonArtifact('report', 'collector-report', collectorReport, 'Collector report');
    await session.writeTextArtifact('collapsed-stacks', 'collapsed', collapsed, 'Collapsed stacks');
    if (workloadStdout.trim()) {
      await session.writeTextArtifact('log', 'workload-stdout', workloadStdout, 'workload stdout');
    }
    if (workloadStderr.trim()) {
      await session.writeTextArtifact('log', 'workload-stderr', workloadStderr, 'workload stderr');
    }
    session.log(completion.code === 0 ? 'complete' : 'fallback', completion.code === 0 ? 'workload finished cleanly.' : `workload exit code=${completion.code}`);
    await session.flushLogs();

    return {
      status: 'analyzing',
      progress: 72,
      artifacts: session.artifacts,
      sample: {
        sampleCount: parsedProfile?.sampleCount ?? Math.max(1, Math.round(collectorReport.duration_ms / 40)),
        topFunctions,
        metrics: collectorReport.metrics,
        summary: collectorReport.summary,
        rawSignal: parsedProfile?.usedRealData ? 'python-stack-sampling:py-spy' : 'python-stack-sampling:fallback',
        workloadReportPath: reportPath,
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
      },
      logs: session.logs,
    };
  },
};

async function isPySpyAvailable() {
  try {
    await execFileAsync('py-spy', ['--version']);
    return true;
  } catch {
    return false;
  }
}

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
      { name: topFunction, percent: 39, module: 'python/ceval.c' },
      { name: 'walk_rows', percent: 22, module: 'app/rows.py' },
      { name: 'parse_message', percent: 13, module: 'app/parser.py' },
      { name: 'emit_metrics', percent: 8, module: 'infra/metrics.py' },
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
  return { cpu: 72, blocked: 7, gc: 5, syscalls: 6 };
}

function buildSpeedscopePayload(title: string, topFunction: string) {
  return {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    shared: {
      frames: [{ name: title }, { name: topFunction }],
    },
    profiles: [],
    name: title,
  };
}
