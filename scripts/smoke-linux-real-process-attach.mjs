const base = process.env.MINI_DROP_BASE_URL || 'http://127.0.0.1:8787';
const timeoutMs = Number(process.env.MINI_DROP_WAIT_MS || 120000);
const pollMs = Number(process.env.MINI_DROP_POLL_MS || 1000);
const attachPid = Number(process.env.MINI_DROP_TARGET_PID || 0);
const targetName = process.env.MINI_DROP_TARGET_NAME || 'linux-real-process-smoke';
const targetLanguage = process.env.MINI_DROP_TARGET_LANGUAGE || 'Python';
const collector = process.env.MINI_DROP_TARGET_COLLECTOR || 'py-spy';
const scenario = process.env.MINI_DROP_TARGET_SCENARIO || 'python_hot_loop';
const expectRealAttach = process.env.MINI_DROP_EXPECT_REAL_ATTACH === '1';

async function requestJson(path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} -> ${response.status} ${body}`.trim());
  }
  return response.json();
}

async function waitForTask(taskId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const body = await requestJson('/api/tasks');
    const task = body?.tasks?.find?.((item) => item.id === taskId);
    if (task && (task.status === 'DONE' || task.status === 'FAILED')) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(`Timed out waiting for task ${taskId} to finish.`);
}

async function main() {
  const processBody = await requestJson('/api/processes');
  const processes = Array.isArray(processBody?.processes) ? processBody.processes : [];
  const selectedProcess =
    processes.find((item) => item.pid === attachPid) ??
    processes.find((item) => item.name === targetName || /python/i.test(String(item.name ?? ''))) ??
    processes[0];

  if (!selectedProcess) {
    throw new Error('No local process could be selected for the Linux real-process attach smoke.');
  }

  const body = await requestJson('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: targetName,
      targetType: 'process',
      pid: selectedProcess.pid,
      processInfo: selectedProcess,
      language: targetLanguage,
      collector,
      scenario,
    }),
  });

  const taskId = body?.task?.id;
  if (!taskId) {
    throw new Error('Task id missing from create response.');
  }

  const task = await waitForTask(taskId);
  const detailBody = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`);
  const artifactsBody = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/artifacts`);
  const compareBody = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/trends`);
  const detail = detailBody?.task ?? detailBody;
  const provenance = artifactsBody?.resultIndex?.provenance ?? null;
  const processInfo = detail?.targetContext?.processInfo ?? null;
  const sampleSource = String(detail?.sampleSource ?? task.sampleSource ?? '');
  const attachDecision = String(detail?.targetContext?.attachDecision ?? '');

  if (!processInfo?.pid) {
    throw new Error('Task detail did not retain live process metadata.');
  }
  if (processInfo.pid !== selectedProcess.pid) {
    throw new Error(`Expected retained PID ${selectedProcess.pid}, received ${processInfo.pid}.`);
  }
  if (detail?.targetContext?.targetType !== 'process') {
    throw new Error(`Expected targetType=process, received ${detail?.targetContext?.targetType ?? 'missing'}.`);
  }
  if (!detail?.targetContext?.attachSource || detail.targetContext.attachSource === 'managed-workload') {
    throw new Error(`Expected external process attach source, received ${detail?.targetContext?.attachSource ?? 'missing'}.`);
  }
  if (expectRealAttach) {
    if (!sampleSource.includes(collector) || sampleSource.includes('fallback')) {
      throw new Error(`Expected real ${collector} sampleSource, received ${sampleSource || 'missing'}.`);
    }
    if (provenance?.mode === 'fallback') {
      throw new Error(`Expected non-fallback provenance, received ${provenance?.mode}.`);
    }
  }
  if (!compareBody?.historySummary) {
    throw new Error('Trend history summary metadata missing from trends flow.');
  }

  console.log(`task=${taskId}`);
  console.log(`status=${task.status}`);
  console.log(`pid=${processInfo.pid}`);
  console.log(`attachSource=${detail.targetContext.attachSource}`);
  console.log(`attachDecision=${attachDecision}`);
  console.log(`sampleSource=${sampleSource}`);
  console.log(`provenance=${provenance?.mode ?? 'n/a'} ${provenance?.rawSignal ?? 'n/a'}`);
  console.log(`trends=${compareBody?.historySummary?.runCount ?? 0}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
