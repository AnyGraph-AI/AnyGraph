/**
 * UI-0: Precompute Scores — Spec Tests
 *
 * Tests written FROM the UI-0 milestone spec.
 *
 * Spec requirements:
 * 1. Function nodes get downstreamImpact (transitive callee count) and centralityNormalized (0-1)
 * 2. SourceFile nodes get basePain, downstreamImpact, centrality, painScore, confidenceScore, fragility, adjustedPain
 * 3. painScore = basePain * (1 + centrality) * (1 + downstreamImpact)
 * 4. confidenceScore = fraction of contained functions with TESTED_BY or ANALYZED edges on parent file
 * 5. fragility = painScore * (1 - confidenceScore)
 * 6. adjustedPain = painScore * (0.5 + 0.5 * confidenceScore)
 * 7. Normalization utilities: normalize(value, max), getMaxPainScore, getMaxAdjustedPain
 */
import { describe, it, expect } from 'vitest';
import {
  computeDownstreamImpact,
  computeCentralityNormalized,
  computeBasePain,
  computePainScore,
  computeConfidenceScore,
  computeFragility,
  computeAdjustedPain,
  computeSourceFileScores,
  type FunctionScoreInput,
  type SourceFileScoreInput,
} from '../../../../scripts/enrichment/precompute-scores.js';
import { normalize } from '../../../../lib/scoring.js';

// ─── Function-level: downstreamImpact ──────────────────────────

describe('[UI-0] computeDownstreamImpact', () => {
  it('returns 0 for a function with no callees', () => {
    // adjacency: fnA calls nothing
    const adj: Record<string, string[]> = { fnA: [] };
    expect(computeDownstreamImpact('fnA', adj)).toBe(0);
  });

  it('returns 1 for a function with one direct callee', () => {
    const adj: Record<string, string[]> = { fnA: ['fnB'], fnB: [] };
    expect(computeDownstreamImpact('fnA', adj)).toBe(1);
  });

  it('counts transitive callees', () => {
    // fnA -> fnB -> fnC -> fnD
    const adj: Record<string, string[]> = {
      fnA: ['fnB'],
      fnB: ['fnC'],
      fnC: ['fnD'],
      fnD: [],
    };
    expect(computeDownstreamImpact('fnA', adj)).toBe(3);
  });

  it('does not double-count in diamond graphs', () => {
    // fnA -> fnB, fnA -> fnC, fnB -> fnD, fnC -> fnD
    const adj: Record<string, string[]> = {
      fnA: ['fnB', 'fnC'],
      fnB: ['fnD'],
      fnC: ['fnD'],
      fnD: [],
    };
    expect(computeDownstreamImpact('fnA', adj)).toBe(3); // B, C, D — each counted once
  });

  it('handles cycles without infinite loop', () => {
    // fnA -> fnB -> fnA (cycle)
    const adj: Record<string, string[]> = {
      fnA: ['fnB'],
      fnB: ['fnA'],
    };
    expect(computeDownstreamImpact('fnA', adj)).toBe(1); // just fnB
  });

  it('handles missing nodes gracefully', () => {
    const adj: Record<string, string[]> = { fnA: ['fnB'] }; // fnB not in adj
    expect(computeDownstreamImpact('fnA', adj)).toBe(1);
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

// ─── SourceFile-level: basePain ────────────────────────────────

describe('[UI-0] computeBasePain', () => {
  it('returns 0 for file with no functions', () => {
    expect(computeBasePain([])).toBe(0);
  });

  it('sums compositeRisk of all contained functions', () => {
    expect(computeBasePain([0.3, 0.5, 0.2])).toBeCloseTo(1.0);
  });

  it('handles single function', () => {
    expect(computeBasePain([0.75])).toBeCloseTo(0.75);
  });
});

// ─── SourceFile-level: painScore ───────────────────────────────

describe('[UI-0] computePainScore', () => {
  it('returns basePain when centrality and downstreamImpact are 0', () => {
    // painScore = basePain * (1 + 0) * (1 + 0) = basePain
    expect(computePainScore(2.0, 0, 0)).toBeCloseTo(2.0);
  });

  it('multiplies by (1 + centrality)', () => {
    // painScore = 2.0 * (1 + 0.5) * (1 + 0) = 3.0
    expect(computePainScore(2.0, 0.5, 0)).toBeCloseTo(3.0);
  });

  it('multiplies by (1 + downstreamImpact)', () => {
    // painScore = 2.0 * (1 + 0) * (1 + 3) = 8.0
    expect(computePainScore(2.0, 0, 3)).toBeCloseTo(8.0);
  });

  it('full formula: basePain * (1 + centrality) * (1 + downstreamImpact)', () => {
    // painScore = 1.5 * (1 + 0.8) * (1 + 5) = 1.5 * 1.8 * 6 = 16.2
    expect(computePainScore(1.5, 0.8, 5)).toBeCloseTo(16.2);
  });

  it('returns 0 when basePain is 0', () => {
    expect(computePainScore(0, 0.9, 10)).toBe(0);
  });
});

// ─── SourceFile-level: confidenceScore ─────────────────────────

describe('[UI-0] computeConfidenceScore', () => {
  it('returns 0 when no functions are covered', () => {
    expect(computeConfidenceScore(0, 5)).toBe(0);
  });

  it('returns 1 when all functions are covered', () => {
    expect(computeConfidenceScore(5, 5)).toBe(1.0);
  });

  it('returns correct fraction', () => {
    expect(computeConfidenceScore(3, 10)).toBeCloseTo(0.3);
  });

  it('returns 0 when file has no functions (avoid division by zero)', () => {
    expect(computeConfidenceScore(0, 0)).toBe(0);
  });
});

// ─── SourceFile-level: fragility ───────────────────────────────

describe('[UI-0] computeFragility', () => {
  it('equals painScore when confidenceScore is 0', () => {
    // fragility = painScore * (1 - 0) = painScore
    expect(computeFragility(10.0, 0)).toBeCloseTo(10.0);
  });

  it('equals 0 when confidenceScore is 1', () => {
    // fragility = painScore * (1 - 1) = 0
    expect(computeFragility(10.0, 1.0)).toBeCloseTo(0);
  });

  it('correct formula: painScore * (1 - confidenceScore)', () => {
    // fragility = 10 * (1 - 0.6) = 4.0
    expect(computeFragility(10.0, 0.6)).toBeCloseTo(4.0);
  });
});

// ─── SourceFile-level: adjustedPain ────────────────────────────

describe('[UI-0] computeAdjustedPain', () => {
  it('equals painScore * 0.5 when confidenceScore is 0', () => {
    // adjustedPain = painScore * (0.5 + 0.5 * 0) = painScore * 0.5
    expect(computeAdjustedPain(10.0, 0)).toBeCloseTo(5.0);
  });

  it('equals painScore when confidenceScore is 1', () => {
    // adjustedPain = painScore * (0.5 + 0.5 * 1.0) = painScore * 1.0
    expect(computeAdjustedPain(10.0, 1.0)).toBeCloseTo(10.0);
  });

  it('correct formula: painScore * (0.5 + 0.5 * confidenceScore)', () => {
    // adjustedPain = 10 * (0.5 + 0.5 * 0.6) = 10 * 0.8 = 8.0
    expect(computeAdjustedPain(10.0, 0.6)).toBeCloseTo(8.0);
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
  it('computes all properties for a file with mixed coverage', () => {
    const input: SourceFileScoreInput = {
      compositeRisks: [0.3, 0.5, 0.2],       // 3 functions
      functionDownstreamImpacts: [2, 5, 0],    // max = 5
      functionCentralities: [0.4, 0.8, 0.1],   // max = 0.8
      coveredFunctionCount: 2,                  // 2 of 3 covered
      totalFunctionCount: 3,
    };

    const result = computeSourceFileScores(input);

    expect(result.basePain).toBeCloseTo(1.0);                  // 0.3+0.5+0.2
    expect(result.downstreamImpact).toBe(5);                   // max
    expect(result.centrality).toBeCloseTo(0.8);                // max
    expect(result.painScore).toBeCloseTo(1.0 * 1.8 * 6);      // 1.0 * (1+0.8) * (1+5) = 10.8
    expect(result.confidenceScore).toBeCloseTo(2 / 3);         // 2/3
    expect(result.fragility).toBeCloseTo(10.8 * (1 - 2 / 3)); // 10.8 * 1/3 = 3.6
    expect(result.adjustedPain).toBeCloseTo(10.8 * (0.5 + 0.5 * 2 / 3)); // 10.8 * 0.833... = 9.0
  });

  it('handles file with no functions', () => {
    const input: SourceFileScoreInput = {
      compositeRisks: [],
      functionDownstreamImpacts: [],
      functionCentralities: [],
      coveredFunctionCount: 0,
      totalFunctionCount: 0,
    };

    const result = computeSourceFileScores(input);

    expect(result.basePain).toBe(0);
    expect(result.downstreamImpact).toBe(0);
    expect(result.centrality).toBe(0);
    expect(result.painScore).toBe(0);
    expect(result.confidenceScore).toBe(0);
    expect(result.fragility).toBe(0);
    expect(result.adjustedPain).toBe(0);
  });

  it('full confidence reduces fragility to 0', () => {
    const input: SourceFileScoreInput = {
      compositeRisks: [0.5],
      functionDownstreamImpacts: [3],
      functionCentralities: [0.5],
      coveredFunctionCount: 1,
      totalFunctionCount: 1,
    };

    const result = computeSourceFileScores(input);

    expect(result.confidenceScore).toBe(1.0);
    expect(result.fragility).toBe(0);
    expect(result.adjustedPain).toBeCloseTo(result.painScore); // full confidence → adjustedPain = painScore
  });
});
