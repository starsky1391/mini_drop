const base = process.env.MINI_DROP_BASE_URL || 'http://127.0.0.1:8787';
const timeoutMs = Number(process.env.MINI_DROP_WAIT_MS || 90000);
const pollMs = Number(process.env.MINI_DROP_POLL_MS || 1000);
const expectReasonerFallback = process.env.MINI_DROP_EXPECT_REASONER_FALLBACK === '1';
const pidTargetOnly = process.argv.includes('--pid-target-only');

const payload = {
  target: 'compare-trend-smoke@local',
  language: 'Python',
  collector: 'py-spy',
  scenario: 'python_hot_loop',
};

async function requestJson(path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} -> ${response.status} ${body}`.trim());
  }
  return response.json();
}

async function createTask(runIndex) {
  const body = await requestJson('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      target: payload.target,
    }),
  });

  if (!body?.task?.id) {
    throw new Error(`run ${runIndex}: task id missing from create response`);
  }

  return body.task.id;
}

async function createPidTask(processInfo) {
  const scenarioPayload = deriveScenarioPayload(processInfo);
  if (!scenarioPayload) {
    return null;
  }

  const body = await requestJson('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: `pid-smoke@${processInfo.name}-${processInfo.pid}`,
      targetType: 'pid',
      pid: processInfo.pid,
      language: scenarioPayload.language,
      collector: scenarioPayload.collector,
      scenario: scenarioPayload.scenario,
    }),
  });

  if (!body?.task?.id) {
    throw new Error('PID target smoke task id missing from create response.');
  }

  return body.task.id;
}

async function waitForTerminalTask(taskId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tasksBody = await requestJson('/api/tasks');
    const task = tasksBody?.tasks?.find?.((item) => item.id === taskId);
    if (task && (task.status === 'DONE' || task.status === 'FAILED')) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out waiting for task ${taskId} to finish.`);
}

function deriveScenarioPayload(processInfo) {
  const hint = (processInfo.languageHint || '').toLowerCase();
  if (hint.includes('python')) {
    return { language: 'Python', collector: 'py-spy', scenario: 'python_hot_loop' };
  }
  if (hint.includes('node') || hint.includes('javascript') || hint.includes('typescript')) {
    return { language: 'Node.js', collector: 'perf', scenario: 'cpu_hot' };
  }
  if (hint.includes('java') || hint.includes('kotlin')) {
    return { language: 'Java', collector: 'async-profiler', scenario: 'gc_pressure' };
  }
  if (hint.includes('go') || hint.includes('c++') || hint.includes('c')) {
    return { language: hint.includes('go') ? 'Go' : 'C++', collector: 'perf', scenario: 'cpu_hot' };
  }
  return null;
}

async function main() {
  const processBody = await requestJson('/api/processes');
  if (!Array.isArray(processBody?.processes)) {
    throw new Error('Process list response missing processes array.');
  }

  const compatibleProcess = processBody.processes.find((item) => deriveScenarioPayload(item));
  if (compatibleProcess) {
    const pidTaskId = await createPidTask(compatibleProcess);
    const pidTask = pidTaskId ? await waitForTerminalTask(pidTaskId) : null;
    if (!pidTask?.targetContext?.processInfo?.pid) {
      throw new Error('PID target task did not retain process metadata.');
    }
    if (pidTask.targetContext.targetType !== 'pid') {
      throw new Error(`PID target smoke task retained unexpected targetType=${pidTask.targetContext.targetType}.`);
    }
    console.log(
      `pidTarget=${pidTask.id} status=${pidTask.status} pid=${pidTask.targetContext.processInfo.pid} attach=${pidTask.targetContext.attachSource}`,
    );
    if (pidTargetOnly) {
      return;
    }
  } else if (pidTargetOnly) {
    throw new Error('No compatible local process with a supported language hint was available for PID target smoke.');
  }

  const baselineId = await createTask(1);
  const currentId = await createTask(2);

  const baseline = await waitForTerminalTask(baselineId);
  const current = await waitForTerminalTask(currentId);

  const comparisonBody = await requestJson(
    `/api/tasks/${encodeURIComponent(current.id)}/compare/${encodeURIComponent(baseline.id)}`,
  );
  const trendsBody = await requestJson(`/api/tasks/${encodeURIComponent(current.id)}/trends`);
  const continuousBody = await requestJson(
    `/api/tasks/${encodeURIComponent(current.id)}/continuous-profile?scope=history&limit=2`,
  );
  const artifactsBody = await requestJson(`/api/tasks/${encodeURIComponent(current.id)}/artifacts`);
  const reasonerBody = await requestJson(`/api/tasks/${encodeURIComponent(current.id)}/reasoner`);

  if (!comparisonBody?.comparison?.summary) {
    throw new Error('Comparison summary missing from compare response.');
  }
  if (!comparisonBody?.comparison?.compatibility) {
    throw new Error('Comparison compatibility metadata missing from compare response.');
  }
  if (!comparisonBody.comparison?.hotspotShift?.currentTop) {
    throw new Error('Comparison hotspot snapshot missing current top hotspot.');
  }
  if (!trendsBody?.points || trendsBody.points.length < 2) {
    throw new Error('Trend response did not retain at least two comparable points.');
  }
  if (!trendsBody?.historySummary || typeof trendsBody.historySummary.processVariants !== 'number') {
    throw new Error('Trend response missing process-aware history summary.');
  }
  if (!trendsBody?.hotspotChanges || trendsBody.hotspotChanges.length < 1) {
    throw new Error('Trend response did not retain hotspot change history.');
  }
  if (!continuousBody?.window?.sliceCount || continuousBody.window.sliceCount < 1) {
    throw new Error('Continuous profile response did not retain any slices.');
  }
  if (!artifactsBody?.resultIndex) {
    throw new Error('Artifact result index missing from artifact response.');
  }
  if (!reasonerBody?.taskId) {
    throw new Error('Reasoner response missing task id.');
  }
  if (expectReasonerFallback && !reasonerBody?.snapshot?.output?.fallbackReason) {
    throw new Error('Expected reasoner fallback metadata, but no fallbackReason was retained.');
  }

  const previewable = artifactsBody.artifacts.find((artifact) => artifact.previewable !== false);
  if (previewable?.path) {
    const previewBody = await requestJson(
      `/api/tasks/${encodeURIComponent(current.id)}/artifacts/content?path=${encodeURIComponent(previewable.path)}`,
    );
    if (!previewBody?.preview?.mode) {
      throw new Error('Artifact preview response missing preview mode.');
    }
  }

  console.log(`baseline=${baseline.id} status=${baseline.status}`);
  console.log(`current=${current.id} status=${current.status}`);
  console.log(`comparison=${comparisonBody.comparison.verdict} driver=${comparisonBody.comparison.driver?.label ?? 'none'}`);
  console.log(
    `trendPoints=${trendsBody.points.length} hotspotChanges=${trendsBody.hotspotChanges.length} processVariants=${trendsBody.historySummary.processVariants}`,
  );
  console.log(`continuousSlices=${continuousBody.window.sliceCount} window=${continuousBody.window.from}..${continuousBody.window.to}`);
  console.log(`artifacts=${artifactsBody.artifacts.length} previewable=${artifactsBody.resultIndex.previewableArtifactCount}`);
  console.log(
    `reasonerSnapshot=${reasonerBody.snapshot ? 'present' : 'missing'} fallback=${reasonerBody.snapshot?.output?.fallbackReason ?? 'none'}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
