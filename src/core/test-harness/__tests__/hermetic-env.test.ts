/**
 * Hermetic Environment — Smoke Tests
 *
 * Validates that frozen clock, locale, and RNG produce deterministic results.
 */

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

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => void][] = [
    ['frozen clock returns fixed time', () => {
      freezeClock('2026-06-15T12:00:00.000Z');
      const t1 = Date.now();
      const t2 = Date.now();
      assert(t1 === t2, `Date.now() should be stable: ${t1} vs ${t2}`);
      assert(t1 === new Date('2026-06-15T12:00:00.000Z').getTime(), `wrong frozen time: ${t1}`);
      restoreClock();
    }],

    ['advance clock moves time forward', () => {
      freezeClock('2026-01-01T00:00:00.000Z');
      advanceClock(60_000); // +1 minute
      const now = Date.now();
      assert(now === new Date('2026-01-01T00:01:00.000Z').getTime(), `advance failed: ${now}`);
      restoreClock();
    }],

    ['restore clock returns to real time', () => {
      const realBefore = Date.now();
      freezeClock('2000-01-01T00:00:00.000Z');
      assert(Date.now() < realBefore, 'should be in year 2000');
      restoreClock();
      const realAfter = Date.now();
      assert(realAfter >= realBefore, `should be back to real time: ${realAfter} < ${realBefore}`);
    }],

    ['seeded RNG is deterministic', () => {
      const { next: next1 } = seedRNG('test-abc', false);
      restoreRNG();
      const { next: next2 } = seedRNG('test-abc', false);

      const seq1 = [next1(), next1(), next1(), next1(), next1()];
      const seq2 = [next2(), next2(), next2(), next2(), next2()];

      for (let i = 0; i < seq1.length; i++) {
        assert(seq1[i] === seq2[i], `RNG mismatch at ${i}: ${seq1[i]} vs ${seq2[i]}`);
      }
      restoreRNG();
    }],

    ['different seeds produce different sequences', () => {
      const { next: next1 } = seedRNG('seed-a', false);
      const val1 = next1();
      restoreRNG();
      const { next: next2 } = seedRNG('seed-b', false);
      const val2 = next2();
      restoreRNG();
      assert(val1 !== val2, `different seeds should differ: ${val1} vs ${val2}`);
    }],

    ['Math.random override works', () => {
      seedRNG('fixed-seed', true);
      const r1 = Math.random();
      restoreRNG();
      seedRNG('fixed-seed', true);
      const r2 = Math.random();
      restoreRNG();
      assert(r1 === r2, `Math.random should be deterministic: ${r1} vs ${r2}`);
    }],

    ['setupHermeticEnv freezes everything', () => {
      const state = setupHermeticEnv({
        frozenClock: '2026-03-14T00:00:00.000Z',
        timezone: 'UTC',
        locale: 'en-US',
        rngSeed: 'harness-test',
      });
      assert(state.clock?.active === true, 'clock should be active');
      assert(state.locale?.active === true, 'locale should be active');
      assert(state.rng?.active === true, 'rng should be active');
      assert(state.clock?.frozenAt === '2026-03-14T00:00:00.000Z', 'wrong frozen time');
      assert(state.rng?.seed === 'harness-test', 'wrong seed');
      teardownHermeticEnv();
    }],

    ['provenance output has correct shape', () => {
      setupHermeticEnv({ rngSeed: 'prov-test', frozenClock: '2026-01-01T00:00:00.000Z' });
      const state = getHermeticState();
      const prov = hermeticStateToProvenance(state, 'A', 'micro');
      assert(prov.lane === 'A', 'wrong lane');
      assert(prov.fixtureTier === 'micro', 'wrong tier');
      assert(prov.seed === 'prov-test', 'wrong seed');
      assert(prov.frozenClock === '2026-01-01T00:00:00.000Z', 'wrong clock');
      teardownHermeticEnv();
    }],
  ];

  for (const [name, fn] of tests) {
    try {
      fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${name}: ${(e as Error).message}`);
    }
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

runTests();
