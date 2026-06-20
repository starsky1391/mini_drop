import { promises as fs } from 'node:fs';
import { getScenario } from '../../shared/catalog.js';
import type { CollectorOutcome, CollectorPlugin } from './types.js';
import { artifactLabel, artifactPath, ensureArtifactDir, ensureArtifactFile } from './runtime-utils.js';
import { readWorkloadReport, startWorkloadProcess } from './workload.js';
import { resolveRuntimeProfile } from './scenario-runtime.js';
import { buildCollapsedFromHotspots, mergeHotspots, parsePerfScript } from './profile-utils.js';
import type { ParsedProfileSummary } from './profile-utils.js';
import { createCollectorSession } from './session.js';
import { persistCollectionPathDecision } from './collection-path.js';
import { probeLinuxPrivilegeSupport, runLinuxCollectorCommand } from './linux-privileged.js';
import type { TaskMetrics } from '../../shared/types.js';

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
        const linuxPrivilege = await probeLinuxPrivilegeSupport();
        session.log('prepare', linuxPrivilege.detail);
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
        const perfRecord = await runLinuxCollectorCommand('perf', recordArgs, {
          timeoutMs: Math.max(15_000, durationSeconds * 2_000),
          requirePrivilege: true,
        });
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

        const perfScript = await runLinuxCollectorCommand('perf', ['script', '-i', perfDataPath], {
          timeoutMs: 20_000,
          requirePrivilege: true,
        });
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
    const preferEvidenceBackedAttachReport =
      shouldTryExternalAttach && (collectionAssessment.mode === 'real' || collectionAssessment.mode === 'partial-real');
    const fallbackWorkload =
      preferEvidenceBackedAttachReport || collectionAssessment.mode === 'real'
        ? !shouldTryExternalAttach && collectionAssessment.mode === 'real'
          ? workload
          : null
        : await ensureManagedFallbackWorkload();
    const [completion, workloadStdout, workloadStderr] = fallbackWorkload
      ? await Promise.all([fallbackWorkload.completion, fallbackWorkload.stdout, fallbackWorkload.stderr])
      : [{ code: 0, signal: null, report: null }, '', ''];
    const fallbackReport = completion.report ?? (fallbackWorkload ? await readWorkloadReport(reportFile) : null);
    const report =
      fallbackReport ??
      (preferEvidenceBackedAttachReport
        ? buildEvidenceBackedPerfReport({
            target: context.target,
            durationSeconds,
            parsedProfile,
            processLabel: profile.processInfo?.name ?? profile.targetCommand ?? context.target,
            collectionAssessment,
          })
        : buildSyntheticReport(context.collector, context.target, scenario.name, scenario.topFunctions[0].name, durationSeconds));
    const topFunctions =
      preferEvidenceBackedAttachReport && parsedProfile?.topFunctions?.length
        ? parsedProfile.topFunctions.slice(0, 4)
        : mergeHotspots(parsedProfile?.topFunctions ?? [], report.top_functions, 4);
    const collectorReport = {
      ...report,
      top_functions: topFunctions,
      summary: parsedProfile?.usedRealData
        ? `${report.summary} Real perf stacks were parsed from ${parsedProfile.sampleCount} samples.`
        : collectionAssessment.mode === 'partial-real'
          ? `${report.summary} perf 已保留真实 native 采样产物，并完成了部分真实链路分析；当前热点排序仍带有降级塑形成分，建议结合 perf.data 与 script 产物复核。`
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

export function buildEvidenceBackedPerfReport(input: {
  target: string;
  durationSeconds: number;
  parsedProfile: ParsedProfileSummary | null;
  processLabel: string;
  collectionAssessment: ReturnType<typeof assessPerfCollection>;
}) {
  const topFunctions = input.parsedProfile?.topFunctions?.slice(0, 4) ?? [];
  const metrics = inferPerfMetricsFromHotspots(topFunctions, input.parsedProfile?.sampleCount ?? 0);
  const sourceLabel = input.parsedProfile?.usedRealData ? '真实 perf 栈' : '部分真实 perf 产物';
  return {
    scenario: 'cpu_hot' as const,
    collector: 'perf' as const,
    target: input.target,
    title: `${input.processLabel} perf Attach`,
    duration_ms: input.durationSeconds * 1000,
    result: 1,
    metrics,
    top_functions:
      topFunctions.length > 0
        ? topFunctions
        : [{ name: 'unparsed_perf_stack', percent: 100, module: 'perf/partial-real' }],
    summary: `${sourceLabel}已保留。${input.collectionAssessment.reason}`,
  };
}

function inferPerfMetricsFromHotspots(topFunctions: Array<{ name: string; percent: number; module: string }>, sampleCount: number): TaskMetrics {
  const dominant = topFunctions[0]?.percent ?? 0;
  const cpu = clampMetric(35 + dominant + Math.min(25, Math.round(sampleCount / 8)), 18, 99);
  const blocked = weightedMatch(topFunctions, /(mutex|lock|futex|wait|park|sched|sem)/i, 2);
  const gc = weightedMatch(topFunctions, /(gc|sweep|mark|scan|alloc|malloc|free)/i, 1);
  const syscalls = weightedMatch(topFunctions, /(sys_|syscall|read|write|recv|send|poll|epoll|open|close|fsync|io)/i, 1);
  return {
    cpu,
    blocked,
    gc,
    syscalls,
  };
}

function weightedMatch(
  topFunctions: Array<{ name: string; percent: number; module: string }>,
  pattern: RegExp,
  baseline: number,
) {
  const matched = topFunctions
    .filter((entry) => pattern.test(entry.name) || pattern.test(entry.module))
    .reduce((sum, entry) => sum + entry.percent, 0);
  return clampMetric(Math.round(matched) || baseline, 0, 95);
}

function clampMetric(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
      notes: ['perf.data 已真实保留，可用于离线复核；当前缺少可归一化栈帧，因此展示层只能输出 partial-real 热点摘要。'],
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
    notes: ['retained perf artifacts are real and auditable, but the post-processing path only reached partial-real normalization.'],
  };
}
