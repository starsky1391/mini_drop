import { Router } from 'express';
import { collectorNotes } from '../notes.js';
import { collectors, scenarios } from '../../shared/catalog.js';
import type { CatalogResponse, HealthResponse } from '../../shared/types.js';

export function createCatalogRouter() {
  const router = Router();

  router.get('/health', (_req, res) => {
    const payload: HealthResponse = {
      ok: true,
      service: 'mini-drop',
      collectors: collectors.length,
      scenarios: scenarios.length,
    };
    res.json(payload);
  });

  router.get('/catalog', (_req, res) => {
    const payload: CatalogResponse = {
      collectors,
      scenarios,
      collectorNotes,
    };
    res.json(payload);
  });

  return router;
}
