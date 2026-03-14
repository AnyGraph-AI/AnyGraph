/**
 * X3: Initial Metamorphic Suite — Test Suite
 *
 * Tests the three X3 tasks:
 * 1. Elementary query-equivalence relations on scoped fixtures
 * 2. Compound query-equivalence relations
 * 3. Semantics-preserving mutations on scoped fixtures
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X3
 */

import { strict as assert } from 'node:assert';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  createEphemeralGraph,
  checkQueryEquivalence,
  checkAllQueryEquivalences,
  checkSemanticsMutation,
  type QueryEquivalenceRelation,
  type SemanticsMutation,
  type EphemeralGraphRuntime,
} from '../../index.js';
import {
  SINGLE_FUNCTION,
  CROSS_FILE_CALL,
  HIGH_RISK_HUB,
} from '../../fixtures/micro/code-graph.fixture.js';
import {
  SIMPLE_PLAN,
  PLAN_WITH_DRIFT,
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

// ============================================================================
// TESTS
// ============================================================================

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

console.log('\n=== X3: Initial Metamorphic Suite ===\n');

// --- Task 1: Elementary query-equivalence relations ---

console.log('Task 1: Elementary query-equivalence relations');

await test('node count via MATCH vs via COUNT aggregate', async () => {
  await graph.seed(CROSS_FILE_CALL);

  const relation: QueryEquivalenceRelation = {
    name: 'node_count_equivalence',
    category: 'elementary',
    queryA: `MATCH (n {projectId: $projectId}) RETURN count(n) AS cnt`,
    queryB: `MATCH (n) WHERE n.projectId = $projectId RETURN count(n) AS cnt`,
    params: {},
    comparator: 'set_equality',
    description: 'Inline vs WHERE-clause projectId filtering should be equivalent',
  };

  const result = await checkQueryEquivalence(graph, relation);
  assert.ok(result.holds, result.details);
});

await test('function lookup by name: property vs WHERE', async () => {
  await graph.seed(SINGLE_FUNCTION);

  const relation: QueryEquivalenceRelation = {
    name: 'function_lookup_equivalence',
    category: 'elementary',
    queryA: `MATCH (f:Function {projectId: $projectId}) RETURN f.name AS name ORDER BY name`,
    queryB: `MATCH (f) WHERE f.projectId = $projectId AND 'Function' IN labels(f) RETURN f.name AS name ORDER BY name`,
    params: {},
    comparator: 'set_equality',
    description: 'Label match vs labels() IN should be equivalent',
  };

  const result = await checkQueryEquivalence(graph, relation);
  assert.ok(result.holds, result.details);
});

await test('CALLS edge count: forward vs reverse traversal', async () => {
  await graph.seed(CROSS_FILE_CALL);

  const relation: QueryEquivalenceRelation = {
    name: 'calls_edge_count_equivalence',
    category: 'elementary',
    queryA: `MATCH (a {projectId: $projectId})-[r:CALLS]->(b {projectId: $projectId}) RETURN count(r) AS cnt`,
    queryB: `MATCH (b {projectId: $projectId})<-[r:CALLS]-(a {projectId: $projectId}) RETURN count(r) AS cnt`,
    params: {},
    comparator: 'set_equality',
    description: 'Forward and reverse edge traversal should count the same edges',
  };

  const result = await checkQueryEquivalence(graph, relation);
  assert.ok(result.holds, result.details);
});

await test('task count via PART_OF: task→milestone vs milestone←task', async () => {
  await graph.seed(SIMPLE_PLAN);

  const relation: QueryEquivalenceRelation = {
    name: 'task_partof_equivalence',
    category: 'elementary',
    queryA: `MATCH (t:Task {projectId: $projectId})-[:PART_OF]->(m:Milestone {projectId: $projectId}) RETURN count(t) AS cnt`,
    queryB: `MATCH (m:Milestone {projectId: $projectId})<-[:PART_OF]-(t:Task {projectId: $projectId}) RETURN count(t) AS cnt`,
    params: {},
    comparator: 'set_equality',
    description: 'PART_OF traversal direction should not affect task count',
  };

  const result = await checkQueryEquivalence(graph, relation);
  assert.ok(result.holds, result.details);
});

// --- Task 2: Compound query-equivalence relations ---

console.log('\nTask 2: Compound query-equivalence relations');

await test('compound: nodes with edges vs nodes from edge endpoints', async () => {
  await graph.seed(HIGH_RISK_HUB);

  const relation: QueryEquivalenceRelation = {
    name: 'nodes_with_edges_compound',
    category: 'compound',
    queryA: `
      MATCH (n {projectId: $projectId})
      WHERE EXISTS { (n)-[]-() }
      RETURN count(DISTINCT n) AS cnt
    `,
    queryB: `
      MATCH (a {projectId: $projectId})-[]-(b {projectId: $projectId})
      WITH collect(DISTINCT a) + collect(DISTINCT b) AS all
      UNWIND all AS n
      RETURN count(DISTINCT n) AS cnt
    `,
    params: {},
    comparator: 'set_equality',
    description: 'Nodes with edges (EXISTS) should equal distinct endpoints of all edges',
  };

  const result = await checkQueryEquivalence(graph, relation);
  assert.ok(result.holds, result.details);
});

await test('compound: done task count via status filter vs aggregation', async () => {
  await graph.seed(SIMPLE_PLAN); // has 1 done task — GROUP BY will produce a 'done' row

  const relation: QueryEquivalenceRelation = {
    name: 'done_task_count_compound',
    category: 'compound',
    queryA: `
      MATCH (t:Task {projectId: $projectId, status: 'done'})
      RETURN count(t) AS cnt
    `,
    queryB: `
      MATCH (t:Task {projectId: $projectId})
      WITH t.status AS status, count(*) AS cnt
      WHERE status = 'done'
      RETURN cnt
    `,
    params: {},
    comparator: 'set_equality',
    description: 'Direct status filter vs GROUP BY + filter should be equivalent',
  };

  const result = await checkQueryEquivalence(graph, relation);
  assert.ok(result.holds, result.details);
});

await test('compound: batch equivalence check returns all results', async () => {
  await graph.seed(CROSS_FILE_CALL);

  const relations: QueryEquivalenceRelation[] = [
    {
      name: 'batch_1',
      category: 'elementary',
      queryA: `MATCH (n {projectId: $projectId}) RETURN count(n) AS c`,
      queryB: `MATCH (n) WHERE n.projectId = $projectId RETURN count(n) AS c`,
      params: {},
      description: 'batch test 1',
    },
    {
      name: 'batch_2',
      category: 'elementary',
      queryA: `MATCH ()-[r {projectId: $projectId}]->() RETURN count(r) AS c`,
      queryB: `MATCH ()-[r]->() WHERE r.projectId = $projectId RETURN count(r) AS c`,
      params: {},
      comparator: 'count_equality',
      description: 'batch test 2',
    },
  ];

  const { passed: allPassed, results } = await checkAllQueryEquivalences(graph, relations);
  assert.ok(allPassed, `batch failed: ${results.filter(r => !r.holds).map(r => r.details).join('; ')}`);
  assert.equal(results.length, 2, 'should return 2 results');
});

// --- Task 3: Semantics-preserving mutations ---

console.log('\nTask 3: Semantics-preserving mutations');

await test('adding a property to a node preserves structural queries', async () => {
  await graph.seed(CROSS_FILE_CALL);

  const mutation: SemanticsMutation = {
    name: 'add_property_preserves_structure',
    mutationStatements: [
      `MATCH (f:Function {projectId: $projectId})
       SET f.testAnnotation = 'added_by_metamorphic_test'`,
    ],
    preservedQueries: [
      {
        name: 'node_count',
        query: `MATCH (n {projectId: $projectId}) RETURN count(n) AS cnt`,
        params: {},
      },
      {
        name: 'edge_count',
        query: `MATCH (a {projectId: $projectId})-[r]->(b {projectId: $projectId}) RETURN count(r) AS cnt`,
        params: {},
      },
      {
        name: 'function_names',
        query: `MATCH (f:Function {projectId: $projectId}) RETURN f.name AS name ORDER BY name`,
        params: {},
      },
    ],
    description: 'Adding a non-structural property should not change node/edge counts or names',
  };

  const result = await checkSemanticsMutation(graph, mutation);
  assert.ok(result.allPreserved, `Mutation broke preserved queries: ${
    result.preservedResults.filter(r => !r.preserved).map(r => r.details).join('; ')
  }`);
});

await test('renaming a non-key property preserves edge topology', async () => {
  await graph.seed(SIMPLE_PLAN);

  const mutation: SemanticsMutation = {
    name: 'rename_description_preserves_topology',
    mutationStatements: [
      `MATCH (t:Task {projectId: $projectId})
       SET t.description = 'mutated_description'`,
    ],
    preservedQueries: [
      {
        name: 'edge_topology',
        query: `MATCH (a {projectId: $projectId})-[r]->(b {projectId: $projectId})
                RETURN type(r) AS relType, a.name AS from, b.name AS to
                ORDER BY relType, from, to`,
        params: {},
      },
      {
        name: 'task_count',
        query: `MATCH (t:Task {projectId: $projectId}) RETURN count(t) AS cnt`,
        params: {},
      },
    ],
    description: 'Changing description should not affect edge topology or task count',
  };

  const result = await checkSemanticsMutation(graph, mutation);
  assert.ok(result.allPreserved, `Mutation broke: ${
    result.preservedResults.filter(r => !r.preserved).map(r => r.details).join('; ')
  }`);
});

await test('adding isolated node preserves existing edge queries', async () => {
  await graph.seed(SINGLE_FUNCTION);

  const mutation: SemanticsMutation = {
    name: 'add_isolated_node_preserves_edges',
    mutationStatements: [
      `CREATE (n:Function {projectId: $projectId, name: 'orphan_function', riskLevel: 'low'})`,
    ],
    preservedQueries: [
      {
        name: 'existing_edges',
        query: `MATCH (a {projectId: $projectId})-[r]->(b {projectId: $projectId})
                RETURN type(r) AS relType, a.name AS from, b.name AS to
                ORDER BY relType, from, to`,
        params: {},
      },
    ],
    description: 'Adding an isolated node should not affect existing edges',
  };

  const result = await checkSemanticsMutation(graph, mutation);
  assert.ok(result.allPreserved, `Mutation broke: ${
    result.preservedResults.filter(r => !r.preserved).map(r => r.details).join('; ')
  }`);
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
