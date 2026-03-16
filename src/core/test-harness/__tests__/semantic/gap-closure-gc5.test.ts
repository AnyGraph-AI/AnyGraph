/**
 * GC-5: Composite Risk Scoring — TDD Spec Tests
 *
 * Spec requirements:
 * 1. compositeRisk: weighted sum of structural (0.3), change (0.3), ownership (0.2), verGap (0.2)
 * 2. Absolute flags: NO_VERIFICATION, HIGH_CHURN, HIGH_TEMPORAL_COUPLING, GOVERNANCE_PATH
 * 3. resolveRiskTier: percentile baseline + flag promotion
 * 4. All four tiers populated with meaningful discrimination
 * 5. Functions in verification/governance/sarif paths without coverage get flag-promoted
 */
import { describe, it, expect } from 'vitest';
import {
  percentileRank,
  computeFlags,
  resolveRiskTier,
  computeCompositeRisk,
  ownershipRisk,
  type CompositeRiskInput,
} from '../../../../scripts/enrichment/composite-risk-scoring.js';

// ─── percentileRank ────────────────────────────────────────────

describe('[GC-5] percentileRank', () => {
  it('returns 0 for minimum value', () => {
    expect(percentileRank(1, [1, 2, 3, 4, 5])).toBe(0);
  });

  it('returns 1.0 for value above all', () => {
    expect(percentileRank(6, [1, 2, 3, 4, 5])).toBe(1.0);
  });

  it('returns 0.5 for median of even population', () => {
    // 3 is greater than 1,2 (2 out of 4) = 0.5
    expect(percentileRank(3, [1, 2, 3, 4])).toBe(0.5);
  });

  it('returns 0 for empty population', () => {
    expect(percentileRank(5, [])).toBe(0);
  });

  it('handles all identical values', () => {
    expect(percentileRank(1, [1, 1, 1, 1])).toBe(0);
  });

  it('returns correct percentile for mid-range value', () => {
    // 30 is greater than 10,20 (2 out of 5) = 0.4
    expect(percentileRank(30, [10, 20, 30, 40, 50])).toBe(0.4);
  });
});

// ─── computeFlags ──────────────────────────────────────────────

describe('[GC-5] computeFlags', () => {
  const baseInput: CompositeRiskInput = {
    riskLevel: 5.0,
    churnRelative: 0.5,
    authorCount: 1,
    hasVerification: true,
    temporalCoupling: 0,
    filePath: '/src/core/parsers/typescript-parser.ts',
  };

  it('returns empty flags for normal function', () => {
    expect(computeFlags(baseInput)).toEqual([]);
  });

  it('flags NO_VERIFICATION when no ANALYZED edges', () => {
    const flags = computeFlags({ ...baseInput, hasVerification: false });
    expect(flags).toContain('NO_VERIFICATION');
  });

  it('flags HIGH_CHURN at churnRelative >= 2.0', () => {
    expect(computeFlags({ ...baseInput, churnRelative: 2.0 })).toContain('HIGH_CHURN');
    expect(computeFlags({ ...baseInput, churnRelative: 1.99 })).not.toContain('HIGH_CHURN');
  });

  it('flags HIGH_TEMPORAL_COUPLING at >= 3', () => {
    expect(computeFlags({ ...baseInput, temporalCoupling: 3 })).toContain('HIGH_TEMPORAL_COUPLING');
    expect(computeFlags({ ...baseInput, temporalCoupling: 2 })).not.toContain('HIGH_TEMPORAL_COUPLING');
  });

  it('flags GOVERNANCE_PATH for verification/ files', () => {
    const flags = computeFlags({
      ...baseInput,
      filePath: '/src/core/verification/sarif-importer.ts',
    });
    expect(flags).toContain('GOVERNANCE_PATH');
  });

  it('flags GOVERNANCE_PATH for governance/ files', () => {
    const flags = computeFlags({
      ...baseInput,
      filePath: '/src/utils/governance/metrics.ts',
    });
    expect(flags).toContain('GOVERNANCE_PATH');
  });

  it('flags GOVERNANCE_PATH for sarif/ files', () => {
    const flags = computeFlags({
      ...baseInput,
      filePath: '/src/core/sarif/parser.ts',
    });
    expect(flags).toContain('GOVERNANCE_PATH');
  });

  it('can have multiple flags simultaneously', () => {
    const flags = computeFlags({
      ...baseInput,
      hasVerification: false,
      churnRelative: 3.0,
      temporalCoupling: 5,
      filePath: '/src/core/verification/sarif-importer.ts',
    });
    expect(flags).toHaveLength(4);
    expect(flags).toContain('NO_VERIFICATION');
    expect(flags).toContain('HIGH_CHURN');
    expect(flags).toContain('HIGH_TEMPORAL_COUPLING');
    expect(flags).toContain('GOVERNANCE_PATH');
  });
});

// ─── resolveRiskTier ───────────────────────────────────────────

describe('[GC-5] resolveRiskTier', () => {
  it('LOW for percentile < 0.50 with no flags', () => {
    expect(resolveRiskTier(0.30, [])).toBe('LOW');
  });

  it('MEDIUM for percentile 0.50–0.79 with no flags', () => {
    expect(resolveRiskTier(0.50, [])).toBe('MEDIUM');
    expect(resolveRiskTier(0.79, [])).toBe('MEDIUM');
  });

  it('HIGH for percentile 0.80–0.94 with no flags', () => {
    expect(resolveRiskTier(0.80, [])).toBe('HIGH');
    expect(resolveRiskTier(0.94, [])).toBe('HIGH');
  });

  it('CRITICAL for percentile >= 0.95 with no flags', () => {
    expect(resolveRiskTier(0.95, [])).toBe('CRITICAL');
    expect(resolveRiskTier(1.0, [])).toBe('CRITICAL');
  });

  it('one flag promotes LOW → MEDIUM', () => {
    expect(resolveRiskTier(0.30, ['NO_VERIFICATION'])).toBe('MEDIUM');
  });

  it('two flags promote LOW → HIGH', () => {
    expect(resolveRiskTier(0.30, ['NO_VERIFICATION', 'HIGH_CHURN'])).toBe('HIGH');
  });

  it('three flags promote LOW → CRITICAL', () => {
    expect(resolveRiskTier(0.30, ['NO_VERIFICATION', 'HIGH_CHURN', 'GOVERNANCE_PATH'])).toBe('CRITICAL');
  });

  it('flags cannot promote above CRITICAL', () => {
    expect(resolveRiskTier(0.95, ['NO_VERIFICATION', 'HIGH_CHURN'])).toBe('CRITICAL');
  });

  it('flag promotion stacks from MEDIUM', () => {
    expect(resolveRiskTier(0.60, ['HIGH_CHURN'])).toBe('HIGH');
  });
});

// ─── compositeRisk ─────────────────────────────────────────────

describe('[GC-5] computeCompositeRisk', () => {
  it('returns 0.0 when all components are 0', () => {
    expect(computeCompositeRisk(0, 0, 0, 0)).toBe(0);
  });

  it('returns 1.0 when all components are 1.0', () => {
    expect(computeCompositeRisk(1.0, 1.0, 1.0, 1.0)).toBeCloseTo(1.0);
  });

  it('weights structural at 0.3', () => {
    expect(computeCompositeRisk(1.0, 0, 0, 0)).toBeCloseTo(0.3);
  });

  it('weights change at 0.3', () => {
    expect(computeCompositeRisk(0, 1.0, 0, 0)).toBeCloseTo(0.3);
  });

  it('weights ownership at 0.2', () => {
    expect(computeCompositeRisk(0, 0, 1.0, 0)).toBeCloseTo(0.2);
  });

  it('weights verGap at 0.2', () => {
    expect(computeCompositeRisk(0, 0, 0, 1.0)).toBeCloseTo(0.2);
  });

  it('sum of weights is 1.0', () => {
    expect(0.3 + 0.3 + 0.2 + 0.2).toBe(1.0);
  });
});

// ─── ownershipRisk ─────────────────────────────────────────────

describe('[GC-5] ownershipRisk', () => {
  it('returns 1.0 for 0 authors (no owner = max risk)', () => {
    expect(ownershipRisk(0)).toBe(1.0);
  });

  it('returns 0.2 for 1 author (clear owner)', () => {
    expect(ownershipRisk(1)).toBe(0.2);
  });

  it('returns 0.5 for 2+ authors (shared)', () => {
    expect(ownershipRisk(2)).toBe(0.5);
    expect(ownershipRisk(5)).toBe(0.5);
  });
});

// ─── Integration: governance path promotion ────────────────────

describe('[GC-5] governance path flag promotion', () => {
  it('verification/ function without coverage gets promoted from LOW', () => {
    const input: CompositeRiskInput = {
      riskLevel: 0.5,
      churnRelative: 0.3,
      authorCount: 1,
      hasVerification: false,
      temporalCoupling: 0,
      filePath: '/src/core/verification/sarif-importer.ts',
    };
    const flags = computeFlags(input);
    expect(flags).toContain('NO_VERIFICATION');
    expect(flags).toContain('GOVERNANCE_PATH');
    // 2 flags → at least HIGH even from LOW base
    const tier = resolveRiskTier(0.2, flags);
    expect(tier).toBe('HIGH');
  });
});
