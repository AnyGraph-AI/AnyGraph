/**
 * UI-0 Phase 2: Formula Corrections — Spec Tests
 *
 * Tests written FROM the DECISION-FORMULA-REVIEW-2026-03-17 in UI_DASHBOARD.md.
 * These tests encode the CORRECTED formulas. They MUST FAIL against the
 * current (pre-Phase-2) implementation, then PASS after implementation.
 *
 * Decision log reference (7 decisions, all in Neo4j as Decision nodes):
 * 1. basePain: riskDensity(sum/count) + 4 weighted factors
 * 2. painScore: CRITICAL/HIGH downstream only + log-damping
 * 3. confidenceScore: 3-factor (effectiveConf×0.5 + evidence×0.3 + freshness×0.2)
 * 4. adjustedPain: uncertainty AMPLIFIES: painScore × (1 + (1-confidence))
 * 5. fragility: adjustedPain × (1-confidence) × (1+normalize(churn))
 * 6. gapScore: kept as-is
 */
import { describe, it, expect } from 'vitest';
import {
  computeBasePain,
  computePainScore,
  computeConfidenceScore,
  computeAdjustedPain,
  computeFragility,
  computeSourceFileScores,
} from '../../../../scripts/enrichment/precompute-scores.js';

// ─── Task 1: basePain — 5-factor weighted formula ──────────────

describe('[UI-0 Phase 2] computeBasePain — 5-factor weighted', () => {
  it('accepts 5-factor input and returns weighted combination', () => {
    // riskDensity=0.5, changeFreq=0.4, coverage=0.3(→1-0.3=0.7), fanOut=0.2, coChange=0.1
    // maxima all 1.0 for simplicity
    const result = computeBasePain({
      riskDensity: 0.5,
      changeFrequency: 0.4,
      testCoverage: 0.3,
      avgFanOut: 0.2,
      coChangeCount: 0.1,
      maxRiskDensity: 1.0,
      maxChangeFrequency: 1.0,
      maxAvgFanOut: 1.0,
      maxCoChangeCount: 1.0,
    });

    // Expected: 0.5×0.30 + 0.4×0.25 + 0.7×0.25 + 0.2×0.10 + 0.1×0.10
    // = 0.15 + 0.10 + 0.175 + 0.02 + 0.01 = 0.455
    expect(result).toBeCloseTo(0.455);
  });

  it('uses riskDensity (sum/count) NOT maxRiskLevel', () => {
    // File with 2 functions: compositeRisk [0.8, 0.2]
    // riskDensity = (0.8+0.2)/2 = 0.5
    // NOT maxRiskLevel = 0.8
    const result = computeBasePain({
      riskDensity: 0.5, // sum/count
      changeFrequency: 0,
      testCoverage: 1.0,
      avgFanOut: 0,
      coChangeCount: 0,
      maxRiskDensity: 1.0,
      maxChangeFrequency: 1.0,
      maxAvgFanOut: 1.0,
      maxCoChangeCount: 1.0,
    });

    // 0.5×0.30 + 0×0.25 + 0×0.25 + 0×0.10 + 0×0.10 = 0.15
    expect(result).toBeCloseTo(0.15);
  });

  it('normalizes each factor against project maximum', () => {
    const result = computeBasePain({
      riskDensity: 0.3,
      changeFrequency: 10,
      testCoverage: 0.5,
      avgFanOut: 5,
      coChangeCount: 3,
      maxRiskDensity: 0.6,    // normalize: 0.3/0.6 = 0.5
      maxChangeFrequency: 20, // normalize: 10/20 = 0.5
      maxAvgFanOut: 10,       // normalize: 5/10 = 0.5
      maxCoChangeCount: 6,    // normalize: 3/6 = 0.5
    });

    // All normalized to 0.5:
    // 0.5×0.30 + 0.5×0.25 + (1-0.5)×0.25 + 0.5×0.10 + 0.5×0.10
    // = 0.15 + 0.125 + 0.125 + 0.05 + 0.05 = 0.5
    expect(result).toBeCloseTo(0.5);
  });

  it('handles zero maxima gracefully (normalize to 0)', () => {
    const result = computeBasePain({
      riskDensity: 0.5,
      changeFrequency: 0,
      testCoverage: 0,
      avgFanOut: 0,
      coChangeCount: 0,
      maxRiskDensity: 0,
      maxChangeFrequency: 0,
      maxAvgFanOut: 0,
      maxCoChangeCount: 0,
    });

    // All normalized factors are 0 (safe division), testCoverage=0 → (1-0)=1.0
    // 0×0.30 + 0×0.25 + 1.0×0.25 + 0×0.10 + 0×0.10 = 0.25
    expect(result).toBeCloseTo(0.25);
  });
});

// ─── Task 2: confidenceScore — 3-factor blend ──────────────────

describe('[UI-0 Phase 2] computeConfidenceScore — 3-factor', () => {
  it('accepts 3-factor input: effectiveConfidence, evidenceCount, freshnessWeight', () => {
    const result = computeConfidenceScore({
      avgEffectiveConfidence: 0.8,
      evidenceCount: 5,
      freshnessWeight: 0.9,
    });

    // 0.8×0.5 + (5/10)×0.3 + 0.9×0.2
    // = 0.40 + 0.15 + 0.18 = 0.73
    expect(result).toBeCloseTo(0.73);
  });

  it('caps evidenceCount contribution at 10', () => {
    const result = computeConfidenceScore({
      avgEffectiveConfidence: 1.0,
      evidenceCount: 50,  // should be capped to 10
      freshnessWeight: 1.0,
    });

    // 1.0×0.5 + (10/10)×0.3 + 1.0×0.2 = 0.5 + 0.3 + 0.2 = 1.0
    expect(result).toBeCloseTo(1.0);
  });

  it('returns 0 when all factors are 0', () => {
    const result = computeConfidenceScore({
      avgEffectiveConfidence: 0,
      evidenceCount: 0,
      freshnessWeight: 0,
    });
    expect(result).toBe(0);
  });

  it('freshnessWeight contributes 20% when VR data present', () => {
    // Need non-zero evidenceCount or freshnessWeight for 3-factor mode
    const withFresh = computeConfidenceScore({
      avgEffectiveConfidence: 0,
      evidenceCount: 1,  // VR present → 3-factor mode
      freshnessWeight: 1.0,
    });
    // 0×0.5 + (1/10)×0.3 + 1.0×0.2 = 0 + 0.03 + 0.2 = 0.23
    expect(withFresh).toBeCloseTo(0.23);
  });

  it('VR absent: full weight shifts to effectiveConfidence', () => {
    // When no VerificationRuns exist (evidenceCount=0, freshnessWeight=0),
    // confidence = effectiveConfidence directly (no 50% cap)
    const result = computeConfidenceScore({
      avgEffectiveConfidence: 0.6,  // 6/10 functions tested
      evidenceCount: 0,
      freshnessWeight: 0,
    });
    expect(result).toBeCloseTo(0.6);
  });

  it('VR absent: fully tested file reaches 100% confidence', () => {
    const result = computeConfidenceScore({
      avgEffectiveConfidence: 1.0,
      evidenceCount: 0,
      freshnessWeight: 0,
    });
    expect(result).toBe(1.0);
  });

  it('VR absent: untested file stays at 0% confidence', () => {
    const result = computeConfidenceScore({
      avgEffectiveConfidence: 0,
      evidenceCount: 0,
      freshnessWeight: 0,
    });
    expect(result).toBe(0);
  });
});

// ─── Task 3: adjustedPain — uncertainty AMPLIFIES ──────────────

describe('[UI-0 Phase 2] computeAdjustedPain — uncertainty amplification', () => {
  it('DOUBLES pain when confidence is 0 (unknown = worst case)', () => {
    // adjustedPain = painScore × (1 + (1 - 0)) = painScore × 2.0
    expect(computeAdjustedPain(10.0, 0)).toBeCloseTo(20.0);
  });

  it('returns face value when confidence is 1 (known = trust it)', () => {
    // adjustedPain = painScore × (1 + (1 - 1)) = painScore × 1.0
    expect(computeAdjustedPain(10.0, 1.0)).toBeCloseTo(10.0);
  });

  it('amplifies by 1.5x at 50% confidence', () => {
    // adjustedPain = painScore × (1 + (1 - 0.5)) = painScore × 1.5
    expect(computeAdjustedPain(10.0, 0.5)).toBeCloseTo(15.0);
  });

  it('never REDUCES pain below painScore (always >= 1.0x multiplier)', () => {
    // For ANY confidence value 0-1, multiplier = (1 + (1-conf)) >= 1.0
    for (const conf of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]) {
      const result = computeAdjustedPain(10.0, conf);
      expect(result).toBeGreaterThanOrEqual(10.0);
    }
  });
});

// ─── Task 4: fragility — compound product formula ──────────────

describe('[UI-0 Phase 2] computeFragility — compound product', () => {
  it('accepts adjustedPain, confidenceScore, and normalizedChurn', () => {
    // fragility = adjustedPain × (1-confidence) × (1+normalizedChurn)
    const result = computeFragility({
      adjustedPain: 20.0,
      confidenceScore: 0.3,
      normalizedChurn: 0.5,
    });

    // 20.0 × 0.7 × 1.5 = 21.0
    expect(result).toBeCloseTo(21.0);
  });

  it('returns 0 when confidence is 100% (fully protected)', () => {
    const result = computeFragility({
      adjustedPain: 50.0,
      confidenceScore: 1.0,
      normalizedChurn: 0.8,
    });
    expect(result).toBe(0);
  });

  it('churn amplifies fragility for unstable files', () => {
    const stable = computeFragility({
      adjustedPain: 20.0,
      confidenceScore: 0.3,
      normalizedChurn: 0,  // no churn
    });

    const churning = computeFragility({
      adjustedPain: 20.0,
      confidenceScore: 0.3,
      normalizedChurn: 1.0,  // max churn
    });

    // churning should be exactly 2× stable
    expect(churning).toBeCloseTo(stable * 2);
  });

  it('is NOT a linear combination of basePain inputs', () => {
    // The old formula was weighted linear: risk×0.30 + churn×0.25 + ...
    // New formula is a product: adjustedPain × (1-conf) × (1+churn)
    // These MUST produce different results
    const result = computeFragility({
      adjustedPain: 15.0,
      confidenceScore: 0.5,
      normalizedChurn: 0.3,
    });

    // 15.0 × 0.5 × 1.3 = 9.75
    expect(result).toBeCloseTo(9.75);
  });
});

// ─── Task 5: downstream impact — CRITICAL/HIGH only ────────────

describe('[UI-0 Phase 2] computePainScore — CRITICAL/HIGH downstream', () => {
  it('still uses log-damping on filtered downstream count', () => {
    // This test verifies the formula hasn't changed
    // The FILTERING happens in the Neo4j query / enrichment, not in this function
    // computePainScore receives the already-filtered count
    const criticalDownstream = 5;
    const result = computePainScore(1.0, 0.5, criticalDownstream);
    expect(result).toBeCloseTo(1.0 * 1.5 * (1 + Math.log(6)));
  });
});

// ─── computeSourceFileScores — integrated formula verification ─

describe('[UI-0 Phase 2] computeSourceFileScores — corrected integration', () => {
  it('uses all corrected formulas together', () => {
    const result = computeSourceFileScores({
      riskDensity: 0.5,
      changeFrequency: 0.4,
      testCoverage: 0.3,
      avgFanOut: 0.2,
      coChangeCount: 0.1,
      maxRiskDensity: 1.0,
      maxChangeFrequency: 1.0,
      maxAvgFanOut: 1.0,
      maxCoChangeCount: 1.0,
      functionDownstreamImpacts: [3, 5],
      functionCentralities: [0.4, 0.8],
      avgEffectiveConfidence: 0.7,
      evidenceCount: 4,
      freshnessWeight: 0.8,
      normalizedChurn: 0.5,
    });

    // basePain = 0.5×0.30 + 0.4×0.25 + 0.7×0.25 + 0.2×0.10 + 0.1×0.10 = 0.455
    expect(result.basePain).toBeCloseTo(0.455);

    // painScore = 0.455 × (1+0.8) × (1+ln(6)) = 0.455 × 1.8 × 2.7918 ≈ 2.286
    const expectedPain = 0.455 * 1.8 * (1 + Math.log(6));
    expect(result.painScore).toBeCloseTo(expectedPain);

    // confidenceScore = 0.7×0.5 + (4/10)×0.3 + 0.8×0.2 = 0.35 + 0.12 + 0.16 = 0.63
    expect(result.confidenceScore).toBeCloseTo(0.63);

    // adjustedPain = painScore × (1 + (1-0.63)) = painScore × 1.37
    expect(result.adjustedPain).toBeCloseTo(expectedPain * 1.37);

    // fragility = adjustedPain × (1-0.63) × (1+0.5)
    const expectedAdjusted = expectedPain * 1.37;
    expect(result.fragility).toBeCloseTo(expectedAdjusted * 0.37 * 1.5);
  });

  it('0% confidence file: pain is doubled, fragility is maximized', () => {
    const result = computeSourceFileScores({
      riskDensity: 0.8,
      changeFrequency: 0,
      testCoverage: 0,
      avgFanOut: 0,
      coChangeCount: 0,
      maxRiskDensity: 1.0,
      maxChangeFrequency: 1.0,
      maxAvgFanOut: 1.0,
      maxCoChangeCount: 1.0,
      functionDownstreamImpacts: [0],
      functionCentralities: [0],
      avgEffectiveConfidence: 0,
      evidenceCount: 0,
      freshnessWeight: 0,
      normalizedChurn: 0,
    });

    // basePain = 0.8×0.30 + 0 + 1.0×0.25 + 0 + 0 = 0.24 + 0.25 = 0.49
    expect(result.basePain).toBeCloseTo(0.49);

    // confidence = 0
    expect(result.confidenceScore).toBe(0);

    // adjustedPain = painScore × 2.0 (doubled!)
    expect(result.adjustedPain).toBeCloseTo(result.painScore * 2.0);

    // fragility = adjustedPain × 1.0 × 1.0 = adjustedPain
    expect(result.fragility).toBeCloseTo(result.adjustedPain);
  });

  it('100% confidence file: pain is face value, fragility is 0', () => {
    const result = computeSourceFileScores({
      riskDensity: 0.5,
      changeFrequency: 0.5,
      testCoverage: 1.0,
      avgFanOut: 0.3,
      coChangeCount: 0.2,
      maxRiskDensity: 1.0,
      maxChangeFrequency: 1.0,
      maxAvgFanOut: 1.0,
      maxCoChangeCount: 1.0,
      functionDownstreamImpacts: [2],
      functionCentralities: [0.5],
      avgEffectiveConfidence: 1.0,
      evidenceCount: 10,
      freshnessWeight: 1.0,
      normalizedChurn: 0.5,
    });

    // confidence = 1.0×0.5 + 1.0×0.3 + 1.0×0.2 = 1.0
    expect(result.confidenceScore).toBeCloseTo(1.0);

    // adjustedPain = painScore × 1.0
    expect(result.adjustedPain).toBeCloseTo(result.painScore);

    // fragility = adjustedPain × 0 × anything = 0
    expect(result.fragility).toBe(0);
  });
});
