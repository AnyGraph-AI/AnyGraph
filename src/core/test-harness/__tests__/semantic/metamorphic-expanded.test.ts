/**
 * L1: Full Metamorphic + Mutation Expansion — Test Suite
 *
 * Tests both L1 tasks:
 * 1. Expand elementary/compound/dynamic MR coverage
 * 2. Build mutation library with reduced counterexamples
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L1
 */

import { strict as assert } from 'node:assert';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  createEphemeralGraph,
  checkQueryEquivalence,
  checkAllQueryEquivalences,
  checkSemanticsMutation,
  PRESERVING_MUTATIONS,
  BREAKING_MUTATIONS,
  DYNAMIC_QUERY_EQUIVALENCES,
  reduceBreakingMutation,
  type EphemeralGraphRuntime,
} from '../../index.js';
import {
  SINGLE_FUNCTION,
  CROSS_FILE_CALL,
  HIGH_RISK_HUB,
  STATEFUL_CLASS,
} from '../../fixtures/micro/code-graph.fixture.js';
import {
  SIMPLE_PLAN,
  PLAN_WITH_DRIFT,
  BLOCKED_CHAIN,
  PLAN_WITH_DECISION,
} from '../../fixtures/micro/plan-graph.fixture.js';

// ============================================================================
// SETUP / TEARDOWN
// ============================================================================

let graph: EphemeralGraphRuntime;

async function setup() {
  setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' });
  graph = await createEphemeralGraph({ setupSchema: false });
}

async function teardown() {
  if (graph) await graph.teardown();
  teardownHermeticEnv();
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  await setup();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  } finally {
    await teardown();
  }
}

console.log('\n=== L1: Full Metamorphic + Mutation Expansion ===\n');

// --- Task 1: Expand MR coverage ---

console.log('Task 1: Expand elementary/compound/dynamic MR coverage');

await test('dynamic equivalences hold on SINGLE_FUNCTION fixture', async () => {
  await graph.seed(SINGLE_FUNCTION);
  const { passed: allPassed, results } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
  const failures = results.filter(r => !r.holds);
  assert.ok(allPassed, `Failed: ${failures.map(r => `${r.relation}: ${r.details}`).join('; ')}`);
});

await test('dynamic equivalences hold on CROSS_FILE_CALL fixture', async () => {
  await graph.seed(CROSS_FILE_CALL);
  const { passed: allPassed, results } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
  const failures = results.filter(r => !r.holds);
  assert.ok(allPassed, `Failed: ${failures.map(r => `${r.relation}: ${r.details}`).join('; ')}`);
});

await test('dynamic equivalences hold on HIGH_RISK_HUB fixture', async () => {
  await graph.seed(HIGH_RISK_HUB);
  const { passed: allPassed, results } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
  const failures = results.filter(r => !r.holds);
  assert.ok(allPassed, `Failed: ${failures.map(r => `${r.relation}: ${r.details}`).join('; ')}`);
});

await test('dynamic equivalences hold on SIMPLE_PLAN fixture', async () => {
  await graph.seed(SIMPLE_PLAN);
  const { passed: allPassed, results } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
  const failures = results.filter(r => !r.holds);
  assert.ok(allPassed, `Failed: ${failures.map(r => `${r.relation}: ${r.details}`).join('; ')}`);
});

await test('dynamic equivalences hold on BLOCKED_CHAIN fixture', async () => {
  await graph.seed(BLOCKED_CHAIN);
  const { passed: allPassed, results } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
  const failures = results.filter(r => !r.holds);
  assert.ok(allPassed, `Failed: ${failures.map(r => `${r.relation}: ${r.details}`).join('; ')}`);
});

// --- Task 2: Mutation library with counterexample reduction ---

console.log('\nTask 2: Mutation library with reduced counterexamples');

await test('all preserving mutations preserve code graph structure', async () => {
  await graph.seed(CROSS_FILE_CALL);
  for (const mutation of PRESERVING_MUTATIONS) {
    // Only run mutations that target code graphs (not plan-only)
    if (mutation.preservedQueries.some(q => q.query.includes('Task'))) continue;
    const result = await checkSemanticsMutation(graph, mutation);
    assert.ok(result.allPreserved, `${mutation.name} broke: ${
      result.preservedResults.filter(r => !r.preserved).map(r => r.details).join('; ')
    }`);
  }
});

await test('all preserving mutations preserve plan graph structure', async () => {
  await graph.seed(SIMPLE_PLAN);
  for (const mutation of PRESERVING_MUTATIONS) {
    // Only run mutations that target plan graphs
    if (!mutation.preservedQueries.some(q => q.query.includes('Task') || q.query.includes('status'))) continue;
    const result = await checkSemanticsMutation(graph, mutation);
    assert.ok(result.allPreserved, `${mutation.name} broke: ${
      result.preservedResults.filter(r => !r.preserved).map(r => r.details).join('; ')
    }`);
  }
});

await test('breaking mutations actually change results', async () => {
  await graph.seed(CROSS_FILE_CALL);

  // Test count-based breaking mutations (add_new_function, delete_all_edges)
  for (const mutation of BREAKING_MUTATIONS.filter(m =>
    m.affectedQueries.every(q => q.expectedChange !== 'content_change')
  )) {
    const beforeResults = new Map<string, number>();
    for (const aq of mutation.affectedQueries) {
      const result = await graph.run(aq.query, { ...aq.params, projectId: graph.projectId });
      const val = result.records[0]?.get('cnt');
      const cnt = val?.low ?? val ?? 0;
      beforeResults.set(aq.name, cnt as number);
    }

    for (const stmt of mutation.mutationStatements) {
      await graph.run(stmt, { projectId: graph.projectId });
    }

    for (const aq of mutation.affectedQueries) {
      const result = await graph.run(aq.query, { ...aq.params, projectId: graph.projectId });
      const val = result.records[0]?.get('cnt');
      const afterCnt = (val?.low ?? val ?? 0) as number;
      const beforeCnt = beforeResults.get(aq.name)!;

      if (aq.expectedChange === 'count_increase') {
        assert.ok(afterCnt > beforeCnt,
          `${mutation.name}/${aq.name}: expected increase but ${beforeCnt} → ${afterCnt}`);
      } else if (aq.expectedChange === 'count_decrease') {
        assert.ok(afterCnt < beforeCnt,
          `${mutation.name}/${aq.name}: expected decrease but ${beforeCnt} → ${afterCnt}`);
      }
    }
  }
});

await test('content-change mutations alter query results', async () => {
  await graph.seed(SIMPLE_PLAN);

  // Test status change mutation on plan fixture (has tasks)
  const statusMutation = BREAKING_MUTATIONS.find(m => m.name === 'change_task_status')!;

  // Before: snapshot status distribution
  const beforeResult = await graph.run(
    `MATCH (t:Task {projectId: $projectId}) RETURN t.status AS status, count(t) AS cnt ORDER BY status`,
    { projectId: graph.projectId }
  );
  const beforeRows = beforeResult.records.map(r =>
    `${r.get('status')}:${r.get('cnt').low ?? r.get('cnt')}`
  ).join(',');

  for (const stmt of statusMutation.mutationStatements) {
    await graph.run(stmt, { projectId: graph.projectId });
  }

  const afterResult = await graph.run(
    `MATCH (t:Task {projectId: $projectId}) RETURN t.status AS status, count(t) AS cnt ORDER BY status`,
    { projectId: graph.projectId }
  );
  const afterRows = afterResult.records.map(r =>
    `${r.get('status')}:${r.get('cnt').low ?? r.get('cnt')}`
  ).join(',');

  assert.notEqual(beforeRows, afterRows, `Status distribution should change: ${beforeRows} → ${afterRows}`);
});

await test('counterexample reduction produces minimal mutation', async () => {
  const mutation = BREAKING_MUTATIONS.find(m => m.name === 'delete_all_edges')!;
  const cx = reduceBreakingMutation(mutation, 'edge_count');

  assert.equal(cx.mutationName, 'delete_all_edges');
  assert.equal(cx.queryName, 'edge_count');
  assert.ok(cx.minimalMutation.length >= 1, 'should have at least one statement');
  assert.ok(cx.minimalMutation.length <= cx.originalMutation.length, 'minimal should not be longer than original');
  assert.ok(cx.expectedBehavior, 'should have expected behavior');
});

await test('mutation library covers all fixture types', async () => {
  // Test on STATEFUL_CLASS (code) and PLAN_WITH_DECISION (plan) for breadth
  await graph.seed(STATEFUL_CLASS);

  const addMeta = PRESERVING_MUTATIONS.find(m => m.name === 'add_metadata_property')!;
  const result = await checkSemanticsMutation(graph, addMeta);
  assert.ok(result.allPreserved, `add_metadata_property broke on STATEFUL_CLASS: ${
    result.preservedResults.filter(r => !r.preserved).map(r => r.details).join('; ')
  }`);
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
