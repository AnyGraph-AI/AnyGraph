/**
 * L4: Confidence Governance Analytics — Test Suite
 *
 * Tests the four L4 tasks:
 * 1. Confidence regression budget tracking
 * 2. Evidence completeness trend analytics
 * 3. Override entropy trend analytics
 * 4. Policy effectiveness trend analytics
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L4
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  checkConfidenceRegression,
  analyzeCompletenessTrend,
  computeOverrideEntropy,
  analyzePolicyEffectiveness,
  DEFAULT_REGRESSION_BUDGET,
  type ConfidenceSnapshot,
  type EvidenceCompletenessSnapshot,
  type OverrideEvent,
  type PolicyEffectivenessSnapshot,
} from '../../index.js';

// ============================================================================
// HELPERS
// ============================================================================

function makeConfidenceSnapshot(avg: number, ts = '2026-03-14T00:00:00.000Z'): ConfidenceSnapshot {
  return {
    timestamp: ts,
    projectId: 'proj_test',
    edgeConfidence: { CALLS: avg, CONTAINS: 1.0, PART_OF: 1.0 },
    lowConfidenceEdges: avg < 1.0 ? 10 : 0,
    totalEdges: 100,
    weightedAverage: avg,
  };
}

function makeCompletenessSnapshot(pct: number, ts = '2026-03-14T00:00:00.000Z'): EvidenceCompletenessSnapshot {
  const total = 100;
  const withEv = Math.round(total * pct / 100);
  return {
    timestamp: ts,
    projectId: 'proj_test',
    totalDoneTasks: total,
    tasksWithEvidence: withEv,
    tasksWithoutEvidence: total - withEv,
    completenessPercent: pct,
    byCategory: {},
  };
}

function makeEffectivenessSnapshot(prevented: number, escaped: number, fp: number): PolicyEffectivenessSnapshot {
  const total = prevented + escaped;
  return {
    timestamp: '2026-03-14T00:00:00.000Z',
    projectId: 'proj_test',
    preventedViolations: prevented,
    escapedViolations: escaped,
    preventionRate: total > 0 ? prevented / total : 1,
    falsePositives: fp,
    falsePositiveRate: total > 0 ? fp / (total + fp) : 0,
    byInvariant: {},
  };
}

describe('L4: Confidence Governance Analytics', () => {
  beforeEach(() => {
    setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' });
  });

  afterEach(() => {
    teardownHermeticEnv();
  });

  describe('Task 1: Confidence regression budget tracking', () => {
    it('stable confidence within budget', () => {
      const current = makeConfidenceSnapshot(0.95);
      const previous = makeConfidenceSnapshot(0.95);
      const baseline = makeConfidenceSnapshot(0.95);
      const result = checkConfidenceRegression(current, previous, baseline);
      expect(result.withinBudget).toBe(true);
      expect(result.alerts).toHaveLength(0);
    });

    it('small drop within period budget', () => {
      const current = makeConfidenceSnapshot(0.92);
      const previous = makeConfidenceSnapshot(0.95);
      const result = checkConfidenceRegression(current, previous, null);
      expect(result.withinBudget).toBe(true);
      expect(result.periodDrop!).toBeLessThan(DEFAULT_REGRESSION_BUDGET.maxDropPerPeriod);
    });

    it('large period drop exceeds budget', () => {
      const current = makeConfidenceSnapshot(0.85);
      const previous = makeConfidenceSnapshot(0.95);
      const result = checkConfidenceRegression(current, previous, null);
      expect(result.withinBudget).toBe(false);
      expect(result.alerts.some(a => a.includes('Period drop'))).toBe(true);
    });

    it('absolute drop from baseline exceeds budget', () => {
      const current = makeConfidenceSnapshot(0.82);
      const baseline = makeConfidenceSnapshot(0.95);
      const result = checkConfidenceRegression(current, null, baseline);
      expect(result.withinBudget).toBe(false);
      expect(result.alerts.some(a => a.includes('Absolute drop'))).toBe(true);
    });

    it('below minimum weighted average triggers alert', () => {
      const current = makeConfidenceSnapshot(0.70);
      const result = checkConfidenceRegression(current, null, null);
      expect(result.withinBudget).toBe(false);
      expect(result.alerts.some(a => a.includes('below minimum'))).toBe(true);
    });
  });

  describe('Task 2: Evidence completeness trend analytics', () => {
    it('improving trend detected', () => {
      const current = makeCompletenessSnapshot(25.0);
      const previous = makeCompletenessSnapshot(15.0);
      const trend = analyzeCompletenessTrend(current, previous);
      expect(trend.direction).toBe('improving');
      expect(trend.delta).toBe(10.0);
      expect(trend.alert).toBeNull();
    });

    it('declining trend generates alert', () => {
      const current = makeCompletenessSnapshot(10.0);
      const previous = makeCompletenessSnapshot(15.0);
      const trend = analyzeCompletenessTrend(current, previous);
      expect(trend.direction).toBe('declining');
      expect(trend.alert).toContain('declining');
    });

    it('stable trend with small delta', () => {
      const current = makeCompletenessSnapshot(15.2);
      const previous = makeCompletenessSnapshot(15.0);
      const trend = analyzeCompletenessTrend(current, previous);
      expect(trend.direction).toBe('stable');
    });

    it('first snapshot has no previous', () => {
      const current = makeCompletenessSnapshot(22.4);
      const trend = analyzeCompletenessTrend(current, null);
      expect(trend.direction).toBe('stable');
      expect(trend.delta).toBeNull();
      expect(trend.previousPercent).toBeNull();
    });
  });

  describe('Task 3: Override entropy trend analytics', () => {
    it('zero overrides = zero entropy = healthy', () => {
      const result = computeOverrideEntropy([]);
      expect(result.entropy).toBe(0);
      expect(result.healthy).toBe(true);
      expect(result.totalOverrides).toBe(0);
    });

    it('single override type = low entropy', () => {
      const events: OverrideEvent[] = [
        { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'done_without_witness', reason: 'test', issuerId: 'admin' },
        { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'done_without_witness', reason: 'test', issuerId: 'admin' },
      ];
      const result = computeOverrideEntropy(events);
      expect(result.uniqueTypes).toBe(1);
      expect(result.uniqueInvariants).toBe(1);
      expect(result.healthy).toBe(true);
    });

    it('many diverse overrides = high entropy = unhealthy', () => {
      const events: OverrideEvent[] = [
        { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'inv1', reason: 'test', issuerId: 'a' },
        { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'mode_downgrade', invariantId: 'inv2', reason: 'test', issuerId: 'b' },
        { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'threshold_relaxation', invariantId: 'inv3', reason: 'test', issuerId: 'c' },
        { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'manual_pass', invariantId: 'inv4', reason: 'test', issuerId: 'd' },
        { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'inv5', reason: 'test', issuerId: 'e' },
        { timestamp: '2026-03-14', projectId: 'proj_test', overrideType: 'mode_downgrade', invariantId: 'inv6', reason: 'test', issuerId: 'f' },
      ];
      const result = computeOverrideEntropy(events, new Date('2026-03-14'), 1.5);
      expect(result.healthy).toBe(false);
      expect(result.alert).toContain('entropy');
    });

    it('expired overrides counted separately', () => {
      const events: OverrideEvent[] = [
        { timestamp: '2026-03-01', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'inv1', reason: 'test', issuerId: 'a', expiresAt: '2026-03-10T00:00:00.000Z' },
        { timestamp: '2026-03-12', projectId: 'proj_test', overrideType: 'waiver', invariantId: 'inv1', reason: 'test', issuerId: 'a' },
      ];
      const result = computeOverrideEntropy(events, new Date('2026-03-14'));
      expect(result.expiredOverrides).toBe(1);
      expect(result.activeOverrides).toBe(1);
    });
  });

  describe('Task 4: Policy effectiveness trend analytics', () => {
    it('high prevention rate = effective', () => {
      const current = makeEffectivenessSnapshot(95, 5, 2);
      const result = analyzePolicyEffectiveness(current, null);
      expect(result.effective).toBe(true);
      expect(result.direction).toBe('stable');
      expect(result.alert).toBeNull();
    });

    it('low prevention rate triggers alert', () => {
      const current = makeEffectivenessSnapshot(70, 30, 0);
      const result = analyzePolicyEffectiveness(current, null);
      expect(result.effective).toBe(false);
      expect(result.alert).toContain('Prevention rate');
    });

    it('high false positive rate triggers alert', () => {
      const current = makeEffectivenessSnapshot(90, 5, 20);
      const result = analyzePolicyEffectiveness(current, null);
      expect(result.effective).toBe(false);
      expect(result.alert).toContain('False positive');
    });

    it('improving trend detected from previous', () => {
      const current = makeEffectivenessSnapshot(95, 5, 1);
      const previous = makeEffectivenessSnapshot(85, 15, 5);
      const result = analyzePolicyEffectiveness(current, previous);
      expect(result.direction).toBe('improving');
      expect(result.effective).toBe(true);
    });

    it('declining trend detected from previous', () => {
      const current = makeEffectivenessSnapshot(85, 15, 5);
      const previous = makeEffectivenessSnapshot(95, 5, 1);
      const result = analyzePolicyEffectiveness(current, previous);
      expect(result.direction).toBe('declining');
    });
  });
});
