/**
 * [aud-tc-09] Batch E — direct behavioral tests
 *
 * Tests for:
 *   1. confidence-debt.ts  (computeConfidenceDebt, generateDebtDashboard, verifyDebtFieldPresence)
 *   2. calibration.ts      (runCalibration)
 *   3. anti-gaming.ts      (enforceSourceFamilyCaps, verifyAntiGaming)
 *
 * Anti-gaming rules enforced:
 *   - NO source-string-match tests
 *   - NO reimplemented logic
 *   - NO Cypher string assertions
 *   - Assert on params passed to mocks and return values only
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeConfidenceDebt,
  generateDebtDashboard,
  verifyDebtFieldPresence,
  type DebtConfig,
} from '../confidence-debt.js';
import { runCalibration, type CalibrationConfig } from '../calibration.js';
import {
  enforceSourceFamilyCaps,
  verifyAntiGaming,
  type AntiGamingConfig,
} from '../anti-gaming.js';

// ── Mock factory ────────────────────────────────────────────────────

function makeMockNeo4j() {
  return { run: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
}

// ════════════════════════════════════════════════════════════════════
// 1. confidence-debt.ts
// ════════════════════════════════════════════════════════════════════

describe('[aud-tc-09] Batch E — direct behavioral tests', () => {
  describe('confidence-debt', () => {
    let neo4j: ReturnType<typeof makeMockNeo4j>;

    beforeEach(() => {
      neo4j = makeMockNeo4j();
    });

    // ── computeConfidenceDebt ─────────────────────────────────────

    it('computeConfidenceDebt returns stamped count from neo4j result', async () => {
      neo4j.run.mockResolvedValueOnce([{ stamped: 42 }]);
      const result = await computeConfidenceDebt(neo4j as any, 'proj1');
      expect(result).toEqual({ stamped: 42 });
    });

    it('computeConfidenceDebt passes projectId and defaultRequired to neo4j.run', async () => {
      neo4j.run.mockResolvedValueOnce([{ stamped: 0 }]);
      const config: DebtConfig = { defaultRequired: 0.8, highDebtThreshold: 0.4, maxHighDebt: 5 };
      await computeConfidenceDebt(neo4j as any, 'proj_x', config);
      expect(neo4j.run).toHaveBeenCalledOnce();
      const params = neo4j.run.mock.calls[0][1];
      expect(params).toEqual({ projectId: 'proj_x', defaultRequired: 0.8 });
    });

    it('computeConfidenceDebt returns 0 when result is empty', async () => {
      neo4j.run.mockResolvedValueOnce([]);
      const result = await computeConfidenceDebt(neo4j as any, 'empty');
      expect(result).toEqual({ stamped: 0 });
    });

    // ── generateDebtDashboard ─────────────────────────────────────

    it('generateDebtDashboard returns dashboard with correct structure for entities with debt', async () => {
      // First call: computeConfidenceDebt stamps
      neo4j.run.mockResolvedValueOnce([{ stamped: 3 }]);
      // Second call: fetch debt records
      neo4j.run.mockResolvedValueOnce([
        { id: 'vr1', name: 'tool-a', kind: 'VerificationRun', required: 0.7, effective: 0.3, debt: 0.4 },
        { id: 'vr2', name: 'tool-b', kind: 'VerificationRun', required: 0.7, effective: 0.6, debt: 0.1 },
        { id: 'vr3', name: 'tool-c', kind: 'VerificationRun', required: 0.7, effective: 0.7, debt: 0.0 },
      ]);

      const dashboard = await generateDebtDashboard(neo4j as any, 'proj1');
      expect(dashboard.projectId).toBe('proj1');
      expect(dashboard.totalEntities).toBe(3);
      expect(dashboard.entitiesWithDebt).toBe(2); // vr1 and vr2 have debt > 0
      expect(dashboard.maxDebt).toBe(0.4);
      expect(typeof dashboard.durationMs).toBe('number');
    });

    it('generateDebtDashboard generates critical alert when maxDebt >= 0.5', async () => {
      neo4j.run.mockResolvedValueOnce([{ stamped: 1 }]);
      neo4j.run.mockResolvedValueOnce([
        { id: 'vr-critical', name: 'crit', kind: 'VerificationRun', required: 0.9, effective: 0.2, debt: 0.7 },
      ]);

      const dashboard = await generateDebtDashboard(neo4j as any, 'proj1');
      expect(dashboard.alerts.length).toBeGreaterThanOrEqual(1);
      expect(dashboard.alerts.some(a => a.includes('Critical'))).toBe(true);
    });

    it('generateDebtDashboard limits highDebtEntities to maxHighDebt from config', async () => {
      neo4j.run.mockResolvedValueOnce([{ stamped: 5 }]);
      const records = Array.from({ length: 5 }, (_, i) => ({
        id: `vr${i}`, name: `tool${i}`, kind: 'VerificationRun',
        required: 0.9, effective: 0.1, debt: 0.8,
      }));
      neo4j.run.mockResolvedValueOnce(records);

      const config: DebtConfig = { defaultRequired: 0.9, highDebtThreshold: 0.3, maxHighDebt: 2 };
      const dashboard = await generateDebtDashboard(neo4j as any, 'proj1', config);
      expect(dashboard.highDebtEntities.length).toBe(2);
    });

    it('generateDebtDashboard handles empty project gracefully', async () => {
      neo4j.run.mockResolvedValueOnce([{ stamped: 0 }]);
      neo4j.run.mockResolvedValueOnce([]);

      const dashboard = await generateDebtDashboard(neo4j as any, 'empty');
      expect(dashboard.totalEntities).toBe(0);
      expect(dashboard.entitiesWithDebt).toBe(0);
      expect(dashboard.avgDebt).toBe(0);
      expect(dashboard.maxDebt).toBe(0);
      expect(dashboard.highDebtEntities).toEqual([]);
      expect(dashboard.alerts).toEqual([]);
    });

    it('generateDebtDashboard produces warning when >30% entities exceed highDebtThreshold', async () => {
      neo4j.run.mockResolvedValueOnce([{ stamped: 3 }]);
      // All 3 above threshold 0.3
      neo4j.run.mockResolvedValueOnce([
        { id: 'a', name: 'ta', kind: 'VR', required: 0.7, effective: 0.2, debt: 0.45 },
        { id: 'b', name: 'tb', kind: 'VR', required: 0.7, effective: 0.3, debt: 0.4 },
        { id: 'c', name: 'tc', kind: 'VR', required: 0.7, effective: 0.35, debt: 0.35 },
      ]);

      const dashboard = await generateDebtDashboard(neo4j as any, 'proj1');
      // 3/3 = 100% above threshold → warning
      expect(dashboard.alerts.some(a => a.includes('Warning') && a.includes('%'))).toBe(true);
    });

    // ── verifyDebtFieldPresence ───────────────────────────────────

    it('verifyDebtFieldPresence returns ok:true when no entities are missing debt field', async () => {
      neo4j.run.mockResolvedValueOnce([{ missing: 0 }]);
      neo4j.run.mockResolvedValueOnce([{ cnt: 10 }]);
      const result = await verifyDebtFieldPresence(neo4j as any, 'proj1');
      expect(result).toEqual({ ok: true, missingDebt: 0, total: 10 });
    });

    it('verifyDebtFieldPresence returns ok:false when some entities lack confidenceDebt', async () => {
      neo4j.run.mockResolvedValueOnce([{ missing: 3 }]);
      neo4j.run.mockResolvedValueOnce([{ cnt: 10 }]);
      const result = await verifyDebtFieldPresence(neo4j as any, 'proj1');
      expect(result).toEqual({ ok: false, missingDebt: 3, total: 10 });
    });

    it('verifyDebtFieldPresence passes projectId in both queries', async () => {
      neo4j.run.mockResolvedValueOnce([{ missing: 0 }]);
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);
      await verifyDebtFieldPresence(neo4j as any, 'proj_check');
      expect(neo4j.run).toHaveBeenCalledTimes(2);
      expect(neo4j.run.mock.calls[0][1]).toEqual({ projectId: 'proj_check' });
      expect(neo4j.run.mock.calls[1][1]).toEqual({ projectId: 'proj_check' });
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 2. calibration.ts
  // ════════════════════════════════════════════════════════════════

  describe('calibration', () => {
    let neo4j: ReturnType<typeof makeMockNeo4j>;

    beforeEach(() => {
      neo4j = makeMockNeo4j();
    });

    it('runCalibration returns structured output with production and shadow metrics', async () => {
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', prodConf: 0.8, shadowConf: 0.7, outcome: 1 },
        { id: 'r2', prodConf: 0.3, shadowConf: 0.4, outcome: 0 },
      ]);

      const result = await runCalibration(neo4j as any, 'proj1');
      expect(result.projectId).toBe('proj1');
      expect(typeof result.production.brierScore).toBe('number');
      expect(typeof result.shadow.brierScore).toBe('number');
      expect(result.production.sampleCount).toBe(2);
      expect(result.shadow.sampleCount).toBe(2);
      expect(typeof result.durationMs).toBe('number');
    });

    it('runCalibration marks promotionEligible:true when shadow improves over production', async () => {
      // shadow = 0.7 for satisfies → Brier(0.7-1)^2 = 0.09, prod = 0.5 → (0.5-1)^2 = 0.25
      // shadow better → eligible
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', prodConf: 0.5, shadowConf: 0.7, outcome: 1 },
      ]);

      const result = await runCalibration(neo4j as any, 'proj1');
      expect(result.promotionEligible).toBe(true);
      expect(result.promotionBlockers).toEqual([]);
    });

    it('runCalibration blocks promotion when shadow Brier regresses beyond maxBrierRegression', async () => {
      // prod conf=0.9 for satisfies → Brier = (0.9-1)^2 = 0.01
      // shadow conf=0.2 for satisfies → Brier = (0.2-1)^2 = 0.64
      // shadow much worse → blocked
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', prodConf: 0.9, shadowConf: 0.2, outcome: 1 },
      ]);

      const result = await runCalibration(neo4j as any, 'proj1');
      expect(result.promotionEligible).toBe(false);
      expect(result.promotionBlockers.length).toBeGreaterThan(0);
    });

    it('runCalibration blocks when both Brier scores exceed threshold', async () => {
      // Both high Brier → both above 0.25 threshold
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', prodConf: 0.1, shadowConf: 0.1, outcome: 1 },
      ]);

      const config: CalibrationConfig = { bins: 10, brierThreshold: 0.25, maxBrierRegression: 0.05 };
      const result = await runCalibration(neo4j as any, 'proj1', config);
      // Brier = (0.1-1)^2 = 0.81 for both, well above 0.25
      expect(result.promotionEligible).toBe(false);
      expect(result.promotionBlockers.some(b => b.includes('threshold'))).toBe(true);
    });

    it('runCalibration handles empty VR set gracefully', async () => {
      neo4j.run.mockResolvedValueOnce([]);
      const result = await runCalibration(neo4j as any, 'empty');
      expect(result.production.sampleCount).toBe(0);
      expect(result.shadow.sampleCount).toBe(0);
      expect(result.production.brierScore).toBe(0);
    });

    it('runCalibration passes projectId to neo4j.run', async () => {
      neo4j.run.mockResolvedValueOnce([]);
      await runCalibration(neo4j as any, 'proj_cal');
      expect(neo4j.run).toHaveBeenCalledOnce();
      expect(neo4j.run.mock.calls[0][1]).toEqual({ projectId: 'proj_cal' });
    });

    it('runCalibration respects custom bins config in bucket output', async () => {
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', prodConf: 0.5, shadowConf: 0.5, outcome: 1 },
      ]);
      const config: CalibrationConfig = { bins: 5, brierThreshold: 0.25, maxBrierRegression: 0.05 };
      const result = await runCalibration(neo4j as any, 'proj1', config);
      expect(result.production.buckets.length).toBe(5);
      expect(result.shadow.buckets.length).toBe(5);
    });

    it('runCalibration includes exactly one project-level slice', async () => {
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', prodConf: 0.6, shadowConf: 0.7, outcome: 1 },
      ]);
      const result = await runCalibration(neo4j as any, 'proj1');
      expect(result.slices.length).toBe(1);
      expect(result.slices[0].level).toBe('project');
      expect(result.slices[0].sliceId).toBe('proj1');
      expect(typeof result.slices[0].brierDelta).toBe('number');
      expect(typeof result.slices[0].brierImproved).toBe('boolean');
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 3. anti-gaming.ts
  // ════════════════════════════════════════════════════════════════

  describe('anti-gaming', () => {
    let neo4j: ReturnType<typeof makeMockNeo4j>;

    beforeEach(() => {
      neo4j = makeMockNeo4j();
    });

    // ── enforceSourceFamilyCaps ───────────────────────────────────

    it('enforceSourceFamilyCaps returns structured result with all counters', async () => {
      // families query
      neo4j.run.mockResolvedValueOnce([
        { family: 'eslint', cnt: 3, ids: ['r1', 'r2', 'r3'] },
      ]);
      // cap application for eslint family
      neo4j.run.mockResolvedValueOnce([]);
      // duplicates query
      neo4j.run.mockResolvedValueOnce([]);
      // collusion query
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);
      // untrusted seed
      neo4j.run.mockResolvedValueOnce([{ cnt: 2 }]);

      const result = await enforceSourceFamilyCaps(neo4j as any, 'proj1');
      expect(result.projectId).toBe('proj1');
      expect(result.sourceFamiliesDetected).toBe(1);
      expect(result.capsApplied).toBe(3);
      expect(result.duplicatesCollapsed).toBe(0);
      expect(result.collusionSuspects).toBe(0);
      expect(result.untrustedSeeded).toBe(2);
      expect(typeof result.durationMs).toBe('number');
    });

    it('enforceSourceFamilyCaps collapses duplicates keeping first, marking rest', async () => {
      neo4j.run.mockResolvedValueOnce([]); // no families
      // duplicates: cluster of 3 with same hash
      neo4j.run.mockResolvedValueOnce([
        { hash: 'abc123', ids: ['d1', 'd2', 'd3'], cnt: 3 },
      ]);
      // mark duplicates (d2, d3)
      neo4j.run.mockResolvedValueOnce([]);
      // collusion
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);
      // untrusted
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);

      const result = await enforceSourceFamilyCaps(neo4j as any, 'proj1');
      expect(result.duplicatesCollapsed).toBe(2); // 3 in cluster, first kept, 2 collapsed
    });

    it('enforceSourceFamilyCaps passes untrustedSeedFloor from config', async () => {
      neo4j.run.mockResolvedValueOnce([]); // no families
      neo4j.run.mockResolvedValueOnce([]); // no duplicates
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]); // no collusion
      neo4j.run.mockResolvedValueOnce([{ cnt: 5 }]); // untrusted

      const config: AntiGamingConfig = {
        sourceFamilyCap: 0.4,
        restatementThreshold: 0.9,
        collusionThreshold: 0.85,
        untrustedSeedFloor: 0.2,
        clusterInfluenceCap: 0.5,
      };
      await enforceSourceFamilyCaps(neo4j as any, 'proj1', config);

      // Last call is the untrusted seed query — check floor param
      const lastCall = neo4j.run.mock.calls[neo4j.run.mock.calls.length - 1];
      expect(lastCall[1]).toMatchObject({ projectId: 'proj1', floor: 0.2 });
    });

    it('enforceSourceFamilyCaps passes sourceFamilyCap from config to cap application', async () => {
      neo4j.run.mockResolvedValueOnce([
        { family: 'jest', cnt: 2, ids: ['r1', 'r2'] },
      ]);
      // cap application
      neo4j.run.mockResolvedValueOnce([]);
      neo4j.run.mockResolvedValueOnce([]); // no duplicates
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]); // no collusion
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]); // no untrusted

      const config: AntiGamingConfig = {
        sourceFamilyCap: 0.35,
        restatementThreshold: 0.9,
        collusionThreshold: 0.85,
        untrustedSeedFloor: 0.1,
        clusterInfluenceCap: 0.5,
      };
      await enforceSourceFamilyCaps(neo4j as any, 'proj1', config);

      // Second call is the SET sourceFamily query
      const capCall = neo4j.run.mock.calls[1];
      expect(capCall[1]).toMatchObject({ cap: 0.35, family: 'jest' });
    });

    it('enforceSourceFamilyCaps handles multiple families', async () => {
      neo4j.run.mockResolvedValueOnce([
        { family: 'eslint', cnt: 2, ids: ['r1', 'r2'] },
        { family: 'tsc', cnt: 1, ids: ['r3'] },
      ]);
      // cap for eslint
      neo4j.run.mockResolvedValueOnce([]);
      // cap for tsc
      neo4j.run.mockResolvedValueOnce([]);
      // no duplicates
      neo4j.run.mockResolvedValueOnce([]);
      // no collusion
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);
      // no untrusted
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);

      const result = await enforceSourceFamilyCaps(neo4j as any, 'proj1');
      expect(result.sourceFamiliesDetected).toBe(2);
      expect(result.capsApplied).toBe(3); // 2 + 1
    });

    it('enforceSourceFamilyCaps returns collusionSuspects from graph query', async () => {
      neo4j.run.mockResolvedValueOnce([]); // no families
      neo4j.run.mockResolvedValueOnce([]); // no duplicates
      neo4j.run.mockResolvedValueOnce([{ cnt: 7 }]); // 7 collusion suspects
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]); // no untrusted

      const result = await enforceSourceFamilyCaps(neo4j as any, 'proj1');
      expect(result.collusionSuspects).toBe(7);
    });

    // ── verifyAntiGaming ──────────────────────────────────────────

    it('verifyAntiGaming returns ok:true when no family exceeds cap and no untrusted above floor', async () => {
      // family check: none exceed
      neo4j.run.mockResolvedValueOnce([]);
      // floor check: none above
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);

      const result = await verifyAntiGaming(neo4j as any, 'proj1');
      expect(result).toEqual({ ok: true, issues: [] });
    });

    it('verifyAntiGaming reports issues when source family exceeds cap', async () => {
      neo4j.run.mockResolvedValueOnce([
        { fam: 'eslint', avgConf: 0.95, cnt: 10 },
      ]);
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);

      const result = await verifyAntiGaming(neo4j as any, 'proj1');
      expect(result.ok).toBe(false);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]).toContain('eslint');
    });

    it('verifyAntiGaming reports issues when untrusted sources exceed floor', async () => {
      neo4j.run.mockResolvedValueOnce([]); // no family cap issues
      neo4j.run.mockResolvedValueOnce([{ cnt: 5 }]); // 5 untrusted above floor

      const result = await verifyAntiGaming(neo4j as any, 'proj1');
      expect(result.ok).toBe(false);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]).toContain('untrusted');
    });

    it('verifyAntiGaming passes custom config cap and floor values', async () => {
      neo4j.run.mockResolvedValueOnce([]);
      neo4j.run.mockResolvedValueOnce([{ cnt: 0 }]);

      const config: AntiGamingConfig = {
        sourceFamilyCap: 0.3,
        restatementThreshold: 0.9,
        collusionThreshold: 0.85,
        untrustedSeedFloor: 0.05,
        clusterInfluenceCap: 0.5,
      };
      await verifyAntiGaming(neo4j as any, 'proj1', config);

      expect(neo4j.run.mock.calls[0][1]).toMatchObject({ cap: 0.3 });
      expect(neo4j.run.mock.calls[1][1]).toMatchObject({ floor: 0.05 });
    });
  });
});
