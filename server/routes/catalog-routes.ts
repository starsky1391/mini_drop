import { Router } from 'express';
import { collectorNotes } from '../notes.js';
import { collectorRegistry } from '../collectors/index.js';
import { probeAgentEnvironment } from '../agent/probe.js';
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
    const collectorReadiness = await Promise.all(
      collectorRegistry.entries().map(async ([_, plugin]) => {
        const probe = await probeAgentEnvironment(plugin);
        return probe.collectors[0]!;
      }),
    );

    const payload: CatalogResponse = {
      collectors,
      scenarios,
      targetTypes,
      collectorNotes: [
        ...collectorNotes,
        ...collectorReadiness.map(
          (item) => `${item.collector}: readiness=${item.readiness} supported=${item.supported} available=${item.available}`,
        ),
      ],
      collectorReadiness,
    };
    res.json(payload);
  });

  return router;
}
