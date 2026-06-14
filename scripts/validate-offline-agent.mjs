import { randomUUID } from 'node:crypto';
import { acceptAgentHeartbeat, registerAgent, sweepOfflineAgents } from '../server/services/task-service.ts';
import { getAgent, upsertAgent } from '../server/store.ts';

const agentId = `offline-validate-${randomUUID().slice(0, 8)}`;
const now = Date.now();
const oldIso = new Date(now - 60_000).toISOString();

const registered = await registerAgent({
  id: agentId,
  label: 'offline-validation-agent',
  host: {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    pid: process.pid,
  },
});

if (!registered.ok) {
  throw new Error(registered.error.message);
}

await upsertAgent({
  ...registered.value.agent,
  lastHeartbeatAt: oldIso,
  lastSeenAt: oldIso,
  staleAfterSeconds: 1,
});

const swept = await sweepOfflineAgents();
const afterSweep = await getAgent(agentId);

const recovered = await acceptAgentHeartbeat(agentId, {
  notes: ['offline validation heartbeat'],
});

if (!recovered.ok) {
  throw new Error(recovered.error.message);
}

console.log(
  JSON.stringify(
    {
      agentId,
      swept,
      afterSweep: afterSweep
        ? {
            status: afterSweep.status,
            heartbeatState: afterSweep.heartbeatState,
          }
        : null,
      afterRecovery: {
        status: recovered.value.agent.status,
        heartbeatState: recovered.value.agent.heartbeatState,
      },
    },
    null,
    2,
  ),
);
