import test from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createAgentApiClient,
  executeLeasedTask,
  registerAgentProcess,
  resolveAgentRuntimeConfig,
} from '../server/agent/index.js';
import { getAgent, getTask, getTaskReasonerSnapshot, listAuditEvents } from '../server/store.js';
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

test('completed tasks persist a safe degraded reasoner snapshot when external attribution is unverifiable', async () => {
  const previousMode = process.env.MINI_DROP_REASONER_MODE;
  const previousConfigPath = process.env.MINI_DROP_REASONER_CONFIG_PATH;
  const previousEndpoint = process.env.MINI_DROP_REASONER_ENDPOINT;
  const previousApiKey = process.env.MINI_DROP_REASONER_API_KEY;
  const previousModel = process.env.MINI_DROP_REASONER_MODEL;
  const originalFetch = globalThis.fetch;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mini-drop-reasoner-degraded-'));
  const configPath = path.join(tempDir, 'models.json');

  await writeFile(
    configPath,
    JSON.stringify(
      {
        models: [
          {
            id: 'degraded-mock',
            url: 'http://127.0.0.1:9010/v1/chat/completions',
            apiKey: 'test-api-key',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  process.env.MINI_DROP_REASONER_MODE = 'external';
  process.env.MINI_DROP_REASONER_CONFIG_PATH = configPath;
  delete process.env.MINI_DROP_REASONER_ENDPOINT;
  delete process.env.MINI_DROP_REASONER_API_KEY;
  delete process.env.MINI_DROP_REASONER_MODEL;

  globalThis.fetch = (async (input, init) => {
    const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (requestUrl.includes('/v1/chat/completions')) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '模型返回了一个未经验证的根因。',
                  findings: [
                    {
                      title: '未经验证结论',
                      detail: '这里没有真实 citation 支撑。',
                      citations: ['missing-evidence'],
                    },
                  ],
                  citations: ['missing-evidence'],
                  toolCalls: [
                    {
                      name: 'shell_exec',
                      args: { command: 'cat /etc/shadow' },
                    },
                  ],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    const url = new URL(requestUrl);
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

    if (url.pathname === `/api/agents/${encodeURIComponent('degraded-reasoner-agent')}/heartbeat` && init?.method === 'POST') {
      const result = await acceptAgentHeartbeat('degraded-reasoner-agent', body);
      return result.ok ? json(result.value) : json(result.error, result.status);
    }

    if (url.pathname === `/api/agents/${encodeURIComponent('degraded-reasoner-agent')}/poll-task` && init?.method === 'POST') {
      const result = await pollAgentTask('degraded-reasoner-agent');
      return result.ok ? json(result.value) : json(result.error, result.status);
    }

    if (url.pathname === `/api/agents/${encodeURIComponent('degraded-reasoner-agent')}/upload-result` && init?.method === 'POST') {
      const result = await acceptAgentUploadResult('degraded-reasoner-agent', body);
      return result.ok ? json(result.value) : json(result.error, result.status);
    }

    return json({ code: 'not_found', message: `Unhandled mock agent route ${url.pathname}` }, 404);
  }) as typeof fetch;

  const config = resolveAgentRuntimeConfig({
    ...process.env,
    MINI_DROP_AGENT_ID: 'degraded-reasoner-agent',
    MINI_DROP_AGENT_LABEL: 'degraded-reasoner-agent',
    MINI_DROP_AGENT_BASE_URL: 'http://agent-degraded-reasoner.local',
  });

  try {
    const client = createAgentApiClient(config, globalThis.fetch);
    await registerAgentProcess(config, client);

    const created = await createTaskAndDispatch({
      target: `degraded-reasoner-${Date.now()}@local`,
      language: 'Python',
      collector: 'py-spy',
      scenario: 'python_hot_loop',
    });

    await executeLeasedTask(created.task, config, client);

    const snapshot = await getTaskReasonerSnapshot(created.task.id);
    assert.ok(snapshot);
    assert.equal(snapshot?.output.mode, 'external');
    assert.equal(snapshot?.output.citations.length, 0);
    assert.ok(snapshot?.output.toolInvocations.some((item) => item.status === 'rejected'));
    assert.deepEqual(snapshot?.output.rejectedCitations, ['missing-evidence']);
    assert.match(snapshot?.output.fallbackReason ?? '', /未声明工具请求/);
    assert.ok(snapshot?.output.findings.every((item) => item.status === 'context-only'));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });

    if (previousMode === undefined) {
      delete process.env.MINI_DROP_REASONER_MODE;
    } else {
      process.env.MINI_DROP_REASONER_MODE = previousMode;
    }

    if (previousConfigPath === undefined) {
      delete process.env.MINI_DROP_REASONER_CONFIG_PATH;
    } else {
      process.env.MINI_DROP_REASONER_CONFIG_PATH = previousConfigPath;
    }

    if (previousEndpoint === undefined) {
      delete process.env.MINI_DROP_REASONER_ENDPOINT;
    } else {
      process.env.MINI_DROP_REASONER_ENDPOINT = previousEndpoint;
    }

    if (previousApiKey === undefined) {
      delete process.env.MINI_DROP_REASONER_API_KEY;
    } else {
      process.env.MINI_DROP_REASONER_API_KEY = previousApiKey;
    }

    if (previousModel === undefined) {
      delete process.env.MINI_DROP_REASONER_MODEL;
    } else {
      process.env.MINI_DROP_REASONER_MODEL = previousModel;
    }
  }
});
