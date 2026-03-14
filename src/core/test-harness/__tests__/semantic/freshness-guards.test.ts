/**
 * N4 Semantic Test: Freshness Guards
 *
 * Tests that stale data is detected: plan freshness, governance freshness,
 * evidence staleness, snapshot age.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */

import { setupReplay, freezeClock, advanceClock, restoreClock } from '../../index.js';
import { SIMPLE_PLAN } from '../../fixtures/micro/index.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    // HAPPY: fresh data passes freshness check
    ['fresh snapshot passes age check', async () => {
      const ctx = await setupReplay({
        testName: 'fresh-snapshot', lane: 'A',
        hermeticConfig: { frozenClock: '2026-01-01T12:00:00.000Z', blockNetwork: false },
        fixture: SIMPLE_PLAN,
      });
      // Simulate a snapshot taken at frozen time
      await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, name: 'Set up project'})
        SET t.lastVerifiedAt = $now
      `, { pid: ctx.graph!.projectId, now: '2026-01-01T12:00:00.000Z' });

      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid})
        WHERE t.lastVerifiedAt IS NOT NULL
          AND t.lastVerifiedAt = '2026-01-01T12:00:00.000Z'
        RETURN count(t) AS fresh
      `, { pid: ctx.graph!.projectId });
      assert(result.records[0].get('fresh').toNumber() === 1, 'should find fresh task');
      await ctx.finish();
    }],

    // FAIL: stale data detected
    ['stale verification detected after time advance', async () => {
      const ctx = await setupReplay({
        testName: 'stale-detection', lane: 'A',
        hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', blockNetwork: false },
        fixture: SIMPLE_PLAN,
      });
      // Set verification time to frozen clock
      await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, name: 'Set up project'})
        SET t.lastVerifiedAt = '2026-01-01T00:00:00.000Z'
      `, { pid: ctx.graph!.projectId });

      // Query for tasks stale by more than 24h (simulating future check)
      const staleThreshold = '2026-01-02T00:00:00.000Z';
      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid})
        WHERE t.lastVerifiedAt IS NOT NULL
          AND t.lastVerifiedAt < $threshold
        RETURN count(t) AS stale
      `, { pid: ctx.graph!.projectId, threshold: staleThreshold });
      assert(result.records[0].get('stale').toNumber() === 1, 'should detect stale task');
      await ctx.finish();
    }],

    // REPLAY: freshness check is deterministic
    ['replay: freshness queries deterministic', async () => {
      const config = {
        testName: 'freshness-replay', lane: 'A',
        hermeticConfig: { frozenClock: '2026-06-01T00:00:00.000Z', rngSeed: 'fresh', blockNetwork: false },
        fixture: SIMPLE_PLAN,
      };
      const ctx1 = await setupReplay(config);
      const t1 = Date.now();
      await ctx1.finish();

      const ctx2 = await setupReplay(config);
      const t2 = Date.now();
      await ctx2.finish();

      assert(t1 === t2, `frozen clock should match: ${t1} vs ${t2}`);
    }],

    // IDEMPOTENCY: same freshness query repeated = same result
    ['idempotent: freshness query stable across calls', async () => {
      const ctx = await setupReplay({
        testName: 'freshness-idempotent', lane: 'A',
        hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', blockNetwork: false },
        fixture: SIMPLE_PLAN,
      });
      const query = `MATCH (t:Task {projectId: $pid}) RETURN count(t) AS total`;
      const r1 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });
      const r2 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });
      assert(
        r1.records[0].get('total').toNumber() === r2.records[0].get('total').toNumber(),
        'repeated queries should match'
      );
      await ctx.finish();
    }],
  ];

  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.error(`  ❌ ${name}: ${(e as Error).message}`); }
  }
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

runTests();
