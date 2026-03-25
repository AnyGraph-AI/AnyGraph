// Spec source: plans/codegraph/TDD_ROADMAP.md §N2

import { describe, it, expect } from 'vitest';
import { seedRNG, restoreRNG, getRNGState } from '../seeded-rng.js';

describe('seeded-rng.ts audit', () => {
  it('seedRNG overrides Math.random with deterministic PRNG', () => {
    const original = Math.random;
    seedRNG('override-check', true);

    expect(Math.random).not.toBe(original);
    expect(getRNGState()?.seed).toBe('override-check');

    restoreRNG();
    expect(Math.random).toBe(original);
  });

  it('same seed produces identical random sequence', () => {
    const first = seedRNG('same-seed-sequence', false);
    const seqA = [first.next(), first.next(), first.next(), first.next()];

    const second = seedRNG('same-seed-sequence', false);
    const seqB = [second.next(), second.next(), second.next(), second.next()];

    expect(seqA).toEqual(seqB);

    restoreRNG();
  });

  it('restoreRNG restores original Math.random after override', () => {
    const original = Math.random;
    seedRNG('restore-check', true);

    const overridden = Math.random;
    expect(overridden).not.toBe(original);

    restoreRNG();
    expect(Math.random).toBe(original);
  });

  it('different seeds produce different sequences', () => {
    const seqA = (() => {
      const rng = seedRNG('seed-A', false);
      return [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
    })();

    const seqB = (() => {
      const rng = seedRNG('seed-B', false);
      return [rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
    })();

    expect(seqA).not.toEqual(seqB);

    restoreRNG();
  });
});
