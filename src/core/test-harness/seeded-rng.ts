/**
 * Seeded RNG — Deterministic Random Number Generation
 *
 * Provides a seedable PRNG for test runs. Records seed in provenance
 * for exact replay. Uses xoshiro128** (fast, well-distributed, reproducible).
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N2, S1 Minimum
 */

export interface SeededRNGState {
  /** Original seed (for provenance) */
  seed: string;
  /** Internal PRNG state */
  state: Uint32Array;
  /** Whether Math.random is overridden */
  mathRandomOverridden: boolean;
  /** Original Math.random (for restore) */
  originalMathRandom: () => number;
}

let rngState: SeededRNGState | null = null;

/**
 * Create a seeded RNG and optionally override Math.random.
 *
 * @param seed - Seed string (default: 'test-seed-0')
 * @param overrideMathRandom - If true, replaces Math.random globally (default: true)
 * @returns Object with next() method and the seed for provenance
 */
export function seedRNG(seed = 'test-seed-0', overrideMathRandom = true): {
  seed: string;
  next: () => number;
} {
  if (rngState?.mathRandomOverridden) {
    restoreRNG();
  }

  const state = seedToState(seed);
  const originalMathRandom = Math.random;

  rngState = {
    seed,
    state,
    mathRandomOverridden: overrideMathRandom,
    originalMathRandom,
  };

  const next = () => xoshiro128ss(state);

  if (overrideMathRandom) {
    Math.random = next;
  }

  return { seed, next };
}

/**
 * Restore original Math.random.
 */
export function restoreRNG(): void {
  if (!rngState) return;

  if (rngState.mathRandomOverridden) {
    Math.random = rngState.originalMathRandom;
  }

  rngState = null;
}

/**
 * Get the current RNG state (for provenance recording).
 */
export function getRNGState(): { seed: string; active: boolean } | null {
  if (!rngState) return null;
  return { seed: rngState.seed, active: true };
}

/**
 * Guard: ensure RNG is seeded before running test logic.
 */
export function requireSeededRNG(): void {
  if (!rngState) {
    throw new Error(
      'Test requires seeded RNG but RNG is not seeded. ' +
      'Call seedRNG() before running this test.'
    );
  }
}

// ============================================================================
// INTERNALS — xoshiro128** PRNG
// ============================================================================

/**
 * Convert a seed string to 4x uint32 state via simple hash.
 */
function seedToState(seed: string): Uint32Array {
  const state = new Uint32Array(4);
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  // Splitmix32 to fill state
  for (let i = 0; i < 4; i++) {
    h += 0x9e3779b9;
    let t = h ^ (h >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    state[i] = t >>> 0;
  }
  // Ensure non-zero state
  if (state.every(v => v === 0)) {
    state[0] = 1;
  }
  return state;
}

/**
 * xoshiro128** — fast, well-distributed 32-bit PRNG.
 * Returns a float in [0, 1).
 */
function xoshiro128ss(s: Uint32Array): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9);
  const t = s[1] << 9;

  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = rotl(s[3], 11);

  return (result >>> 0) / 0x100000000;
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}
