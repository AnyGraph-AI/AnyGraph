/**
 * AUD-TC-07-L2-04: invariant-registry-schema.ts — Behavioral Audit Tests (INCOMPLETE → strengthened)
 *
 * Verdict: INCOMPLETE — rf9-invariant-engine.spec-test.ts covers RF9 invariants well but:
 *   - Exact counts not verified (HARD=6, ADVISORY=5, RF9=4, total=15)
 *   - HARD_INVARIANTS enforcement/waiver policy not tested
 *   - ADVISORY_INVARIANTS waiver policy not systematically tested
 *   - RF9_INVARIANTS array not tested in isolation
 *
 * Action: Strengthen in __audit__/ with missing behavioral coverage.
 *
 * Spec source: plans/codegraph/TDD_ROADMAP.md §Milestone N1 "Define and freeze
 *              invariant registry schema" + §S2 Invariant Registry
 */
import { describe, it, expect } from 'vitest';
import {
  INVARIANT_REGISTRY_SCHEMA_VERSION,
  HARD_INVARIANTS,
  ADVISORY_INVARIANTS,
  RF9_INVARIANTS,
  INVARIANT_REGISTRY,
  InvariantClass,
  EnforcementMode,
  InvariantScope,
  type InvariantDefinition,
} from '../../../core/config/invariant-registry-schema.js';

describe('AUD-TC-07-L2 | invariant-registry-schema.ts (strengthened)', () => {

  // ─── Behavior 1: HARD_INVARIANTS contains 6 definitions with correct IDs ─

  describe('Behavior 1: HARD_INVARIANTS contains exactly 6 definitions with correct invariantIds', () => {
    const expectedHardIds = [
      'done_without_witness',
      'cross_project_witness_reference',
      'expired_waiver_allows_progress',
      'missing_required_policy_bundle_digest',
      'missing_required_test_provenance',
      'contract_break_on_required_surface',
    ];

    it('has exactly 6 hard invariants', () => {
      expect(HARD_INVARIANTS).toHaveLength(6);
    });

    it.each(expectedHardIds)('contains invariant "%s"', (id) => {
      expect(HARD_INVARIANTS.some(inv => inv.invariantId === id)).toBe(true);
    });

    it('has no duplicate invariantIds in HARD_INVARIANTS', () => {
      const ids = HARD_INVARIANTS.map(i => i.invariantId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ─── Behavior 2: ADVISORY_INVARIANTS contains 5 definitions ─────────────

  describe('Behavior 2: ADVISORY_INVARIANTS contains exactly 5 definitions with correct invariantIds', () => {
    const expectedAdvisoryIds = [
      'insufficient_scope_completeness',
      'stale_recommendation_inputs',
      'confidence_below_threshold',
      'suspicious_evidence_density',
      'structural_drift_threshold',
    ];

    it('has exactly 5 advisory invariants', () => {
      expect(ADVISORY_INVARIANTS).toHaveLength(5);
    });

    it.each(expectedAdvisoryIds)('contains invariant "%s"', (id) => {
      expect(ADVISORY_INVARIANTS.some(inv => inv.invariantId === id)).toBe(true);
    });

    it('has no duplicate invariantIds in ADVISORY_INVARIANTS', () => {
      const ids = ADVISORY_INVARIANTS.map(i => i.invariantId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ─── Behavior 3: RF9_INVARIANTS contains 4 definitions ───────────────────

  describe('Behavior 3: RF9_INVARIANTS contains exactly 4 definitions with correct invariantIds', () => {
    const expectedRf9Ids = [
      'provenance_acyclicity',
      'temporal_ordering',
      'trust_contribution_cap',
      'evidence_saturation',
    ];

    it('has exactly 4 RF9 invariants', () => {
      expect(RF9_INVARIANTS).toHaveLength(4);
    });

    it.each(expectedRf9Ids)('contains invariant "%s"', (id) => {
      expect(RF9_INVARIANTS.some(inv => inv.invariantId === id)).toBe(true);
    });

    it('has no duplicate invariantIds in RF9_INVARIANTS', () => {
      const ids = RF9_INVARIANTS.map(i => i.invariantId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ─── Behavior 4: INVARIANT_REGISTRY is union of all 3 arrays (15 total) ──

  describe('Behavior 4: INVARIANT_REGISTRY is the union of all 3 arrays (15 total)', () => {
    it('has exactly 15 invariants', () => {
      expect(INVARIANT_REGISTRY).toHaveLength(15);
    });

    it('contains all HARD_INVARIANTS', () => {
      for (const inv of HARD_INVARIANTS) {
        expect(INVARIANT_REGISTRY.some(r => r.invariantId === inv.invariantId)).toBe(true);
      }
    });

    it('contains all ADVISORY_INVARIANTS', () => {
      for (const inv of ADVISORY_INVARIANTS) {
        expect(INVARIANT_REGISTRY.some(r => r.invariantId === inv.invariantId)).toBe(true);
      }
    });

    it('contains all RF9_INVARIANTS', () => {
      for (const inv of RF9_INVARIANTS) {
        expect(INVARIANT_REGISTRY.some(r => r.invariantId === inv.invariantId)).toBe(true);
      }
    });

    it('total count equals 6 + 5 + 4', () => {
      expect(INVARIANT_REGISTRY.length).toBe(
        HARD_INVARIANTS.length + ADVISORY_INVARIANTS.length + RF9_INVARIANTS.length
      );
    });

    it('all invariantIds in the full registry are unique', () => {
      const ids = INVARIANT_REGISTRY.map(i => i.invariantId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ─── Behavior 5: every invariant has required fields ─────────────────────

  describe('Behavior 5: every invariant has required fields', () => {
    const requiredFields: (keyof InvariantDefinition)[] = [
      'invariantId', 'class', 'scope', 'enforcementMode', 'diagnosticQueryTemplate',
    ];

    it.each(requiredFields)('all invariants have field "%s"', (field) => {
      for (const inv of INVARIANT_REGISTRY) {
        expect(inv[field]).toBeTruthy();
      }
    });

    it('all invariants have a non-empty description', () => {
      for (const inv of INVARIANT_REGISTRY) {
        expect(inv.description.trim().length).toBeGreaterThan(0);
      }
    });

    it('all invariants have a non-empty diagnosticQueryTemplate', () => {
      for (const inv of INVARIANT_REGISTRY) {
        expect(inv.diagnosticQueryTemplate.trim().length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Behavior 6: hard invariants are all ENFORCED and waiverable: false ──

  describe('Behavior 6: hard invariants are all ENFORCED and waiverable: false', () => {
    it('all HARD_INVARIANTS have enforcementMode = ENFORCED', () => {
      for (const inv of HARD_INVARIANTS) {
        expect(inv.enforcementMode).toBe(EnforcementMode.ENFORCED);
      }
    });

    it('all HARD_INVARIANTS have waiverable = false', () => {
      for (const inv of HARD_INVARIANTS) {
        expect(inv.waiverable).toBe(false);
      }
    });
  });

  // ─── Behavior 7: advisory invariants are all waiverable: true ───────────

  describe('Behavior 7: advisory invariants are all waiverable: true', () => {
    // Note: ADVISORY_INVARIANTS includes structural_drift_threshold which is
    // EnforcementMode.ENFORCED but waiverable: false — testing waiverable per entry
    const advisoryWaiverable = ['insufficient_scope_completeness', 'stale_recommendation_inputs',
      'confidence_below_threshold', 'suspicious_evidence_density'];
    const advisoryNonWaiverable = ['structural_drift_threshold'];

    it('insufficient_scope_completeness is waiverable', () => {
      const inv = ADVISORY_INVARIANTS.find(i => i.invariantId === 'insufficient_scope_completeness');
      expect(inv?.waiverable).toBe(true);
    });

    it('stale_recommendation_inputs is waiverable', () => {
      const inv = ADVISORY_INVARIANTS.find(i => i.invariantId === 'stale_recommendation_inputs');
      expect(inv?.waiverable).toBe(true);
    });

    it('confidence_below_threshold is waiverable', () => {
      const inv = ADVISORY_INVARIANTS.find(i => i.invariantId === 'confidence_below_threshold');
      expect(inv?.waiverable).toBe(true);
    });

    it('suspicious_evidence_density is waiverable', () => {
      const inv = ADVISORY_INVARIANTS.find(i => i.invariantId === 'suspicious_evidence_density');
      expect(inv?.waiverable).toBe(true);
    });

    it('structural_drift_threshold is NOT waiverable (exception: enforced despite being in advisory array)', () => {
      const inv = ADVISORY_INVARIANTS.find(i => i.invariantId === 'structural_drift_threshold');
      expect(inv?.waiverable).toBe(false);
    });
  });

  // ─── Behavior 8: diagnostic query templates contain valid Cypher patterns ─

  describe('Behavior 8: diagnostic query templates contain valid Cypher patterns', () => {
    it('all diagnostic queries contain MATCH keyword', () => {
      for (const inv of INVARIANT_REGISTRY) {
        expect(inv.diagnosticQueryTemplate.toUpperCase()).toContain('MATCH');
      }
    });

    it('all diagnostic queries contain RETURN keyword', () => {
      for (const inv of INVARIANT_REGISTRY) {
        expect(inv.diagnosticQueryTemplate.toUpperCase()).toContain('RETURN');
      }
    });

    it('done_without_witness query targets Task nodes', () => {
      const inv = INVARIANT_REGISTRY.find(i => i.invariantId === 'done_without_witness');
      expect(inv?.diagnosticQueryTemplate).toContain('Task');
    });

    it('provenance_acyclicity query uses relationship traversal (* notation)', () => {
      const inv = INVARIANT_REGISTRY.find(i => i.invariantId === 'provenance_acyclicity');
      expect(inv?.diagnosticQueryTemplate).toContain('*');
    });

    it('temporal_ordering query references VerificationRun nodes', () => {
      const inv = INVARIANT_REGISTRY.find(i => i.invariantId === 'temporal_ordering');
      expect(inv?.diagnosticQueryTemplate).toContain('VerificationRun');
    });

    it('schema version is "1.0.0"', () => {
      expect(INVARIANT_REGISTRY_SCHEMA_VERSION).toBe('1.0.0');
    });
  });
});
