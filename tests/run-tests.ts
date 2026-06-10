import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskDetail } from '../server/analysis.js';
import { compareTasks } from '../server/comparison.js';

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
