import { Router } from 'express';
import type { Response } from 'express';
import {
  cancelTask,
  loadArtifactPreview,
  createTaskAndDispatch,
  loadAuditFeed,
  loadTaskArtifacts,
  loadTaskAudit,
  loadTaskComparison,
  loadTaskContinuousProfile,
  type LoadContinuousProfileOptions,
  loadTaskDetail,
  loadTaskList,
  loadTaskReasoner,
  loadTaskRunState,
  loadTaskTrends,
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
      sendApiError(res, 404, { code: 'task_not_found', message: 'Task not found' });
      return;
    }

    res.json(task);
  });

  router.get('/tasks/:id/compare/:otherId', async (req, res) => {
    const comparison = await loadTaskComparison(req.params.id, req.params.otherId);
    if (!comparison) {
      sendApiError(res, 404, {
        code: 'task_comparison_missing',
        message: 'One or both tasks were not found',
      });
      return;
    }

    res.json(comparison);
  });

  router.get('/tasks/:id/artifacts', async (req, res) => {
    await respondWithTaskSidecar(res, req.params.id, loadTaskArtifacts);
  });

  router.get('/tasks/:id/artifacts/content', async (req, res) => {
    const artifactPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!artifactPath) {
      sendApiError(res, 400, {
        code: 'artifact_path_required',
        message: 'Artifact path query parameter is required.',
      });
      return;
    }

    const preview = await loadArtifactPreview(req.params.id, artifactPath);
    if (!preview) {
      sendApiError(res, 404, { code: 'task_not_found', message: 'Task not found' });
      return;
    }
    if ('code' in preview) {
      sendApiError(res, 404, preview);
      return;
    }

    res.json(preview);
  });

  router.get('/tasks/:id/audit', async (req, res) => {
    await respondWithTaskSidecar(res, req.params.id, loadTaskAudit);
  });

  router.get('/tasks/:id/reasoner', async (req, res) => {
    await respondWithTaskSidecar(res, req.params.id, loadTaskReasoner);
  });

  router.get('/tasks/:id/run-state', async (req, res) => {
    await respondWithTaskSidecar(res, req.params.id, loadTaskRunState);
  });

  router.get('/tasks/:id/trends', async (req, res) => {
    await respondWithTaskSidecar(res, req.params.id, loadTaskTrends);
  });

  router.get('/tasks/:id/continuous-profile', async (req, res) => {
    const scope = req.query.scope === 'history' ? 'history' : 'task';
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const limit =
      typeof req.query.limit === 'string' && /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : undefined;
    const options: LoadContinuousProfileOptions = { scope, from, to, limit };
    await respondWithTaskSidecar(res, req.params.id, (taskId) => loadTaskContinuousProfile(taskId, options));
  });

  router.get('/audit', async (req, res) => {
    const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
    res.json(await loadAuditFeed(taskId));
  });

  router.post('/tasks', async (req, res) => {
    const parsed = await validateTaskCreateInput(req.body);
    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const created = await createTaskAndDispatch(parsed.value);
    res.status(201).json(created);
  });

  router.post('/tasks/:id/cancel', async (req, res) => {
    const canceled = await cancelTask(req.params.id);
    if (!canceled) {
      sendApiError(res, 404, { code: 'task_not_found', message: 'Task not found' });
      return;
    }

    if (!canceled.accepted) {
      sendApiError(res, 409, {
        code: 'task_already_terminal',
        message: canceled.reason,
      });
      return;
    }

    res.json(canceled);
  });

  return router;
}

async function respondWithTaskSidecar<T>(
  res: Response,
  taskId: string,
  loader: (taskId: string) => Promise<T | null>,
) {
  const payload = await loader(taskId);
  if (!payload) {
    sendApiError(res, 404, { code: 'task_not_found', message: 'Task not found' });
    return;
  }

  res.json(payload);
}

function sendApiError(res: Response, status: number, error: ApiErrorResponse) {
  res.status(status).json(error satisfies ApiErrorResponse);
}
