import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { getScenario } from '../../shared/catalog.js';
import type { CollectorOutcome, CollectorPlugin } from './types.js';
import { artifactLabel, artifactPath, ensureArtifactDir } from './runtime-utils.js';
import { readWorkloadReport, startWorkloadProcess } from './workload.js';
import { resolveRuntimeProfile } from './scenario-runtime.js';
import { buildCollapsedFromHotspots, mergeHotspots, parseBpftraceSnapshot } from './profile-utils.js';
import type { ParsedProfileSummary } from './profile-utils.js';
import { createCollectorSession } from './session.js';
import { persistCollectionPathDecision } from './collection-path.js';

const execFileAsync = promisify(execFile);

export const ebpfCollector: CollectorPlugin = {
  capability: {
    id: 'ebpf',
    name: 'eBPF probe set',
    languages: ['Linux services'],
    description: 'Capture kernel-aware snapshots with bpftrace and preserve raw evidence for offline analysis.',
    supportsRealCollection: true,
  },
  async collect(context) {
    const profile = resolveRuntimeProfile(context);
    const scenario = getScenario(context.scenario);
    const durationSeconds = Math.max(5, Math.ceil(profile.durationMs / 1000));
    const session = createCollectorSession(context.taskId, 'ebpf', profile.notes);
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

    const rawPath = artifactPath(context.taskId, `${artifactLabel('ebpf', 'snapshot')}.txt`);
    const collapsedPath = artifactPath(context.taskId, `${artifactLabel('ebpf', 'collapsed')}.collapsed`);
    let rawSignal = 'kernel-aware-sampling:fallback';
    let rawSnapshot = '';
    let collectionCommand: string | null = null;
    let commandError: string | null = null;
    let parsedProfile: ParsedProfileSummary | null = null;

    try {
      const bpftraceBin = process.env.MINI_DROP_BPFTRACE_BIN || 'bpftrace';
      if (process.platform === 'linux' && (await isCommandAvailable(bpftraceBin, ['--version']))) {
        const script = `profile:hz:${profile.sampleRate} /pid == ${attachPid}/ { @[ustack] = count(); } interval:s:${durationSeconds} { exit(); }`;
        collectionCommand = `${bpftraceBin} -e ${script}`;
        const result = await execFileAsync(bpftraceBin, ['-e', script], { maxBuffer: 8 * 1024 * 1024 });
        rawSnapshot = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join('\n');
        parsedProfile = rawSnapshot ? parseBpftraceSnapshot(rawSnapshot) : null;
        rawSignal = parsedProfile?.usedRealData
          ? 'kernel-aware-sampling:bpftrace'
          : rawSnapshot
            ? 'kernel-aware-sampling:bpftrace-raw'
            : rawSignal;
        session.log(parsedProfile?.usedRealData ? 'normalize' : 'capture', rawSnapshot
          ? parsedProfile?.usedRealData
            ? `bpftrace snapshot normalized into ${parsedProfile.sampleCount} structured stack sample(s).`
            : 'bpftrace snapshot captured, but normalization still relies on fallback hotspot shaping.'
          : 'bpftrace returned without a printable stack snapshot.');
      } else {
        session.log('fallback', 'bpftrace unavailable; kernel-aware fallback artifacts will be created.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'bpftrace command failed';
      rawSnapshot = `bpftrace unavailable: ${message}`;
      commandError = message;
      session.log('fallback', `eBPF execution fallback: ${message}`);
    }

    await fs.writeFile(rawPath, rawSnapshot || 'No raw bpftrace stack snapshot was captured.', 'utf8');
    session.addArtifact('raw', rawPath, 'bpftrace raw snapshot');

    const collapsedText =
      parsedProfile?.collapsedStacks ||
      buildCollapsedFromHotspots(scenario.name, scenario.topFunctions, [
        'sys_enter',
        'tcp_sendmsg',
        'futex_wait',
        'vfs_write',
      ]);
    await fs.writeFile(collapsedPath, collapsedText, 'utf8');
    session.addArtifact('collapsed-stacks', collapsedPath, 'eBPF normalized collapsed stacks');

    const collectionAssessment = assessEbpfCollection({
      platform: process.platform,
      command: collectionCommand,
      commandError,
      rawSnapshot,
      parsedProfile,
      requestedPid: profile.requestedPid,
    });

    const fallbackWorkload =
      collectionAssessment.mode === 'partial-real' && !shouldTryExternalAttach
        ? workload
        : collectionAssessment.mode === 'partial-real' && shouldTryExternalAttach
            ? await ensureManagedFallbackWorkload()
            : collectionAssessment.mode === 'fallback'
              ? await ensureManagedFallbackWorkload()
              : workload;
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
      summary:
        collectionAssessment.mode === 'real'
          ? `${fallbackReport.summary} bpftrace snapshot data was normalized into structured hotspot evidence.`
          : collectionAssessment.mode === 'partial-real'
            ? `${fallbackReport.summary} A raw bpftrace snapshot was captured and preserved for offline kernel/user-space correlation.`
          : `${fallbackReport.summary} Kernel-aware hotspot shaping currently relies on fallback stacks.`,
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
        'bpftrace raw snapshot',
        'eBPF normalized collapsed stacks',
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
        sampleCount: Math.max(1, Math.round(collectorReport.duration_ms / 45)),
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
            ? `eBPF 对 PID ${attachPid} 保留并归一化了真实 stack snapshot。`
            : collectionAssessment.mode === 'partial-real'
              ? `eBPF 对 PID ${attachPid} 保留了 raw snapshot，但热点排序仍有 fallback 成分。`
            : shouldTryExternalAttach
              ? `eBPF 未能稳定附着到 PID ${attachPid}，已回退到 managed workload 保留证据。`
              : 'eBPF 通过 managed workload 路径完成采样。',
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
    collector: 'ebpf',
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
    summary: `${scenario.name} collected with eBPF fallback shaping.`,
  };
}

interface EbpfCollectionAssessmentInput {
  platform: NodeJS.Platform;
  command: string | null;
  commandError: string | null;
  rawSnapshot: string;
  parsedProfile: Pick<ParsedProfileSummary, 'usedRealData' | 'sampleCount' | 'evidence'> | null;
  requestedPid?: number | null;
}

export function assessEbpfCollection(input: EbpfCollectionAssessmentInput) {
  const targetQualifier = input.requestedPid ? ` for PID ${input.requestedPid}` : '';
  const fallbackSourceKind = input.requestedPid ? 'managed-workload-fallback' : 'workload-fallback';
  const normalizedRawSnapshot = input.rawSnapshot.trim();

  if (input.platform !== 'linux') {
    return {
      mode: 'fallback' as const,
      reason: `bpftrace requires Linux, so fallback artifacts were emitted${targetQualifier}.`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'kernel-aware-sampling:fallback',
      notes: ['eBPF collection is unavailable on this platform, so only fallback hotspot shaping was retained.'],
    };
  }

  if (input.commandError) {
    return {
      mode: 'fallback' as const,
      reason: `bpftrace command execution failed${targetQualifier}: ${input.commandError}`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'kernel-aware-sampling:fallback',
      notes: ['bpftrace failed before a raw kernel-aware snapshot could be retained.'],
    };
  }

  if (!input.command) {
    return {
      mode: 'fallback' as const,
      reason: `bpftrace binary was unavailable, so fallback artifacts were emitted${targetQualifier}.`,
      sourceKind: fallbackSourceKind,
      rawSignal: 'kernel-aware-sampling:fallback',
      notes: ['No real bpftrace capture was available on this host.'],
    };
  }

  if (input.parsedProfile?.usedRealData) {
    return {
      mode: 'real' as const,
      reason: `bpftrace retained a parseable stack snapshot${targetQualifier} with ${input.parsedProfile.sampleCount} normalized stack sample(s).`,
      sourceKind: input.requestedPid ? 'external-bpftrace-normalized' : input.parsedProfile.evidence.sourceKind,
      rawSignal: 'kernel-aware-sampling:bpftrace',
      notes: ['Raw bpftrace output was normalized into structured hotspot evidence.'],
    };
  }

  if (normalizedRawSnapshot && !normalizedRawSnapshot.startsWith('bpftrace unavailable:')) {
    return {
      mode: 'partial-real' as const,
      reason: `bpftrace retained a raw stack snapshot${targetQualifier}, while hotspot ranking still relies on normalized fallback shaping.`,
      sourceKind: input.requestedPid ? 'external-bpftrace-raw' : 'bpftrace-raw',
      rawSignal: 'kernel-aware-sampling:bpftrace-raw',
      notes: ['Raw bpftrace output is preserved, while hotspot ranking still follows the normalized fallback path.'],
    };
  }

  return {
    mode: 'fallback' as const,
    reason: `bpftrace did not emit a printable raw stack snapshot${targetQualifier}, so fallback artifacts were used.`,
    sourceKind: fallbackSourceKind,
    rawSignal: 'kernel-aware-sampling:fallback',
    notes: ['No kernel snapshot was captured, so all hotspot ranking comes from workload-shaped collapsed stacks.'],
  };
}
