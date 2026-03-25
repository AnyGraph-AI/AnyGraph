import { describe, it, expect } from 'vitest';
import {
  computeConfidenceEntropy,
  detectEntropyAnomaly,
  correlateEntropyAnomalies,
  type EntropySnapshot,
  type OverrideEvent,
  type AntiGamingEvent,
} from '../confidence-analytics.js';

describe('AUD-TC-11b: confidence-analytics entropy behaviors (9-11)', () => {
  it('computeConfidenceEntropy returns low entropy for concentrated distribution and higher for spread', () => {
    const concentrated = Array.from({ length: 20 }, () => ({ effectiveConfidence: 0.95 }));
    const spread = [
      ...Array.from({ length: 5 }, () => ({ effectiveConfidence: 0.1 })),
      ...Array.from({ length: 5 }, () => ({ effectiveConfidence: 0.3 })),
      ...Array.from({ length: 5 }, () => ({ effectiveConfidence: 0.6 })),
      ...Array.from({ length: 5 }, () => ({ effectiveConfidence: 0.9 })),
    ];

    const low = computeConfidenceEntropy(concentrated, { binCount: 10 });
    const high = computeConfidenceEntropy(spread, { binCount: 10 });

    expect(low.totalVRs).toBe(20);
    expect(low.occupiedBins).toBe(1);
    expect(low.normalizedEntropy).toBe(0);

    expect(high.totalVRs).toBe(20);
    expect(high.occupiedBins).toBeGreaterThan(1);
    expect(high.entropy).toBeGreaterThan(low.entropy);
    expect(high.normalizedEntropy).toBeGreaterThan(0);
  });

  it('detectEntropyAnomaly flags collapse and spike based on relative changes', () => {
    const collapseHistory: EntropySnapshot[] = [
      { timestamp: '2026-03-01T00:00:00.000Z', entropy: 2.0, normalizedEntropy: 0.8 },
      { timestamp: '2026-03-02T00:00:00.000Z', entropy: 0.7, normalizedEntropy: 0.2 },
    ];
    const collapse = detectEntropyAnomaly(collapseHistory, { collapseDropThreshold: 0.5 });
    expect(collapse.collapse).toBe(true);
    expect(collapse.spike).toBe(false);

    const spikeHistory: EntropySnapshot[] = [
      { timestamp: '2026-03-01T00:00:00.000Z', entropy: 1.0, normalizedEntropy: 0.3 },
      { timestamp: '2026-03-02T00:00:00.000Z', entropy: 1.7, normalizedEntropy: 0.6 },
    ];
    const spike = detectEntropyAnomaly(spikeHistory, { spikeRiseThreshold: 0.5 });
    expect(spike.collapse).toBe(false);
    expect(spike.spike).toBe(true);
  });

  it('correlateEntropyAnomalies links collapse/spike anomalies to concurrent events in window', () => {
    const entropyHistory: EntropySnapshot[] = [
      { timestamp: '2026-03-01T00:00:00.000Z', entropy: 2.0, normalizedEntropy: 0.8 },
      { timestamp: '2026-03-05T00:00:00.000Z', entropy: 0.8, normalizedEntropy: 0.2 },
    ];

    const antiGaming: AntiGamingEvent[] = [
      { timestamp: '2026-03-04T10:00:00.000Z', type: 'collusion_flag', sourceFamily: 'semgrep' },
    ];

    const overrides: OverrideEvent[] = [
      {
        timestamp: '2026-03-03T12:00:00.000Z',
        projectId: 'proj_test',
        overrideType: 'manual_pass',
        invariantId: 'inv-1',
        reason: 'manual bypass',
        issuerId: 'admin',
      },
    ];

    const result = correlateEntropyAnomalies(entropyHistory, antiGaming, overrides, 7);

    expect(result.anomalyDetected).toBe(true);
    expect(result.correlations.some(c => c.type === 'collapse_with_gaming')).toBe(true);
    expect(result.correlations.some(c => c.type === 'collapse_with_overrides')).toBe(true);
  });
});
