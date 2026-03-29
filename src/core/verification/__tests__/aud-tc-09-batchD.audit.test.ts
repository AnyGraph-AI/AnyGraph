/**
 * [aud-tc-09] Batch D — direct behavioral tests
 *
 * Health Witness B6: shadow-propagation, explainability-paths, promotion-policy
 * Anti-gaming: no source-string-match, no reimplemented logic, no Cypher assertions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runShadowPropagation,
  verifyShadowIsolation,
  type ShadowPropagationConfig,
  type ShadowPropagationOutput,
} from '../shadow-propagation.js';
import {
  discoverExplainabilityPaths,
  queryExplainabilityPaths,
  verifyExplainabilityCoverage,
  type ExplainabilityConfig,
} from '../explainability-paths.js';
import {
  evaluatePromotion,
  persistPromotionDecision,
  validatePolicyTransition,
  type PromotionInputs,
  type PromotionPolicyConfig,
  type PromotionDecision,
  type PolicyMode,
} from '../promotion-policy.js';

function makeMockNeo4j() {
  return { run: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
}

// ═══════════════════════════════════════════════════════════════════
// 1. shadow-propagation.ts
// ═══════════════════════════════════════════════════════════════════
describe('[aud-tc-09] Batch D — direct behavioral tests', () => {
  describe('shadow-propagation', () => {
    let neo4j: ReturnType<typeof makeMockNeo4j>;

    beforeEach(() => {
      neo4j = makeMockNeo4j();
    });

    it('returns zero-update output when no VerificationRuns exist', async () => {
      neo4j.run.mockResolvedValueOnce([]); // fetch runs → empty

      const result = await runShadowPropagation(neo4j as any, 'proj_empty');

      expect(result.projectId).toBe('proj_empty');
      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.maxDivergence).toBe(0);
      expect(result.avgDivergence).toBe(0);
      expect(result.promotionReady).toBe(true);
      expect(result.promotionBlockers).toHaveLength(0);
    });

    it('computes shadow confidence and persists shadow fields (never effectiveConfidence)', async () => {
      // Single run, no neighbors
      neo4j.run.mockResolvedValueOnce([
        { id: 'run1', tcf: 0.8, penalty: 0.9, prodConf: 0.7, neighbors: [] },
      ]);
      neo4j.run.mockResolvedValueOnce([]); // persist call

      const result = await runShadowPropagation(neo4j as any, 'proj_1');

      expect(result.updated).toBe(1);
      // Second call is the persist call — check params include shadow fields
      const persistCall = neo4j.run.mock.calls[1];
      const params = persistCall[1] as any;
      expect(params.updates).toHaveLength(1);
      expect(params.updates[0]).toHaveProperty('shadowEffectiveConfidence');
      expect(params.updates[0]).toHaveProperty('shadowInfluenceScore');
      // Must NOT have effectiveConfidence in the update payload
      expect(params.updates[0]).not.toHaveProperty('effectiveConfidence');
    });

    it('passes projectId as param to both fetch and persist queries', async () => {
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', tcf: 1.0, penalty: 1.0, prodConf: 0.5, neighbors: [] },
      ]);
      neo4j.run.mockResolvedValueOnce([]);

      await runShadowPropagation(neo4j as any, 'proj_abc');

      expect(neo4j.run.mock.calls[0][1]).toHaveProperty('projectId', 'proj_abc');
      expect(neo4j.run.mock.calls[1][1]).toHaveProperty('projectId', 'proj_abc');
    });

    it('respects custom config: dampingFactor and normalizationMode propagate to output', async () => {
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', tcf: 0.6, penalty: 0.8, prodConf: 0.5, neighbors: [] },
      ]);
      neo4j.run.mockResolvedValueOnce([]);

      const config: ShadowPropagationConfig = {
        dampingFactor: 0.5,
        maxHops: 2,
        normalizationMode: 'softmax',
        minInfluence: 0.02,
      };

      await runShadowPropagation(neo4j as any, 'proj_cfg', config);

      const persistParams = neo4j.run.mock.calls[1][1] as any;
      expect(persistParams.updates[0].normalizationMode).toBe('softmax');
      expect(persistParams.updates[0].dampingFactorUsed).toBe(0.5);
    });

    it('detects high divergence and blocks promotion', async () => {
      // Run where shadow will be tcf*penalty = 0.5*1.0 = 0.5, prodConf = 0.95 → divergence = 0.45 > 0.3
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', tcf: 0.5, penalty: 1.0, prodConf: 0.95, neighbors: [] },
      ]);
      neo4j.run.mockResolvedValueOnce([]);

      const result = await runShadowPropagation(neo4j as any, 'proj_div');

      expect(result.maxDivergence).toBeGreaterThan(0.3);
      expect(result.promotionReady).toBe(false);
      expect(result.promotionBlockers.length).toBeGreaterThan(0);
    });

    it('marks promotion-ready when divergence is low', async () => {
      // tcf*penalty = 0.7*1.0 = 0.7, prodConf = 0.7 → divergence = 0
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', tcf: 0.7, penalty: 1.0, prodConf: 0.7, neighbors: [] },
      ]);
      neo4j.run.mockResolvedValueOnce([]);

      const result = await runShadowPropagation(neo4j as any, 'proj_ok');

      expect(result.maxDivergence).toBe(0);
      expect(result.promotionReady).toBe(true);
      expect(result.promotionBlockers).toHaveLength(0);
    });

    it('propagates through PRECEDES neighbors', async () => {
      // Two runs linked as neighbors
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', tcf: 0.9, penalty: 1.0, prodConf: 0.8, neighbors: ['r2'] },
        { id: 'r2', tcf: 0.6, penalty: 0.8, prodConf: 0.5, neighbors: ['r1'] },
      ]);
      neo4j.run.mockResolvedValueOnce([]);

      const result = await runShadowPropagation(neo4j as any, 'proj_chain');

      expect(result.updated).toBe(2);
      const updates = (neo4j.run.mock.calls[1][1] as any).updates;
      // Both should have shadowInfluenceScore > 0 (each has 1 neighbor out of 2 runs)
      expect(updates[0].shadowInfluenceScore).toBeGreaterThan(0);
      expect(updates[1].shadowInfluenceScore).toBeGreaterThan(0);
    });

    it('filters null neighbors from the neighbor list', async () => {
      // neighbors array contains nulls (from OPTIONAL MATCH)
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', tcf: 1.0, penalty: 1.0, prodConf: 1.0, neighbors: [null, null] },
      ]);
      neo4j.run.mockResolvedValueOnce([]);

      const result = await runShadowPropagation(neo4j as any, 'proj_null');
      // Should succeed without error, treat as no neighbors
      expect(result.updated).toBe(1);
    });

    it('verifyShadowIsolation returns ok:true when no violations', async () => {
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);

      const result = await verifyShadowIsolation(neo4j as any, 'proj_iso');

      expect(result.ok).toBe(true);
      expect(result.violations).toBe(0);
      expect(neo4j.run.mock.calls[0][1]).toHaveProperty('projectId', 'proj_iso');
    });

    it('verifyShadowIsolation returns ok:false with violation count', async () => {
      neo4j.run.mockResolvedValueOnce([{ cnt: 3 }]);

      const result = await verifyShadowIsolation(neo4j as any, 'proj_bad');

      expect(result.ok).toBe(false);
      expect(result.violations).toBe(3);
    });

    it('returns durationMs as a non-negative number', async () => {
      neo4j.run.mockResolvedValueOnce([]);
      const result = await runShadowPropagation(neo4j as any, 'proj_dur');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. explainability-paths.ts
  // ═══════════════════════════════════════════════════════════════════
  describe('explainability-paths', () => {
    let neo4j: ReturnType<typeof makeMockNeo4j>;

    beforeEach(() => {
      neo4j = makeMockNeo4j();
    });

    it('returns zero-paths output when no claims have evidence', async () => {
      neo4j.run.mockResolvedValueOnce([]); // support paths
      neo4j.run.mockResolvedValueOnce([]); // contradiction paths
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]); // total claims count

      const result = await discoverExplainabilityPaths(neo4j as any, 'proj_empty');

      expect(result.projectId).toBe('proj_empty');
      expect(result.pathsCreated).toBe(0);
      expect(result.pathsSkipped).toBe(0);
      expect(result.claimsWithPaths).toBe(0);
    });

    it('creates InfluencePath nodes with EXPLAINS_SUPPORT edges for support paths', async () => {
      neo4j.run.mockResolvedValueOnce([
        { claimId: 'c1', evidenceId: 'e1', terminalId: 't1', weight: 0.8, direction: 'support' },
      ]);
      neo4j.run.mockResolvedValueOnce([]); // contradiction paths
      neo4j.run.mockResolvedValueOnce([]); // persist batch
      neo4j.run.mockResolvedValueOnce([{ cnt: 1 }]); // total claims

      const result = await discoverExplainabilityPaths(neo4j as any, 'proj_sup');

      expect(result.pathsCreated).toBe(1);
      expect(result.claimsWithPaths).toBe(1);
      // Verify batch param has correct direction
      const persistCall = neo4j.run.mock.calls[2];
      const batch = (persistCall[1] as any).batch;
      expect(batch[0].direction).toBe('support');
      expect(batch[0].rank).toBe(1);
      expect(batch[0].pathWeight).toBe(0.8);
    });

    it('creates contradiction paths with correct direction', async () => {
      neo4j.run.mockResolvedValueOnce([]); // support paths
      neo4j.run.mockResolvedValueOnce([
        { claimId: 'c1', evidenceId: 'e2', terminalId: null, weight: 0.6, direction: 'contradiction' },
      ]);
      neo4j.run.mockResolvedValueOnce([]); // persist
      neo4j.run.mockResolvedValueOnce([{ cnt: 1 }]); // total claims

      const result = await discoverExplainabilityPaths(neo4j as any, 'proj_con');

      expect(result.pathsCreated).toBe(1);
      const batch = (neo4j.run.mock.calls[2][1] as any).batch;
      expect(batch[0].direction).toBe('contradiction');
      // When terminalId is null, it should default to evidenceId
      expect(batch[0].terminalNodeId).toBe('e2');
    });

    it('enforces top-k limit per claim and skips excess paths', async () => {
      // 7 support paths for same claim, topK=3
      const paths = Array.from({ length: 7 }, (_, i) => ({
        claimId: 'c1', evidenceId: `e${i}`, terminalId: `t${i}`,
        weight: 0.9 - i * 0.1, direction: 'support',
      }));
      neo4j.run.mockResolvedValueOnce(paths);
      neo4j.run.mockResolvedValueOnce([]); // contradiction
      neo4j.run.mockResolvedValueOnce([]); // persist
      neo4j.run.mockResolvedValueOnce([{ cnt: 1 }]); // total

      const config: ExplainabilityConfig = { topK: 3, minWeight: 0.01, maxPayload: 50 };
      const result = await discoverExplainabilityPaths(neo4j as any, 'proj_topk', config);

      expect(result.pathsCreated).toBe(3);
      expect(result.pathsSkipped).toBe(4);
      // Verify ranks are 1-indexed
      const batch = (neo4j.run.mock.calls[2][1] as any).batch;
      expect(batch.map((b: any) => b.rank)).toEqual([1, 2, 3]);
    });

    it('skips paths below minWeight threshold', async () => {
      neo4j.run.mockResolvedValueOnce([
        { claimId: 'c1', evidenceId: 'e1', terminalId: 't1', weight: 0.005, direction: 'support' },
      ]);
      neo4j.run.mockResolvedValueOnce([]); // contradiction
      neo4j.run.mockResolvedValueOnce([{ cnt: 1 }]); // total claims (no persist call since 0 paths)

      const config: ExplainabilityConfig = { topK: 5, minWeight: 0.01, maxPayload: 50 };
      const result = await discoverExplainabilityPaths(neo4j as any, 'proj_min', config);

      expect(result.pathsCreated).toBe(0);
      expect(result.claimsWithPaths).toBe(0);
    });

    it('generates stable pathHash for identical hops+direction', async () => {
      // Two calls with same paths should produce same pathHash
      const pathRow = { claimId: 'c1', evidenceId: 'e1', terminalId: 't1', weight: 0.8, direction: 'support' };

      neo4j.run.mockResolvedValueOnce([pathRow]);
      neo4j.run.mockResolvedValueOnce([]);
      neo4j.run.mockResolvedValueOnce([]);
      neo4j.run.mockResolvedValueOnce([{ cnt: 1 }]);

      await discoverExplainabilityPaths(neo4j as any, 'proj_hash1');
      const hash1 = (neo4j.run.mock.calls[2][1] as any).batch[0].pathHash;

      // Reset and run again
      neo4j = makeMockNeo4j();
      neo4j.run.mockResolvedValueOnce([pathRow]);
      neo4j.run.mockResolvedValueOnce([]);
      neo4j.run.mockResolvedValueOnce([]);
      neo4j.run.mockResolvedValueOnce([{ cnt: 1 }]);

      await discoverExplainabilityPaths(neo4j as any, 'proj_hash2');
      const hash2 = (neo4j.run.mock.calls[2][1] as any).batch[0].pathHash;

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(32);
    });

    it('queryExplainabilityPaths returns parsed InfluencePath objects', async () => {
      neo4j.run.mockResolvedValueOnce([{
        ip: {
          pathHash: 'abc123',
          pathWeight: 0.9,
          rank: 1,
          direction: 'support',
          hopsJson: '["c1","e1","t1"]',
          claimId: 'c1',
          terminalNodeId: 't1',
          projectId: 'proj_q',
        },
      }]);

      const paths = await queryExplainabilityPaths(neo4j as any, 'proj_q', 'c1');

      expect(paths).toHaveLength(1);
      expect(paths[0].pathHash).toBe('abc123');
      expect(paths[0].hops).toEqual(['c1', 'e1', 't1']);
      expect(paths[0].direction).toBe('support');
    });

    it('queryExplainabilityPaths respects maxPayload cap at 100', async () => {
      neo4j.run.mockResolvedValueOnce([]);

      const config: ExplainabilityConfig = { topK: 5, minWeight: 0.01, maxPayload: 200 };
      await queryExplainabilityPaths(neo4j as any, 'proj_cap', undefined, config);

      // limit param should be capped at 100
      const params = neo4j.run.mock.calls[0][1] as any;
      expect(params.limit).toBe(100);
    });

    it('verifyExplainabilityCoverage returns coverage ratio', async () => {
      neo4j.run.mockResolvedValueOnce([{ total: 10, withPaths: 7 }]);

      const result = await verifyExplainabilityCoverage(neo4j as any, 'proj_cov');

      expect(result.total).toBe(10);
      expect(result.claimsWithout).toBe(3);
      expect(result.coverageRatio).toBeCloseTo(0.7, 5);
      expect(result.ok).toBe(false);
    });

    it('verifyExplainabilityCoverage returns ok:true when all claims covered', async () => {
      neo4j.run.mockResolvedValueOnce([{ total: 5, withPaths: 5 }]);

      const result = await verifyExplainabilityCoverage(neo4j as any, 'proj_full');

      expect(result.ok).toBe(true);
      expect(result.claimsWithout).toBe(0);
      expect(result.coverageRatio).toBe(1.0);
    });

    it('returns durationMs for discoverExplainabilityPaths', async () => {
      neo4j.run.mockResolvedValueOnce([]);
      neo4j.run.mockResolvedValueOnce([]);
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);

      const result = await discoverExplainabilityPaths(neo4j as any, 'proj_dur');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. promotion-policy.ts
  // ═══════════════════════════════════════════════════════════════════
  describe('promotion-policy', () => {
    const baseInputs: PromotionInputs = {
      projectId: 'proj_promo',
      brierProd: 0.3,
      brierShadow: 0.2,
      governancePass: true,
      antiGamingPass: true,
      calibrationPass: true,
    };

    it('evaluatePromotion returns eligible=true in advisory mode when all gates pass', () => {
      const decision = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });

      expect(decision.promotionEligible).toBe(true);
      expect(decision.promoted).toBe(false); // advisory never promotes
      expect(decision.mode).toBe('advisory');
      expect(decision.projectId).toBe('proj_promo');
    });

    it('evaluatePromotion returns eligible=false when calibrationPass is false', () => {
      const inputs = { ...baseInputs, calibrationPass: false };
      const decision = evaluatePromotion(inputs);

      expect(decision.promotionEligible).toBe(false);
      expect(decision.promoted).toBe(false);
    });

    it('evaluatePromotion returns eligible=false when antiGamingPass is false', () => {
      const inputs = { ...baseInputs, antiGamingPass: false };
      const decision = evaluatePromotion(inputs);

      expect(decision.promotionEligible).toBe(false);
    });

    it('evaluatePromotion returns eligible=false when governancePass is false', () => {
      const inputs = { ...baseInputs, governancePass: false };
      const decision = evaluatePromotion(inputs);

      expect(decision.promotionEligible).toBe(false);
    });

    it('evaluatePromotion promotes in enforced mode with enableEnforcement=true', () => {
      const config: PromotionPolicyConfig = { mode: 'enforced', enableEnforcement: true };
      const decision = evaluatePromotion(baseInputs, config);

      expect(decision.promotionEligible).toBe(true);
      expect(decision.promoted).toBe(true);
      expect(decision.mode).toBe('enforced');
    });

    it('evaluatePromotion does NOT promote in enforced mode with enableEnforcement=false', () => {
      const config: PromotionPolicyConfig = { mode: 'enforced', enableEnforcement: false };
      const decision = evaluatePromotion(baseInputs, config);

      expect(decision.promotionEligible).toBe(true);
      expect(decision.promoted).toBe(false);
    });

    it('evaluatePromotion in assisted mode never promotes automatically', () => {
      const config: PromotionPolicyConfig = { mode: 'assisted', enableEnforcement: true };
      const decision = evaluatePromotion(baseInputs, config);

      expect(decision.promotionEligible).toBe(true);
      expect(decision.promoted).toBe(false);
    });

    it('evaluatePromotion checks minBrierImprovement', () => {
      // brierProd=0.3, brierShadow=0.2, improvement=0.1, require 0.2
      const config: PromotionPolicyConfig = { mode: 'advisory', enableEnforcement: false, minBrierImprovement: 0.2 };
      const decision = evaluatePromotion(baseInputs, config);

      expect(decision.promotionEligible).toBe(false);
    });

    it('evaluatePromotion generates deterministic decisionHash for same inputs', () => {
      const d1 = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
      const d2 = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });

      expect(d1.decisionHash).toBe(d2.decisionHash);
      expect(d1.decisionHash).toHaveLength(32);
    });

    it('evaluatePromotion generates different hash for different inputs', () => {
      const d1 = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
      const d2 = evaluatePromotion(
        { ...baseInputs, brierProd: 0.5 },
        { mode: 'advisory', enableEnforcement: false },
      );

      expect(d1.decisionHash).not.toBe(d2.decisionHash);
    });

    it('persistPromotionDecision calls neo4j.run with decision props', async () => {
      const neo4j = makeMockNeo4j();
      neo4j.run.mockResolvedValue([]);

      const decision = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
      await persistPromotionDecision(neo4j as any, decision);

      expect(neo4j.run).toHaveBeenCalledTimes(1);
      const params = neo4j.run.mock.calls[0][1] as any;
      expect(params.decisionId).toBe(decision.decisionId);
      expect(params.projectId).toBe('proj_promo');
      expect(params.props.mode).toBe('advisory');
      expect(params.props.decisionHash).toBe(decision.decisionHash);
    });

    it('persistPromotionDecision copies shadow→production when promoted=true', async () => {
      const neo4j = makeMockNeo4j();
      neo4j.run.mockResolvedValue([]);

      const decision = evaluatePromotion(baseInputs, { mode: 'enforced', enableEnforcement: true });
      expect(decision.promoted).toBe(true);

      await persistPromotionDecision(neo4j as any, decision);

      // Should make 2 calls: persist decision + copy shadow→production
      expect(neo4j.run).toHaveBeenCalledTimes(2);
      const copyParams = neo4j.run.mock.calls[1][1] as any;
      expect(copyParams.projectId).toBe('proj_promo');
      expect(copyParams.decisionHash).toBe(decision.decisionHash);
    });

    it('persistPromotionDecision does NOT copy shadow→production when promoted=false', async () => {
      const neo4j = makeMockNeo4j();
      neo4j.run.mockResolvedValue([]);

      const decision = evaluatePromotion(baseInputs, { mode: 'advisory', enableEnforcement: false });
      expect(decision.promoted).toBe(false);

      await persistPromotionDecision(neo4j as any, decision);

      expect(neo4j.run).toHaveBeenCalledTimes(1); // only persist, no copy
    });

    it('validatePolicyTransition blocks advisory→enforced (must go through assisted)', () => {
      const result = validatePolicyTransition('advisory', 'enforced', true);
      expect(result.ok).toBe(false);
      expect(result.reason).toBeTruthy();
    });

    it('validatePolicyTransition allows advisory→assisted', () => {
      const result = validatePolicyTransition('advisory', 'assisted', true);
      expect(result.ok).toBe(true);
    });

    it('validatePolicyTransition allows assisted→enforced with calibration', () => {
      const result = validatePolicyTransition('assisted', 'enforced', true);
      expect(result.ok).toBe(true);
    });

    it('validatePolicyTransition blocks enforced without calibration', () => {
      const result = validatePolicyTransition('assisted', 'enforced', false);
      expect(result.ok).toBe(false);
    });

    it('evaluatePromotion returns all required fields in PromotionDecision', () => {
      const decision = evaluatePromotion(baseInputs);

      expect(decision).toHaveProperty('decisionId');
      expect(decision).toHaveProperty('projectId');
      expect(decision).toHaveProperty('mode');
      expect(decision).toHaveProperty('promotionEligible');
      expect(decision).toHaveProperty('evaluatedAt');
      expect(decision).toHaveProperty('decisionHash');
      expect(decision).toHaveProperty('brierProd');
      expect(decision).toHaveProperty('brierShadow');
      expect(decision).toHaveProperty('governancePass');
      expect(decision).toHaveProperty('antiGamingPass');
      expect(decision).toHaveProperty('calibrationPass');
      expect(decision).toHaveProperty('promoted');
      expect(decision).toHaveProperty('reason');
      expect(decision.decisionId).toContain('promo:proj_promo:');
    });
  });
});
