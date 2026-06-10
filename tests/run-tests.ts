import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskDetail } from '../server/analysis.js';
import { compareTasks } from '../server/comparison.js';
import { createQueuedTask } from '../server/analysis.js';
import { saveTask, getTaskReasonerSnapshot, listAuditEvents, getTask } from '../server/store.js';
import { cancelTaskExecution } from '../server/execution.js';

test('createTaskDetail returns a complete report', () => {
  const task = createTaskDetail({
    target: 'payments-api@node-7',
    language: 'Java',
    collector: 'async-profiler',
    scenario: 'gc_pressure',
  });

  assert.equal(task.status, 'done');
  assert.equal(task.reportTitle, 'GC Pressure diagnosis');
  assert.ok(task.primaryFinding.length > 0);
  assert.equal(task.findings.length, 2);
  assert.equal(task.topFunctions[0]?.name, 'ObjectAllocator::new');
});

test('compareTasks detects regressions and improvements', () => {
  const baseline = createTaskDetail({
    target: 'orders-api@node-3',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });

  const current = createTaskDetail({
    target: 'orders-api@node-3',
    language: 'Go',
    collector: 'perf',
    scenario: 'lock_contention',
  });

  const comparison = compareTasks(baseline, current);

  assert.equal(comparison.baselineId, baseline.id);
  assert.equal(comparison.currentId, current.id);
  assert.equal(comparison.metricDeltas.length, 4);
  assert.ok(comparison.summary.length > 0);
});

test('cancelTaskExecution marks queued tasks as stopped and persists audit and reasoner output', async () => {
  const task = createQueuedTask({
    target: 'inventory-api@node-2',
    language: 'Go',
    collector: 'perf',
    scenario: 'cpu_hot',
  });

  await saveTask(task);
  const canceled = await cancelTaskExecution(task.id, 'Stop requested from test.', 'user');

  assert.ok(canceled);
  assert.equal(canceled?.accepted, true);
  assert.equal(canceled?.task.status, 'failed');
  assert.equal(canceled?.task.reportTitle, 'Task stopped');

  const savedTask = await getTask(task.id);
  assert.ok(savedTask);
  assert.equal(savedTask?.status, 'failed');

  const reasoner = await getTaskReasonerSnapshot(task.id);
  assert.ok(reasoner);
  assert.equal(reasoner?.input.taskId, task.id);

  const auditEvents = await listAuditEvents(task.id);
  assert.ok(auditEvents.some((event) => event.type === 'task.stop_requested'));
  assert.ok(auditEvents.some((event) => event.type === 'task.stopped'));
});
