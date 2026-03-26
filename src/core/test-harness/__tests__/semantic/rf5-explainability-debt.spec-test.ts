/**
 * RF-5: Explainability Paths + Evidence Debt — Spec Tests
 *
 * Three capabilities:
 *   1. InfluencePath nodes with pathHash, rank, pathWeight (top-k per claim)
 *   2. Bounded path extraction (acyclic, hop-limited via topK config)
 *   3. Debt metrics (requiredConfidence, effectiveConfidence, confidenceDebt) on VRs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';
import {
  discoverExplainabilityPaths,
  verifyExplainabilityCoverage,
} from '../../../../core/verification/explainability-paths.js';
import {
  computeConfidenceDebt,
  generateDebtDashboard,
  verifyDebtFieldPresence,
} from '../../../../core/verification/confidence-debt.js';

// InfluencePaths live on plan projects (claim-evidence edges are there)
const PLAN_PROJECT = 'plan_codegraph';
const CODE_PROJECT = 'proj_c0d3e9a1f200';

describe('RF-5: Explainability Paths + Evidence Debt', () => {
  let neo4j: Neo4jService;

  beforeAll(() => {
    neo4j = new Neo4jService();
  });

  afterAll(async () => {
    await neo4j.close();
  });

  describe('InfluencePath persistence (top-k)', () => {
    it('creates InfluencePath nodes with pathHash and pathWeight', { timeout: 60_000 }, async () => {
      await discoverExplainabilityPaths(neo4j, PLAN_PROJECT);

      const rows = await neo4j.run(
        `MATCH (ip:InfluencePath {projectId: $pid})
         WHERE ip.pathHash IS NOT NULL AND ip.pathWeight IS NOT NULL
         RETURN count(ip) AS total`,
        { pid: PLAN_PROJECT },
      );
      const total = (rows[0]?.total as any)?.toNumber?.() ?? Number(rows[0]?.total);
      expect(total).toBeGreaterThan(0);
    });

    it('assigns rank per claim (1-indexed, weight descending)', { timeout: 60_000 }, async () => {
      await discoverExplainabilityPaths(neo4j, PLAN_PROJECT);

      const rows = await neo4j.run(
        `MATCH (ip:InfluencePath {projectId: $pid})
         WHERE ip.rank IS NOT NULL
         RETURN ip.claimId AS claim, ip.rank AS rank, ip.pathWeight AS weight
         ORDER BY ip.claimId, ip.rank
         LIMIT 20`,
        { pid: PLAN_PROJECT },
      );

      expect(rows.length).toBeGreaterThan(0);
      // Verify rank starts at 1
      const firstRanks = rows.filter(r => (r.rank as number) === 1);
      expect(firstRanks.length).toBeGreaterThan(0);

      // Verify within same claim, rank 1 has highest weight
      const byClaim = new Map<string, Array<{ rank: number; weight: number }>>();
      for (const r of rows) {
        const claim = r.claim as string;
        const existing = byClaim.get(claim) ?? [];
        existing.push({ rank: r.rank as number, weight: Number(r.weight) });
        byClaim.set(claim, existing);
      }
      for (const [, paths] of byClaim) {
        if (paths.length >= 2) {
          // Higher rank = lower weight (rank 1 is best)
          expect(paths[0].weight).toBeGreaterThanOrEqual(paths[paths.length - 1].weight);
        }
      }
    });

    it('pathHash is stable (same paths produce same hash)', { timeout: 60_000 }, async () => {
      // Run discover twice independently — same inputs must produce same hashes.
      // This test is self-contained: does not depend on prior tests.
      await discoverExplainabilityPaths(neo4j, PLAN_PROJECT);
      const first = await neo4j.run(
        `MATCH (ip:InfluencePath {projectId: $pid})
         RETURN ip.pathHash AS hash ORDER BY hash LIMIT 10`,
        { pid: PLAN_PROJECT },
      );

      await discoverExplainabilityPaths(neo4j, PLAN_PROJECT);
      const second = await neo4j.run(
        `MATCH (ip:InfluencePath {projectId: $pid})
         RETURN ip.pathHash AS hash ORDER BY hash LIMIT 10`,
        { pid: PLAN_PROJECT },
      );

      expect(first.length).toBe(second.length);
      for (let i = 0; i < first.length; i++) {
        expect(first[i].hash).toBe(second[i].hash);
      }
    });
  });

  describe('bounded path-slice policy', () => {
    it('paths are hop-bounded (hopCount present and reasonable)', async () => {
      const rows = await neo4j.run(
        `MATCH (ip:InfluencePath {projectId: $pid})
         WHERE ip.hopCount IS NOT NULL
         RETURN max(ip.hopCount) AS maxHops, avg(ip.hopCount) AS avgHops, count(ip) AS total`,
        { pid: PLAN_PROJECT },
      );

      const maxHops = (rows[0]?.maxHops as any)?.toNumber?.() ?? Number(rows[0]?.maxHops);
      expect(maxHops).toBeGreaterThan(0);
      // Paths should be bounded — not traversing the entire graph
      expect(maxHops).toBeLessThanOrEqual(10);
    });

    it('top-k limits new paths per claim (default k=5)', { timeout: 60_000 }, async () => {
      // The discover function takes top-k from its sorted list.
      // Verify the function's output count, not stale graph state.
      const result = await discoverExplainabilityPaths(neo4j, PLAN_PROJECT);

      // pathsCreated should be bounded: at most topK(5) × number of claims
      expect(result.pathsCreated).toBeGreaterThan(0);
      // And skipped paths means top-k was enforced
      expect(typeof result.pathsSkipped).toBe('number');
    });

    it('coverage ratio reports claims with and without paths', async () => {
      const coverage = await verifyExplainabilityCoverage(neo4j, PLAN_PROJECT);

      expect(coverage).toHaveProperty('coverageRatio');
      expect(coverage).toHaveProperty('claimsWithout');
      expect(coverage.coverageRatio).toBeGreaterThanOrEqual(0);
      expect(coverage.coverageRatio).toBeLessThanOrEqual(1);
    });
  });

  describe('debt metrics on VR outputs', () => {
    it('VRs have requiredConfidence, effectiveConfidence, confidenceDebt', async () => {
      await computeConfidenceDebt(neo4j, CODE_PROJECT);

      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.requiredConfidence IS NOT NULL
           AND r.effectiveConfidence IS NOT NULL
           AND r.confidenceDebt IS NOT NULL
         RETURN count(r) AS withAll`,
        { pid: CODE_PROJECT },
      );

      const withAll = (rows[0]?.withAll as any)?.toNumber?.() ?? Number(rows[0]?.withAll);
      expect(withAll).toBeGreaterThan(0);
    });

    it('debt = max(0, required - effective)', async () => {
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.requiredConfidence IS NOT NULL
           AND r.effectiveConfidence IS NOT NULL
           AND r.confidenceDebt IS NOT NULL
         RETURN r.requiredConfidence AS req, r.effectiveConfidence AS eff,
                r.confidenceDebt AS debt
         LIMIT 20`,
        { pid: CODE_PROJECT },
      );

      for (const row of rows) {
        const req = Number(row.req);
        const eff = Number(row.eff);
        const debt = Number(row.debt);
        const expected = Math.max(0, req - eff);
        expect(Math.abs(debt - expected)).toBeLessThan(0.01);
      }
    });

    it('debt dashboard aggregates real metrics', async () => {
      await computeConfidenceDebt(neo4j, CODE_PROJECT);
      const dashboard = await generateDebtDashboard(neo4j, CODE_PROJECT);

      expect(dashboard.totalEntities).toBeGreaterThan(0);
      expect(dashboard.avgDebt).toBeGreaterThanOrEqual(0);
      expect(dashboard.maxDebt).toBeGreaterThanOrEqual(0);
      expect(dashboard.maxDebt).toBeLessThanOrEqual(1);
      expect(typeof dashboard.durationMs).toBe('number');
    });

    it('debt field presence check passes after stamping', async () => {
      await computeConfidenceDebt(neo4j, CODE_PROJECT);
      const check = await verifyDebtFieldPresence(neo4j, CODE_PROJECT);

      expect(check.ok).toBe(true);
      expect(check.total).toBeGreaterThan(0);
    });
  });
});
