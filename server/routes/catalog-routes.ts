import { Router } from 'express';
import { collectorNotes } from '../notes.js';
import { loadCatalogCollectorReadiness } from '../services/task-service.js';
import { collectors, scenarios, targetTypes } from '../../shared/catalog.js';
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

  router.get('/catalog', async (_req, res) => {
    const readiness = await loadCatalogCollectorReadiness();

    const payload: CatalogResponse = {
      collectors,
      scenarios,
      targetTypes,
      collectorNotes: [
        ...collectorNotes,
        ...readiness.notes,
        ...readiness.collectorReadiness.map(
          (item) => `${item.collector}: readiness=${item.readiness} supported=${item.supported} available=${item.available}`,
        ),
      ],
      collectorReadiness: readiness.collectorReadiness,
      collectorReadinessSource: readiness.source,
      collectorReadinessAgentId: readiness.agentId,
      collectorReadinessAgentLabel: readiness.agentLabel,
    };
    res.json(payload);
  });

  return router;
}
