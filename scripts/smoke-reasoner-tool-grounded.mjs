const base = process.env.MINI_DROP_BASE_URL || 'http://127.0.0.1:8787';
const expectDegraded =
  process.argv.includes('--degraded') || process.env.MINI_DROP_REASONER_EXPECT_DEGRADED === '1';

async function requestJson(path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} -> ${response.status} ${body}`.trim());
  }
  return response.json();
}

async function waitForTask(taskId, timeoutMs = 120000, pollMs = 1000) {
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
      target: 'reasoner-grounded-smoke',
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
      targetType: 'label',
    }),
  });

  const taskId = createBody?.task?.id;
  if (!taskId) {
    throw new Error('Task id missing from create response.');
  }

  await waitForTask(taskId);
  const reasoner = await requestJson(`/api/tasks/${encodeURIComponent(taskId)}/reasoner`);
  const snapshot = reasoner?.snapshot;
  if (!snapshot) {
    throw new Error('Reasoner snapshot missing.');
  }

  if (!Array.isArray(snapshot.input.availableTools) || snapshot.input.availableTools.length === 0) {
    throw new Error('availableTools missing from reasoner snapshot input.');
  }
  if (!Array.isArray(snapshot.output.toolInvocations) || snapshot.output.toolInvocations.length === 0) {
    throw new Error('toolInvocations missing from reasoner snapshot output.');
  }
  if (!Array.isArray(snapshot.output.rejectedCitationDetails)) {
    throw new Error('rejectedCitationDetails missing from reasoner snapshot output.');
  }

  if (expectDegraded) {
    if (!snapshot.output.fallbackReason || snapshot.output.fallbackReason.trim().length === 0) {
      throw new Error('Expected degraded reasoner run to retain a fallbackReason.');
    }
    if (!snapshot.output.toolInvocations.some((item) => item.status === 'rejected' || item.status === 'failed')) {
      throw new Error('Expected degraded reasoner run to preserve a rejected or failed tool trace.');
    }
    if (!snapshot.output.findings.every((item) => item.status === 'context-only')) {
      throw new Error('Expected degraded reasoner findings to stay context-only.');
    }
  }

  console.log(`task=${taskId}`);
  console.log(`mode=${snapshot.output.mode}`);
  console.log(`tools=${snapshot.input.availableTools.map((item) => item.name).join(',')}`);
  console.log(`toolTrace=${snapshot.output.toolInvocations.length}`);
  console.log(`citations=${snapshot.output.citations.join(',') || 'none'}`);
  console.log(`degraded=${expectDegraded ? 'expected' : 'no'}`);
  console.log(`fallbackReason=${snapshot.output.fallbackReason || 'none'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
