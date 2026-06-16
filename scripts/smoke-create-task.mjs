const base = process.env.MINI_DROP_BASE_URL || 'http://127.0.0.1:8787';
const timeoutMs = Number(process.env.MINI_DROP_WAIT_MS || 90000);
const pollMs = Number(process.env.MINI_DROP_POLL_MS || 1000);
const expectRealPySpy = process.env.MINI_DROP_EXPECT_REAL_PYSPY === '1';
const payload = {
  target: 'smoke@local',
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
  const body = await requestJson('/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const taskId = body.task?.id;
  if (!taskId) {
    throw new Error('Task id missing from create response.');
  }

  if (!expectRealPySpy) {
    console.log(taskId);
    return;
  }

  const task = await waitForTask(taskId);
  if (task.status !== 'DONE') {
    throw new Error(`Expected py-spy smoke task to finish with DONE, received ${task.status}.`);
  }

  const detailBody = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`);
  const artifactsBody = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/artifacts`);
  const detail = detailBody?.task ?? detailBody;
  const sampleSource = String(detail?.sampleSource ?? task.sampleSource ?? '');
  const provenance = artifactsBody?.resultIndex?.provenance ?? null;
  const hasSpeedscopeArtifact = (artifactsBody?.artifacts ?? []).some(
    (artifact) => artifact.kind === 'speedscope' || /speedscope/i.test(String(artifact.label ?? '')),
  );

  if (!sampleSource.includes('py-spy') || sampleSource.includes('fallback')) {
    throw new Error(`Expected real py-spy sampleSource, received ${sampleSource || 'missing'}.`);
  }
  if (provenance?.mode !== 'real') {
    throw new Error(`Expected py-spy provenance.mode=real, received ${provenance?.mode ?? 'missing'}.`);
  }
  if (!hasSpeedscopeArtifact) {
    throw new Error('Expected py-spy smoke to retain a speedscope artifact.');
  }

  console.log(`task=${taskId}`);
  console.log(`status=${task.status}`);
  console.log(`sampleSource=${sampleSource}`);
  console.log(`provenance=${provenance.mode} ${provenance.rawSignal ?? 'n/a'}`);
  console.log(`artifacts=${artifactsBody.artifacts.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
