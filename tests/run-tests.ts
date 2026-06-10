import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskDetail } from '../server/analysis.js';
import { compareTasks } from '../server/comparison.js';
import { parsePerfScript, parseSpeedscopeProfile } from '../server/collectors/profile-utils.js';

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

test('parsePerfScript preserves weighted stacks and caller evidence', () => {
  const parsed = parsePerfScript(`
python3 1234/1234 [002] 1000.001: 41 cpu-clock:
        7ff6a3 parse_message+0x08 (app/parser.py)
        7ff6a2 walk_rows+0x18 (app/rows.py)
        7ff6a1 frame_eval+0x10 (python/ceval.c)

python3 1234/1234 [002] 1000.002: 21 cpu-clock:
        7ff6a4 emit_metrics+0x05 (infra/metrics.py)
        7ff6a2 walk_rows+0x18 (app/rows.py)
        7ff6a1 frame_eval+0x10 (python/ceval.c)
`);

  assert.ok(parsed);
  assert.equal(parsed.usedRealData, true);
  assert.equal(parsed.evidence.sourceKind, 'perf-script');
  assert.equal(parsed.evidence.threadCount, 1);
  assert.equal(parsed.topFunctions[0]?.name, 'parse_message');
  assert.ok(parsed.evidence.hotspots[0]?.representativeStack.length >= 2);
  assert.match(parsed.collapsedStacks, /frame_eval/);
});

test('parseSpeedscopeProfile preserves file and line evidence', () => {
  const parsed = parseSpeedscopeProfile(
    JSON.stringify({
      $schema: 'https://www.speedscope.app/file-format-schema.json',
      shared: {
        frames: [
          { name: 'process_rows', file: 'app/rows.py', line: 12 },
          { name: 'frame_eval', file: 'python/ceval.c', line: 3021 },
          { name: 'parse_message', file: 'app/parser.py', line: 87 },
        ],
      },
      profiles: [
        {
          type: 'sampled',
          name: 'MainThread',
          unit: 'samples',
          samples: [
            [0, 1, 2],
            [0, 1, 2],
          ],
          weights: [5, 7],
        },
      ],
    }),
  );

  assert.ok(parsed);
  assert.equal(parsed.usedRealData, true);
  assert.equal(parsed.evidence.sourceKind, 'speedscope');
  assert.equal(parsed.topFunctions[0]?.name, 'parse_message');
  assert.equal(parsed.evidence.hotspots[0]?.leaf.file, 'parser.py');
  assert.equal(parsed.evidence.hotspots[0]?.leaf.line, 87);
  assert.equal(parsed.evidence.threadCount, 1);
});
