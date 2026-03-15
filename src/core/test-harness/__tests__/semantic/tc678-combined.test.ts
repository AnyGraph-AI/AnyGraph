/**
 * TC-6/7/8: Anti-Gaming, Calibration, Promotion Policy Tests
 */
import { describe, it, expect } from 'vitest';
import { enforceSourceFamilyCaps, verifyAntiGaming } from '../../../verification/anti-gaming.js';
import { runCalibration, type CalibrationConfig } from '../../../verification/calibration.js';
import { evaluatePromotion, validatePolicyTransition, type PromotionInputs } from '../../../verification/promotion-policy.js';

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
    expect(result.production.brierScore).toBeGreaterThan(0);
    expect(result.slices).toHaveLength(1);
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

  it('validates policy transitions', () => {
    expect(validatePolicyTransition('advisory', 'assisted', true).ok).toBe(true);
    expect(validatePolicyTransition('assisted', 'enforced', true).ok).toBe(true);
    expect(validatePolicyTransition('advisory', 'enforced', true).ok).toBe(false);
    expect(validatePolicyTransition('assisted', 'enforced', false).ok).toBe(false);
  });

  it('decision hash is deterministic', () => {
    const d1 = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
    const d2 = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
    expect(d1.decisionHash).toBe(d2.decisionHash);
  });
});
