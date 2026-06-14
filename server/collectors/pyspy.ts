import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { getScenario } from '../../shared/catalog.js';
import type { CollectorOutcome, CollectorPlugin } from './types.js';
import { artifactLabel, artifactPath, ensureArtifactDir, ensureArtifactFile } from './runtime-utils.js';
import { readWorkloadReport, startWorkloadProcess } from './workload.js';
import { resolveRuntimeProfile } from './scenario-runtime.js';
import { buildCollapsedFromHotspots, mergeHotspots, parseSpeedscopeProfile } from './profile-utils.js';
import type { ParsedProfileSummary } from './profile-utils.js';
import { createCollectorSession } from './session.js';
import { persistCollectionPathDecision } from './collection-path.js';

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
    const shouldTryExternalAttach = Boolean(profile.requestedPid && profile.processInfo);

    const reportFile = artifactPath(context.taskId, `${artifactLabel('workload', 'report')}.json`);
    let workload: Awaited<ReturnType<typeof startWorkloadProcess>> | null = null;
    const ensureManagedFallbackWorkload = async () => {
      if (workload) {
        return workload;
      }
      workload = await startWorkloadProcess({
        scenario: context.scenario,
        collector: context.collector,
        durationSeconds,
        reportFile,
        target: context.target,
      });
      session.log('prepare', `${shouldTryExternalAttach ? 'fallback ' : ''}workload pid=${workload.pid}`);
      return workload;
    };

    const attachPid = shouldTryExternalAttach ? (profile.requestedPid ?? profile.targetPid) : (await ensureManagedFallbackWorkload()).pid;
    if (shouldTryExternalAttach) {
      session.log('prepare', `external target pid=${attachPid} (${profile.processInfo?.commandSummary ?? profile.targetCommand})`);
    }

    const speedscopePath = artifactPath(context.taskId, `${artifactLabel('pyspy', 'speedscope')}.json`);
    let speedscopeText = '';
    let parsedProfile: ParsedProfileSummary | null = null;
    let collectionCommand: string | null = null;
    let commandError: string | null = null;
    let speedscopeRecovered = false;
    let speedscopeArtifactRetained = false;

    try {
      const pySpyBin = process.env.MINI_DROP_PYSPY_BIN || 'py-spy';
      if (await isPySpyAvailable(pySpyBin)) {
        const pySpyArgs = [
          'record',
          '--pid',
          String(attachPid),
          '--duration',
          String(durationSeconds),
          '--rate',
          String(profile.sampleRate),
          '--output',
          speedscopePath,
          '--format',
          'speedscope',
        ];
        collectionCommand = `${pySpyBin} ${pySpyArgs.join(' ')}`;
        const result = await execFileAsync(pySpyBin, pySpyArgs);
        session.log('capture', result.stderr?.trim() || 'py-spy record completed.');
        const retention = await ensureArtifactFile(
          speedscopePath,
          JSON.stringify(buildSpeedscopePayload(scenario.name, scenario.topFunctions[0].name), null, 2),
        );
        speedscopeRecovered = retention.recovered;
        speedscopeArtifactRetained = true;
        session.addArtifact('speedscope', speedscopePath, 'Speedscope profile');
        speedscopeText = await fs.readFile(speedscopePath, 'utf8');
        parsedProfile = parseSpeedscopeProfile(speedscopeText);
        if (retention.recovered) {
          session.log('fallback', 'py-spy completed without a retained speedscope payload; placeholder profile was persisted.');
        }
      } else {
        speedscopeText = JSON.stringify(buildSpeedscopePayload(scenario.name, scenario.topFunctions[0].name), null, 2);
        await fs.writeFile(speedscopePath, speedscopeText, 'utf8');
        speedscopeArtifactRetained = true;
        session.addArtifact('speedscope', speedscopePath, 'Speedscope profile');
        session.log('fallback', 'py-spy unavailable; speedscope placeholder created.');
      }
    } catch (error) {
      commandError = error instanceof Error ? error.message : 'py-spy command failed';
      session.log('fallback', `py-spy execution fallback: ${commandError}`);
      speedscopeText = JSON.stringify(buildSpeedscopePayload(scenario.name, scenario.topFunctions[0].name), null, 2);
      await fs.writeFile(speedscopePath, speedscopeText, 'utf8');
      speedscopeArtifactRetained = true;
      session.addArtifact('speedscope', speedscopePath, 'Speedscope profile');
    }

    parsedProfile ??= parseSpeedscopeProfile(speedscopeText);
    const collectionAssessment = assessPySpyCollection({
      command: collectionCommand,
      commandError,
      speedscopeRecovered,
      speedscopeArtifactRetained,
      parsedProfile,
      requestedPid: profile.requestedPid,
    });
    session.log(
      parsedProfile?.usedRealData ? 'normalize' : 'fallback',
      parsedProfile?.usedRealData
        ? `speedscope normalized into ${parsedProfile.sampleCount} stack samples.`
        : 'speedscope did not contain enough structured samples; workload hotspots will be used.',
    );

    const fallbackWorkload =
      collectionAssessment.mode === 'real' && !shouldTryExternalAttach ? workload : collectionAssessment.mode === 'real' ? null : await ensureManagedFallbackWorkload();
    const [completion, workloadStdout, workloadStderr] = fallbackWorkload
      ? await Promise.all([fallbackWorkload.completion, fallbackWorkload.stdout, fallbackWorkload.stderr])
      : [{ code: 0, signal: null, report: null }, '', ''];
    const fallbackReport = completion.report ?? (fallbackWorkload ? await readWorkloadReport(reportFile) : null);
    const report = fallbackReport ?? buildSyntheticReport(context.collector, context.target, scenario.name, scenario.topFunctions[0].name, durationSeconds);
    const topFunctions = mergeHotspots(parsedProfile?.topFunctions ?? [], report.top_functions, 4);
    const collectorReport = {
      ...report,
      top_functions: topFunctions,
      summary: parsedProfile?.usedRealData
        ? `${report.summary} Real py-spy samples were normalized from ${parsedProfile.sampleCount} stack samples.`
        : collectionAssessment.mode === 'partial-real'
          ? `${report.summary} py-spy retained a real speedscope artifact, but hotspot shaping still depends on fallback interpretation.`
        : `${report.summary} Synthetic or workload-derived hotspots were used as a fallback.`,
    };
    const collapsed =
      parsedProfile?.collapsedStacks ||
      buildCollapsedFromHotspots(collectorReport.title, topFunctions, ['frame_eval', 'walk_rows', 'parse_message', 'emit_metrics']);

    const reportPath = await session.writeJsonArtifact('report', 'collector-report', collectorReport, 'Collector report');
    await session.writeTextArtifact('collapsed-stacks', 'collapsed', collapsed, 'Collapsed stacks');
    await persistCollectionPathDecision(session, {
      collector: context.collector,
      mode: collectionAssessment.mode,
      command: collectionCommand,
      reason: collectionAssessment.reason,
      sourceKind: collectionAssessment.sourceKind,
      rawSignal: collectionAssessment.rawSignal,
      expectedArtifacts: ['Speedscope profile', 'Collapsed stacks', 'Collector report', 'Collection path summary'],
      notes: collectionAssessment.notes,
    });
    if (workloadStdout.trim()) {
      await session.writeTextArtifact('log', 'workload-stdout', workloadStdout, 'workload stdout');
    }
    if (workloadStderr.trim()) {
      await session.writeTextArtifact('log', 'workload-stderr', workloadStderr, 'workload stderr');
    }
    session.log(completion.code === 0 ? 'complete' : 'fallback', completion.code === 0 ? 'workload finished cleanly.' : `workload exit code=${completion.code}`);
    await session.flushLogs();

    return {
      status: 'UPLOADING',
      progress: 72,
      artifacts: session.artifacts,
      sample: {
        sampleCount: parsedProfile?.sampleCount ?? Math.max(1, Math.round(collectorReport.duration_ms / 40)),
        topFunctions,
        metrics: collectorReport.metrics,
        summary: collectorReport.summary,
        rawSignal: collectionAssessment.rawSignal,
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
      targetContext: {
        attachSource:
          collectionAssessment.mode === 'real' || collectionAssessment.mode === 'partial-real'
            ? context.targetContext.attachSource
            : shouldTryExternalAttach
              ? 'managed-fallback'
              : 'managed-workload',
        attachDecision:
          collectionAssessment.mode === 'real'
            ? `py-spy 直接 attach 到 PID ${attachPid} 并保留了真实样本。`
            : collectionAssessment.mode === 'partial-real'
              ? `py-spy 直接 attach 到 PID ${attachPid} 并保留了 speedscope 产物，但热点排序仍有 fallback 成分。`
            : shouldTryExternalAttach
              ? `py-spy 未能稳定 attach 到 PID ${attachPid}，已回退到 managed workload 保留证据。`
              : 'py-spy 通过 managed workload 路径完成采样。',
        processInfo: shouldTryExternalAttach ? profile.processInfo : null,
      },
    };
  },
};

async function isPySpyAvailable(command: string) {
  try {
    await execFileAsync(command, ['--version']);
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

interface PySpyCollectionAssessmentInput {
  command: string | null;
  commandError: string | null;
  speedscopeRecovered: boolean;
  speedscopeArtifactRetained: boolean;
  parsedProfile: Pick<ParsedProfileSummary, 'usedRealData' | 'sampleCount' | 'evidence'> | null;
  requestedPid?: number | null;
}

export function assessPySpyCollection(input: PySpyCollectionAssessmentInput) {
  const targetQualifier = input.requestedPid ? ` for PID ${input.requestedPid}` : '';
  const fallbackSourceKind = input.requestedPid ? 'managed-workload-fallback' : 'workload-fallback';

  if (input.commandError) {
    return {
      mode: 'fallback' as const,
      reason: `py-spy command execution failed${targetQualifier}: ${input.commandError}`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'python-stack-sampling:fallback',
      notes: ['A placeholder or workload-shaped profile was stored because py-spy could not finish cleanly.'],
    };
  }

  if (!input.command) {
    return {
      mode: 'fallback' as const,
      reason: `py-spy binary was unavailable, so a placeholder speedscope artifact was emitted${targetQualifier}.`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'python-stack-sampling:fallback',
      notes: ['The collector retained a placeholder speedscope artifact instead of real py-spy output.'],
    };
  }

  if (input.speedscopeRecovered) {
    return {
      mode: 'fallback' as const,
      reason: `${input.command} completed${targetQualifier}, but no retained speedscope payload was found, so a placeholder profile was persisted.`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'python-stack-sampling:fallback',
      notes: ['A placeholder speedscope artifact was written because the real py-spy output was empty or missing.'],
    };
  }

  if (input.parsedProfile?.usedRealData) {
    return {
      mode: 'real' as const,
      reason: `py-spy recorded a speedscope profile${targetQualifier} with ${input.parsedProfile.sampleCount} normalized stack sample(s).`,
      sourceKind: input.requestedPid ? 'external-py-spy' : input.parsedProfile.evidence.sourceKind,
      rawSignal: 'python-stack-sampling:py-spy',
      notes: ['Preserved structured sampled Python stacks from py-spy.'],
    };
  }

  if (input.speedscopeArtifactRetained) {
    return {
      mode: 'partial-real' as const,
      reason: `py-spy retained a speedscope artifact${targetQualifier}, but it did not fully normalize into structured sampled stacks.`,
      sourceKind: input.requestedPid ? 'external-py-spy' : input.parsedProfile?.evidence.sourceKind ?? 'speedscope',
      rawSignal: 'python-stack-sampling:py-spy:partial',
      notes: ['The retained speedscope artifact is real, but hotspot ranking still depends on fallback shaping.'],
    };
  }

  return {
    mode: 'fallback' as const,
    reason: `py-spy recorded a file${targetQualifier}, but it did not normalize into structured sampled stacks.`,
    sourceKind: input.parsedProfile?.evidence.sourceKind ?? fallbackSourceKind,
    rawSignal: 'python-stack-sampling:fallback',
    notes: ['A placeholder or workload-shaped profile was stored instead of real py-spy output.'],
  };
}
