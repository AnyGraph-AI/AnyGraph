/**
 * X4: Flake Governance Operationalization — Test Suite
 *
 * Tests the two X4 tasks:
 * 1. Quarantine workflow with expiry + reintegration criteria
 * 2. Flake budget monitoring in weekly report
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X4
 */

import { strict as assert } from 'node:assert';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  FlakeTracker,
  type TestRun,
} from '../../index.js';

// ============================================================================
// HELPERS
// ============================================================================

function makeRun(testId: string, passed: boolean, lane = 'A', runIndex = 0): TestRun {
  return {
    testId,
    testName: `test_${testId}`,
    lane,
    passed,
    durationMs: 100,
    runAt: new Date().toISOString(),
    runId: `run_${testId}_${runIndex}`,
  };
}

function setup() {
  setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' });
}

function teardown() {
  teardownHermeticEnv();
}

// ============================================================================
// TESTS
// ============================================================================

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void) {
  setup();
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  } finally {
    teardown();
  }
}

console.log('\n=== X4: Flake Governance Operationalization ===\n');

// --- Task 1: Quarantine workflow ---

console.log('Task 1: Quarantine workflow with expiry + reintegration');

await test('test starts not quarantined', () => {
  const tracker = new FlakeTracker();
  tracker.recordRun(makeRun('t1', true));
  const record = tracker.getRecord('t1')!;
  assert.ok(!record.quarantined);
  assert.equal(record.flakeRate, 0);
});

await test('auto-quarantine when flake rate exceeds threshold', () => {
  const tracker = new FlakeTracker({
    autoQuarantineThreshold: 0.05, // 5%
    trailingWindowSize: 10,
  });

  // 9 passes, 1 fail = 10% flake rate → above 5% threshold
  for (let i = 0; i < 9; i++) {
    tracker.recordRun(makeRun('t1', true, 'A', i));
  }
  tracker.recordRun(makeRun('t1', false, 'A', 9));

  const record = tracker.getRecord('t1')!;
  assert.ok(record.quarantined, 'should be quarantined');
  assert.ok(record.quarantineReason?.includes('Auto-quarantined'));
  assert.ok(record.quarantineExpiresAt, 'should have expiry date');
});

await test('reintegration after enough consecutive passes', () => {
  const tracker = new FlakeTracker({
    autoQuarantineThreshold: 0.05,
    trailingWindowSize: 20,
    reintegrationPasses: 5,
  });

  // Force quarantine
  for (let i = 0; i < 18; i++) {
    tracker.recordRun(makeRun('t1', true, 'A', i));
  }
  tracker.recordRun(makeRun('t1', false, 'A', 18));
  tracker.recordRun(makeRun('t1', false, 'A', 19));

  const quarantined = tracker.getRecord('t1')!;
  assert.ok(quarantined.quarantined, 'should be quarantined after 2 failures in 20');

  // Now pass 5 times in a row → reintegration
  for (let i = 20; i < 25; i++) {
    tracker.recordRun(makeRun('t1', true, 'A', i));
  }

  const reintegrated = tracker.getRecord('t1')!;
  assert.ok(!reintegrated.quarantined, 'should be reintegrated after 5 consecutive passes');
  assert.equal(reintegrated.quarantineReason, null);
});

await test('expired quarantine detected', () => {
  const tracker = new FlakeTracker({ quarantineDurationDays: 14 });
  tracker.recordRun(makeRun('t1', true));
  tracker.quarantine('t1', 'manual quarantine');

  // Check before expiry
  const beforeExpiry = new Date('2026-03-20T00:00:00.000Z');
  assert.equal(tracker.checkExpiredQuarantines(beforeExpiry).length, 0);

  // Check after expiry (14 days = March 28)
  const afterExpiry = new Date('2026-03-29T00:00:00.000Z');
  const expired = tracker.checkExpiredQuarantines(afterExpiry);
  assert.equal(expired.length, 1);
  assert.equal(expired[0], 't1');
});

await test('manual quarantine and reintegrate', () => {
  const tracker = new FlakeTracker();
  tracker.recordRun(makeRun('t1', true));

  tracker.quarantine('t1', 'manual: investigating flakiness');
  assert.ok(tracker.getRecord('t1')!.quarantined);

  tracker.reintegrate('t1');
  assert.ok(!tracker.getRecord('t1')!.quarantined);
});

await test('quarantined tests list is accurate', () => {
  const tracker = new FlakeTracker();
  tracker.recordRun(makeRun('t1', true));
  tracker.recordRun(makeRun('t2', true));
  tracker.recordRun(makeRun('t3', true));

  tracker.quarantine('t1', 'flaky');
  tracker.quarantine('t3', 'flaky');

  const quarantined = tracker.getQuarantined();
  assert.equal(quarantined.length, 2);
  assert.ok(quarantined.some(r => r.testId === 't1'));
  assert.ok(quarantined.some(r => r.testId === 't3'));
});

// --- Task 2: Flake budget monitoring ---

console.log('\nTask 2: Flake budget monitoring in weekly report');

await test('report with zero flakes shows within budget', () => {
  const tracker = new FlakeTracker();
  for (let i = 0; i < 100; i++) {
    tracker.recordRun(makeRun(`t${i % 10}`, true, 'A', i));
  }

  const report = tracker.generateReport();
  assert.equal(report.overallFlakeRate, 0);
  assert.ok(report.overallWithinBudget);
  assert.equal(report.quarantineBacklog, 0);
  assert.equal(report.expiryBreaches, 0);
  assert.equal(report.topFlakers.length, 0);
});

await test('report detects lane budget breach', () => {
  const tracker = new FlakeTracker({ criticalLaneBudget: 0.01 }); // 1%

  // Lane A: 100 runs, 2 failures = 2% (over budget)
  for (let i = 0; i < 98; i++) {
    tracker.recordRun(makeRun(`ta${i % 5}`, true, 'A', i));
  }
  tracker.recordRun(makeRun('ta_flaky', false, 'A', 98));
  tracker.recordRun(makeRun('ta_flaky', false, 'A', 99));

  // Lane B: 50 runs, 0 failures (within budget)
  for (let i = 0; i < 50; i++) {
    tracker.recordRun(makeRun(`tb${i % 3}`, true, 'B', i));
  }

  const report = tracker.generateReport();
  const laneA = report.laneBreakdown.find(l => l.laneId === 'A')!;
  const laneB = report.laneBreakdown.find(l => l.laneId === 'B')!;

  assert.ok(!laneA.withinBudget, 'Lane A should exceed budget');
  assert.ok(laneB.withinBudget, 'Lane B should be within budget');
});

await test('report includes top flakers', () => {
  const tracker = new FlakeTracker({ trailingWindowSize: 10 });

  // Test 1: 50% flake rate
  for (let i = 0; i < 5; i++) {
    tracker.recordRun(makeRun('flaky1', true, 'A', i));
    tracker.recordRun(makeRun('flaky1', false, 'A', i + 5));
  }

  // Test 2: 20% flake rate
  for (let i = 0; i < 8; i++) {
    tracker.recordRun(makeRun('flaky2', true, 'A', i));
  }
  tracker.recordRun(makeRun('flaky2', false, 'A', 8));
  tracker.recordRun(makeRun('flaky2', false, 'A', 9));

  // Test 3: 0% (stable)
  for (let i = 0; i < 10; i++) {
    tracker.recordRun(makeRun('stable', true, 'A', i));
  }

  const report = tracker.generateReport();
  assert.ok(report.topFlakers.length >= 2, 'should have at least 2 flakers');
  assert.equal(report.topFlakers[0].testId, 'flaky1', 'worst flaker first');
  assert.ok(!report.topFlakers.some(f => f.testId === 'stable'), 'stable test not in flakers');
});

await test('report tracks quarantine backlog and expiry breaches', () => {
  const tracker = new FlakeTracker({ quarantineDurationDays: 7 });

  tracker.recordRun(makeRun('t1', true));
  tracker.recordRun(makeRun('t2', true));

  tracker.quarantine('t1', 'flaky');
  tracker.quarantine('t2', 'flaky');

  // Report before any expiry
  const report1 = tracker.generateReport(new Date('2026-03-14T00:00:00.000Z'));
  assert.equal(report1.quarantineBacklog, 2);
  assert.equal(report1.expiryBreaches, 0);

  // Report after expiry (7+ days later)
  const report2 = tracker.generateReport(new Date('2026-03-22T00:00:00.000Z'));
  assert.equal(report2.quarantineBacklog, 2); // still quarantined (not auto-reintegrated)
  assert.equal(report2.expiryBreaches, 2);
  assert.deepEqual(report2.expiredQuarantineIds.sort(), ['t1', 't2']);
});

await test('report has all required governance scoreboard fields', () => {
  const tracker = new FlakeTracker();
  tracker.recordRun(makeRun('t1', true));
  const report = tracker.generateReport();

  // Check all required fields from TDD_ROADMAP Decision: Weekly Governance Scoreboard
  assert.ok('overallFlakeRate' in report, 'must have flakeRate');
  assert.ok('quarantineBacklog' in report, 'must have quarantineBacklog');
  assert.ok('expiryBreaches' in report, 'must have expiryBreaches');
  assert.ok('laneBreakdown' in report, 'must have lane breakdown');
  assert.ok('generatedAt' in report, 'must have timestamp');
  assert.ok('totalTests' in report, 'must have totalTests');
  assert.ok('totalRuns' in report, 'must have totalRuns');
  assert.ok('totalFailures' in report, 'must have totalFailures');
  assert.ok('config' in report, 'must include config for reproducibility');
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
