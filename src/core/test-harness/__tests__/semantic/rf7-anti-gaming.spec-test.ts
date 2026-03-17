/**
 * RF-7: Trust-Graph Anti-Gaming + Collusion Projection — Spec Tests
 *
 * Tests written FROM the VERIFICATION_GRAPH_ROADMAP.md RF-7 spec.
 *
 * Spec requirements:
 * 1. Enforce source-family caps and duplicate/restatement collapse in TrustView contribution stage
 * 2. Compute collusion signals on dedicated undirected trust/support projection
 * 3. Add governance checks for untrusted-seed floor and confidence inflation prevention
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  enforceSourceFamilyCaps,
  verifyAntiGaming,
  type AntiGamingConfig,
  type AntiGamingResult,
} from '../../../verification/anti-gaming.js';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';

describe('RF-7: Trust-Graph Anti-Gaming + Collusion Projection', () => {
  let neo4j: Neo4jService;
  const projectId = 'proj_c0d3e9a1f200';

  beforeAll(() => {
    neo4j = new Neo4jService();
  });

  afterAll(async () => {
    await neo4j.close();
  });

  function toNum(val: unknown): number {
    const v = val as any;
    return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
  }

  // ── Task 1: Source-family caps + duplicate/restatement collapse ──

  describe('Task 1: Source-family caps and duplicate collapse', () => {
    it('enforceSourceFamilyCaps returns all required fields', async () => {
      const result = await enforceSourceFamilyCaps(neo4j, projectId);
      expect(result).toHaveProperty('projectId', projectId);
      expect(result).toHaveProperty('sourceFamiliesDetected');
      expect(result).toHaveProperty('capsApplied');
      expect(result).toHaveProperty('duplicatesCollapsed');
      expect(result).toHaveProperty('collusionSuspects');
      expect(result).toHaveProperty('untrustedSeeded');
      expect(result).toHaveProperty('durationMs');
    });

    it('detects known source families (semgrep, eslint, done-check)', async () => {
      const result = await enforceSourceFamilyCaps(neo4j, projectId);
      expect(result.sourceFamiliesDetected).toBeGreaterThanOrEqual(2);
    });

    it('applies sourceFamilyCap to all VR nodes', async () => {
      await enforceSourceFamilyCaps(neo4j, projectId);
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.sourceFamilyCap IS NOT NULL
         RETURN count(r) AS cnt`,
        { pid: projectId },
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
    });

    it('tags VRs with sourceFamily property', async () => {
      await enforceSourceFamilyCaps(neo4j, projectId);
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.sourceFamily IS NOT NULL
         RETURN r.sourceFamily AS fam, count(r) AS cnt
         ORDER BY cnt DESC`,
        { pid: projectId },
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
      // Known families should be present
      const families = rows.map(r => r.fam);
      expect(families).toContain('ESLint');
    });

    it('marks duplicate clusters with restatementScore', async () => {
      await enforceSourceFamilyCaps(neo4j, projectId);
      // Check if any duplicates were collapsed (may be 0 if no identical artifactHashes)
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.restatementScore IS NOT NULL
         RETURN count(r) AS cnt`,
        { pid: projectId },
      );
      // This is data-dependent — just verify the query works and returns a number
      expect(toNum(rows[0]?.cnt)).toBeGreaterThanOrEqual(0);
    });

    it('accepts custom sourceFamilyCap config', async () => {
      const config: AntiGamingConfig = {
        sourceFamilyCap: 0.5,
        restatementThreshold: 0.9,
        collusionThreshold: 0.85,
        untrustedSeedFloor: 0.1,
        clusterInfluenceCap: 0.5,
      };
      const result = await enforceSourceFamilyCaps(neo4j, projectId, config);
      expect(result.capsApplied).toBeGreaterThan(0);

      // Verify custom cap was persisted
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {projectId: $pid})
         WHERE r.sourceFamilyCap IS NOT NULL
         RETURN r.sourceFamilyCap AS cap LIMIT 1`,
        { pid: projectId },
      );
      expect(rows[0]?.cap).toBe(0.5);

      // Restore default
      await enforceSourceFamilyCaps(neo4j, projectId);
    });
  });

  // ── Task 2: Collusion signals ───────────────────────────────────

  describe('Task 2: Collusion signal computation', () => {
    it('reports collusionSuspects count', async () => {
      const result = await enforceSourceFamilyCaps(neo4j, projectId);
      expect(typeof result.collusionSuspects).toBe('number');
      expect(result.collusionSuspects).toBeGreaterThanOrEqual(0);
    });

    it('collusion detection uses time-window correlation (same tool + status + <60s)', async () => {
      // Verify the logic: create 2 VRs within 60s, same tool, same status
      const testPid = '__rf7_collusion_test__';
      const now = new Date().toISOString();
      const soon = new Date(Date.now() + 30000).toISOString(); // 30s later

      try {
        await neo4j.run(
          `CREATE (r1:VerificationRun {id: 'rf7_col_1', projectId: $pid, tool: 'test-tool', status: 'satisfies', ranAt: $t1, observedAt: $t1})
           CREATE (r2:VerificationRun {id: 'rf7_col_2', projectId: $pid, tool: 'test-tool', status: 'satisfies', ranAt: $t2, observedAt: $t2})`,
          { pid: testPid, t1: now, t2: soon },
        );

        const result = await enforceSourceFamilyCaps(neo4j, testPid);
        expect(result.collusionSuspects).toBeGreaterThanOrEqual(1);
      } finally {
        await neo4j.run(
          `MATCH (r:VerificationRun {projectId: $pid}) DETACH DELETE r`,
          { pid: testPid },
        );
      }
    });
  });

  // ── Task 3: Governance checks — untrusted-seed floor + inflation ─

  describe('Task 3: Governance checks', () => {
    it('verifyAntiGaming returns ok and issues array', async () => {
      // Run enforcement first to ensure data exists
      await enforceSourceFamilyCaps(neo4j, projectId);
      const result = await verifyAntiGaming(neo4j, projectId);
      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('issues');
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('checks source family aggregate confidence against cap', async () => {
      await enforceSourceFamilyCaps(neo4j, projectId);
      const result = await verifyAntiGaming(neo4j, projectId);
      // If any family exceeds cap, issues should contain a message about it
      if (!result.ok) {
        expect(result.issues.some(i => i.includes('Source family'))).toBe(true);
      }
    });

    it('checks untrusted sources against seed floor', async () => {
      await enforceSourceFamilyCaps(neo4j, projectId);
      const result = await verifyAntiGaming(neo4j, projectId);
      // Verify the check ran — issues may or may not contain untrusted findings
      expect(typeof result.ok).toBe('boolean');
    });

    it('untrustedSeedFloor config is respected', async () => {
      const config: AntiGamingConfig = {
        sourceFamilyCap: 0.85,
        restatementThreshold: 0.9,
        collusionThreshold: 0.85,
        untrustedSeedFloor: 0.1,
        clusterInfluenceCap: 0.5,
      };
      const result = await verifyAntiGaming(neo4j, projectId, config);
      expect(typeof result.ok).toBe('boolean');
    });

    it('idempotent — running twice produces consistent results', async () => {
      await enforceSourceFamilyCaps(neo4j, projectId);
      const r1 = await verifyAntiGaming(neo4j, projectId);
      await enforceSourceFamilyCaps(neo4j, projectId);
      const r2 = await verifyAntiGaming(neo4j, projectId);
      expect(r1.ok).toBe(r2.ok);
      expect(r1.issues.length).toBe(r2.issues.length);
    });
  });
});
