const base = process.env.MINI_DROP_BASE_URL || 'http://127.0.0.1:8787';
const timeoutMs = Number(process.env.MINI_DROP_WAIT_MS || 90000);
const pollMs = Number(process.env.MINI_DROP_POLL_MS || 1000);
const expectRealPySpy = process.env.MINI_DROP_EXPECT_REAL_PYSPY === '1';

const payload = {
  target: 'continuous-smoke@local',
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

async function waitForTerminalTask(taskId) {
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
  const firstId = await createTask(1);
  const secondId = await createTask(2);

  const first = await waitForTerminalTask(firstId);
  const second = await waitForTerminalTask(secondId);

  const taskWindow = await requestJson(`/api/tasks/${encodeURIComponent(second.id)}/continuous-profile`);
  const historyWindow = await requestJson(
    `/api/tasks/${encodeURIComponent(second.id)}/continuous-profile?scope=history&limit=2`,
  );

  if (!taskWindow?.window?.sliceCount) {
    throw new Error('Task-level continuous profile window is empty.');
  }
  if (!historyWindow?.window?.sliceCount || historyWindow.window.sliceCount < 2) {
    throw new Error('History-scope continuous profile window did not retain both runs.');
  }
  if (historyWindow.window.slices.at(-1)?.taskId !== second.id) {
    throw new Error('History-scope continuous profile window did not keep the latest run as the newest slice.');
  }
  if (expectRealPySpy) {
    const sampleSource = String(second.sampleSource ?? '');
    if (!sampleSource.includes('py-spy') || sampleSource.includes('fallback')) {
      throw new Error(`Expected continuous-profile latest run to use real py-spy, received ${sampleSource || 'missing'}.`);
    }
  }

  console.log(`first=${first.id} status=${first.status}`);
  console.log(`second=${second.id} status=${second.status}`);
  if (expectRealPySpy) {
    console.log(`sampleSource=${second.sampleSource ?? 'missing'}`);
  }
  console.log(`taskWindow=${taskWindow.window.sliceCount}`);
  console.log(`historyWindow=${historyWindow.window.sliceCount}`);
  console.log(
    `latestSlice=${historyWindow.window.slices.at(-1)?.taskId ?? 'missing'} samples=${historyWindow.window.slices.at(-1)?.sampleCount ?? 0}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
