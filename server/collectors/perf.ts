import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { getScenario } from '../../shared/catalog.js';
import type { CollectorOutcome, CollectorPlugin } from './types.js';
import { artifactLabel, artifactPath, ensureArtifactDir, ensureArtifactFile } from './runtime-utils.js';
import { readWorkloadReport, startWorkloadProcess } from './workload.js';
import { resolveRuntimeProfile } from './scenario-runtime.js';
import { buildCollapsedFromHotspots, mergeHotspots, parsePerfScript } from './profile-utils.js';
import type { ParsedProfileSummary } from './profile-utils.js';
import { createCollectorSession } from './session.js';
import { persistCollectionPathDecision } from './collection-path.js';

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

    const perfDataPath = artifactPath(context.taskId, `${artifactLabel('perf', 'record')}.data`);
    let parsedProfile: ParsedProfileSummary | null = null;
    let collectionCommand: string | null = null;
    let commandError: string | null = null;
    let perfDataRecovered = false;
    let scriptOutputHadFrames = false;

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
          String(attachPid),
          '--',
          'sleep',
          String(durationSeconds),
        ];
        collectionCommand = `perf ${recordArgs.join(' ')}`;
        const perfRecord = await execFileAsync('perf', recordArgs);
        session.log('capture', perfRecord.stderr?.trim() || 'perf record completed.');
        const retention = await ensureArtifactFile(
          perfDataPath,
          'perf record completed without a retained perf.data payload; placeholder retained for audit.',
        );
        perfDataRecovered = retention.recovered;
        session.addArtifact('raw', perfDataPath, 'perf.data');
        if (retention.recovered) {
          session.log('fallback', 'perf record completed but no retained perf.data payload was found; placeholder persisted.');
        }

        const perfScript = await execFileAsync('perf', ['script', '-i', perfDataPath]);
        scriptOutputHadFrames = perfScript.stdout.trim().length > 0;
        const scriptPath = await session.writeTextArtifact(
          'raw',
          'script',
          scriptOutputHadFrames
            ? perfScript.stdout
            : 'perf script completed without emitting stack frames; fallback normalization was used.',
          'perf script output',
        );
        parsedProfile = scriptOutputHadFrames ? parsePerfScript(perfScript.stdout) : null;
        session.log(
          parsedProfile?.usedRealData ? 'normalize' : 'fallback',
          parsedProfile?.usedRealData
            ? `perf script normalized into ${parsedProfile.sampleCount} stack samples.`
            : 'perf script was captured but did not yield parseable stack samples.',
        );
        session.log('capture', `raw script saved at ${scriptPath}`);
      } else {
        await fs.writeFile(perfDataPath, 'perf unsupported on this platform, falling back to synthetic stacks.', 'utf8');
        session.addArtifact('raw', perfDataPath, 'perf.data');
        session.log('fallback', 'perf is not available on this platform; fallback sample file created.');
      }
    } catch (error) {
      commandError = error instanceof Error ? error.message : 'perf command failed';
      session.log('fallback', `perf execution fallback: ${commandError}`);
      await fs.writeFile(perfDataPath, `perf unavailable: ${commandError}`, 'utf8');
      session.addArtifact('raw', perfDataPath, 'perf.data');
    }

    const collectionAssessment = assessPerfCollection({
      platform: process.platform,
      command: collectionCommand,
      commandError,
      perfDataRecovered,
      scriptOutputHadFrames,
      parsedProfile,
      requestedPid: profile.requestedPid,
      usedManagedFallback: !shouldTryExternalAttach,
    });
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
        ? `${report.summary} Real perf stacks were parsed from ${parsedProfile.sampleCount} samples.`
        : collectionAssessment.mode === 'partial-real'
          ? `${report.summary} perf retained raw native artifacts, but hotspot shaping still relies on fallback interpretation.`
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
    await persistCollectionPathDecision(session, {
      collector: context.collector,
      mode: collectionAssessment.mode,
      command: collectionCommand,
      reason: collectionAssessment.reason,
      sourceKind: collectionAssessment.sourceKind,
      rawSignal: collectionAssessment.rawSignal,
      expectedArtifacts: ['perf.data', 'perf script output', 'Collapsed stacks', 'Collector report', 'Collection path summary'],
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

    const sampleCount = parsedProfile?.sampleCount ?? Math.max(1, Math.round(collectorReport.duration_ms / 32));
    return {
      status: 'UPLOADING',
      progress: 72,
      artifacts: session.artifacts,
      sample: {
        sampleCount,
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
            ? `perf 直接 attach 到 PID ${attachPid} 并保留了真实样本。`
            : collectionAssessment.mode === 'partial-real'
              ? `perf 直接 attach 到 PID ${attachPid} 并保留了 perf.data / script 产物，但热点排序仍有 fallback 成分。`
            : shouldTryExternalAttach
              ? `perf 未能稳定 attach 到 PID ${attachPid}，已回退到 managed workload 保留证据。`
              : 'perf 通过 managed workload 路径完成采样。',
        processInfo: shouldTryExternalAttach ? profile.processInfo : null,
      },
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

interface PerfCollectionAssessmentInput {
  platform: NodeJS.Platform;
  command: string | null;
  commandError: string | null;
  perfDataRecovered: boolean;
  scriptOutputHadFrames: boolean;
  parsedProfile: Pick<ParsedProfileSummary, 'usedRealData' | 'sampleCount' | 'evidence'> | null;
  requestedPid?: number | null;
  usedManagedFallback?: boolean;
}

export function assessPerfCollection(input: PerfCollectionAssessmentInput) {
  const targetQualifier = input.requestedPid ? ` for PID ${input.requestedPid}` : '';
  const fallbackSourceKind = input.requestedPid ? 'managed-workload-fallback' : 'workload-fallback';

  if (input.platform !== 'linux') {
    return {
      mode: 'fallback' as const,
      reason: `perf requires Linux, so the collector emitted fallback artifacts on this platform${targetQualifier}.`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'native-stack-sampling:fallback',
      notes: ['perf is unavailable on this platform, so workload-shaped fallback evidence was retained.'],
    };
  }

  if (input.commandError) {
    return {
      mode: 'fallback' as const,
      reason: `perf command execution failed${targetQualifier}: ${input.commandError}`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'native-stack-sampling:fallback',
      notes: ['perf command execution failed before a normalized native stack profile could be retained.'],
    };
  }

  if (input.perfDataRecovered) {
    return {
      mode: 'fallback' as const,
      reason: `perf record completed${targetQualifier}, but ${input.command ?? 'perf'} did not retain a usable perf.data payload.`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'native-stack-sampling:fallback',
      notes: ['A placeholder perf.data artifact was retained so the fallback path remains auditable.'],
    };
  }

  if (!input.scriptOutputHadFrames) {
    return {
      mode: 'partial-real' as const,
      reason: `perf record completed${targetQualifier}, and perf.data was retained, but perf script did not emit stack frames that could be normalized.`,
      sourceKind: input.requestedPid ? 'external-perf-data' : 'perf-data',
      rawSignal: 'native-stack-sampling:perf-data:partial',
      notes: ['perf.data and the retained script artifact remain available for audit, but hotspot shaping still fell back to workload-derived interpretation.'],
    };
  }

  if (input.parsedProfile?.usedRealData) {
    return {
      mode: 'real' as const,
      reason: `perf record and perf script completed${targetQualifier} with ${input.parsedProfile.sampleCount} normalized stack sample(s).`,
      sourceKind: input.requestedPid ? 'external-perf-script' : input.parsedProfile.evidence.sourceKind,
      rawSignal: 'native-stack-sampling:perf-script',
      notes: [`Normalized ${input.parsedProfile.sampleCount} stack sample(s) from perf script.`],
    };
  }

  return {
    mode: 'partial-real' as const,
    reason: `perf commands completed${targetQualifier}, but the retained script output did not fully normalize into structured stack evidence.`,
    sourceKind: input.requestedPid ? 'external-perf-script' : input.parsedProfile?.evidence.sourceKind ?? 'perf-script',
    rawSignal: 'native-stack-sampling:perf-script:partial',
    notes: ['Retained perf artifacts are real, but the post-processing path still depends on fallback hotspot shaping.'],
  };
}
