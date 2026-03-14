/**
 * Ephemeral Graph Runtime — Smoke Tests
 *
 * Validates isolation, seeding, stats, and cleanup.
 */

import {
  createEphemeralGraph,
  codeGraphFixture,
  planGraphFixture,
  type EphemeralGraphRuntime,
} from '../ephemeral-graph.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    ['creates ephemeral runtime with unique projectId', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      assert(rt.projectId.startsWith('__test_'), `bad projectId: ${rt.projectId}`);
      assert(rt.testId.length === 8, `bad testId: ${rt.testId}`);
      await rt.teardown();
    }],

    ['two runtimes get different projectIds', async () => {
      const rt1 = await createEphemeralGraph({ setupSchema: false });
      const rt2 = await createEphemeralGraph({ setupSchema: false });
      assert(rt1.projectId !== rt2.projectId, 'projectIds should differ');
      await rt1.teardown();
      await rt2.teardown();
    }],

    ['seed code graph fixture and verify stats', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      const fixture = codeGraphFixture({
        files: [{ name: 'a.ts' }, { name: 'b.ts' }],
        functions: [
          { name: 'foo', file: 'a.ts', riskLevel: 50, riskTier: 'MEDIUM' },
          { name: 'bar', file: 'b.ts', riskLevel: 5, riskTier: 'LOW' },
        ],
        calls: [{ from: 'foo', to: 'bar' }],
      });
      await rt.seed(fixture);
      const stats = await rt.stats();
      assert(stats.nodes === 4, `expected 4 nodes, got ${stats.nodes}`);
      // edges: 2 CONTAINS + 1 CALLS = 3, but each counted from both sides = 6? No, DISTINCT r.
      assert(stats.edges === 3, `expected 3 edges, got ${stats.edges}`);
      await rt.teardown();
    }],

    ['seed plan graph fixture', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      const fixture = planGraphFixture({
        milestones: [{ name: 'Milestone T1: Test' }],
        tasks: [
          { name: 'Task A', milestone: 'Milestone T1: Test', status: 'done' },
          { name: 'Task B', milestone: 'Milestone T1: Test', status: 'planned' },
        ],
        dependencies: [{ from: 'Task B', to: 'Task A' }],
      });
      await rt.seed(fixture);
      const stats = await rt.stats();
      assert(stats.nodes === 3, `expected 3 nodes, got ${stats.nodes}`);
      // 2 PART_OF + 1 DEPENDS_ON = 3
      assert(stats.edges === 3, `expected 3 edges, got ${stats.edges}`);
      await rt.teardown();
    }],

    ['teardown removes all test data', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      const testProjectId = rt.projectId;
      await rt.seed(codeGraphFixture({
        files: [{ name: 'x.ts' }],
        functions: [{ name: 'cleanup_test', file: 'x.ts' }],
      }));

      // Verify data exists before teardown
      const pre = await rt.stats();
      assert(pre.nodes > 0, 'should have nodes before teardown');

      await rt.teardown();

      // Verify with a fresh connection
      const verify = await createEphemeralGraph({ setupSchema: false });
      const result = await verify.run(
        'MATCH (n {projectId: $pid}) RETURN count(n) AS remaining',
        { pid: testProjectId }
      );
      const remaining = result.records[0].get('remaining').toNumber();
      assert(remaining === 0, `expected 0 remaining, got ${remaining}`);
      await verify.teardown();
    }],

    ['isolation: two runtimes dont see each others data', async () => {
      const rt1 = await createEphemeralGraph({ setupSchema: false });
      const rt2 = await createEphemeralGraph({ setupSchema: false });

      await rt1.seed(codeGraphFixture({
        files: [{ name: 'rt1.ts' }],
        functions: [{ name: 'rt1_fn', file: 'rt1.ts' }],
      }));
      await rt2.seed(codeGraphFixture({
        files: [{ name: 'rt2.ts' }],
        functions: [{ name: 'rt2_fn', file: 'rt2.ts' }],
      }));

      const stats1 = await rt1.stats();
      const stats2 = await rt2.stats();
      assert(stats1.nodes === 2, `rt1 should have 2 nodes, got ${stats1.nodes}`);
      assert(stats2.nodes === 2, `rt2 should have 2 nodes, got ${stats2.nodes}`);

      // Teardown rt1 shouldn't affect rt2
      await rt1.teardown();
      const stats2after = await rt2.stats();
      assert(stats2after.nodes === 2, `rt2 should still have 2 nodes after rt1 teardown, got ${stats2after.nodes}`);

      await rt2.teardown();
    }],

    ['run() executes arbitrary Cypher scoped by projectId', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(codeGraphFixture({
        files: [{ name: 'query.ts' }],
        functions: [
          { name: 'high_risk', file: 'query.ts', riskLevel: 500, riskTier: 'CRITICAL' },
          { name: 'low_risk', file: 'query.ts', riskLevel: 2, riskTier: 'LOW' },
        ],
      }));

      const result = await rt.run(`
        MATCH (f:Function {projectId: $projectId})
        WHERE f.riskTier = 'CRITICAL'
        RETURN f.name AS name
      `, { projectId: rt.projectId });

      assert(result.records.length === 1, `expected 1 critical fn, got ${result.records.length}`);
      assert(result.records[0].get('name') === 'high_risk', 'wrong function name');
      await rt.teardown();
    }],

    ['production data is untouched', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });

      // Count production nodes (non-test projectIds)
      const before = await rt.run(`
        MATCH (n) WHERE NOT n.projectId STARTS WITH '__test_'
        RETURN count(n) AS count
      `);
      const countBefore = before.records[0].get('count').toNumber();

      // Seed test data
      await rt.seed(codeGraphFixture({
        files: [{ name: 'safe.ts' }],
        functions: [{ name: 'safe_fn', file: 'safe.ts' }],
      }));

      // Count again — production should be unchanged
      const after = await rt.run(`
        MATCH (n) WHERE NOT n.projectId STARTS WITH '__test_'
        RETURN count(n) AS count
      `);
      const countAfter = after.records[0].get('count').toNumber();
      assert(countBefore === countAfter, `production nodes changed: ${countBefore} → ${countAfter}`);

      await rt.teardown();
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
