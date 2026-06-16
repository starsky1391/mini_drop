const base = process.env.MINI_DROP_BASE_URL || 'http://127.0.0.1:8787';
const timeoutMs = Number(process.env.MINI_DROP_WAIT_MS || 120000);
const pollMs = Number(process.env.MINI_DROP_POLL_MS || 1000);

async function requestJson(path, init) {
  const response = await fetch(base + path, init);
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
  const createBody = await requestJson('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      target: 'perf-linux-smoke@local',
      targetType: 'label',
      language: 'Go',
      collector: 'perf',
      scenario: 'cpu_hot',
    }),
  });

  const taskId = createBody?.task?.id;
  if (!taskId) {
    throw new Error('perf Linux smoke task id missing from create response.');
  }

  const task = await waitForTask(taskId);
  const detailBody = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`);
  const detail = detailBody?.task ?? detailBody;
  const artifactsBody = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/artifacts`);
  const artifacts = artifactsBody?.artifacts ?? [];
  const provenance = artifactsBody?.resultIndex?.provenance ?? null;
  const sampleSource = String(detail?.sampleSource ?? task.sampleSource ?? '');
  const hasPerfData = artifacts.some((artifact) => /perf\.data/i.test(String(artifact.path ?? '')) || /perf\.data/i.test(String(artifact.label ?? '')));
  const hasPerfScript = artifacts.some((artifact) => /perf script/i.test(String(artifact.label ?? '')) || /script/i.test(String(artifact.path ?? '')));

  if (task.status !== 'DONE') {
    throw new Error(`perf Linux smoke task ended with status=${task.status}.`);
  }
  if (!sampleSource.includes('perf') || sampleSource.includes('fallback')) {
    throw new Error(`perf Linux smoke retained fallback-only sampleSource=${sampleSource || 'missing'}.`);
  }
  if (!['real', 'partial-real'].includes(String(provenance?.mode ?? ''))) {
    throw new Error(`perf Linux smoke expected real or partial-real provenance, received ${provenance?.mode ?? 'missing'}.`);
  }
  if (!hasPerfData) {
    throw new Error('perf Linux smoke did not retain perf.data.');
  }
  if (!hasPerfScript) {
    throw new Error('perf Linux smoke did not retain perf script output.');
  }

  console.log(`task=${taskId}`);
  console.log(`status=${task.status}`);
  console.log(`sampleSource=${sampleSource}`);
  console.log(`provenance=${provenance?.mode ?? 'n/a'} ${provenance?.rawSignal ?? 'n/a'}`);
  console.log(`artifacts=${artifacts.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
