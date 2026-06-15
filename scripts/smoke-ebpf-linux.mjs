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
      target: 'ebpf-linux-smoke@local',
      targetType: 'label',
      language: 'C++',
      collector: 'ebpf',
      scenario: 'cpu_hot',
    }),
  });

  const taskId = createBody?.task?.id;
  if (!taskId) {
    throw new Error('eBPF smoke task id missing from create response.');
  }

  const task = await waitForTask(taskId);
  const detailBody = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`);
  const detail = detailBody?.task ?? detailBody;
  const artifactsBody = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/artifacts`);
  const sampleSource = String(detail?.sampleSource ?? task.sampleSource ?? '');
  const provenance = artifactsBody?.resultIndex?.provenance ?? null;
  const attachDecision = String(detail?.targetContext?.attachDecision ?? '');
  const collectorLogs = Array.isArray(detail?.collectorLogs) ? detail.collectorLogs.join('\n') : '';

  if (task.status !== 'DONE') {
    throw new Error(`eBPF smoke task ended with status=${task.status}.`);
  }
  if (!sampleSource || sampleSource.includes('fallback')) {
    throw new Error(`eBPF smoke retained fallback-only sampleSource=${sampleSource || 'missing'}.`);
  }
  if (!/bpftrace/i.test(sampleSource) && !/bpftrace/i.test(provenance?.rawSignal ?? '') && !/bpftrace/i.test(attachDecision) && !/bpftrace/i.test(collectorLogs)) {
    throw new Error('eBPF smoke did not retain observable bpftrace evidence.');
  }

  console.log(`task=${taskId}`);
  console.log(`status=${task.status}`);
  console.log(`sampleSource=${sampleSource}`);
  console.log(`provenance=${provenance?.mode ?? 'n/a'} ${provenance?.rawSignal ?? 'n/a'}`);
  console.log(`attach=${attachDecision}`);
  console.log(`artifacts=${Array.isArray(artifactsBody?.artifacts) ? artifactsBody.artifacts.length : 0}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
