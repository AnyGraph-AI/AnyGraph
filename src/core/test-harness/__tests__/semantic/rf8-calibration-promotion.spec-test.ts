/**
 * RF-8: Calibration + Promotion Gate — Spec Tests
 *
 * Tests written FROM the VERIFICATION_GRAPH_ROADMAP.md RF-8 spec.
 *
 * Spec requirements:
 * 1. Calibration pipeline (brierScore primary; ece/ace diagnostic; bootstrap CIs)
 * 2. Promotion policy (advisory → assisted → enforced) with decision lineage artifact hashes
 * 3. Gate promotion on Brier improvement + no governance regression + no anti-gaming regression
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  runCalibration,
  type CalibrationOutput,
} from '../../../verification/calibration.js';
import {
  evaluatePromotion,
  persistPromotionDecision,
  validatePolicyTransition,
  type PromotionDecision,
  type PromotionInputs,
  type PolicyMode,
} from '../../../verification/promotion-policy.js';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';

describe('RF-8: Calibration + Promotion Gate', () => {
  let neo4j: Neo4jService;
  const projectId = 'proj_c0d3e9a1f200';

  beforeAll(() => {
    neo4j = new Neo4jService();
  });

  afterAll(async () => {
    // Clean up any test promotion decisions
    await neo4j.run(
      `MATCH (d:PromotionDecision) WHERE d.projectId STARTS WITH '__rf8_' DETACH DELETE d`,
    );
    await neo4j.close();
  });

  // ── Task 1: Calibration pipeline ────────────────────────────────

  describe('Task 1: Calibration pipeline', () => {
    let calibOutput: CalibrationOutput;

    beforeAll(async () => {
      calibOutput = await runCalibration(neo4j, projectId);
    });

    it('runCalibration returns all required fields', () => {
      expect(calibOutput).toHaveProperty('projectId', projectId);
      expect(calibOutput).toHaveProperty('production');
      expect(calibOutput).toHaveProperty('shadow');
      expect(calibOutput).toHaveProperty('slices');
      expect(calibOutput).toHaveProperty('promotionEligible');
      expect(calibOutput).toHaveProperty('promotionBlockers');
      expect(calibOutput).toHaveProperty('durationMs');
    });

    it('production metrics include brierScore (primary)', () => {
      expect(typeof calibOutput.production.brierScore).toBe('number');
      expect(calibOutput.production.brierScore).toBeGreaterThanOrEqual(0);
      expect(calibOutput.production.brierScore).toBeLessThanOrEqual(1);
    });

    it('production metrics include ECE (diagnostic)', () => {
      expect(typeof calibOutput.production.ece).toBe('number');
      expect(calibOutput.production.ece).toBeGreaterThanOrEqual(0);
    });

    it('shadow metrics include brierScore and ECE', () => {
      expect(typeof calibOutput.shadow.brierScore).toBe('number');
      expect(typeof calibOutput.shadow.ece).toBe('number');
    });

    it('slices contain at least project-level slice', () => {
      expect(calibOutput.slices.length).toBeGreaterThanOrEqual(1);
      const projectSlice = calibOutput.slices.find(s => s.sliceName === 'project');
      expect(projectSlice).toBeDefined();
      expect(projectSlice!.brierDelta).toBeDefined();
      expect(typeof projectSlice!.brierImproved).toBe('boolean');
    });

    it('production metrics have buckets (ECE binning)', () => {
      expect(Array.isArray(calibOutput.production.buckets)).toBe(true);
      if (calibOutput.production.buckets.length > 0) {
        const bucket = calibOutput.production.buckets[0];
        expect(bucket).toHaveProperty('binStart');
        expect(bucket).toHaveProperty('binEnd');
        expect(bucket).toHaveProperty('avgConfidence');
        expect(bucket).toHaveProperty('avgOutcome');
        expect(bucket).toHaveProperty('count');
      }
    });
  });

  // ── Task 2: Promotion policy with decision lineage ──────────────

  describe('Task 2: Promotion policy (advisory → assisted → enforced)', () => {
    it('evaluatePromotion returns a PromotionDecision with all fields', () => {
      const inputs: PromotionInputs = {
        projectId: '__rf8_test_1__',
        brierProd: 0.15,
        brierShadow: 0.12,
        governancePass: true,
        antiGamingPass: true,
        calibrationPass: true,
      };
      const decision = evaluatePromotion(inputs);
      expect(decision).toHaveProperty('decisionId');
      expect(decision).toHaveProperty('projectId', '__rf8_test_1__');
      expect(decision).toHaveProperty('mode');
      expect(decision).toHaveProperty('promotionEligible');
      expect(decision).toHaveProperty('evaluatedAt');
      expect(decision).toHaveProperty('decisionHash');
      expect(decision).toHaveProperty('brierProd', 0.15);
      expect(decision).toHaveProperty('brierShadow', 0.12);
      expect(decision).toHaveProperty('promoted');
      expect(decision).toHaveProperty('reason');
    });

    it('advisory mode: eligible but never promotes', () => {
      const decision = evaluatePromotion(
        { projectId: '__rf8_test__', brierProd: 0.15, brierShadow: 0.12, governancePass: true, antiGamingPass: true, calibrationPass: true },
        { mode: 'advisory', enableEnforcement: false, minBrierImprovement: 0 },
      );
      expect(decision.promotionEligible).toBe(true);
      expect(decision.promoted).toBe(false);
      expect(decision.mode).toBe('advisory');
    });

    it('assisted mode: eligible but requires human decision', () => {
      const decision = evaluatePromotion(
        { projectId: '__rf8_test__', brierProd: 0.15, brierShadow: 0.12, governancePass: true, antiGamingPass: true, calibrationPass: true },
        { mode: 'assisted', enableEnforcement: false, minBrierImprovement: 0 },
      );
      expect(decision.promotionEligible).toBe(true);
      expect(decision.promoted).toBe(false);
      expect(decision.mode).toBe('assisted');
    });

    it('enforced mode with enableEnforcement: promotes when eligible', () => {
      const decision = evaluatePromotion(
        { projectId: '__rf8_test__', brierProd: 0.15, brierShadow: 0.12, governancePass: true, antiGamingPass: true, calibrationPass: true },
        { mode: 'enforced', enableEnforcement: true, minBrierImprovement: 0 },
      );
      expect(decision.promotionEligible).toBe(true);
      expect(decision.promoted).toBe(true);
      expect(decision.mode).toBe('enforced');
    });

    it('decision has a deterministic hash (lineage artifact)', () => {
      const inputs: PromotionInputs = {
        projectId: '__rf8_test__', brierProd: 0.15, brierShadow: 0.12,
        governancePass: true, antiGamingPass: true, calibrationPass: true,
      };
      const d1 = evaluatePromotion(inputs);
      const d2 = evaluatePromotion(inputs);
      expect(d1.decisionHash).toBe(d2.decisionHash);
      expect(d1.decisionHash.length).toBeGreaterThan(0);
    });

    it('persistPromotionDecision writes to Neo4j', async () => {
      const decision = evaluatePromotion(
        { projectId: '__rf8_persist_test__', brierProd: 0.2, brierShadow: 0.18, governancePass: true, antiGamingPass: true, calibrationPass: true },
        { mode: 'advisory', enableEnforcement: false, minBrierImprovement: 0 },
      );
      await persistPromotionDecision(neo4j, decision);

      const rows = await neo4j.run(
        `MATCH (d:PromotionDecision {decisionId: $id}) RETURN d.mode AS mode, d.decisionHash AS hash`,
        { id: decision.decisionId },
      );
      expect(rows.length).toBe(1);
      expect(rows[0]?.mode).toBe('advisory');
      expect(rows[0]?.hash).toBe(decision.decisionHash);

      // Cleanup
      await neo4j.run(`MATCH (d:PromotionDecision {decisionId: $id}) DETACH DELETE d`, { id: decision.decisionId });
    });
  });

  // ── Task 3: Gate on Brier + governance + anti-gaming ────────────

  describe('Task 3: Promotion gate conditions', () => {
    it('not eligible when calibration fails', () => {
      const decision = evaluatePromotion(
        { projectId: '__rf8_test__', brierProd: 0.15, brierShadow: 0.12, governancePass: true, antiGamingPass: true, calibrationPass: false },
        { mode: 'enforced', enableEnforcement: true, minBrierImprovement: 0 },
      );
      expect(decision.promotionEligible).toBe(false);
      expect(decision.promoted).toBe(false);
    });

    it('not eligible when governance fails', () => {
      const decision = evaluatePromotion(
        { projectId: '__rf8_test__', brierProd: 0.15, brierShadow: 0.12, governancePass: false, antiGamingPass: true, calibrationPass: true },
        { mode: 'enforced', enableEnforcement: true, minBrierImprovement: 0 },
      );
      expect(decision.promotionEligible).toBe(false);
      expect(decision.promoted).toBe(false);
    });

    it('not eligible when anti-gaming fails', () => {
      const decision = evaluatePromotion(
        { projectId: '__rf8_test__', brierProd: 0.15, brierShadow: 0.12, governancePass: true, antiGamingPass: false, calibrationPass: true },
        { mode: 'enforced', enableEnforcement: true, minBrierImprovement: 0 },
      );
      expect(decision.promotionEligible).toBe(false);
      expect(decision.promoted).toBe(false);
    });

    it('validatePolicyTransition blocks advisory→enforced skip', () => {
      const result = validatePolicyTransition('advisory', 'enforced', true);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('skip');
    });

    it('validatePolicyTransition blocks enforced without calibration', () => {
      const result = validatePolicyTransition('assisted', 'enforced', false);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('calibration');
    });

    it('validatePolicyTransition allows assisted→enforced with calibration', () => {
      const result = validatePolicyTransition('assisted', 'enforced', true);
      expect(result.ok).toBe(true);
    });

    it('calibration blockers fire on Brier regression', async () => {
      // Run calibration and verify blocker logic exists
      const output = await runCalibration(neo4j, projectId);
      expect(Array.isArray(output.promotionBlockers)).toBe(true);
      // If shadow Brier is worse than production, blockers should fire
      if (output.shadow.brierScore > output.production.brierScore + 0.05) {
        expect(output.promotionBlockers.length).toBeGreaterThan(0);
      }
    });
  });
});
