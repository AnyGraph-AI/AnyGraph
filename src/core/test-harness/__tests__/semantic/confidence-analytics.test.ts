/**
 * L4: Confidence Governance Analytics — Test Suite
 *
 * Tests the four L4 tasks:
 * 1. Confidence regression budget tracking
 * 2. Evidence completeness trend analytics
 * 3. Override entropy trend analytics
 * 4. Policy effectiveness trend analytics
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L4
 */

import { strict as assert } from 'node:assert';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  checkConfidenceRegression,
  analyzeCompletenessTrend,
  computeOverrideEntropy,
  analyzePolicyEffectiveness,
  DEFAULT_REGRESSION_BUDGET,
  type ConfidenceSnapshot,
  type EvidenceCompletenessSnapshot,
  type OverrideEvent,
  type PolicyEffectivenessSnapshot,
} from '../../index.js';

function setup() { setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' }); }
function teardown() { teardownHermeticEnv(); }

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void) {
  setup();
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err: any) { failed++; console.log(`  ✗ ${name}\n    ${err.message}`); }
  finally { teardown(); }
}

// ============================================================================
// HELPERS
// ============================================================================

function makeConfidenceSnapshot(avg: number, ts = '2026-03-14T00:00:00.000Z'): ConfidenceSnapshot {
  return {
    timestamp: ts,
    projectId: 'proj_test',
    edgeConfidence: { CALLS: avg, CONTAINS: 1.0, PART_OF: 1.0 },
    lowConfidenceEdges: avg < 1.0 ? 10 : 0,
    totalEdges: 100,
    weightedAverage: avg,
  };
}

function makeCompletenessSnapshot(pct: number, ts = '2026-03-14T00:00:00.000Z'): EvidenceCompletenessSnapshot {
  const total = 100;
  const withEv = Math.round(total * pct / 100);
  return {
    timestamp: ts,
    projectId: 'proj_test',
    totalDoneTasks: total,
    tasksWithEvidence: withEv,
    tasksWithoutEvidence: total - withEv,
    completenessPercent: pct,
    byCategory: {},
  };
}

function makeEffectivenessSnapshot(prevented: number, escaped: number, fp: number): PolicyEffectivenessSnapshot {
  const total = prevented + escaped;
  return {
    timestamp: '2026-03-14T00:00:00.000Z',
    projectId: 'proj_test',
    preventedViolations: prevented,
    escapedViolations: escaped,
    preventionRate: total > 0 ? prevented / total : 1,
    falsePositives: fp,
    falsePositiveRate: total > 0 ? fp / (total + fp) : 0,
    byInvariant: {},
  };
}

console.log('\n=== L4: Confidence Governance Analytics ===\n');

// --- Task 1: Confidence regression budget ---

console.log('Task 1: Confidence regression budget tracking');

await test('stable confidence within budget', () => {
  const current = makeConfidenceSnapshot(0.95);
  const previous = makeConfidenceSnapshot(0.95);
  const baseline = makeConfidenceSnapshot(0.95);
  const result = checkConfidenceRegression(current, previous, baseline);
  assert.ok(result.withinBudget);
  assert.equal(result.alerts.length, 0);
});

await test('small drop within period budget', () => {
  const current = makeConfidenceSnapshot(0.92);
  const previous = makeConfidenceSnapshot(0.95);
  const result = checkConfidenceRegression(current, previous, null);
  assert.ok(result.withinBudget, `Expected within budget: ${result.alerts.join('; ')}`);
  assert.ok(result.periodDrop! < DEFAULT_REGRESSION_BUDGET.maxDropPerPeriod);
});

await test('large period drop exceeds budget', () => {
  const current = makeConfidenceSnapshot(0.85);
  const previous = makeConfidenceSnapshot(0.95);
  const result = checkConfidenceRegression(current, previous, null);
  assert.ok(!result.withinBudget);
  assert.ok(result.alerts.some(a => a.includes('Period drop')));
});

await test('absolute drop from baseline exceeds budget', () => {
  const current = makeConfidenceSnapshot(0.82);
  const baseline = makeConfidenceSnapshot(0.95);
  const result = checkConfidenceRegression(current, null, baseline);
  assert.ok(!result.withinBudget);
  assert.ok(result.alerts.some(a => a.includes('Absolute drop')));
});

await test('below minimum weighted average triggers alert', () => {
  const current = makeConfidenceSnapshot(0.70);
  const result = checkConfidenceRegression(current, null, null);
  assert.ok(!result.withinBudget);
  assert.ok(result.alerts.some(a => a.includes('below minimum')));
});

// --- Task 2: Evidence completeness trend ---

console.log('\nTask 2: Evidence completeness trend analytics');

await test('improving trend detected', () => {
  const current = makeCompletenessSnapshot(25.0);
  const previous = makeCompletenessSnapshot(15.0);
  const trend = analyzeCompletenessTrend(current, previous);
  assert.equal(trend.direction, 'improving');
  assert.equal(trend.delta, 10.0);
  assert.equal(trend.alert, null);
});

await test('declining trend generates alert', () => {
  const current = makeCompletenessSnapshot(10.0);
  const previous = makeCompletenessSnapshot(15.0);
  const trend = analyzeCompletenessTrend(current, previous);
  assert.equal(trend.direction, 'declining');
  assert.ok(trend.alert?.includes('declining'));
});

await test('stable trend with small delta', () => {
  const current = makeCompletenessSnapshot(15.2);
  const previous = makeCompletenessSnapshot(15.0);
  const trend = analyzeCompletenessTrend(current, previous);
  assert.equal(trend.direction, 'stable');
});

await test('first snapshot has no previous', () => {
  const current = makeCompletenessSnapshot(22.4);
  const trend = analyzeCompletenessTrend(current, null);
  assert.equal(trend.direction, 'stable');
  assert.equal(trend.delta, null);
  assert.equal(trend.previousPercent, null);
});

// --- Task 3: Override entropy ---

console.log('\nTask 3: Override entropy trend analytics');

await test('zero overrides = zero entropy = healthy', () => {
  const result = computeOverrideEntropy([]);
  assert.equal(result.entropy, 0);
  assert.ok(result.healthy);
  assert.equal(result.totalOverrides, 0);
});

await test('single override type = low entropy', () => {
  const events: OverrideEvent[] = [
    { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'done_without_witness', reason: 'test', issuerId: 'admin' },
    { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'done_without_witness', reason: 'test', issuerId: 'admin' },
  ];
  const result = computeOverrideEntropy(events);
  assert.equal(result.uniqueTypes, 1);
  assert.equal(result.uniqueInvariants, 1);
  assert.ok(result.healthy);
});

await test('many diverse overrides = high entropy = unhealthy', () => {
  const events: OverrideEvent[] = [
    { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'inv1', reason: 'test', issuerId: 'a' },
    { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'mode_downgrade', invariantId: 'inv2', reason: 'test', issuerId: 'b' },
    { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'threshold_relaxation', invariantId: 'inv3', reason: 'test', issuerId: 'c' },
    { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'manual_pass', invariantId: 'inv4', reason: 'test', issuerId: 'd' },
    { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'inv5', reason: 'test', issuerId: 'e' },
    { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'mode_downgrade', invariantId: 'inv6', reason: 'test', issuerId: 'f' },
  ];
  const result = computeOverrideEntropy(events, new Date('2026-03-14'), 1.5);
  assert.ok(!result.healthy, `Expected unhealthy but got entropy=${result.entropy.toFixed(2)}`);
  assert.ok(result.alert?.includes('entropy'));
});

await test('expired overrides counted separately', () => {
  const events: OverrideEvent[] = [
    { timestamp: '2026-03-01', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'inv1', reason: 'test', issuerId: 'a', expiresAt: '2026-03-10T00:00:00.000Z' },
    { timestamp: '2026-03-12', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'inv1', reason: 'test', issuerId: 'a' },
  ];
  const result = computeOverrideEntropy(events, new Date('2026-03-14'));
  assert.equal(result.expiredOverrides, 1);
  assert.equal(result.activeOverrides, 1);
});

// --- Task 4: Policy effectiveness ---

console.log('\nTask 4: Policy effectiveness trend analytics');

await test('high prevention rate = effective', () => {
  const current = makeEffectivenessSnapshot(95, 5, 2);
  const result = analyzePolicyEffectiveness(current, null);
  assert.ok(result.effective);
  assert.equal(result.direction, 'stable');
  assert.equal(result.alert, null);
});

await test('low prevention rate triggers alert', () => {
  const current = makeEffectivenessSnapshot(70, 30, 0);
  const result = analyzePolicyEffectiveness(current, null);
  assert.ok(!result.effective);
  assert.ok(result.alert?.includes('Prevention rate'));
});

await test('high false positive rate triggers alert', () => {
  const current = makeEffectivenessSnapshot(90, 5, 20);
  const result = analyzePolicyEffectiveness(current, null);
  assert.ok(!result.effective);
  assert.ok(result.alert?.includes('False positive'));
});

await test('improving trend detected from previous', () => {
  const current = makeEffectivenessSnapshot(95, 5, 1);
  const previous = makeEffectivenessSnapshot(85, 15, 5);
  const result = analyzePolicyEffectiveness(current, previous);
  assert.equal(result.direction, 'improving');
  assert.ok(result.effective);
});

await test('declining trend detected from previous', () => {
  const current = makeEffectivenessSnapshot(85, 15, 5);
  const previous = makeEffectivenessSnapshot(95, 5, 1);
  const result = analyzePolicyEffectiveness(current, previous);
  assert.equal(result.direction, 'declining');
});

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
