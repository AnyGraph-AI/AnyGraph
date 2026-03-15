/**
 * Hermetic Environment — Smoke Tests
 *
 * Validates that frozen clock, locale, and RNG produce deterministic results.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  freezeClock,
  advanceClock,
  restoreClock,
  seedRNG,
  restoreRNG,
  hermeticStateToProvenance,
  getHermeticState,
} from '../index.js';

describe('Hermetic Environment', () => {
  afterEach(() => {
    restoreClock();
    restoreRNG();
  });

  it('frozen clock returns fixed time', () => {
    freezeClock('2026-06-15T12:00:00.000Z');
    const t1 = Date.now();
    const t2 = Date.now();
    expect(t1).toBe(t2);
    expect(t1).toBe(new Date('2026-06-15T12:00:00.000Z').getTime());
  });

  it('advance clock moves time forward', () => {
    freezeClock('2026-01-01T00:00:00.000Z');
    advanceClock(60_000); // +1 minute
    const now = Date.now();
    expect(now).toBe(new Date('2026-01-01T00:01:00.000Z').getTime());
  });

  it('restore clock returns to real time', () => {
    const realBefore = Date.now();
    freezeClock('2000-01-01T00:00:00.000Z');
    expect(Date.now()).toBeLessThan(realBefore);
    restoreClock();
    const realAfter = Date.now();
    expect(realAfter).toBeGreaterThanOrEqual(realBefore);
  });

  it('seeded RNG is deterministic', () => {
    const { next: next1 } = seedRNG('test-abc', false);
    restoreRNG();
    const { next: next2 } = seedRNG('test-abc', false);

    const seq1 = [next1(), next1(), next1(), next1(), next1()];
    const seq2 = [next2(), next2(), next2(), next2(), next2()];

    for (let i = 0; i < seq1.length; i++) {
      expect(seq1[i]).toBe(seq2[i]);
    }
  });

  it('different seeds produce different sequences', () => {
    const { next: next1 } = seedRNG('seed-a', false);
    const val1 = next1();
    restoreRNG();
    const { next: next2 } = seedRNG('seed-b', false);
    const val2 = next2();
    expect(val1).not.toBe(val2);
  });

  it('Math.random override works', () => {
    seedRNG('fixed-seed', true);
    const r1 = Math.random();
    restoreRNG();
    seedRNG('fixed-seed', true);
    const r2 = Math.random();
    expect(r1).toBe(r2);
  });

  it('setupHermeticEnv freezes everything', () => {
    const state = setupHermeticEnv({
      frozenClock: '2026-03-14T00:00:00.000Z',
      timezone: 'UTC',
      locale: 'en-US',
      rngSeed: 'harness-test',
    });
    expect(state.clock?.active).toBe(true);
    expect(state.locale?.active).toBe(true);
    expect(state.rng?.active).toBe(true);
    expect(state.clock?.frozenAt).toBe('2026-03-14T00:00:00.000Z');
    expect(state.rng?.seed).toBe('harness-test');
    teardownHermeticEnv();
  });

  it('provenance output has correct shape', () => {
    setupHermeticEnv({ rngSeed: 'prov-test', frozenClock: '2026-01-01T00:00:00.000Z' });
    const state = getHermeticState();
    const prov = hermeticStateToProvenance(state, 'A', 'micro');
    expect(prov.lane).toBe('A');
    expect(prov.fixtureTier).toBe('micro');
    expect(prov.seed).toBe('prov-test');
    expect(prov.frozenClock).toBe('2026-01-01T00:00:00.000Z');
    teardownHermeticEnv();
  });
});
