/**
 * N4 Semantic Test: Done/Proven Status Semantics
 *
 * Tests the relationship between task status (done/planned),
 * hasCodeEvidence flag, and actual HAS_CODE_EVIDENCE edges.
 *
 * Covers: happy path, failure cases, replay determinism, idempotency.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */

import {
  setupReplay,
  createEphemeralGraph,
  type ReplayContext,
} from '../../index.js';
import {
  SIMPLE_PLAN,
  PLAN_WITH_DRIFT,
  BLOCKED_CHAIN,
} from '../../fixtures/micro/index.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    // ---- HAPPY PATH ----
    ['done task with evidence: consistent state', async () => {
      const ctx = await setupReplay({
        testName: 'done-with-evidence',
        lane: 'A',
        hermeticConfig: { blockNetwork: false },
        fixture: SIMPLE_PLAN,
      });
      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, status: 'done'})
        WHERE t.hasCodeEvidence = true
        RETURN t.name AS name
      `, { pid: ctx.graph!.projectId });
      assert(result.records.length === 1, `expected 1 done+evidence task, got ${result.records.length}`);
      assert(result.records[0].get('name') === 'Set up project', 'wrong task');
      await ctx.finish();
    }],

    ['planned task without evidence: consistent state', async () => {
      const ctx = await setupReplay({
        testName: 'planned-no-evidence',
        lane: 'A',
        hermeticConfig: { blockNetwork: false },
        fixture: SIMPLE_PLAN,
      });
      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, status: 'planned'})
        WHERE t.hasCodeEvidence = false
        RETURN t.name AS name
      `, { pid: ctx.graph!.projectId });
      assert(result.records.length === 1, `expected 1 planned task, got ${result.records.length}`);
      await ctx.finish();
    }],

    // ---- FAILURE CASES ----
    ['drift detection: planned task WITH evidence flags as drift', async () => {
      const ctx = await setupReplay({
        testName: 'drift-detection',
        lane: 'A',
        hermeticConfig: { blockNetwork: false },
        fixture: PLAN_WITH_DRIFT,
      });
      const drift = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, status: 'planned'})
        WHERE t.hasCodeEvidence = true
        RETURN t.name AS name
      `, { pid: ctx.graph!.projectId });
      assert(drift.records.length === 1, `expected 1 drift task, got ${drift.records.length}`);
      assert(drift.records[0].get('name') === 'Implement feature X', 'wrong drifted task');
      await ctx.finish();
    }],

    ['blocked chain: downstream tasks cant be done before upstream', async () => {
      const ctx = await setupReplay({
        testName: 'blocked-chain-semantics',
        lane: 'A',
        hermeticConfig: { blockNetwork: false },
        fixture: BLOCKED_CHAIN,
      });
      // Check that final task depends transitively on foundation
      const chain = await ctx.graph!.run(`
        MATCH path = (final:Task {name: 'Final integration', projectId: $pid})
          -[:DEPENDS_ON*]->(root:Task {status: 'done'})
        RETURN length(path) AS depth
      `, { pid: ctx.graph!.projectId });
      assert(chain.records.length === 1, 'should find transitive dependency to done task');
      assert(chain.records[0].get('depth').toNumber() === 2, 'chain depth should be 2');
      await ctx.finish();
    }],

    // ---- REPLAY DETERMINISM ----
    ['replay produces identical query results', async () => {
      const ctx1 = await setupReplay({
        testName: 'replay-status',
        lane: 'A',
        hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', rngSeed: 'status-replay', blockNetwork: false },
        fixture: SIMPLE_PLAN,
      });
      const r1 = await ctx1.graph!.run(`
        MATCH (t:Task {projectId: $pid})
        RETURN t.name AS name, t.status AS status ORDER BY t.name
      `, { pid: ctx1.graph!.projectId });
      const names1 = r1.records.map(r => r.get('name'));
      const packet = await ctx1.finish();

      // Replay
      const ctx2 = await setupReplay({
        testName: 'replay-status',
        lane: 'A',
        hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', rngSeed: 'status-replay', blockNetwork: false },
        fixture: SIMPLE_PLAN,
      });
      const r2 = await ctx2.graph!.run(`
        MATCH (t:Task {projectId: $pid})
        RETURN t.name AS name, t.status AS status ORDER BY t.name
      `, { pid: ctx2.graph!.projectId });
      const names2 = r2.records.map(r => r.get('name'));
      await ctx2.finish();

      assert(JSON.stringify(names1) === JSON.stringify(names2), 'replay should produce same results');
    }],

    // ---- IDEMPOTENCY ----
    ['seeding same fixture twice yields same state', async () => {
      const fixture = SIMPLE_PLAN;

      const rt1 = await createEphemeralGraph({ setupSchema: false });
      await rt1.seed(fixture);
      const s1 = await rt1.stats();
      await rt1.teardown();

      const rt2 = await createEphemeralGraph({ setupSchema: false });
      await rt2.seed(fixture);
      const s2 = await rt2.stats();
      await rt2.teardown();

      assert(s1.nodes === s2.nodes, `node count differs: ${s1.nodes} vs ${s2.nodes}`);
      assert(s1.edges === s2.edges, `edge count differs: ${s1.edges} vs ${s2.edges}`);
    }],
  ];

  for (const [name, fn] of tests) {
    try {
      await fn();
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
