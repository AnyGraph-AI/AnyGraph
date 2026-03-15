/**
 * TC-1: Temporal Confidence Tests
 */
import { describe, it, expect } from 'vitest';
import { computeTemporalFactors, type TemporalDecayConfig } from '../../../verification/temporal-confidence.js';

const DEFAULT_CONFIG: TemporalDecayConfig = {
  decayWindowHours: 720,
  minimumFactor: 0.1,
  defaultValidityHours: 2160,
};

describe('Temporal Confidence (TC-1)', () => {
  const now = new Date('2026-03-15T12:00:00Z');

  it('returns 1.0/1.0 for fresh evidence within validity window', () => {
    const factors = computeTemporalFactors(
      '2026-03-15T10:00:00Z', // observed 2h ago
      '2026-03-15T10:00:00Z', // valid from same time
      '2026-06-15T10:00:00Z', // valid for 3 months
      null,                    // not superseded
      now,
      DEFAULT_CONFIG,
    );
    expect(factors.timeConsistencyFactor).toBe(1.0);
    expect(factors.retroactivePenalty).toBe(1.0);
  });

  it('returns minimum factor + 0 penalty for superseded evidence', () => {
    const factors = computeTemporalFactors(
      '2026-03-10T10:00:00Z',
      '2026-03-10T10:00:00Z',
      '2026-06-10T10:00:00Z',
      '2026-03-14T10:00:00Z', // superseded yesterday
      now,
      DEFAULT_CONFIG,
    );
    expect(factors.timeConsistencyFactor).toBe(DEFAULT_CONFIG.minimumFactor);
    expect(factors.retroactivePenalty).toBe(0.0);
  });

  it('decays linearly after validity expires', () => {
    // Expired 360 hours ago (half the decay window)
    const expiredAt = new Date(now.getTime() - 360 * 3600_000);
    const validTo = expiredAt.toISOString();
    const observedAt = new Date(expiredAt.getTime() - 24 * 3600_000).toISOString();

    const factors = computeTemporalFactors(
      observedAt,
      observedAt,
      validTo,
      null,
      now,
      DEFAULT_CONFIG,
    );

    // Half decay: 1.0 - 0.5 * (1.0 - 0.1) = 1.0 - 0.45 = 0.55
    expect(factors.timeConsistencyFactor).toBeCloseTo(0.55, 2);
    expect(factors.retroactivePenalty).toBe(1.0); // not superseded
  });

  it('hits minimum factor at full decay window', () => {
    // Expired exactly 720 hours ago (full decay window)
    const expiredAt = new Date(now.getTime() - 720 * 3600_000);
    const validTo = expiredAt.toISOString();
    const observedAt = new Date(expiredAt.getTime() - 24 * 3600_000).toISOString();

    const factors = computeTemporalFactors(
      observedAt,
      observedAt,
      validTo,
      null,
      now,
      DEFAULT_CONFIG,
    );

    expect(factors.timeConsistencyFactor).toBeCloseTo(DEFAULT_CONFIG.minimumFactor, 2);
  });

  it('uses default validity window when validTo is null', () => {
    // Observed 100 days ago (2400h), default window is 90 days (2160h)
    // So expired 240h ago, decay ratio = 240/720 = 0.333
    const observedAt = new Date(now.getTime() - 2400 * 3600_000).toISOString();

    const factors = computeTemporalFactors(
      observedAt,
      observedAt,
      null, // open-ended → default 2160h window
      null,
      now,
      DEFAULT_CONFIG,
    );

    // 240h past expiry, decay = 240/720 = 0.333, factor = 1.0 - 0.333 * 0.9 = 0.7
    expect(factors.timeConsistencyFactor).toBeCloseTo(0.7, 1);
    expect(factors.retroactivePenalty).toBe(1.0);
  });

  it('returns 1.0/1.0 for evidence with no observedAt', () => {
    const factors = computeTemporalFactors(null, null, null, null, now, DEFAULT_CONFIG);
    expect(factors.timeConsistencyFactor).toBe(1.0);
    expect(factors.retroactivePenalty).toBe(1.0);
  });

  it('never goes below minimum factor', () => {
    // Way past decay window
    const observedAt = new Date(now.getTime() - 10000 * 3600_000).toISOString();
    const validTo = new Date(now.getTime() - 9000 * 3600_000).toISOString();

    const factors = computeTemporalFactors(
      observedAt,
      observedAt,
      validTo,
      null,
      now,
      DEFAULT_CONFIG,
    );

    expect(factors.timeConsistencyFactor).toBe(DEFAULT_CONFIG.minimumFactor);
  });

  it('respects custom config', () => {
    const customConfig: TemporalDecayConfig = {
      decayWindowHours: 100,
      minimumFactor: 0.5,
      defaultValidityHours: 48,
    };

    // Observed 72h ago, default validity 48h → expired 24h ago
    // Decay ratio = 24/100 = 0.24, factor = 1.0 - 0.24 * 0.5 = 0.88
    const observedAt = new Date(now.getTime() - 72 * 3600_000).toISOString();

    const factors = computeTemporalFactors(
      observedAt,
      observedAt,
      null,
      null,
      now,
      customConfig,
    );

    expect(factors.timeConsistencyFactor).toBeCloseTo(0.88, 2);
  });
});
