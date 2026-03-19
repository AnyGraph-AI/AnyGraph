/**
 * UI-0: Precompute Scores — Spec Tests
 *
 * Tests written FROM the UI-0 milestone spec.
 * Updated for Phase 2 formula corrections (DECISION-FORMULA-REVIEW-2026-03-17).
 *
 * Spec requirements:
 * 1. Function nodes get downstreamImpact (transitive callee count) and centralityNormalized (0-1)
 * 2. SourceFile nodes get basePain, downstreamImpact, centrality, painScore, confidenceScore, fragility, adjustedPain
 * 3. basePain = 5-factor weighted (riskDensity×0.30 + changeFreq×0.25 + (1-coverage)×0.25 + fanOut×0.10 + coChange×0.10)
 * 4. confidenceScore = 3-factor (effectiveConf×0.5 + evidenceCount×0.3 + freshness×0.2)
 * 5. adjustedPain = painScore × (1 + (1-confidence)) — uncertainty AMPLIFIES
 * 6. fragility = adjustedPain × (1-confidence) × (1+normalizedChurn)
 * 7. painScore = basePain × (1+centrality) × (1+ln(1+downstream))
 * 8. Normalization utilities: normalize(value, max), getMaxPainScore, getMaxAdjustedPain
 */
import { describe, it, expect } from 'vitest';
import {
  computeDownstreamImpact,
  computeMaxCallDepth,
  formatRiskTierSummary,
  computeCentralityNormalized,
  computeBasePain,
  computePainScore,
  computeConfidenceScore,
  computeFragility,
  computeAdjustedPain,
  computeSourceFileScores,
  type SourceFileScoreInput,
} from '../../../../scripts/enrichment/precompute-scores.js';
import { normalize } from '../../../../lib/scoring.js';

// ─── Function-level: downstreamImpact ──────────────────────────

describe('[UI-0] computeDownstreamImpact', () => {
  it('returns 0 for a function with no callees', () => {
    const adj: Record<string, string[]> = { fnA: [] };
    expect(computeDownstreamImpact('fnA', adj)).toBe(0);
  });

  it('returns 1 for a function with one direct callee', () => {
    const adj: Record<string, string[]> = { fnA: ['fnB'], fnB: [] };
    expect(computeDownstreamImpact('fnA', adj)).toBe(1);
  });

  it('counts transitive callees', () => {
    const adj: Record<string, string[]> = {
      fnA: ['fnB'],
      fnB: ['fnC'],
      fnC: ['fnD'],
      fnD: [],
    };
    expect(computeDownstreamImpact('fnA', adj)).toBe(3);
  });

  it('does not double-count in diamond graphs', () => {
    const adj: Record<string, string[]> = {
      fnA: ['fnB', 'fnC'],
      fnB: ['fnD'],
      fnC: ['fnD'],
      fnD: [],
    };
    expect(computeDownstreamImpact('fnA', adj)).toBe(3);
  });

  it('handles cycles without infinite loop', () => {
    const adj: Record<string, string[]> = {
      fnA: ['fnB'],
      fnB: ['fnA'],
    };
    expect(computeDownstreamImpact('fnA', adj)).toBe(1);
  });

  it('handles missing nodes gracefully', () => {
    const adj: Record<string, string[]> = { fnA: ['fnB'] };
    expect(computeDownstreamImpact('fnA', adj)).toBe(1);
  });
});

describe('[UI-0] computeMaxCallDepth', () => {
  it('returns 0 when no callees', () => {
    expect(computeMaxCallDepth('fnA', { fnA: [] })).toBe(0);
  });

  it('returns longest reachable depth', () => {
    const adj: Record<string, string[]> = {
      fnA: ['fnB', 'fnC'],
      fnB: ['fnD'],
      fnC: ['fnE'],
      fnD: [],
      fnE: ['fnF'],
      fnF: [],
    };
    expect(computeMaxCallDepth('fnA', adj)).toBe(3);
  });

  it('handles cycles safely', () => {
    const adj: Record<string, string[]> = {
      fnA: ['fnB'],
      fnB: ['fnC'],
      fnC: ['fnA'],
    };
    expect(computeMaxCallDepth('fnA', adj)).toBe(2);
  });
});

describe('[UI-0] formatRiskTierSummary', () => {
  it('formats tier counts compactly', () => {
    expect(formatRiskTierSummary(['CRITICAL', 'CRITICAL', 'HIGH', 'MEDIUM'])).toBe('2C,1H,1M');
  });

  it('includes LOW when present', () => {
    expect(formatRiskTierSummary(['LOW', 'LOW', 'HIGH'])).toBe('1H,2L');
  });

  it('returns 0 for empty/invalid tiers', () => {
    expect(formatRiskTierSummary([])).toBe('0');
    expect(formatRiskTierSummary([null, undefined, 'UNKNOWN'])).toBe('0');
  });
});

// ─── Function-level: centralityNormalized ──────────────────────

describe('[UI-0] computeCentralityNormalized', () => {
  it('returns 0.0 when maxFanIn is 0', () => {
    expect(computeCentralityNormalized(0, 0)).toBe(0);
  });

  it('returns 1.0 for the function with highest fanIn', () => {
    expect(computeCentralityNormalized(10, 10)).toBe(1.0);
  });

  it('returns correct ratio for mid-range fanIn', () => {
    expect(computeCentralityNormalized(5, 20)).toBeCloseTo(0.25);
  });

  it('returns 0.0 when fanIn is 0 but maxFanIn > 0', () => {
    expect(computeCentralityNormalized(0, 10)).toBe(0);
  });
});

// ─── SourceFile-level: basePain (Phase 2: 5-factor) ────────────

describe('[UI-0] computeBasePain — 5-factor weighted', () => {
  it('returns weighted combination of all factors', () => {
    const result = computeBasePain({
      riskDensity: 1.0, changeFrequency: 1.0, testCoverage: 0,
      avgFanOut: 1.0, coChangeCount: 1.0,
      maxRiskDensity: 1.0, maxChangeFrequency: 1.0, maxAvgFanOut: 1.0, maxCoChangeCount: 1.0,
    });
    // 1.0×0.30 + 1.0×0.25 + 1.0×0.25 + 1.0×0.10 + 1.0×0.10 = 1.0
    expect(result).toBeCloseTo(1.0);
  });

  it('returns 0.25 for file with no risk but no coverage', () => {
    const result = computeBasePain({
      riskDensity: 0, changeFrequency: 0, testCoverage: 0,
      avgFanOut: 0, coChangeCount: 0,
      maxRiskDensity: 1.0, maxChangeFrequency: 1.0, maxAvgFanOut: 1.0, maxCoChangeCount: 1.0,
    });
    // 0 + 0 + (1-0)×0.25 + 0 + 0 = 0.25
    expect(result).toBeCloseTo(0.25);
  });

  it('returns 0 for fully covered file with no other factors', () => {
    const result = computeBasePain({
      riskDensity: 0, changeFrequency: 0, testCoverage: 1.0,
      avgFanOut: 0, coChangeCount: 0,
      maxRiskDensity: 1.0, maxChangeFrequency: 1.0, maxAvgFanOut: 1.0, maxCoChangeCount: 1.0,
    });
    expect(result).toBeCloseTo(0);
  });
});

// ─── SourceFile-level: painScore ───────────────────────────────

describe('[UI-0] computePainScore — log-damped downstream impact', () => {
  it('returns basePain when centrality and downstreamImpact are 0', () => {
    expect(computePainScore(2.0, 0, 0)).toBeCloseTo(2.0);
  });

  it('multiplies by (1 + centrality)', () => {
    expect(computePainScore(2.0, 0.5, 0)).toBeCloseTo(3.0);
  });

  it('log-damps downstream impact instead of linear multiply', () => {
    expect(computePainScore(2.0, 0, 3)).toBeCloseTo(2.0 * (1 + Math.log(4)));
  });

  it('downstream=21 gives ~3.1x not 22x', () => {
    const result = computePainScore(1.5, 0.8, 21);
    expect(result).toBeCloseTo(1.5 * 1.8 * (1 + Math.log(22)));
    expect(result).not.toBeCloseTo(1.5 * 1.8 * 22);
  });

  it('full formula: basePain * (1 + centrality) * (1 + ln(1 + downstreamImpact))', () => {
    expect(computePainScore(1.5, 0.8, 5)).toBeCloseTo(1.5 * 1.8 * (1 + Math.log(6)));
  });

  it('returns 0 when basePain is 0', () => {
    expect(computePainScore(0, 0.9, 10)).toBe(0);
  });

  it('downstream=1 gives modest boost (ln(2) ≈ 0.69)', () => {
    expect(computePainScore(1.0, 0, 1)).toBeCloseTo(1 + Math.log(2));
  });

  it('high downstream (100) is bounded, not explosive', () => {
    const result = computePainScore(1.0, 0, 100);
    expect(result).toBeCloseTo(1 + Math.log(101));
    expect(result).toBeLessThan(10);
  });
});

// ─── SourceFile-level: confidenceScore (Phase 2: 3-factor) ─────

describe('[UI-0] computeConfidenceScore — 3-factor', () => {
  it('returns 0 when all factors are 0', () => {
    expect(computeConfidenceScore({ avgEffectiveConfidence: 0, evidenceCount: 0, freshnessWeight: 0 })).toBe(0);
  });

  it('returns 1 when all factors are maxed', () => {
    expect(computeConfidenceScore({ avgEffectiveConfidence: 1.0, evidenceCount: 10, freshnessWeight: 1.0 })).toBeCloseTo(1.0);
  });

  it('weights: effectiveConf=50%, evidence=30%, freshness=20%', () => {
    const result = computeConfidenceScore({ avgEffectiveConfidence: 0.6, evidenceCount: 5, freshnessWeight: 0.8 });
    // 0.6×0.5 + 0.5×0.3 + 0.8×0.2 = 0.30 + 0.15 + 0.16 = 0.61
    expect(result).toBeCloseTo(0.61);
  });

  it('caps evidenceCount at 10', () => {
    const capped = computeConfidenceScore({ avgEffectiveConfidence: 0, evidenceCount: 100, freshnessWeight: 0 });
    const max = computeConfidenceScore({ avgEffectiveConfidence: 0, evidenceCount: 10, freshnessWeight: 0 });
    expect(capped).toBeCloseTo(max);
  });
});

// ─── SourceFile-level: fragility (Phase 2: compound product) ───

describe('[UI-0] computeFragility — compound product', () => {
  it('equals adjustedPain when confidence is 0 and no churn', () => {
    expect(computeFragility({ adjustedPain: 10.0, confidenceScore: 0, normalizedChurn: 0 })).toBeCloseTo(10.0);
  });

  it('equals 0 when confidence is 1', () => {
    expect(computeFragility({ adjustedPain: 10.0, confidenceScore: 1.0, normalizedChurn: 0.5 })).toBeCloseTo(0);
  });

  it('churn amplifies: adjustedPain × (1-conf) × (1+churn)', () => {
    expect(computeFragility({ adjustedPain: 10.0, confidenceScore: 0.4, normalizedChurn: 0.5 })).toBeCloseTo(10.0 * 0.6 * 1.5);
  });
});

// ─── SourceFile-level: adjustedPain (Phase 2: amplification) ───

describe('[UI-0] computeAdjustedPain — uncertainty amplification', () => {
  it('DOUBLES pain when confidence is 0 (unknown = worst case)', () => {
    expect(computeAdjustedPain(10.0, 0)).toBeCloseTo(20.0);
  });

  it('returns face value when confidence is 1 (known = trust it)', () => {
    expect(computeAdjustedPain(10.0, 1.0)).toBeCloseTo(10.0);
  });

  it('amplifies by 1.5× at 50% confidence', () => {
    expect(computeAdjustedPain(10.0, 0.5)).toBeCloseTo(15.0);
  });

  it('never reduces below painScore', () => {
    for (const conf of [0, 0.25, 0.5, 0.75, 1.0]) {
      expect(computeAdjustedPain(10.0, conf)).toBeGreaterThanOrEqual(10.0);
    }
  });
});

// ─── normalize utility ─────────────────────────────────────────

describe('[UI-0] normalize', () => {
  it('returns 0 when max is 0', () => {
    expect(normalize(5, 0)).toBe(0);
  });

  it('returns 1 when value equals max', () => {
    expect(normalize(10, 10)).toBe(1.0);
  });

  it('returns correct ratio', () => {
    expect(normalize(5, 20)).toBeCloseTo(0.25);
  });

  it('returns 0 when value is 0', () => {
    expect(normalize(0, 100)).toBe(0);
  });
});

// ─── computeSourceFileScores integration ───────────────────────

describe('[UI-0] computeSourceFileScores', () => {
  it('computes all properties with corrected formulas', () => {
    const input: SourceFileScoreInput = {
      riskDensity: 0.5,
      changeFrequency: 0.4,
      testCoverage: 2 / 3,
      avgFanOut: 0.3,
      coChangeCount: 0.1,
      maxRiskDensity: 1.0,
      maxChangeFrequency: 1.0,
      maxAvgFanOut: 1.0,
      maxCoChangeCount: 1.0,
      functionDownstreamImpacts: [2, 5, 0],
      functionCentralities: [0.4, 0.8, 0.1],
      avgEffectiveConfidence: 0.6,
      evidenceCount: 3,
      freshnessWeight: 0.5,
      normalizedChurn: 0.3,
    };

    const result = computeSourceFileScores(input);

    // basePain = 0.5×0.30 + 0.4×0.25 + (1-2/3)×0.25 + 0.3×0.10 + 0.1×0.10
    const expectedBase = 0.5 * 0.30 + 0.4 * 0.25 + (1 / 3) * 0.25 + 0.3 * 0.10 + 0.1 * 0.10;
    expect(result.basePain).toBeCloseTo(expectedBase);
    expect(result.downstreamImpact).toBe(5);
    expect(result.centrality).toBeCloseTo(0.8);

    const expectedPain = expectedBase * 1.8 * (1 + Math.log(6));
    expect(result.painScore).toBeCloseTo(expectedPain);

    // confidence = 0.6×0.5 + (3/10)×0.3 + 0.5×0.2 = 0.30 + 0.09 + 0.10 = 0.49
    expect(result.confidenceScore).toBeCloseTo(0.49);

    // adjustedPain = painScore × (1 + (1-0.49)) = painScore × 1.51
    expect(result.adjustedPain).toBeCloseTo(expectedPain * 1.51);

    // fragility = adjustedPain × 0.51 × 1.3
    expect(result.fragility).toBeCloseTo(expectedPain * 1.51 * 0.51 * 1.3);
  });

  it('handles file with no functions', () => {
    const input: SourceFileScoreInput = {
      riskDensity: 0, changeFrequency: 0, testCoverage: 0,
      avgFanOut: 0, coChangeCount: 0,
      maxRiskDensity: 0, maxChangeFrequency: 0, maxAvgFanOut: 0, maxCoChangeCount: 0,
      functionDownstreamImpacts: [],
      functionCentralities: [],
      avgEffectiveConfidence: 0, evidenceCount: 0, freshnessWeight: 0,
      normalizedChurn: 0,
    };

    const result = computeSourceFileScores(input);

    // basePain = 0 + 0 + (1-0)×0.25 + 0 + 0 = 0.25
    expect(result.basePain).toBeCloseTo(0.25);
    expect(result.downstreamImpact).toBe(0);
    expect(result.centrality).toBe(0);
    // painScore = 0.25 × 1 × 1 = 0.25
    expect(result.painScore).toBeCloseTo(0.25);
    // confidence = 0
    expect(result.confidenceScore).toBe(0);
    // adjustedPain = 0.25 × 2 = 0.5
    expect(result.adjustedPain).toBeCloseTo(0.5);
    // fragility = 0.5 × 1 × 1 = 0.5
    expect(result.fragility).toBeCloseTo(0.5);
  });

  it('full confidence: adjustedPain = painScore, fragility = 0', () => {
    const input: SourceFileScoreInput = {
      riskDensity: 0.5, changeFrequency: 0.5, testCoverage: 1.0,
      avgFanOut: 0.3, coChangeCount: 0.2,
      maxRiskDensity: 1.0, maxChangeFrequency: 1.0, maxAvgFanOut: 1.0, maxCoChangeCount: 1.0,
      functionDownstreamImpacts: [3],
      functionCentralities: [0.5],
      avgEffectiveConfidence: 1.0, evidenceCount: 10, freshnessWeight: 1.0,
      normalizedChurn: 0.5,
    };

    const result = computeSourceFileScores(input);

    expect(result.confidenceScore).toBeCloseTo(1.0);
    expect(result.adjustedPain).toBeCloseTo(result.painScore);
    expect(result.fragility).toBe(0);
  });
});
