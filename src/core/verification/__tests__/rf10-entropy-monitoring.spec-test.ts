/**
 * RF-10: Entropy Monitoring + Collapse Alerts — Spec Tests
 *
 * Tests written against the RF-10 spec:
 * - Task 1: Confidence entropy metric per project/gate/slice (H = -Σp log p) with stable binning
 * - Task 2: Alert on abrupt entropy collapse and abrupt entropy spikes
 * - Task 3: Correlate entropy anomalies with collusion and override events
 *
 * @see plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md — Milestone RF-10
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// Task 1: Confidence Entropy Metric
// ============================================================================

describe('RF-10 Task 1: Confidence Entropy Metric', () => {
  // Will import from confidence-analytics.ts once implemented
  // import { computeConfidenceEntropy, ConfidenceEntropyConfig } from '../../test-harness/confidence-analytics';

  describe('Shannon entropy computation (H = -Σp log p)', () => {
    it('returns 0 entropy for uniform confidence (all VRs identical)', async () => {
      const { computeConfidenceEntropy } = await import('../../test-harness/confidence-analytics');
      // All VRs at 0.8 → single bin → p=1.0 → H = -1*log2(1) = 0
      const vrs = Array(50).fill(null).map(() => ({ effectiveConfidence: 0.8 }));
      const result = computeConfidenceEntropy(vrs);
      expect(result.entropy).toBe(0);
      expect(result.binCount).toBeGreaterThan(0);
    });

    it('returns max entropy for uniformly distributed confidence', async () => {
      const { computeConfidenceEntropy } = await import('../../test-harness/confidence-analytics');
      // VRs spread evenly across all bins → maximum entropy
      const config = { binCount: 10, minConfidence: 0.0, maxConfidence: 1.0 };
      const vrs: { effectiveConfidence: number }[] = [];
      for (let i = 0; i < 10; i++) {
        // 10 VRs each in a different bin
        for (let j = 0; j < 5; j++) {
          vrs.push({ effectiveConfidence: (i + 0.5) / 10 });
        }
      }
      const result = computeConfidenceEntropy(vrs, config);
      // Max entropy for 10 bins = log2(10) ≈ 3.322
      expect(result.entropy).toBeCloseTo(Math.log2(10), 1);
      expect(result.maxEntropy).toBeCloseTo(Math.log2(10), 1);
      expect(result.normalizedEntropy).toBeCloseTo(1.0, 1);
    });

    it('returns 0 entropy for empty input', async () => {
      const { computeConfidenceEntropy } = await import('../../test-harness/confidence-analytics');
      const result = computeConfidenceEntropy([]);
      expect(result.entropy).toBe(0);
      expect(result.normalizedEntropy).toBe(0);
      expect(result.totalVRs).toBe(0);
    });

    it('returns 0 entropy for single VR', async () => {
      const { computeConfidenceEntropy } = await import('../../test-harness/confidence-analytics');
      const result = computeConfidenceEntropy([{ effectiveConfidence: 0.5 }]);
      expect(result.entropy).toBe(0);
      expect(result.totalVRs).toBe(1);
    });
  });

  describe('stable binning', () => {
    it('uses fixed bin boundaries regardless of data distribution', async () => {
      const { computeConfidenceEntropy } = await import('../../test-harness/confidence-analytics');
      const config = { binCount: 10, minConfidence: 0.0, maxConfidence: 1.0 };
      
      // Clustered data should still use all 10 bins (most empty)
      const clustered = Array(100).fill(null).map(() => ({ effectiveConfidence: 0.85 }));
      const result = computeConfidenceEntropy(clustered, config);
      expect(result.binCount).toBe(10);
      expect(result.occupiedBins).toBe(1);
    });

    it('clamps values outside [min, max] to boundary bins', async () => {
      const { computeConfidenceEntropy } = await import('../../test-harness/confidence-analytics');
      const config = { binCount: 10, minConfidence: 0.0, maxConfidence: 1.0 };
      const vrs = [
        { effectiveConfidence: -0.1 },  // clamp to bin 0
        { effectiveConfidence: 1.5 },   // clamp to last bin
        { effectiveConfidence: 0.5 },   // normal
      ];
      const result = computeConfidenceEntropy(vrs, config);
      expect(result.totalVRs).toBe(3);
      // Should not throw, should not produce NaN
      expect(Number.isFinite(result.entropy)).toBe(true);
    });
  });

  describe('per-project/gate/slice grouping', () => {
    it('computes entropy per sourceFamily (gate)', async () => {
      const { computeConfidenceEntropy } = await import('../../test-harness/confidence-analytics');
      // Semgrep VRs clustered at 0.8, ESLint spread wide
      const semgrepVRs = Array(20).fill(null).map(() => ({ effectiveConfidence: 0.8 }));
      const eslintVRs = [0.1, 0.3, 0.5, 0.7, 0.9].map(ec => ({ effectiveConfidence: ec }));
      
      const semgrepResult = computeConfidenceEntropy(semgrepVRs);
      const eslintResult = computeConfidenceEntropy(eslintVRs);
      
      // ESLint should have higher entropy (more spread)
      expect(eslintResult.entropy).toBeGreaterThan(semgrepResult.entropy);
    });
  });

  describe('result structure', () => {
    it('returns all required fields', async () => {
      const { computeConfidenceEntropy } = await import('../../test-harness/confidence-analytics');
      const vrs = [{ effectiveConfidence: 0.5 }, { effectiveConfidence: 0.9 }];
      const result = computeConfidenceEntropy(vrs);
      
      expect(result).toHaveProperty('entropy');
      expect(result).toHaveProperty('normalizedEntropy');
      expect(result).toHaveProperty('maxEntropy');
      expect(result).toHaveProperty('binCount');
      expect(result).toHaveProperty('occupiedBins');
      expect(result).toHaveProperty('totalVRs');
      expect(result).toHaveProperty('binDistribution');
      
      expect(typeof result.entropy).toBe('number');
      expect(result.normalizedEntropy).toBeGreaterThanOrEqual(0);
      expect(result.normalizedEntropy).toBeLessThanOrEqual(1);
    });
  });
});

// ============================================================================
// Task 2: Collapse & Spike Alerts
// ============================================================================

describe('RF-10 Task 2: Entropy Collapse & Spike Alerts', () => {
  describe('entropy collapse detection', () => {
    it('alerts when entropy drops below collapse threshold', async () => {
      const { detectEntropyAnomaly } = await import('../../test-harness/confidence-analytics');
      const history = [
        { timestamp: '2026-03-01', entropy: 2.5, normalizedEntropy: 0.75 },
        { timestamp: '2026-03-08', entropy: 2.4, normalizedEntropy: 0.72 },
        { timestamp: '2026-03-15', entropy: 0.3, normalizedEntropy: 0.09 },  // collapse
      ];
      const result = detectEntropyAnomaly(history);
      expect(result.collapse).toBe(true);
      expect(result.spike).toBe(false);
      expect(result.alert).toBeTruthy();
      expect(result.alert).toContain('collapse');
    });

    it('alerts when entropy drops by more than threshold between periods', async () => {
      const { detectEntropyAnomaly } = await import('../../test-harness/confidence-analytics');
      const config = { collapseDropThreshold: 0.5 };  // 50% relative drop
      const history = [
        { timestamp: '2026-03-08', entropy: 2.0, normalizedEntropy: 0.60 },
        { timestamp: '2026-03-15', entropy: 0.8, normalizedEntropy: 0.24 },  // 60% drop
      ];
      const result = detectEntropyAnomaly(history, config);
      expect(result.collapse).toBe(true);
    });

    it('does not alert on gradual entropy decrease', async () => {
      const { detectEntropyAnomaly } = await import('../../test-harness/confidence-analytics');
      const history = [
        { timestamp: '2026-03-01', entropy: 2.5, normalizedEntropy: 0.75 },
        { timestamp: '2026-03-08', entropy: 2.3, normalizedEntropy: 0.69 },
        { timestamp: '2026-03-15', entropy: 2.1, normalizedEntropy: 0.63 },
      ];
      const result = detectEntropyAnomaly(history);
      expect(result.collapse).toBe(false);
    });
  });

  describe('entropy spike detection', () => {
    it('alerts when entropy spikes above threshold', async () => {
      const { detectEntropyAnomaly } = await import('../../test-harness/confidence-analytics');
      const history = [
        { timestamp: '2026-03-08', entropy: 1.0, normalizedEntropy: 0.30 },
        { timestamp: '2026-03-15', entropy: 3.2, normalizedEntropy: 0.96 },  // spike
      ];
      const result = detectEntropyAnomaly(history);
      expect(result.spike).toBe(true);
      expect(result.collapse).toBe(false);
      expect(result.alert).toContain('spike');
    });
  });

  describe('no anomaly', () => {
    it('returns no alert for stable entropy', async () => {
      const { detectEntropyAnomaly } = await import('../../test-harness/confidence-analytics');
      const history = [
        { timestamp: '2026-03-01', entropy: 2.0, normalizedEntropy: 0.60 },
        { timestamp: '2026-03-08', entropy: 2.1, normalizedEntropy: 0.63 },
        { timestamp: '2026-03-15', entropy: 1.9, normalizedEntropy: 0.57 },
      ];
      const result = detectEntropyAnomaly(history);
      expect(result.collapse).toBe(false);
      expect(result.spike).toBe(false);
      expect(result.alert).toBeNull();
    });

    it('handles single-entry history gracefully', async () => {
      const { detectEntropyAnomaly } = await import('../../test-harness/confidence-analytics');
      const history = [
        { timestamp: '2026-03-15', entropy: 2.0, normalizedEntropy: 0.60 },
      ];
      const result = detectEntropyAnomaly(history);
      expect(result.collapse).toBe(false);
      expect(result.spike).toBe(false);
    });

    it('handles empty history', async () => {
      const { detectEntropyAnomaly } = await import('../../test-harness/confidence-analytics');
      const result = detectEntropyAnomaly([]);
      expect(result.collapse).toBe(false);
      expect(result.spike).toBe(false);
      expect(result.alert).toBeNull();
    });
  });
});

// ============================================================================
// Task 3: Entropy-Collusion-Override Correlation
// ============================================================================

describe('RF-10 Task 3: Entropy × Collusion × Override Correlation', () => {
  it('flags correlation when entropy collapse coincides with anti-gaming trigger', async () => {
    const { correlateEntropyAnomalies } = await import('../../test-harness/confidence-analytics');
    const entropyHistory = [
      { timestamp: '2026-03-08', entropy: 2.5, normalizedEntropy: 0.75 },
      { timestamp: '2026-03-15', entropy: 0.3, normalizedEntropy: 0.09 },
    ];
    const antiGamingEvents = [
      { timestamp: '2026-03-14', type: 'source_family_cap_triggered', sourceFamily: 'ESLint' },
    ];
    const overrideEvents: any[] = [];
    
    const result = correlateEntropyAnomalies(entropyHistory, antiGamingEvents, overrideEvents);
    expect(result.correlations.length).toBeGreaterThan(0);
    expect(result.correlations[0].type).toBe('collapse_with_gaming');
  });

  it('flags correlation when entropy spike coincides with override burst', async () => {
    const { correlateEntropyAnomalies } = await import('../../test-harness/confidence-analytics');
    const entropyHistory = [
      { timestamp: '2026-03-08', entropy: 1.0, normalizedEntropy: 0.30 },
      { timestamp: '2026-03-15', entropy: 3.2, normalizedEntropy: 0.96 },
    ];
    const antiGamingEvents: any[] = [];
    const overrideEvents = [
      { timestamp: '2026-03-14', projectId: 'test', overrideType: 'waiver' as const, invariantId: 'inv1', reason: 'test', issuerId: 'agent1' },
      { timestamp: '2026-03-14', projectId: 'test', overrideType: 'threshold_relaxation' as const, invariantId: 'inv2', reason: 'test', issuerId: 'agent1' },
      { timestamp: '2026-03-15', projectId: 'test', overrideType: 'waiver' as const, invariantId: 'inv3', reason: 'test', issuerId: 'agent1' },
    ];

    const result = correlateEntropyAnomalies(entropyHistory, antiGamingEvents, overrideEvents);
    expect(result.correlations.length).toBeGreaterThan(0);
    expect(result.correlations.some(c => c.type === 'spike_with_overrides')).toBe(true);
  });

  it('returns no correlations when anomaly has no concurrent events', async () => {
    const { correlateEntropyAnomalies } = await import('../../test-harness/confidence-analytics');
    const entropyHistory = [
      { timestamp: '2026-03-08', entropy: 2.5, normalizedEntropy: 0.75 },
      { timestamp: '2026-03-15', entropy: 0.3, normalizedEntropy: 0.09 },
    ];
    // Events far away in time
    const antiGamingEvents = [
      { timestamp: '2026-02-01', type: 'source_family_cap_triggered', sourceFamily: 'ESLint' },
    ];
    const overrideEvents: any[] = [];

    const result = correlateEntropyAnomalies(entropyHistory, antiGamingEvents, overrideEvents);
    expect(result.correlations.length).toBe(0);
  });

  it('returns no correlations when entropy is stable', async () => {
    const { correlateEntropyAnomalies } = await import('../../test-harness/confidence-analytics');
    const entropyHistory = [
      { timestamp: '2026-03-08', entropy: 2.0, normalizedEntropy: 0.60 },
      { timestamp: '2026-03-15', entropy: 2.1, normalizedEntropy: 0.63 },
    ];
    const antiGamingEvents = [
      { timestamp: '2026-03-14', type: 'source_family_cap_triggered', sourceFamily: 'ESLint' },
    ];
    const overrideEvents: any[] = [];

    const result = correlateEntropyAnomalies(entropyHistory, antiGamingEvents, overrideEvents);
    expect(result.correlations.length).toBe(0);
  });
});
