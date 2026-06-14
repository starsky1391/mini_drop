import { Router } from 'express';
import {
  acceptAgentHeartbeat,
  acceptAgentUploadResult,
  loadAgentList,
  pollAgentTask,
  registerAgent,
} from '../services/task-service.js';

export function createAgentRouter() {
  const router = Router();

  router.get('/agents', async (_req, res) => {
    res.json(await loadAgentList());
  });

  router.post('/agents/register', async (req, res) => {
    const result = await registerAgent(req.body);
    if (!result.ok) {
      res.status(400).json(result.error);
      return;
    }
    res.status(201).json(result.value);
  });

  router.post('/agents/:id/heartbeat', async (req, res) => {
    const result = await acceptAgentHeartbeat(req.params.id, req.body);
    if (!result.ok) {
      res.status(result.status).json(result.error);
      return;
    }
    res.json(result.value);
  });

  router.post('/agents/:id/poll-task', async (req, res) => {
    const result = await pollAgentTask(req.params.id);
    if (!result.ok) {
      res.status(result.status).json(result.error);
      return;
    }
    res.json(result.value);
  });

  router.post('/agents/:id/upload-result', async (req, res) => {
    const result = await acceptAgentUploadResult(req.params.id, req.body);
    if (!result.ok) {
      res.status(result.status).json(result.error);
      return;
    }
    res.json(result.value);
  });

  return router;
}
