import { Router } from 'express';
import {
  createTaskAndDispatch,
  loadAuditFeed,
  loadTaskArtifacts,
  loadTaskAudit,
  loadTaskComparison,
  loadTaskDetail,
  loadTaskList,
  parseTaskListFilters,
  validateTaskCreateInput,
} from '../services/task-service.js';
import type { ApiErrorResponse } from '../../shared/types.js';

export function createTaskRouter() {
  const router = Router();

  router.get('/tasks', async (req, res) => {
    const parsed = parseTaskListFilters(req.query as Record<string, unknown>);
    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    res.json(await loadTaskList(parsed.value));
  });

  router.get('/tasks/:id', async (req, res) => {
    const task = await loadTaskDetail(req.params.id);
    if (!task) {
      res.status(404).json({ code: 'task_not_found', message: 'Task not found' } satisfies ApiErrorResponse);
      return;
    }

    res.json(task);
  });

  router.get('/tasks/:id/compare/:otherId', async (req, res) => {
    const comparison = await loadTaskComparison(req.params.id, req.params.otherId);
    if (!comparison) {
      res.status(404).json({
        code: 'task_comparison_missing',
        message: 'One or both tasks were not found',
      } satisfies ApiErrorResponse);
      return;
    }

    res.json(comparison);
  });

  router.get('/tasks/:id/artifacts', async (req, res) => {
    const artifacts = await loadTaskArtifacts(req.params.id);
    if (!artifacts) {
      res.status(404).json({ code: 'task_not_found', message: 'Task not found' } satisfies ApiErrorResponse);
      return;
    }

    res.json(artifacts);
  });

  router.get('/tasks/:id/audit', async (req, res) => {
    const audit = await loadTaskAudit(req.params.id);
    if (!audit) {
      res.status(404).json({ code: 'task_not_found', message: 'Task not found' } satisfies ApiErrorResponse);
      return;
    }

    res.json(audit);
  });

  router.get('/audit', async (req, res) => {
    const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
    res.json(await loadAuditFeed(taskId));
  });

  router.post('/tasks', async (req, res) => {
    const parsed = validateTaskCreateInput(req.body);
    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const created = await createTaskAndDispatch(parsed.value);
    res.status(201).json(created);
  });

  return router;
}
