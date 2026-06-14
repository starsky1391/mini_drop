import { Router } from 'express';
import { loadLocalProcesses } from '../services/task-service.js';

export function createProcessRouter() {
  const router = Router();

  router.get('/processes', async (_req, res) => {
    res.json(await loadLocalProcesses());
  });

  return router;
}
