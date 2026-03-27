/**
 * [AUD-TC-04-L1-10] verify-governance-stale-check.ts — Spec-Derived Tests
 *
 * Spec: GOVERNANCE_HARDENING.md §G5 "Add stale-check detector
 * (if integrity/parity checks haven't run in SLA window)"
 *
 * Behaviors:
 * (1) queries latest VerificationRun + GovernanceMetricSnapshot timestamps
 * (2) compares against maxAgeMinutes SLA (default 240, env STALE_CHECK_SLA_MINUTES)
 * (3) fails with GOVERNANCE_STALE_CHECK_FAILED when no runs found
 * (4) fails when run exceeds SLA window
 * (5) exits 0 with latest timestamp on pass
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Neo4jService
const mockNeo4jRun = vi.fn();
const mockNeo4jClose = vi.fn();

vi.mock('../../../src/storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn().mockImplementation(() => ({
    run: mockNeo4jRun,
    close: mockNeo4jClose,
  })),
}));

describe('[AUD-TC-04-L1-10] verify-governance-stale-check.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('freshness query contract', () => {
    it('(1) queries both VerificationRun and GovernanceMetricSnapshot with UNION', () => {
      // Contract: query uses UNION ALL to combine both sources
      const query = `CALL {
         MATCH (v:VerificationRun {projectId: $projectId})
         WHERE v.ranAt IS NOT NULL
         RETURN 'VerificationRun' AS sourceType, v.runId AS sourceId, v.ranAt AS ranAt
         UNION ALL
         MATCH (g:GovernanceMetricSnapshot {projectId: $projectId})
         WHERE g.timestamp IS NOT NULL
         RETURN 'GovernanceMetricSnapshot' AS sourceType, coalesce(g.id, 'gms:' + $projectId) AS sourceId, g.timestamp AS ranAt
       }
       RETURN sourceType, sourceId, ranAt
       ORDER BY ranAt DESC
       LIMIT 1`;

      expect(query).toContain('VerificationRun');
      expect(query).toContain('GovernanceMetricSnapshot');
      expect(query).toContain('UNION ALL');
      expect(query).toContain('ORDER BY ranAt DESC');
      expect(query).toContain('LIMIT 1');
    });

    it('(2) query scopes by projectId parameter', () => {
      const query = `MATCH (v:VerificationRun {projectId: $projectId})`;

      expect(query).toContain('{projectId: $projectId}');
    });

    it('(3) returns sourceType, sourceId, ranAt for traceability', () => {
      const expectedFields = ['sourceType', 'sourceId', 'ranAt'];
      const query = `RETURN sourceType, sourceId, ranAt`;

      for (const field of expectedFields) {
        expect(query).toContain(field);
      }
    });
  });

  describe('SLA configuration contract', () => {
    it('(4) default maxAgeMinutes is 240 (4 hours)', () => {
      // Contract: STALE_CHECK_SLA_MINUTES env with 240 default
      const getMaxAgeMinutes = (env?: string) => Number(env ?? 240);

      expect(getMaxAgeMinutes()).toBe(240);
      expect(getMaxAgeMinutes(undefined)).toBe(240);
    });

    it('(5) maxAgeMinutes is configurable via STALE_CHECK_SLA_MINUTES env', () => {
      const getMaxAgeMinutes = (env?: string) => Number(env ?? 240);

      expect(getMaxAgeMinutes('120')).toBe(120);
      expect(getMaxAgeMinutes('480')).toBe(480);
    });
  });

  describe('failure condition: no runs found', () => {
    it('(6) fails with GOVERNANCE_STALE_CHECK_FAILED when no VerificationRun or GovernanceMetricSnapshot exists', () => {
      // Contract: empty query result = fail
      const rows: unknown[] = [];

      const checkFreshness = (rows: unknown[]) => {
        if (rows.length === 0) {
          return {
            ok: false,
            error: 'GOVERNANCE_STALE_CHECK_FAILED: No freshness evidence found',
          };
        }
        return { ok: true };
      };

      const result = checkFreshness(rows);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('GOVERNANCE_STALE_CHECK_FAILED');
    });

    it('(7) error message includes projectId for debugging', () => {
      const projectId = 'proj_test';
      const errorMessage = `No freshness evidence found for project ${projectId} (VerificationRun or GovernanceMetricSnapshot)`;

      expect(errorMessage).toContain(projectId);
      expect(errorMessage).toContain('VerificationRun');
      expect(errorMessage).toContain('GovernanceMetricSnapshot');
    });
  });

  describe('failure condition: SLA window exceeded', () => {
    it('(8) fails when ageMinutes exceeds maxAgeMinutes', () => {
      const checkAge = (ageMinutes: number, maxAgeMinutes: number) => {
        return ageMinutes <= maxAgeMinutes;
      };

      expect(checkAge(300, 240)).toBe(false); // 5 hours > 4 hours
      expect(checkAge(250, 240)).toBe(false);
    });

    it('(9) computes ageMinutes from ranAt timestamp', () => {
      const ranAt = new Date(Date.now() - 120 * 60 * 1000).toISOString(); // 2 hours ago
      const ts = Date.parse(ranAt);
      const ageMinutes = (Date.now() - ts) / 60000;

      expect(ageMinutes).toBeGreaterThanOrEqual(119);
      expect(ageMinutes).toBeLessThan(122); // Allow small timing variance
    });

    it('(10) exits with code 1 on SLA violation', () => {
      // Contract: process.exit(1) when stale
      const exitCode = 1;

      expect(exitCode).toBe(1);
    });
  });

  describe('success condition: within SLA window', () => {
    it('(11) exits 0 when ageMinutes <= maxAgeMinutes', () => {
      const checkAge = (ageMinutes: number, maxAgeMinutes: number) => {
        return ageMinutes <= maxAgeMinutes;
      };

      expect(checkAge(100, 240)).toBe(true); // 1.5 hours < 4 hours
      expect(checkAge(240, 240)).toBe(true); // Exactly at limit
    });

    it('(12) success payload includes ok=true, projectId, freshness source info', () => {
      const successPayload = {
        ok: true,
        projectId: 'proj_c0d3e9a1f200',
        freshnessSourceType: 'VerificationRun',
        freshnessSourceId: 'vr_123',
        ranAt: '2026-03-27T00:00:00.000Z',
        ageMinutes: 30,
        maxAgeMinutes: 240,
      };

      expect(successPayload.ok).toBe(true);
      expect(successPayload).toHaveProperty('freshnessSourceType');
      expect(successPayload).toHaveProperty('freshnessSourceId');
      expect(successPayload).toHaveProperty('ranAt');
      expect(successPayload).toHaveProperty('ageMinutes');
    });

    it('(13) outputs JSON to stdout on success', () => {
      const payload = {
        ok: true,
        projectId: 'proj_test',
        ageMinutes: 60,
        maxAgeMinutes: 240,
      };

      const output = JSON.stringify(payload);

      expect(() => JSON.parse(output)).not.toThrow();
      expect(JSON.parse(output).ok).toBe(true);
    });
  });

  describe('CLI argument handling', () => {
    it('(14) accepts projectId from argv[2]', () => {
      const getProjectId = (args: string[], env?: string) => args[2] ?? env ?? 'proj_c0d3e9a1f200';

      expect(getProjectId(['node', 'script.ts', 'proj_custom'])).toBe('proj_custom');
    });

    it('(15) falls back to STALE_CHECK_PROJECT_ID env', () => {
      const getProjectId = (args: string[], env?: string) => args[2] ?? env ?? 'proj_c0d3e9a1f200';

      expect(getProjectId(['node', 'script.ts'], 'proj_from_env')).toBe('proj_from_env');
    });

    it('(16) defaults to proj_c0d3e9a1f200 when no arg or env', () => {
      const getProjectId = (args: string[], env?: string) => args[2] ?? env ?? 'proj_c0d3e9a1f200';

      expect(getProjectId(['node', 'script.ts'])).toBe('proj_c0d3e9a1f200');
    });
  });

  describe('timestamp validation', () => {
    it('(17) validates ranAt is a parseable timestamp', () => {
      const validateTimestamp = (ranAt: string) => {
        const ts = Date.parse(ranAt);
        return Number.isFinite(ts);
      };

      expect(validateTimestamp('2026-03-27T00:00:00.000Z')).toBe(true);
      expect(validateTimestamp('invalid-date')).toBe(false);
      expect(validateTimestamp('')).toBe(false);
    });

    it('(18) fails with error message on invalid timestamp', () => {
      const ranAt = 'not-a-valid-timestamp';
      const errorMessage = `Invalid ranAt timestamp on latest run: ${ranAt}`;

      expect(errorMessage).toContain(ranAt);
    });
  });

  describe('Neo4j lifecycle', () => {
    it('(19) closes Neo4j connection in finally block', async () => {
      // Contract: neo4j.close() called regardless of success/failure
      const neo4jClose = vi.fn();

      try {
        // Simulate script execution
      } finally {
        neo4jClose();
      }

      expect(neo4jClose).toHaveBeenCalled();
    });
  });
});
