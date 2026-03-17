/**
 * RF-3: Deterministic Production Confidence Baseline — Spec Tests
 *
 * Three invariants:
 *   1. effectiveConfidence = clamp(confidence × TCF × retroactivePenalty)
 *   2. Shadow propagation never overwrites production effectiveConfidence
 *   3. Same graph snapshot + inputs → same effectiveConfidence (reproducibility)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';
import {
  incrementalRecompute,
  verifyReproducibility,
} from '../../../../core/verification/incremental-recompute.js';
import {
  verifyShadowIsolation,
} from '../../../../core/verification/shadow-propagation.js';

const TEST_PROJECT = 'proj_c0d3e9a1f200';

describe('RF-3: Deterministic Production Confidence Baseline', () => {
  let neo4j: Neo4jService;

  beforeAll(() => {
    neo4j = new Neo4jService();
  });

  afterAll(async () => {
    await neo4j.close();
  });

  describe('effectiveConfidence materialization', () => {
    it('recompute stamps effectiveConfidence on VR nodes', async () => {
      await incrementalRecompute(neo4j, {
        projectId: TEST_PROJECT,
        scope: 'full',
        fullOverride: true,
        reason: 'rf3_test_materialization',
      });

      // Check that effectiveConfidence is now set on VRs
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.effectiveConfidence IS NOT NULL
         RETURN count(r) AS withEC`,
        { pid: TEST_PROJECT },
      );

      const withEC = (rows[0]?.withEC as any)?.toNumber?.() ?? Number(rows[0]?.withEC) ?? 0;
      expect(withEC).toBeGreaterThan(0);
    });

    it('effectiveConfidence = confidence × TCF × penalty (formula check)', async () => {
      await incrementalRecompute(neo4j, {
        projectId: TEST_PROJECT,
        scope: 'full',
        fullOverride: true,
        reason: 'rf3_test_formula',
      });

      // Sample VR nodes and verify the formula
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.effectiveConfidence IS NOT NULL
           AND r.timeConsistencyFactor IS NOT NULL
           AND r.confidence IS NOT NULL
         RETURN r.confidence AS conf,
                r.timeConsistencyFactor AS tcf,
                coalesce(r.retroactivePenalty, 1.0) AS penalty,
                r.effectiveConfidence AS ec
         LIMIT 20`,
        { pid: TEST_PROJECT },
      );

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        const conf = Number(row.conf);
        const tcf = Number(row.tcf);
        const penalty = Number(row.penalty);
        const ec = Number(row.ec);
        const expected = conf * tcf * penalty;

        // Allow small floating point tolerance
        expect(Math.abs(ec - expected)).toBeLessThan(0.001);
      }
    });

    it('effectiveConfidence uses 0.5 default when confidence is null', async () => {
      await incrementalRecompute(neo4j, {
        projectId: TEST_PROJECT,
        scope: 'full',
        fullOverride: true,
        reason: 'rf3_test_null_default',
      });

      // Check VRs where confidence was null — EC should use 0.5 base
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.confidence IS NULL
           AND r.effectiveConfidence IS NOT NULL
           AND r.timeConsistencyFactor IS NOT NULL
         RETURN r.effectiveConfidence AS ec,
                r.timeConsistencyFactor AS tcf,
                coalesce(r.retroactivePenalty, 1.0) AS penalty
         LIMIT 10`,
        { pid: TEST_PROJECT },
      );

      for (const row of rows) {
        const tcf = Number(row.tcf);
        const penalty = Number(row.penalty);
        const ec = Number(row.ec);
        const expected = 0.5 * tcf * penalty;
        expect(Math.abs(ec - expected)).toBeLessThan(0.001);
      }
    });

    it('effectiveConfidence is bounded [0, 1]', async () => {
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.effectiveConfidence IS NOT NULL
         RETURN min(r.effectiveConfidence) AS minEC,
                max(r.effectiveConfidence) AS maxEC`,
        { pid: TEST_PROJECT },
      );

      const minEC = Number(rows[0]?.minEC);
      const maxEC = Number(rows[0]?.maxEC);
      expect(minEC).toBeGreaterThanOrEqual(0);
      expect(maxEC).toBeLessThanOrEqual(1);
    });
  });

  describe('propagation isolation', () => {
    it('shadow propagation never overwrites production effectiveConfidence', async () => {
      const isolation = await verifyShadowIsolation(neo4j, TEST_PROJECT);
      expect(isolation.ok).toBe(true);
      expect(isolation.violations).toBe(0);
    });
  });

  describe('reproducibility invariant', () => {
    it('same graph snapshot + inputs → same effectiveConfidence', async () => {
      // First run — establishes baseline
      await incrementalRecompute(neo4j, {
        projectId: TEST_PROJECT,
        scope: 'full',
        fullOverride: true,
        reason: 'rf3_reproducibility_baseline',
      });

      // Verify reproducibility
      const result = await verifyReproducibility(neo4j, TEST_PROJECT);
      expect(result.ok).toBe(true);
      expect(result.divergences).toHaveLength(0);
    });
  });
});
