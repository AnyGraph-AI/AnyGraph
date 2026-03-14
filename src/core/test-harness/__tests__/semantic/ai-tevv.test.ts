/**
 * L2: AI TEVV Full Lane — Test Suite
 *
 * Tests the three L2 tasks:
 * 1. Public canary + private promotion + adversarial eval sets
 * 2. Per-hazard thresholds
 * 3. Lineage-gated promotion
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L2
 */

import { strict as assert } from 'node:assert';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  runEvalCase,
  runEvalSet,
  evaluatePromotion,
  DEFAULT_HAZARD_THRESHOLDS,
  NL_TO_CYPHER_CANARY,
  NL_TO_CYPHER_ADVERSARIAL,
  type EvalCase,
  type EvalResult,
  type HazardThreshold,
} from '../../index.js';

// ============================================================================
// HELPERS
// ============================================================================

function setup() {
  setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' });
}

function teardown() {
  teardownHermeticEnv();
}

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

console.log('\n=== L2: AI TEVV Full Lane ===\n');

// --- Task 1: Eval set tiers ---

console.log('Task 1: Public canary + private promotion + adversarial eval sets');

await test('canary eval set has correct structure', () => {
  assert.ok(NL_TO_CYPHER_CANARY.length >= 3, 'should have at least 3 canary cases');
  for (const c of NL_TO_CYPHER_CANARY) {
    assert.equal(c.tier, 'public_canary');
    assert.ok(c.caseId, 'must have caseId');
    assert.ok(c.hazardClass, 'must have hazardClass');
    assert.ok(c.input, 'must have input');
    assert.ok(c.expected.mode, 'must have expected mode');
    assert.ok(c.expected.value, 'must have expected value');
  }
});

await test('adversarial eval set has correct structure', () => {
  assert.ok(NL_TO_CYPHER_ADVERSARIAL.length >= 3, 'should have at least 3 adversarial cases');
  for (const c of NL_TO_CYPHER_ADVERSARIAL) {
    assert.equal(c.tier, 'adversarial');
    assert.ok(['harmful_output', 'privacy_leak', 'fabrication'].includes(c.hazardClass));
  }
});

await test('runEvalCase: contains match passes correctly', () => {
  const evalCase: EvalCase = {
    caseId: 'test_contains',
    tier: 'public_canary',
    hazardClass: 'fabrication',
    input: 'test query',
    expected: { mode: 'contains', value: 'MATCH' },
    description: 'test',
    tags: [],
  };
  const result = runEvalCase(evalCase, 'MATCH (n) RETURN n');
  assert.ok(result.passed);
  assert.ok(result.matchDetails.includes('Contains'));
});

await test('runEvalCase: not_contains blocks forbidden output', () => {
  const evalCase: EvalCase = {
    caseId: 'test_notcontains',
    tier: 'adversarial',
    hazardClass: 'harmful_output',
    input: 'drop everything',
    expected: { mode: 'not_contains', value: 'DELETE' },
    description: 'test',
    tags: [],
  };
  // Should pass when DELETE is absent
  assert.ok(runEvalCase(evalCase, 'MATCH (n) RETURN n').passed);
  // Should fail when DELETE is present
  assert.ok(!runEvalCase(evalCase, 'MATCH (n) DELETE n').passed);
});

await test('runEvalCase: regex match works', () => {
  const evalCase: EvalCase = {
    caseId: 'test_regex',
    tier: 'public_canary',
    hazardClass: 'fabrication',
    input: 'test',
    expected: { mode: 'regex', value: 'MATCH.*RETURN' },
    description: 'test',
    tags: [],
  };
  assert.ok(runEvalCase(evalCase, 'MATCH (n) RETURN n').passed);
  assert.ok(!runEvalCase(evalCase, 'SELECT * FROM nodes').passed);
});

await test('runEvalSet: aggregates results correctly', () => {
  const cases: EvalCase[] = [
    { caseId: 'c1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
    { caseId: 'c2', tier: 'public_canary', hazardClass: 'fabrication', input: 'b', expected: { mode: 'contains', value: 'y' }, description: '', tags: [] },
    { caseId: 'c3', tier: 'public_canary', hazardClass: 'hallucination', input: 'c', expected: { mode: 'contains', value: 'z' }, description: '', tags: [] },
  ];
  const outputs = new Map([['c1', 'has x'], ['c2', 'no match'], ['c3', 'has z']]);
  const result = runEvalSet(cases, outputs);

  assert.equal(result.totalCases, 3);
  assert.equal(result.passed, 2);
  assert.equal(result.failed, 1);
  assert.ok(Math.abs(result.passRate - 2/3) < 0.01);
  assert.equal(result.failedCases.length, 1);
  assert.equal(result.failedCases[0].caseId, 'c2');
});

// --- Task 2: Per-hazard thresholds ---

console.log('\nTask 2: Per-hazard thresholds');

await test('default thresholds cover all 5 hazard categories', () => {
  assert.equal(DEFAULT_HAZARD_THRESHOLDS.length, 5);
  const categories = DEFAULT_HAZARD_THRESHOLDS.map(t => t.hazardClass);
  assert.ok(categories.includes('fabrication'));
  assert.ok(categories.includes('hallucination'));
  assert.ok(categories.includes('harmful_output'));
  assert.ok(categories.includes('bias_discrimination'));
  assert.ok(categories.includes('privacy_leak'));
});

await test('fabrication and harmful_output require 100% pass rate', () => {
  const fab = DEFAULT_HAZARD_THRESHOLDS.find(t => t.hazardClass === 'fabrication')!;
  const harm = DEFAULT_HAZARD_THRESHOLDS.find(t => t.hazardClass === 'harmful_output')!;
  assert.equal(fab.minPassRate, 1.0);
  assert.equal(fab.maxFailures, 0);
  assert.equal(harm.minPassRate, 1.0);
  assert.equal(harm.maxFailures, 0);
});

await test('all default thresholds block promotion', () => {
  for (const t of DEFAULT_HAZARD_THRESHOLDS) {
    assert.ok(t.blocksPromotion, `${t.hazardClass} should block promotion`);
  }
});

// --- Task 3: Lineage-gated promotion ---

console.log('\nTask 3: Lineage-gated promotion');

await test('all passing → promotion approved', () => {
  const cases: EvalCase[] = [
    { caseId: 'p1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
    { caseId: 'p2', tier: 'public_canary', hazardClass: 'hallucination', input: 'b', expected: { mode: 'contains', value: 'y' }, description: '', tags: [] },
  ];
  const results: EvalResult[] = [
    { caseId: 'p1', passed: true, actualOutput: 'x', matchDetails: 'ok', durationMs: 1, evaluatedAt: '' },
    { caseId: 'p2', passed: true, actualOutput: 'y', matchDetails: 'ok', durationMs: 1, evaluatedAt: '' },
  ];
  const decision = evaluatePromotion(results, cases);
  assert.ok(decision.approved);
  assert.equal(decision.blockingHazards.length, 0);
  assert.ok(decision.lineageDigest.length === 64);
});

await test('fabrication failure → promotion blocked', () => {
  const cases: EvalCase[] = [
    { caseId: 'f1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
  ];
  const results: EvalResult[] = [
    { caseId: 'f1', passed: false, actualOutput: 'wrong', matchDetails: 'no match', durationMs: 1, evaluatedAt: '' },
  ];
  const decision = evaluatePromotion(results, cases);
  assert.ok(!decision.approved);
  assert.ok(decision.blockingHazards.includes('fabrication'));
  assert.ok(decision.reasoning.includes('BLOCKED'));
});

await test('hallucination within tolerance → promotion approved', () => {
  const cases: EvalCase[] = [];
  const results: EvalResult[] = [];
  // 20 cases, 1 failure = 95% pass rate (threshold is 95%, max 2 failures)
  for (let i = 0; i < 20; i++) {
    cases.push({ caseId: `h${i}`, tier: 'public_canary', hazardClass: 'hallucination', input: `q${i}`, expected: { mode: 'contains', value: 'x' }, description: '', tags: [] });
    results.push({ caseId: `h${i}`, passed: i !== 5, actualOutput: i === 5 ? 'bad' : 'x', matchDetails: '', durationMs: 1, evaluatedAt: '' });
  }
  const decision = evaluatePromotion(results, cases);
  assert.ok(decision.approved, `Expected approved but got: ${decision.reasoning}`);
});

await test('lineage digest is deterministic for same results', () => {
  const cases: EvalCase[] = [
    { caseId: 'd1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
  ];
  const results: EvalResult[] = [
    { caseId: 'd1', passed: true, actualOutput: 'x', matchDetails: 'ok', durationMs: 1, evaluatedAt: '' },
  ];
  const d1 = evaluatePromotion(results, cases);
  const d2 = evaluatePromotion(results, cases);
  assert.equal(d1.lineageDigest, d2.lineageDigest, 'same inputs → same lineage digest');
});

await test('custom thresholds override defaults', () => {
  const relaxed: HazardThreshold[] = [
    { hazardClass: 'fabrication', minPassRate: 0.5, maxFailures: 10, blocksPromotion: false },
  ];
  const cases: EvalCase[] = [
    { caseId: 'r1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
  ];
  const results: EvalResult[] = [
    { caseId: 'r1', passed: false, actualOutput: 'nope', matchDetails: 'fail', durationMs: 1, evaluatedAt: '' },
  ];
  const decision = evaluatePromotion(results, cases, relaxed);
  // 0% pass rate < 50% threshold, but blocksPromotion=false
  assert.ok(decision.approved, 'non-blocking threshold should not block');
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
