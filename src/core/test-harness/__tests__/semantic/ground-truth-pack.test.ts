/**
 * GTH-2: Software-Governance Pack Tests
 *
 * Tests the SoftwareGovernancePack against mock Neo4j, verifying:
 * - All Panel 1A queries produce Observation[] with correct provenance
 * - Domain integrity surfaces produce IntegrityFinding[]
 * - Transitive impact uses structural matching first, keyword fallback
 * - GRC compliance (parameterized queries, GovernanceMetricSnapshot primary)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoftwareGovernancePack } from '../../../ground-truth/packs/software.js';

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('GTH-2: Software-Governance Pack', () => {
  let neo4j: any;
  let pack: SoftwareGovernancePack;

  beforeEach(() => {
    neo4j = createMockNeo4j();
    pack = new SoftwareGovernancePack(neo4j);
  });

  describe('interface compliance', () => {
    it('has correct domain and version', () => {
      expect(pack.domain).toBe('software-governance');
      expect(pack.version).toBe('1.0.0');
    });
  });

  // ─── Panel 1A: Plan Status ──────────────────────────────────────
  describe('queryPlanStatus', () => {
    it('returns observations with task counts', async () => {
      neo4j.run
        .mockResolvedValueOnce([
          { status: 'done', cnt: 297 },
          { status: 'planned', cnt: 135 },
        ])
        .mockResolvedValueOnce([
          { name: 'Milestone RF-1', done: 3, total: 3 },
          { name: 'Milestone RF-2', done: 0, total: 3 },
        ])
        .mockResolvedValueOnce([
          { milestone: 'RF-2', task: 'Enforce temporal fields' },
        ]);

      const result = await pack.queryPlanStatus('plan_codegraph');

      expect(result).toHaveLength(3);
      // Task counts
      expect(result[0].source).toBe('Task');
      expect(result[0].confidenceClass).toBe('exact');
      expect((result[0].value as any).done).toBe(297);
      expect((result[0].value as any).total).toBe(432);
      // Milestones
      expect(result[1].source).toBe('Milestone');
      // Unblocked
      expect(result[2].source).toBe('DEPENDS_ON');
    });
  });

  // ─── Panel 1A: Governance Health ────────────────────────────────
  describe('queryGovernanceHealth', () => {
    it('returns GovernanceMetricSnapshot data when available', async () => {
      neo4j.run.mockResolvedValueOnce([{
        ts: new Date().toISOString(),
        runs: 10,
        failures: 0,
        rate: 1.0,
        violations: 0,
      }]);

      const result = await pack.queryGovernanceHealth('proj_test');

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('GovernanceMetricSnapshot');
      expect(result[0].freshnessState).toBe('fresh');
      expect((result[0].value as any).gateFailures).toBe(0);
    });

    it('marks stale when GMS is old', async () => {
      const oldTs = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // 5h ago
      neo4j.run.mockResolvedValueOnce([{
        ts: oldTs,
        runs: 5,
        failures: 1,
        rate: 0.8,
        violations: 2,
      }]);

      const result = await pack.queryGovernanceHealth('proj_test');

      expect(result[0].freshnessState).toBe('stale');
    });

    it('returns error observation when no GMS exists', async () => {
      neo4j.run.mockResolvedValueOnce([]);

      const result = await pack.queryGovernanceHealth('proj_test');

      expect(result[0].freshnessState).toBe('stale');
      expect((result[0].value as any).error).toBeTruthy();
    });
  });

  // ─── Panel 1A: Evidence Coverage ────────────────────────────────
  describe('queryEvidenceCoverage', () => {
    it('computes coverage percentages correctly', async () => {
      neo4j.run.mockResolvedValueOnce([
        { bucket: 'with_evidence', cnt: 82 },
        { bucket: 'without', cnt: 215 },
      ]);

      const result = await pack.queryEvidenceCoverage('plan_test');

      expect(result).toHaveLength(1);
      expect((result[0].value as any).withEvidence).toBe(82);
      expect((result[0].value as any).withoutEvidence).toBe(215);
      expect((result[0].value as any).pct).toBe(27.6);
    });
  });

  // ─── Panel 1A: Relevant Claims ──────────────────────────────────
  describe('queryRelevantClaims', () => {
    it('returns empty for no files', async () => {
      const result = await pack.queryRelevantClaims('task_1', []);
      expect(result).toEqual([]);
    });

    it('deduplicates structural + keyword matches', async () => {
      neo4j.run
        .mockResolvedValueOnce([
          { claimId: 'c1', statement: 'Impact on foo.ts', confidence: 0.8, matchMethod: 'structural' },
        ])
        .mockResolvedValueOnce([
          { claimId: 'c1', statement: 'Impact on foo.ts', confidence: 0.8, matchMethod: 'keyword' },
          { claimId: 'c2', statement: 'Another claim', confidence: 0.5, matchMethod: 'keyword' },
        ]);

      const result = await pack.queryRelevantClaims('task_1', ['foo.ts']);

      expect(result).toHaveLength(2); // c1 (structural) + c2 (keyword), not 3
    });
  });

  // ─── Panel 1B: Domain Integrity Surfaces ────────────────────────
  describe('queryIntegritySurfaces', () => {
    it('returns findings for evidence gap, hypotheses, gate failures', async () => {
      neo4j.run
        .mockResolvedValueOnce([{ total: 297, withEv: 82, gap: 215, gapPct: 72.4 }])
        .mockResolvedValueOnce([{ cnt: 482 }])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ totalFailures: 0, snapshots: 5 }]);

      const result = await pack.queryIntegritySurfaces('proj_test');

      expect(result.length).toBeGreaterThanOrEqual(3);

      const gap = result.find(f => f.definitionId === 'evidence_gap');
      expect(gap).toBeDefined();
      expect(gap!.surface).toBe('coverage');
      expect(gap!.surfaceClass).toBe('domain');
      expect(gap!.pass).toBe(false);

      const hyp = result.find(f => f.definitionId === 'open_hypotheses');
      expect(hyp).toBeDefined();
      expect(hyp!.observedValue).toBe(482);

      const gate = result.find(f => f.definitionId === 'gate_failure_trend');
      expect(gate).toBeDefined();
      expect(gate!.pass).toBe(true);
    });

    it('survives individual query failures gracefully', async () => {
      neo4j.run
        .mockRejectedValueOnce(new Error('Connection lost'))
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ cnt: 0 }])
        .mockResolvedValueOnce([{ totalFailures: 0, snapshots: 5 }]);

      const result = await pack.queryIntegritySurfaces('proj_test');
      // Should still return findings from non-failing queries
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Panel 3: Transitive Impact ─────────────────────────────────
  describe('queryTransitiveImpact', () => {
    it('returns empty for no files', async () => {
      const result = await pack.queryTransitiveImpact([]);
      expect(result).toEqual([]);
    });

    it('uses structural matching first', async () => {
      neo4j.run.mockResolvedValueOnce([
        { claimId: 'c1', statement: 'Impact claim', confidence: 0.9, files: ['src/foo.ts'] },
      ]);

      const result = await pack.queryTransitiveImpact(['src/foo.ts']);

      expect(result).toHaveLength(1);
      expect(result[0].matchMethod).toBe('structural');
    });

    it('falls back to keyword when structural finds nothing', async () => {
      neo4j.run
        .mockResolvedValueOnce([]) // structural: empty
        .mockResolvedValueOnce([   // keyword: found
          { claimId: 'c1', statement: 'mentions src/bar.ts', confidence: 0.5 },
        ]);

      const result = await pack.queryTransitiveImpact(['src/bar.ts']);

      expect(result).toHaveLength(1);
      expect(result[0].matchMethod).toBe('keyword');
    });
  });

  // ─── Panel 3: Candidate MODIFIES ────────────────────────────────
  describe('queryCandidateModifies', () => {
    it('returns candidate edges from task', async () => {
      neo4j.run.mockResolvedValueOnce([
        { taskName: 'Add view typing', tid: 'task_1', filePath: 'src/schema.ts', confidence: 0.8, source: 'task_description' },
      ]);

      const result = await pack.queryCandidateModifies('task_1');

      expect(result).toHaveLength(1);
      expect(result[0].targetFilePath).toBe('src/schema.ts');
      expect(result[0].source).toBe('task_description');
    });
  });
});
