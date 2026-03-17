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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupHermeticEnv, teardownHermeticEnv,
  assemblePolicyBundle, computeBundleDigest, verifyBundleDigest,
  resolveGateMode, evaluateGate, createInputSnapshot, verifyInputDigest,
  computeReplayHash, verifyReplayConsistency,
  type PolicyBundle, type GateInputSnapshot, type InvariantCheckResult,
} from '../../index.js';
import { GateMode, GateDecision } from '../../../config/gate-decision-packet-schema.js';
import { EnforcementMode } from '../../../config/invariant-registry-schema.js';
import { ChangeClass } from '../../../config/change-class-matrix.js';

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
    { invariantId: 'provenance_acyclicity', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'temporal_ordering', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'trust_contribution_cap', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
    { invariantId: 'evidence_saturation', passed: true, violationCount: 0, counterexamples: [], message: 'OK' },
  ];
}

function makeInput(overrides?: { changedFiles?: string[]; invariantResults?: InvariantCheckResult[] }): GateInputSnapshot {
  return createInputSnapshot({
    commitSha: 'abc123def456',
    changedFiles: overrides?.changedFiles ?? ['src/core/parsers/typescript-parser.ts'],
    projectId: 'proj_test',
    invariantResults: overrides?.invariantResults ?? makePassingResults(),
    graphSnapshotDigest: 'deadbeef'.repeat(8),
  });
}

const EVAL_CONFIG = { builderId: 'watson-test-runner' };

describe('X1: Policy Replayability Layer', () => {
  beforeEach(() => { setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' }); });
  afterEach(() => { teardownHermeticEnv(); });

  describe('Task 1: Pin policy bundles by digest', () => {
    it('assemblePolicyBundle produces non-empty digest', () => {
      const bundle = assemblePolicyBundle();
      expect(bundle.digest).toHaveLength(64);
      expect(bundle.schemaVersion).toBe('1.0.0');
      expect(bundle.invariants.definitions.length).toBeGreaterThanOrEqual(10);
      expect(Object.keys(bundle.changeClassMatrix.definitions).length).toBeGreaterThanOrEqual(5);
    });

    it('same config produces same digest (deterministic)', () => {
      const b1 = assemblePolicyBundle({ defaultGateMode: GateMode.ENFORCED });
      const b2 = assemblePolicyBundle({ defaultGateMode: GateMode.ENFORCED });
      expect(b1.digest).toBe(b2.digest);
    });

    it('different config produces different digest', () => {
      const enforced = assemblePolicyBundle({ defaultGateMode: GateMode.ENFORCED });
      const advisory = assemblePolicyBundle({ defaultGateMode: GateMode.ADVISORY });
      expect(enforced.digest).not.toBe(advisory.digest);
    });

    it('verifyBundleDigest detects tampering', () => {
      const bundle = assemblePolicyBundle();
      expect(verifyBundleDigest(bundle)).toBe(true);
      const tampered = { ...bundle, defaultGateMode: GateMode.ADVISORY };
      expect(verifyBundleDigest(tampered)).toBe(false);
    });

    it('resolveGateMode follows override chain', () => {
      const bundle = assemblePolicyBundle({
        defaultGateMode: GateMode.ENFORCED,
        gateModeOverrides: [
          { invariantId: 'done_without_witness', projectId: 'proj_test', mode: GateMode.ADVISORY, reason: 'test' },
          { invariantId: 'done_without_witness', projectId: null, mode: GateMode.ASSISTED, reason: 'global' },
          { invariantId: '*', projectId: null, mode: GateMode.ADVISORY, reason: 'fallback' },
        ],
      });
      expect(resolveGateMode(bundle, 'done_without_witness', 'proj_test')).toBe(GateMode.ADVISORY);
      expect(resolveGateMode(bundle, 'done_without_witness', 'other_project')).toBe(GateMode.ASSISTED);
      expect(resolveGateMode(bundle, 'unknown_invariant', 'any_project')).toBe(GateMode.ADVISORY);
    });

    it('expired overrides are ignored', () => {
      const bundle = assemblePolicyBundle({
        defaultGateMode: GateMode.ENFORCED,
        gateModeOverrides: [{ invariantId: 'done_without_witness', projectId: null, mode: GateMode.ADVISORY, reason: 'expired', expiresAt: '2025-01-01T00:00:00.000Z' }],
      });
      const now = new Date('2026-03-14T00:00:00.000Z');
      expect(resolveGateMode(bundle, 'done_without_witness', null, now)).toBe(GateMode.ENFORCED);
    });
  });

  describe('Task 2: Evaluate gates from immutable input snapshots', () => {
    it('createInputSnapshot produces verifiable digest', () => {
      const input = makeInput();
      expect(input.digest).toHaveLength(64);
      expect(verifyInputDigest(input)).toBe(true);
    });

    it('all invariants passing → PASS decision', () => {
      const policy = assemblePolicyBundle();
      const input = makeInput();
      const { packet, log } = evaluateGate(policy, input, EVAL_CONFIG);
      expect(packet.decision).toBe(GateDecision.PASS);
      expect(log.decision).toBe(GateDecision.PASS);
      expect(log.reasoning).toContain('PASS');
    });

    it('hard invariant failure in ENFORCED mode → FAIL', () => {
      const policy = assemblePolicyBundle();
      const results = makePassingResults();
      results[0] = { invariantId: 'done_without_witness', passed: false, violationCount: 3, counterexamples: [{ taskId: 't1', taskName: 'test', projectId: 'proj_test' }], message: '3 tasks done without witness' };
      const input = makeInput({ invariantResults: results });
      const { packet, log } = evaluateGate(policy, input, EVAL_CONFIG);
      expect(packet.decision).toBe(GateDecision.FAIL);
      expect(log.entries.some(e => e.invariantId === 'done_without_witness' && e.action === 'block')).toBe(true);
    });

    it('advisory invariant failure → ADVISORY_WARN (not FAIL)', () => {
      const policy = assemblePolicyBundle();
      const results = makePassingResults();
      results.find(r => r.invariantId === 'suspicious_evidence_density')!.passed = false;
      results.find(r => r.invariantId === 'suspicious_evidence_density')!.violationCount = 1;
      const input = makeInput({ invariantResults: results, changedFiles: ['src/scripts/verify/verify-commit-audit-invariants.ts'] });
      const { packet, log } = evaluateGate(policy, input, EVAL_CONFIG);
      expect(packet.decision).toBe(GateDecision.ADVISORY_WARN);
      expect(log.entries.some(e => e.invariantId === 'suspicious_evidence_density' && e.action === 'warn')).toBe(true);
    });

    it('change class is correctly classified and lanes assigned', () => {
      const policy = assemblePolicyBundle();
      const input = makeInput({ changedFiles: ['src/scripts/verify/verify-commit-audit-invariants.ts'] });
      const { log } = evaluateGate(policy, input, EVAL_CONFIG);
      expect(log.changeClass).toBe(ChangeClass.STATUS_INVARIANT_CONFIDENCE);
      expect(log.requiredLanes).toContain('A');
      expect(log.requiredLanes).toContain('C2');
    });
  });

  describe('Task 3: Emit GateDecisionPacket + decision log refs', () => {
    it('packet contains all required fields', () => {
      const policy = assemblePolicyBundle();
      const input = makeInput();
      const { packet } = evaluateGate(policy, input, EVAL_CONFIG);
      expect(packet.policyBundleDigest).toBeTruthy();
      expect(packet.contractBundleDigest).toBeTruthy();
      expect(packet.graphSnapshotDigest).toBeTruthy();
      expect(packet.inputSnapshotDigest).toBeTruthy();
      expect(packet.decisionLogRef).toBeTruthy();
      expect(packet.mode).toBeTruthy();
      expect(packet.provenanceRef).toBeTruthy();
      expect(packet.builderId).toBe('watson-test-runner');
      expect(packet.invocationId).toBeTruthy();
      expect(packet.decidedAt).toBeTruthy();
      expect(packet.replayHash).toBeTruthy();
      expect([GateDecision.PASS, GateDecision.FAIL, GateDecision.ADVISORY_WARN]).toContain(packet.decision);
    });

    it('packet.policyBundleDigest matches policy.digest', () => {
      const policy = assemblePolicyBundle();
      const input = makeInput();
      const { packet } = evaluateGate(policy, input, EVAL_CONFIG);
      expect(packet.policyBundleDigest).toBe(policy.digest);
    });

    it('packet.inputSnapshotDigest matches input.digest', () => {
      const policy = assemblePolicyBundle();
      const input = makeInput();
      const { packet } = evaluateGate(policy, input, EVAL_CONFIG);
      expect(packet.inputSnapshotDigest).toBe(input.digest);
    });

    it('replay hash is deterministic for same policy+input', () => {
      const policy = assemblePolicyBundle();
      const input = makeInput();
      const { packet: p1 } = evaluateGate(policy, input, EVAL_CONFIG);
      const { packet: p2 } = evaluateGate(policy, input, EVAL_CONFIG);
      expect(p1.replayHash).toBe(p2.replayHash);
    });

    it('verifyReplayConsistency passes for identical evaluations', () => {
      const policy = assemblePolicyBundle();
      const input = makeInput();
      const { packet: p1 } = evaluateGate(policy, input, EVAL_CONFIG);
      const { packet: p2 } = evaluateGate(policy, input, EVAL_CONFIG);
      const { consistent } = verifyReplayConsistency(p1, p2);
      expect(consistent).toBe(true);
    });

    it('verifyReplayConsistency fails when decision differs', () => {
      const policy = assemblePolicyBundle();
      const input = makeInput();
      const { packet: p1 } = evaluateGate(policy, input, EVAL_CONFIG);
      const p2 = { ...p1, decision: GateDecision.FAIL };
      const { consistent } = verifyReplayConsistency(p1, p2);
      expect(consistent).toBe(false);
    });

    it('decision log has correct structure and references', () => {
      const policy = assemblePolicyBundle();
      const input = makeInput({ changedFiles: ['src/scripts/verify/verify-commit-audit-invariants.ts'] });
      const { packet, log } = evaluateGate(policy, input, EVAL_CONFIG);
      expect(packet.decisionLogRef).toBe(log.logId);
      expect(log.entries.length).toBeGreaterThanOrEqual(10);
      for (const entry of log.entries) {
        expect(entry.invariantId).toBeTruthy();
        expect(entry.mode).toBeTruthy();
        expect(typeof entry.passed).toBe('boolean');
        expect(['pass', 'warn', 'block']).toContain(entry.action);
        expect(entry.reason).toBeTruthy();
      }
    });
  });
});
