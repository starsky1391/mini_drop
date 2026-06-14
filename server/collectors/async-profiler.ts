import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { getScenario } from '../../shared/catalog.js';
import type { CollectorOutcome, CollectorPlugin } from './types.js';
import { artifactLabel, artifactPath, ensureArtifactDir } from './runtime-utils.js';
import { readWorkloadReport, startWorkloadProcess } from './workload.js';
import { resolveRuntimeProfile } from './scenario-runtime.js';
import { buildCollapsedFromHotspots, mergeHotspots, parseCollapsedStacks } from './profile-utils.js';
import type { ParsedProfileSummary } from './profile-utils.js';
import { createCollectorSession } from './session.js';
import { persistCollectionPathDecision } from './collection-path.js';

const execFileAsync = promisify(execFile);

export const asyncProfilerCollector: CollectorPlugin = {
  capability: {
    id: 'async-profiler',
    name: 'async-profiler',
    languages: ['Java', 'Kotlin'],
    description: 'Capture JVM stacks with async-profiler collapsed output.',
    supportsRealCollection: true,
  },
  async collect(context) {
    const profile = resolveRuntimeProfile(context);
    const scenario = getScenario(context.scenario);
    const durationSeconds = Math.max(5, Math.ceil(profile.durationMs / 1000));
    const session = createCollectorSession(context.taskId, 'async-profiler', profile.notes);
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

    const collapsedPath = artifactPath(context.taskId, `${artifactLabel('async-profiler', 'collapsed')}.collapsed`);
    const rawPath = artifactPath(context.taskId, `${artifactLabel('async-profiler', 'stdout')}.txt`);
    let collapsedText = '';
    let commandOutput = '';
    let parsedProfile: ParsedProfileSummary | null = null;
    let collectionMode: 'real' | 'partial-real' | 'fallback' = 'fallback';
    let collectionReason = 'async-profiler has not started yet.';
    let collectionCommand: string | null = null;

    try {
      const profilerBin = process.env.MINI_DROP_ASYNC_PROFILER_BIN || 'asprof';
      if (process.platform !== 'win32' && (await isCommandAvailable(profilerBin, ['--help']))) {
        const args = ['-d', String(durationSeconds), '-f', collapsedPath, '-o', 'collapsed', String(attachPid)];
        collectionCommand = `${profilerBin} ${args.join(' ')}`;
        const result = await execFileAsync(profilerBin, args);
        commandOutput = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join('\n');
        session.log('capture', commandOutput || 'async-profiler completed.');
        collapsedText = await fs.readFile(collapsedPath, 'utf8');
        session.addArtifact('collapsed-stacks', collapsedPath, 'async-profiler collapsed stacks');
        await fs.writeFile(rawPath, commandOutput || 'async-profiler completed without printable stdout/stderr.', 'utf8');
        session.addArtifact('raw', rawPath, 'async-profiler command output');
        parsedProfile = parseCollapsedStacks(collapsedText, 'async-profiler-collapsed');
        collectionMode = parsedProfile?.usedRealData ? 'real' : 'partial-real';
        collectionReason = parsedProfile?.usedRealData
          ? `async-profiler emitted collapsed stacks with ${parsedProfile.sampleCount} normalized stack sample(s).`
          : 'async-profiler emitted a collapsed file, but it did not normalize into structured stack evidence, so workload-shaped fallback interpretation remained active.';
      } else {
        collapsedText = buildCollapsedFromHotspots(
          scenario.name,
          scenario.topFunctions,
          ['Thread.run', 'ForkJoinPool.scan', 'GC.barrier', 'JvmtiExport.post'],
        );
        await fs.writeFile(collapsedPath, collapsedText, 'utf8');
        session.addArtifact('collapsed-stacks', collapsedPath, 'async-profiler collapsed stacks');
        await fs.writeFile(rawPath, 'async-profiler unavailable; emitted workload-shaped collapsed fallback.', 'utf8');
        session.addArtifact('raw', rawPath, 'async-profiler command output');
        session.log('fallback', 'async-profiler unavailable; collapsed fallback created from workload hotspots.');
        collectionReason = 'async-profiler binary was unavailable or unsupported on this platform, so fallback artifacts were emitted.';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'async-profiler command failed';
      session.log('fallback', `async-profiler execution fallback: ${message}`);
      collapsedText = buildCollapsedFromHotspots(
        scenario.name,
        scenario.topFunctions,
        ['Thread.run', 'ForkJoinPool.scan', 'GC.barrier', 'JvmtiExport.post'],
      );
      await fs.writeFile(collapsedPath, collapsedText, 'utf8');
      session.addArtifact('collapsed-stacks', collapsedPath, 'async-profiler collapsed stacks');
      await fs.writeFile(rawPath, `async-profiler unavailable: ${message}`, 'utf8');
      session.addArtifact('raw', rawPath, 'async-profiler command output');
      collectionReason = `async-profiler command execution failed: ${message}`;
    }

    const collectionAssessment = assessAsyncProfilerCollection({
      command: collectionCommand,
      commandError:
        collectionMode === 'fallback' && collectionReason.startsWith('async-profiler command execution failed:')
          ? collectionReason.replace('async-profiler command execution failed: ', '')
          : null,
      parsedProfile,
      requestedPid: profile.requestedPid,
      collapsedArtifactRetained: collapsedText.length > 0,
    });

    const fallbackWorkload =
      collectionAssessment.mode === 'real' && !shouldTryExternalAttach
        ? workload
        : collectionAssessment.mode === 'real'
          ? null
          : await ensureManagedFallbackWorkload();
    const [completion, workloadStdout, workloadStderr] = fallbackWorkload
      ? await Promise.all([fallbackWorkload.completion, fallbackWorkload.stdout, fallbackWorkload.stderr])
      : [{ code: 0, signal: null, report: null }, '', ''];
    const fallbackReport =
      completion.report ??
      (fallbackWorkload ? await readWorkloadReport(reportFile) : null) ??
      buildSyntheticReport(context.target, scenario, durationSeconds);
    const topFunctions = mergeHotspots(parsedProfile?.topFunctions ?? [], fallbackReport.top_functions, 4);
    const collectorReport = {
      ...fallbackReport,
      top_functions: topFunctions,
      summary: parsedProfile?.usedRealData
        ? `${fallbackReport.summary} async-profiler collapsed stacks were normalized from ${parsedProfile.sampleCount} sample(s).`
        : collectionAssessment.mode === 'partial-real'
          ? `${fallbackReport.summary} async-profiler retained a real collapsed artifact, but hotspot shaping still depends on fallback interpretation.`
        : `${fallbackReport.summary} JVM hotspots currently rely on workload-derived fallback shaping.`,
    };

    const reportPath = await session.writeJsonArtifact('report', 'collector-report', collectorReport, 'Collector report');
    await persistCollectionPathDecision(session, {
      collector: context.collector,
      mode: collectionAssessment.mode,
      command: collectionCommand,
      reason: collectionAssessment.reason,
      sourceKind: collectionAssessment.sourceKind,
      rawSignal: collectionAssessment.rawSignal,
      expectedArtifacts: [
        'async-profiler command output',
        'async-profiler collapsed stacks',
        'Collector report',
        'Collection path summary',
      ],
      notes: collectionAssessment.notes,
    });
    if (workloadStdout.trim()) {
      await session.writeTextArtifact('log', 'workload-stdout', workloadStdout, 'workload stdout');
    }
    if (workloadStderr.trim()) {
      await session.writeTextArtifact('log', 'workload-stderr', workloadStderr, 'workload stderr');
    }
    session.log(
      completion.code === 0 ? 'complete' : 'fallback',
      completion.code === 0 ? 'workload finished cleanly.' : `workload exit code=${completion.code}`,
    );
    await session.flushLogs();

    return {
      status: 'UPLOADING',
      progress: 72,
      artifacts: session.artifacts,
      sample: {
        sampleCount: parsedProfile?.sampleCount ?? Math.max(1, Math.round(collectorReport.duration_ms / 36)),
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
            ? `async-profiler 直接 attach 到 PID ${attachPid} 并保留了 collapsed stacks。`
            : collectionAssessment.mode === 'partial-real'
              ? `async-profiler 直接 attach 到 PID ${attachPid} 并保留了 collapsed 产物，但热点排序仍有 fallback 成分。`
            : shouldTryExternalAttach
              ? `async-profiler 未能稳定 attach 到 PID ${attachPid}，已回退到 managed workload 保留证据。`
              : 'async-profiler 通过 managed workload 路径完成采样。',
        processInfo: shouldTryExternalAttach ? profile.processInfo : null,
      },
    };
  },
};

async function isCommandAvailable(command: string, args: string[]) {
  try {
    await execFileAsync(command, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function buildSyntheticReport(
  target: string,
  scenario: ReturnType<typeof getScenario>,
  durationSeconds: number,
) {
  return {
    scenario: scenario.id,
    collector: 'async-profiler',
    target,
    title: scenario.name,
    duration_ms: durationSeconds * 1000,
    result: 1,
    metrics: {
      cpu: scenario.cpu,
      blocked: scenario.blocked,
      gc: scenario.gc,
      syscalls: scenario.syscalls,
    },
    top_functions: scenario.topFunctions,
    summary: `${scenario.name} collected with async-profiler fallback shaping.`,
  };
}

interface AsyncProfilerCollectionAssessmentInput {
  command: string | null;
  commandError: string | null;
  parsedProfile: Pick<ParsedProfileSummary, 'usedRealData' | 'sampleCount' | 'evidence'> | null;
  requestedPid?: number | null;
  collapsedArtifactRetained: boolean;
}

export function assessAsyncProfilerCollection(input: AsyncProfilerCollectionAssessmentInput) {
  const targetQualifier = input.requestedPid ? ` for PID ${input.requestedPid}` : '';
  const fallbackSourceKind = input.requestedPid ? 'managed-workload-fallback' : 'workload-fallback';

  if (input.commandError) {
    return {
      mode: 'fallback' as const,
      reason: `async-profiler command execution failed${targetQualifier}: ${input.commandError}`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'jvm-stack-sampling:fallback',
      notes: ['async-profiler failed before a normalized JVM stack capture could be retained.'],
    };
  }

  if (!input.command) {
    return {
      mode: 'fallback' as const,
      reason: `async-profiler binary was unavailable, so fallback artifacts were emitted${targetQualifier}.`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'jvm-stack-sampling:fallback',
      notes: ['The collector emitted collapsed fallback artifacts rather than a real async-profiler capture.'],
    };
  }

  if (!input.collapsedArtifactRetained) {
    return {
      mode: 'fallback' as const,
      reason: `async-profiler completed${targetQualifier}, but no collapsed stack artifact was retained.`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'jvm-stack-sampling:fallback',
      notes: ['No retained collapsed stack artifact was available for JVM hotspot normalization.'],
    };
  }

  if (input.parsedProfile?.usedRealData) {
    return {
      mode: 'real' as const,
      reason: `async-profiler emitted collapsed stacks${targetQualifier} with ${input.parsedProfile.sampleCount} normalized stack sample(s).`,
      sourceKind: input.requestedPid ? 'external-async-profiler' : input.parsedProfile.evidence.sourceKind,
      rawSignal: 'jvm-stack-sampling:async-profiler',
      notes: ['Collapsed stacks were parsed into structured hotspot evidence.'],
    };
  }

  return {
    mode: 'partial-real' as const,
    reason: `async-profiler emitted a collapsed artifact${targetQualifier}, but normalization still relied on workload-shaped fallback interpretation.`,
    sourceKind: input.parsedProfile?.evidence.sourceKind ?? 'async-profiler-collapsed',
    rawSignal: 'jvm-stack-sampling:async-profiler:partial',
    notes: ['A real collapsed artifact was retained, but hotspot ranking still required fallback shaping.'],
  };
}
