import express from 'express';
import path from 'node:path';
import { createAgentRouter } from './routes/agent-routes.js';
import { createCatalogRouter } from './routes/catalog-routes.js';
import { createProcessRouter } from './routes/process-routes.js';
import { createTaskRouter } from './routes/task-routes.js';
import { sweepOfflineAgents } from './services/task-service.js';

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 8787);
const agentSweepIntervalMs = Math.max(5_000, Number(process.env.MINI_DROP_AGENT_SWEEP_MS ?? 5_000));

const app = express();

app.use(express.json());
app.use('/api', createCatalogRouter());
app.use('/api', createAgentRouter());
app.use('/api', createProcessRouter());
app.use('/api', createTaskRouter());

if (isProduction) {
  const clientDir = path.join(process.cwd(), 'dist', 'client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

app.listen(port, () => {
  const mode = isProduction ? 'production' : 'development';
  console.log(`Mini-Drop API listening on http://localhost:${port} (${mode})`);
});

const agentSweepTimer = setInterval(() => {
  void sweepOfflineAgents().catch((error) => {
    console.error(
      '[mini-drop] agent offline sweep failed:',
      error instanceof Error ? error.message : String(error),
    );
  });
}, agentSweepIntervalMs);

agentSweepTimer.unref?.();
