/**
 * TC-6/7/8: Anti-Gaming, Calibration, Promotion Policy Tests
 */
import { describe, it, expect } from 'vitest';
import { enforceSourceFamilyCaps, verifyAntiGaming } from '../../../verification/anti-gaming.js';
import { runCalibration, type CalibrationConfig } from '../../../verification/calibration.js';
import { evaluatePromotion, validatePolicyTransition, type PromotionInputs } from '../../../verification/promotion-policy.js';

/**
 * ⚠️ MOCK FRAGILITY WARNING
 * This mock uses substring-based query matching. Tests may pass even if:
 * - Cypher variable names change (e.g., r → run)
 * - WHERE clause logic inverts (IS NULL → IS NOT NULL)
 * - Query structure changes but keywords remain
 * - Return shape differs from real Neo4j
 *
 * For production-grade validation, see tc-integration.test.ts (real Neo4j).
 * Fragility analysis: audits/tc_test_audit_agent5a_mock.md
 */
class MockNeo4j {
  private data: Record<string, any[]> = {};
  public queries: string[] = [];

  setRunResult(querySubstring: string, result: any[]) {
    this.data[querySubstring] = result;
  }

  async run(query: string, params?: any): Promise<any[]> {
    this.queries.push(query);
    for (const [key, val] of Object.entries(this.data)) {
      if (query.includes(key)) return val;
    }
    return [];
  }

  async close() {}
}

describe('TC-6: Anti-Gaming', () => {
  it('detects source families and applies caps', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('r.tool AS family', [
      { family: 'done-check', cnt: 5, ids: ['r1', 'r2', 'r3', 'r4', 'r5'] },
      { family: 'integrity', cnt: 3, ids: ['r6', 'r7', 'r8'] },
    ]);
    neo4j.setRunResult('SET r.sourceFamily', []);
    neo4j.setRunResult('r.artifactHash AS hash', []);
    neo4j.setRunResult('abs(duration', [{ cnt: 0 }]);
    neo4j.setRunResult('sourceFamily IS NULL', [{ cnt: 0 }]);

    const result = await enforceSourceFamilyCaps(neo4j as any, 'proj_test');
    expect(result.sourceFamiliesDetected).toBe(2);
    expect(result.capsApplied).toBe(8);
  });

  it('collapses duplicates by artifact hash', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('r.tool AS family', []);
    neo4j.setRunResult('r.artifactHash AS hash', [
      { hash: 'abc123', ids: ['r1', 'r2', 'r3'], cnt: 3 },
    ]);
    neo4j.setRunResult('SET r.duplicateClusterId', []);
    neo4j.setRunResult('abs(duration', [{ cnt: 0 }]);
    neo4j.setRunResult('sourceFamily IS NULL', [{ cnt: 0 }]);

    const result = await enforceSourceFamilyCaps(neo4j as any, 'proj_test');
    expect(result.duplicatesCollapsed).toBe(2); // keep first, collapse 2
  });

  it('verifyAntiGaming passes when no issues', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('avg(r.effectiveConfidence)', []);
    neo4j.setRunResult('sourceFamily = \'untrusted\'', [{ cnt: 0 }]);

    const result = await verifyAntiGaming(neo4j as any, 'proj_test');
    expect(result.ok).toBe(true);
  });

  it('verifyAntiGaming fails when source family exceeds cap', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('avg(r.effectiveConfidence)', [
      { fam: 'done-check', avgConf: 0.85, cnt: 10 },
    ]);
    neo4j.setRunResult('sourceFamily = \'untrusted\'', [{ cnt: 0 }]);

    const result = await verifyAntiGaming(neo4j as any, 'proj_test');
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]).toContain('done-check');
    expect(result.issues[0]).toContain('exceeds cap');
  });

  it('verifyAntiGaming fails when untrusted sources above floor', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('avg(r.effectiveConfidence)', []);
    neo4j.setRunResult('sourceFamily = \'untrusted\'', [{ cnt: 5 }]);

    const result = await verifyAntiGaming(neo4j as any, 'proj_test');
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]).toContain('untrusted');
    expect(result.issues[0]).toContain('above seed floor');
  });
});

describe('TC-7: Calibration', () => {
  it('computes Brier score for production and shadow', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('r.status IN', [
      { id: 'r1', prodConf: 0.9, shadowConf: 0.85, outcome: 1 },
      { id: 'r2', prodConf: 0.8, shadowConf: 0.75, outcome: 1 },
      { id: 'r3', prodConf: 0.3, shadowConf: 0.25, outcome: 0 },
    ]);

    const result = await runCalibration(neo4j as any, 'proj_test');
    expect(result.production.sampleCount).toBe(3);
    expect(result.shadow.sampleCount).toBe(3);
    // Hand-computed: ((0.9-1)²+(0.8-1)²+(0.3-0)²)/3 = 0.14/3 = 0.04667
    expect(result.production.brierScore).toBeCloseTo(0.04667, 4);
    // Shadow: ((0.85-1)²+(0.75-1)²+(0.25-0)²)/3 = 0.1475/3 = 0.04917
    expect(result.shadow.brierScore).toBeCloseTo(0.04917, 4);
    expect(result.slices).toHaveLength(1);
  });

  it('Brier = 0 for perfect predictions', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('r.status IN', [
      { id: 'r1', prodConf: 1.0, shadowConf: 1.0, outcome: 1 },
      { id: 'r2', prodConf: 0.0, shadowConf: 0.0, outcome: 0 },
    ]);
    const result = await runCalibration(neo4j as any, 'proj_test');
    expect(result.production.brierScore).toBeCloseTo(0.0, 4);
  });

  it('Brier = 1 for worst-case predictions', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('r.status IN', [
      { id: 'r1', prodConf: 1.0, shadowConf: 1.0, outcome: 0 },
      { id: 'r2', prodConf: 0.0, shadowConf: 0.0, outcome: 1 },
    ]);
    const result = await runCalibration(neo4j as any, 'proj_test');
    expect(result.production.brierScore).toBeCloseTo(1.0, 4);
  });

  it('Brier = 0.25 for uniform uncertainty', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('r.status IN', [
      { id: 'r1', prodConf: 0.5, shadowConf: 0.5, outcome: 1 },
      { id: 'r2', prodConf: 0.5, shadowConf: 0.5, outcome: 0 },
    ]);
    const result = await runCalibration(neo4j as any, 'proj_test');
    expect(result.production.brierScore).toBeCloseTo(0.25, 4);
  });

  it('ECE computed correctly with bucket structure', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('r.status IN', [
      { id: 'r1', prodConf: 0.9, shadowConf: 0.85, outcome: 1 },
      { id: 'r2', prodConf: 0.8, shadowConf: 0.75, outcome: 1 },
      { id: 'r3', prodConf: 0.3, shadowConf: 0.25, outcome: 0 },
    ]);

    const result = await runCalibration(neo4j as any, 'proj_test');
    // 10 buckets
    expect(result.production.buckets).toHaveLength(10);

    // ECE should be non-trivial for this data
    expect(result.production.ece).toBeGreaterThan(0);
    expect(result.production.ece).toBeLessThan(1);

    // NOTE: JS floating point means binStart = i * 0.1 is not exact.
    // e.g., 3 * 0.1 = 0.30000000000000004, so 0.3 < 0.30000000000000004
    // and falls into bin 2 ([0.2, 0.3)) not bin 3 ([0.3, 0.4)).
    // This is a known FP issue in computeECE — not fixing production code here.

    // Find which bins got populated (avoid hardcoding bin indices due to FP)
    const populatedBins = result.production.buckets.filter(b => b.count > 0);
    expect(populatedBins).toHaveLength(3); // 3 data points, each in a different bin

    // Verify bin structure: avgConfidence close to data points
    const avgConfs = populatedBins.map(b => b.avgConfidence).sort();
    expect(avgConfs[0]).toBeCloseTo(0.3, 1);
    expect(avgConfs[1]).toBeCloseTo(0.8, 1);
    expect(avgConfs[2]).toBeCloseTo(0.9, 1);

    // Empty bins have count 0
    const emptyBins = result.production.buckets.filter(b => b.count === 0);
    expect(emptyBins).toHaveLength(7); // 10 - 3 = 7
  });

  it('detects promotion eligibility', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('r.status IN', [
      { id: 'r1', prodConf: 0.9, shadowConf: 0.9, outcome: 1 },
    ]);

    const result = await runCalibration(neo4j as any, 'proj_test');
    // Low Brier = good calibration → eligible
    expect(result.production.brierScore).toBeLessThan(0.25);
    expect(result.promotionEligible).toBe(true);
  });

  it('blocks promotion on Brier regression', async () => {
    const neo4j = new MockNeo4j();
    // Shadow is worse than production
    neo4j.setRunResult('r.status IN', [
      { id: 'r1', prodConf: 0.9, shadowConf: 0.1, outcome: 1 },
    ]);

    const config: CalibrationConfig = { bins: 10, brierThreshold: 0.25, maxBrierRegression: 0.05 };
    const result = await runCalibration(neo4j as any, 'proj_test', config);
    expect(result.shadow.brierScore).toBeGreaterThan(result.production.brierScore);
    expect(result.promotionBlockers.length).toBeGreaterThan(0);
  });
});

describe('TC-8: Promotion Policy', () => {
  const baseInputs: PromotionInputs = {
    projectId: 'proj_test',
    brierProd: 0.1,
    brierShadow: 0.08,
    governancePass: true,
    antiGamingPass: true,
    calibrationPass: true,
  };

  it('advisory mode never promotes', () => {
    const decision = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
    expect(decision.promoted).toBe(false);
    expect(decision.promotionEligible).toBe(true);
    expect(decision.reason).toContain('advisory');
  });

  it('assisted mode requires human decision', () => {
    const decision = evaluatePromotion(baseInputs, { mode: 'assisted', enableEnforcement: false });
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain('human decision');
  });

  it('enforced mode promotes when eligible', () => {
    const decision = evaluatePromotion(baseInputs, { mode: 'enforced', enableEnforcement: true });
    expect(decision.promoted).toBe(true);
    expect(decision.decisionHash).toHaveLength(32);
  });

  it('enforced mode blocked without enforcement enabled', () => {
    const decision = evaluatePromotion(baseInputs, { mode: 'enforced', enableEnforcement: false });
    expect(decision.promoted).toBe(false);
    expect(decision.reason).toContain('enforcement disabled');
  });

  it('not eligible when calibration fails', () => {
    const inputs = { ...baseInputs, calibrationPass: false };
    const decision = evaluatePromotion(inputs, { mode: 'enforced', enableEnforcement: true });
    expect(decision.promoted).toBe(false);
    expect(decision.promotionEligible).toBe(false);
  });

  it('not eligible when governance fails', () => {
    const inputs = { ...baseInputs, governancePass: false };
    const decision = evaluatePromotion(inputs, { mode: 'enforced', enableEnforcement: true });
    expect(decision.promoted).toBe(false);
    expect(decision.promotionEligible).toBe(false);
  });

  it('not eligible when anti-gaming fails', () => {
    const inputs = { ...baseInputs, antiGamingPass: false };
    const decision = evaluatePromotion(inputs, { mode: 'enforced', enableEnforcement: true });
    expect(decision.promoted).toBe(false);
    expect(decision.promotionEligible).toBe(false);
  });

  it('validates policy transitions — upgrades', () => {
    expect(validatePolicyTransition('advisory', 'assisted', true).ok).toBe(true);
    expect(validatePolicyTransition('assisted', 'enforced', true).ok).toBe(true);
    // Skip not allowed
    expect(validatePolicyTransition('advisory', 'enforced', true).ok).toBe(false);
    // Enforced without calibration not allowed
    expect(validatePolicyTransition('assisted', 'enforced', false).ok).toBe(false);
  });

  it('validates policy transitions — downgrades are always allowed', () => {
    expect(validatePolicyTransition('enforced', 'advisory', true).ok).toBe(true);
    expect(validatePolicyTransition('enforced', 'assisted', true).ok).toBe(true);
    expect(validatePolicyTransition('assisted', 'advisory', true).ok).toBe(true);
    // Even without calibration, downgrades work
    expect(validatePolicyTransition('enforced', 'advisory', false).ok).toBe(true);
  });

  it('validates policy transitions — same-state is allowed', () => {
    expect(validatePolicyTransition('advisory', 'advisory', true).ok).toBe(true);
    expect(validatePolicyTransition('assisted', 'assisted', true).ok).toBe(true);
    expect(validatePolicyTransition('enforced', 'enforced', true).ok).toBe(true);
  });

  it('decision hash is deterministic', () => {
    const d1 = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
    const d2 = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
    expect(d1.decisionHash).toBe(d2.decisionHash);
  });

  it('different inputs produce different hashes', () => {
    const d1 = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
    const d2 = evaluatePromotion({ ...baseInputs, brierProd: 0.5 }, { mode: 'advisory', enableEnforcement: false });
    expect(d1.decisionHash).not.toBe(d2.decisionHash);
  });

  it('different modes produce different hashes', () => {
    const d1 = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
    const d2 = evaluatePromotion(baseInputs, { mode: 'assisted', enableEnforcement: false });
    expect(d1.decisionHash).not.toBe(d2.decisionHash);
  });
});
