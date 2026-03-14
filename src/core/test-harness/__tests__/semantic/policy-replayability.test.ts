/**
 * X1: Policy Replayability Layer — Test Suite
 *
 * Tests the three X1 tasks:
 * 1. Pin policy bundles by digest
 * 2. Evaluate gates from immutable input snapshots
 * 3. Emit GateDecisionPacket + decision log refs
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X1
 */

import { strict as assert } from 'node:assert';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  assemblePolicyBundle,
  computeBundleDigest,
  verifyBundleDigest,
  resolveGateMode,
  evaluateGate,
  createInputSnapshot,
  verifyInputDigest,
  computeReplayHash,
  verifyReplayConsistency,
  type PolicyBundle,
  type GateInputSnapshot,
  type InvariantCheckResult,
} from '../../index.js';
import {
  GateMode,
  GateDecision,
} from '../../../config/gate-decision-packet-schema.js';
import {
  EnforcementMode,
} from '../../../config/invariant-registry-schema.js';
import { ChangeClass } from '../../../config/change-class-matrix.js';

// ============================================================================
// SETUP / TEARDOWN
// ============================================================================

function setup() {
  setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' });
}

function teardown() {
  teardownHermeticEnv();
}

// ============================================================================
// HELPERS
// ============================================================================

function makePassingResults(): InvariantCheckResult[] {
  return [
    { invariantId: 'done_without_witness', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'cross_project_witness_reference', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'expired_waiver_allows_progress', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'missing_required_policy_bundle_digest', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'missing_required_test_provenance', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'contract_break_on_required_surface', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'insufficient_scope_completeness', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'stale_recommendation_inputs', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'confidence_below_threshold', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'suspicious_evidence_density', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
  ];
}

function makeInput(overrides?: {
  changedFiles?: string[];
  invariantResults?: InvariantCheckResult[];
}): GateInputSnapshot {
  return createInputSnapshot({
    commitSha: 'abc123def456',
    changedFiles: overrides?.changedFiles ?? ['src/core/parsers/typescript-parser.ts'],
    projectId: 'proj_test',
    invariantResults: overrides?.invariantResults ?? makePassingResults(),
    graphSnapshotDigest: 'deadbeef'.repeat(8),
  });
}

const EVAL_CONFIG = { builderId: 'watson-test-runner' };

// ============================================================================
// TESTS
// ============================================================================

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  setup();
  try {
    await fn();
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

console.log('\n=== X1: Policy Replayability Layer ===\n');

// --- Task 1: Pin policy bundles by digest ---

console.log('Task 1: Pin policy bundles by digest');

await test('assemblePolicyBundle produces non-empty digest', () => {
  const bundle = assemblePolicyBundle();
  assert.ok(bundle.digest.length === 64, 'digest should be 64-char hex SHA-256');
  assert.equal(bundle.schemaVersion, '1.0.0');
  assert.ok(bundle.invariants.definitions.length >= 10, 'should include full invariant registry');
  assert.ok(Object.keys(bundle.changeClassMatrix.definitions).length >= 5, 'should include change-class matrix');
});

await test('same config produces same digest (deterministic)', () => {
  const bundle1 = assemblePolicyBundle({ defaultGateMode: GateMode.ENFORCED });
  const bundle2 = assemblePolicyBundle({ defaultGateMode: GateMode.ENFORCED });
  assert.equal(bundle1.digest, bundle2.digest, 'same config → same digest');
});

await test('different config produces different digest', () => {
  const enforced = assemblePolicyBundle({ defaultGateMode: GateMode.ENFORCED });
  const advisory = assemblePolicyBundle({ defaultGateMode: GateMode.ADVISORY });
  assert.notEqual(enforced.digest, advisory.digest, 'different modes → different digests');
});

await test('verifyBundleDigest detects tampering', () => {
  const bundle = assemblePolicyBundle();
  assert.ok(verifyBundleDigest(bundle), 'untampered bundle should verify');
  // Tamper by creating a modified copy
  const tampered = { ...bundle, defaultGateMode: GateMode.ADVISORY };
  assert.ok(!verifyBundleDigest(tampered), 'tampered bundle should fail verification');
});

await test('resolveGateMode follows override chain', () => {
  const bundle = assemblePolicyBundle({
    defaultGateMode: GateMode.ENFORCED,
    gateModeOverrides: [
      { invariantId: 'done_without_witness', projectId: 'proj_test', mode: GateMode.ADVISORY, reason: 'test' },
      { invariantId: 'done_without_witness', projectId: null, mode: GateMode.ASSISTED, reason: 'global' },
      { invariantId: '*', projectId: null, mode: GateMode.ADVISORY, reason: 'fallback' },
    ],
  });
  // Most specific: exact invariant + exact project
  assert.equal(resolveGateMode(bundle, 'done_without_witness', 'proj_test'), GateMode.ADVISORY);
  // Less specific: exact invariant + global
  assert.equal(resolveGateMode(bundle, 'done_without_witness', 'other_project'), GateMode.ASSISTED);
  // Least specific: wildcard
  assert.equal(resolveGateMode(bundle, 'unknown_invariant', 'any_project'), GateMode.ADVISORY);
});

await test('expired overrides are ignored', () => {
  const bundle = assemblePolicyBundle({
    defaultGateMode: GateMode.ENFORCED,
    gateModeOverrides: [
      {
        invariantId: 'done_without_witness',
        projectId: null,
        mode: GateMode.ADVISORY,
        reason: 'expired',
        expiresAt: '2025-01-01T00:00:00.000Z', // in the past
      },
    ],
  });
  // Clock is frozen at 2026-03-14 — override is expired
  const now = new Date('2026-03-14T00:00:00.000Z');
  assert.equal(
    resolveGateMode(bundle, 'done_without_witness', null, now),
    GateMode.ENFORCED, // falls through to invariant's own mode
    'expired override should be ignored'
  );
});

// --- Task 2: Evaluate gates from immutable input snapshots ---

console.log('\nTask 2: Evaluate gates from immutable input snapshots');

await test('createInputSnapshot produces verifiable digest', () => {
  const input = makeInput();
  assert.ok(input.digest.length === 64);
  assert.ok(verifyInputDigest(input), 'fresh snapshot should verify');
});

await test('all invariants passing → PASS decision', () => {
  const policy = assemblePolicyBundle();
  const input = makeInput();
  const { packet, log } = evaluateGate(policy, input, EVAL_CONFIG);
  assert.equal(packet.decision, GateDecision.PASS);
  assert.equal(log.decision, GateDecision.PASS);
  assert.ok(log.reasoning.includes('PASS'));
});

await test('hard invariant failure in ENFORCED mode → FAIL', () => {
  const policy = assemblePolicyBundle();
  const results = makePassingResults();
  results[0] = { // done_without_witness
    invariantId: 'done_without_witness',
    passed: false,
    violationCount: 3,
    counterexamples: [{ taskId: 't1', taskName: 'test', projectId: 'proj_test' }],
    message: '3 tasks done without witness',
  };
  const input = makeInput({ invariantResults: results });
  const { packet, log } = evaluateGate(policy, input, EVAL_CONFIG);
  assert.equal(packet.decision, GateDecision.FAIL);
  assert.ok(log.entries.some(e => e.invariantId === 'done_without_witness' && e.action === 'block'));
});

await test('advisory invariant failure → ADVISORY_WARN (not FAIL)', () => {
  const policy = assemblePolicyBundle();
  const results = makePassingResults();
  // Fail an advisory-only invariant
  results.find(r => r.invariantId === 'suspicious_evidence_density')!.passed = false;
  results.find(r => r.invariantId === 'suspicious_evidence_density')!.violationCount = 1;
  // Use STATUS_INVARIANT_CONFIDENCE change class so C2 lane is required
  // (HEURISTIC+TASK invariants are only applicable when C2 is in scope)
  const input = makeInput({
    invariantResults: results,
    changedFiles: ['src/scripts/verify/verify-commit-audit-invariants.ts'],
  });
  const { packet, log } = evaluateGate(policy, input, EVAL_CONFIG);
  assert.equal(packet.decision, GateDecision.ADVISORY_WARN);
  assert.ok(log.entries.some(e => e.invariantId === 'suspicious_evidence_density' && e.action === 'warn'));
});

await test('change class is correctly classified and lanes assigned', () => {
  const policy = assemblePolicyBundle();
  // Status/invariant file → STATUS_INVARIANT_CONFIDENCE class
  const input = makeInput({ changedFiles: ['src/scripts/verify/verify-commit-audit-invariants.ts'] });
  const { log } = evaluateGate(policy, input, EVAL_CONFIG);
  assert.equal(log.changeClass, ChangeClass.STATUS_INVARIANT_CONFIDENCE);
  assert.ok(log.requiredLanes.includes('A'), 'should require Lane A');
  assert.ok(log.requiredLanes.includes('C2'), 'should require Lane C2');
});

// --- Task 3: Emit GateDecisionPacket + decision log refs ---

console.log('\nTask 3: Emit GateDecisionPacket + decision log refs');

await test('packet contains all required fields', () => {
  const policy = assemblePolicyBundle();
  const input = makeInput();
  const { packet } = evaluateGate(policy, input, EVAL_CONFIG);

  assert.ok(packet.policyBundleDigest, 'must have policyBundleDigest');
  assert.ok(packet.contractBundleDigest, 'must have contractBundleDigest');
  assert.ok(packet.graphSnapshotDigest, 'must have graphSnapshotDigest');
  assert.ok(packet.inputSnapshotDigest, 'must have inputSnapshotDigest');
  assert.ok(packet.decisionLogRef, 'must have decisionLogRef');
  assert.ok(packet.mode, 'must have mode');
  assert.ok(packet.provenanceRef, 'must have provenanceRef');
  assert.ok(packet.builderId === 'watson-test-runner', 'must have builderId');
  assert.ok(packet.invocationId, 'must have invocationId');
  assert.ok(packet.decidedAt, 'must have decidedAt');
  assert.ok(packet.replayHash, 'must have replayHash');
  assert.ok([GateDecision.PASS, GateDecision.FAIL, GateDecision.ADVISORY_WARN].includes(packet.decision));
});

await test('packet.policyBundleDigest matches policy.digest', () => {
  const policy = assemblePolicyBundle();
  const input = makeInput();
  const { packet } = evaluateGate(policy, input, EVAL_CONFIG);
  assert.equal(packet.policyBundleDigest, policy.digest);
});

await test('packet.inputSnapshotDigest matches input.digest', () => {
  const policy = assemblePolicyBundle();
  const input = makeInput();
  const { packet } = evaluateGate(policy, input, EVAL_CONFIG);
  assert.equal(packet.inputSnapshotDigest, input.digest);
});

await test('replay hash is deterministic for same policy+input', () => {
  const policy = assemblePolicyBundle();
  const input = makeInput();
  const { packet: p1 } = evaluateGate(policy, input, EVAL_CONFIG);
  const { packet: p2 } = evaluateGate(policy, input, EVAL_CONFIG);
  assert.equal(p1.replayHash, p2.replayHash, 'same policy+input → same replay hash');
});

await test('verifyReplayConsistency passes for identical evaluations', () => {
  const policy = assemblePolicyBundle();
  const input = makeInput();
  const { packet: p1 } = evaluateGate(policy, input, EVAL_CONFIG);
  const { packet: p2 } = evaluateGate(policy, input, EVAL_CONFIG);
  const { consistent, details } = verifyReplayConsistency(p1, p2);
  assert.ok(consistent, `should be consistent: ${details}`);
});

await test('verifyReplayConsistency fails when decision differs', () => {
  const policy = assemblePolicyBundle();
  const input = makeInput();
  const { packet: p1 } = evaluateGate(policy, input, EVAL_CONFIG);
  // Manually tamper with p2's decision
  const p2 = { ...p1, decision: GateDecision.FAIL };
  const { consistent } = verifyReplayConsistency(p1, p2);
  assert.ok(!consistent, 'different decisions should fail consistency');
});

await test('decision log has correct structure and references', () => {
  const policy = assemblePolicyBundle();
  // Use STATUS_INVARIANT_CONFIDENCE to include all invariant scopes (C1+C2)
  const input = makeInput({
    changedFiles: ['src/scripts/verify/verify-commit-audit-invariants.ts'],
  });
  const { packet, log } = evaluateGate(policy, input, EVAL_CONFIG);
  
  // Log ID should be referenced from packet
  assert.equal(packet.decisionLogRef, log.logId);
  
  // Log should have entries for all 10 invariants (C2 in scope → all applicable)
  assert.ok(log.entries.length >= 10, `expected >=10 entries, got ${log.entries.length}`);
  
  // Each entry should have required fields
  for (const entry of log.entries) {
    assert.ok(entry.invariantId, 'entry must have invariantId');
    assert.ok(entry.mode, 'entry must have mode');
    assert.ok(typeof entry.passed === 'boolean', 'entry must have passed boolean');
    assert.ok(['pass', 'warn', 'block'].includes(entry.action), 'entry must have valid action');
    assert.ok(entry.reason, 'entry must have reason');
  }
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
