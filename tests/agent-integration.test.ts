import test from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import {
  createAgentApiClient,
  executeLeasedTask,
  registerAgentProcess,
  resolveAgentRuntimeConfig,
} from '../server/agent/index.js';
import { getAgent, getTask, listAuditEvents } from '../server/store.js';
import {
  acceptAgentHeartbeat,
  acceptAgentUploadResult,
  createTaskAndDispatch,
  loadTaskRunState,
  pollAgentTask,
  registerAgent,
} from '../server/services/task-service.js';
import { readStagedCollectorOutcome } from '../server/storage/repository.js';

test('independent agent runtime can register, lease, execute, and release a queued task', async () => {
  const previousCaptureMs = process.env.MINI_DROP_CAPTURE_MS;
  process.env.MINI_DROP_CAPTURE_MS = '1000';

  const config = resolveAgentRuntimeConfig({
    ...process.env,
    MINI_DROP_AGENT_ID: `integration-agent-${Date.now()}`,
    MINI_DROP_AGENT_LABEL: 'integration-agent',
    MINI_DROP_AGENT_BASE_URL: 'http://agent-integration.local',
  });

  const fetchImpl: typeof fetch = (async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body =
      init?.body && typeof init.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : init?.body
          ? (JSON.parse(String(init.body)) as unknown)
          : undefined;

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (url.pathname === '/api/agents/register' && init?.method === 'POST') {
      const result = await registerAgent(body);
      return result.ok ? json(result.value, 201) : json(result.error, 400);
    }

    if (url.pathname === `/api/agents/${encodeURIComponent(config.agentId)}/heartbeat` && init?.method === 'POST') {
      const result = await acceptAgentHeartbeat(config.agentId, body);
      return result.ok ? json(result.value) : json(result.error, result.status);
    }

    if (url.pathname === `/api/agents/${encodeURIComponent(config.agentId)}/poll-task` && init?.method === 'POST') {
      const result = await pollAgentTask(config.agentId);
      return result.ok ? json(result.value) : json(result.error, result.status);
    }

    if (url.pathname === `/api/agents/${encodeURIComponent(config.agentId)}/upload-result` && init?.method === 'POST') {
      const result = await acceptAgentUploadResult(config.agentId, body);
      return result.ok ? json(result.value) : json(result.error, result.status);
    }

    return json({ code: 'not_found', message: `Unhandled mock agent route ${url.pathname}` }, 404);
  }) as typeof fetch;

  try {
    const client = createAgentApiClient(config, fetchImpl);
    const registered = await registerAgentProcess(config, client);
    assert.equal(registered.accepted, true);

    const created = await createTaskAndDispatch({
      target: `agent-integration-${Date.now()}@local`,
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
    });
    assert.equal(created.task.status, 'PENDING');
    assert.match(created.task.statusReason, /独立 Agent/);

    const beforeExecution = await getTask(created.task.id);
    assert.equal(beforeExecution?.status, 'PENDING');

    await executeLeasedTask(created.task, config, client);

    const afterExecution = await getTask(created.task.id);
    assert.ok(afterExecution);
    assert.notEqual(afterExecution?.status, 'PENDING');
    assert.ok(afterExecution?.status === 'DONE' || afterExecution?.status === 'FAILED');
    assert.equal(afterExecution?.uploadState, 'uploaded');

    const stagedRecord = await readStagedCollectorOutcome(created.task.id);
    assert.equal(stagedRecord, null);

    const auditEvents = await listAuditEvents(created.task.id);
    assert.ok(auditEvents.some((event) => event.message.includes('暂存')));
    assert.ok(auditEvents.some((event) => event.message.includes('上传')));

    const updatedAgent = await getAgent(config.agentId);
    assert.equal(updatedAgent?.currentTaskId, null);

    const runState = await loadTaskRunState(created.task.id);
    assert.ok(runState?.activeRun);
    assert.ok(
      runState?.activeRun?.stage === 'completed' ||
        runState?.activeRun?.stage === 'failed' ||
        runState?.activeRun?.stage === 'stopped',
    );
  } finally {
    if (previousCaptureMs === undefined) {
      delete process.env.MINI_DROP_CAPTURE_MS;
    } else {
      process.env.MINI_DROP_CAPTURE_MS = previousCaptureMs;
    }
  }
});

test('independent agent runtime surfaces upload interruption without clearing the current lease', async () => {
  const previousCaptureMs = process.env.MINI_DROP_CAPTURE_MS;
  process.env.MINI_DROP_CAPTURE_MS = '1000';

  const config = resolveAgentRuntimeConfig({
    ...process.env,
    MINI_DROP_AGENT_ID: `upload-interrupt-agent-${Date.now()}`,
    MINI_DROP_AGENT_LABEL: 'upload-interrupt-agent',
    MINI_DROP_AGENT_BASE_URL: 'http://agent-upload-interrupt.local',
  });

  const fetchImpl: typeof fetch = (async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body =
      init?.body && typeof init.body === 'string'
        ? (JSON.parse(init.body) as unknown)
        : init?.body
          ? (JSON.parse(String(init.body)) as unknown)
          : undefined;

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (url.pathname === '/api/agents/register' && init?.method === 'POST') {
      const result = await registerAgent(body);
      return result.ok ? json(result.value, 201) : json(result.error, 400);
    }

    if (url.pathname === `/api/agents/${encodeURIComponent(config.agentId)}/heartbeat` && init?.method === 'POST') {
      const result = await acceptAgentHeartbeat(config.agentId, body);
      return result.ok ? json(result.value) : json(result.error, result.status);
    }

    if (url.pathname === `/api/agents/${encodeURIComponent(config.agentId)}/poll-task` && init?.method === 'POST') {
      const result = await pollAgentTask(config.agentId);
      return result.ok ? json(result.value) : json(result.error, result.status);
    }

    if (url.pathname === `/api/agents/${encodeURIComponent(config.agentId)}/upload-result` && init?.method === 'POST') {
      return json({ code: 'upload_interrupted', message: 'Simulated upload interruption.' }, 503);
    }

    return json({ code: 'not_found', message: `Unhandled mock agent route ${url.pathname}` }, 404);
  }) as typeof fetch;

  try {
    const client = createAgentApiClient(config, fetchImpl);
    await registerAgentProcess(config, client);

    const created = await createTaskAndDispatch({
      target: `upload-interruption-${Date.now()}@local`,
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
    });

    await assert.rejects(
      async () => executeLeasedTask(created.task, config, client),
      /Simulated upload interruption/,
    );

    const interruptedTask = await getTask(created.task.id);
    assert.ok(interruptedTask);
    assert.equal(interruptedTask?.status, 'UPLOADING');
    assert.equal(interruptedTask?.uploadState, 'uploading');

    const updatedAgent = await getAgent(config.agentId);
    assert.equal(updatedAgent?.currentTaskId, created.task.id);
  } finally {
    if (previousCaptureMs === undefined) {
      delete process.env.MINI_DROP_CAPTURE_MS;
    } else {
      process.env.MINI_DROP_CAPTURE_MS = previousCaptureMs;
    }
  }
});
