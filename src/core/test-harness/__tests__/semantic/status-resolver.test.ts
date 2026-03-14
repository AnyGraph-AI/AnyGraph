/**
 * N4 Semantic Test: Status Resolver Logic
 *
 * Tests how task status should be determined from graph evidence.
 * A "resolver" would look at HAS_CODE_EVIDENCE, DEPENDS_ON completion,
 * and drift flags to determine true status.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */

import { setupReplay } from '../../index.js';
import { SIMPLE_PLAN, PLAN_WITH_DRIFT, BLOCKED_CHAIN } from '../../fixtures/micro/index.js';
import { CODE_PLAN_CROSS_DOMAIN } from '../../fixtures/scenario/index.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    // HAPPY: task with all deps done is unblocked
    ['unblocked task: all dependencies satisfied', async () => {
      const ctx = await setupReplay({
        testName: 'resolver-unblocked', lane: 'A',
        hermeticConfig: { blockNetwork: false }, fixture: SIMPLE_PLAN,
      });
      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, status: 'planned'})
        WHERE ALL(dep IN [(t)-[:DEPENDS_ON]->(d) | d] WHERE dep.status = 'done')
        RETURN t.name AS name
      `, { pid: ctx.graph!.projectId });
      assert(result.records.length === 1, `expected 1 unblocked, got ${result.records.length}`);
      assert(result.records[0].get('name') === 'Write core logic', 'wrong unblocked task');
      await ctx.finish();
    }],

    // FAIL: task blocked by planned dependency
    ['blocked task: dependency not done', async () => {
      const ctx = await setupReplay({
        testName: 'resolver-blocked', lane: 'A',
        hermeticConfig: { blockNetwork: false }, fixture: BLOCKED_CHAIN,
      });
      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, name: 'Final integration'})
        OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep)
        WHERE dep.status <> 'done'
        RETURN count(dep) AS blockers
      `, { pid: ctx.graph!.projectId });
      assert(result.records[0].get('blockers').toNumber() === 1, 'should have 1 blocker');
      await ctx.finish();
    }],

    // REPLAY: same resolver query, same results
    ['replay: resolver produces deterministic results', async () => {
      const config = { testName: 'resolver-replay', lane: 'A',
        hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', rngSeed: 'resolver', blockNetwork: false },
        fixture: CODE_PLAN_CROSS_DOMAIN };

      const ctx1 = await setupReplay(config);
      const r1 = await ctx1.graph!.run(`
        MATCH (t:Task {projectId: $pid})-[:HAS_CODE_EVIDENCE]->(sf)
        RETURN t.name AS task, sf.name AS evidence ORDER BY t.name
      `, { pid: ctx1.graph!.projectId });
      const data1 = r1.records.map(r => `${r.get('task')}→${r.get('evidence')}`);
      await ctx1.finish();

      const ctx2 = await setupReplay(config);
      const r2 = await ctx2.graph!.run(`
        MATCH (t:Task {projectId: $pid})-[:HAS_CODE_EVIDENCE]->(sf)
        RETURN t.name AS task, sf.name AS evidence ORDER BY t.name
      `, { pid: ctx2.graph!.projectId });
      const data2 = r2.records.map(r => `${r.get('task')}→${r.get('evidence')}`);
      await ctx2.finish();

      assert(JSON.stringify(data1) === JSON.stringify(data2), 'resolver replay should match');
    }],

    // IDEMPOTENCY: running resolver query multiple times = same result
    ['idempotent: resolver query returns same result on repeated calls', async () => {
      const ctx = await setupReplay({
        testName: 'resolver-idempotent', lane: 'A',
        hermeticConfig: { blockNetwork: false }, fixture: SIMPLE_PLAN,
      });
      const query = `MATCH (t:Task {projectId: $pid}) RETURN t.name, t.status ORDER BY t.name`;
      const r1 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });
      const r2 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });
      const r3 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });

      const s1 = JSON.stringify(r1.records.map(r => r.toObject()));
      const s2 = JSON.stringify(r2.records.map(r => r.toObject()));
      const s3 = JSON.stringify(r3.records.map(r => r.toObject()));

      assert(s1 === s2 && s2 === s3, 'three runs should produce identical results');
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
