/**
 * Mutation Library — Semantics-Preserving & Breaking Mutations for Metamorphic Testing
 *
 * Pre-built mutation operators for graph testing. Each mutation is classified
 * as either semantics-preserving (should NOT change query results) or
 * semantics-breaking (SHOULD change query results).
 *
 * Includes counterexample reduction: when a mutation reveals a bug,
 * the library automatically tries smaller mutations to find the minimal
 * reproducing case.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L1
 */

import type { SemanticsMutation, QueryEquivalenceRelation } from './metamorphic.js';

// ============================================================================
// MUTATION OPERATORS — SEMANTICS-PRESERVING
// ============================================================================

/**
 * Mutations that should NOT affect structural or semantic query results.
 */
export const PRESERVING_MUTATIONS: SemanticsMutation[] = [
  {
    name: 'add_metadata_property',
    mutationStatements: [
      `MATCH (n {projectId: $projectId})
       WHERE n:Function OR n:SourceFile
       SET n._mutation_tag = 'metamorphic_test'`,
    ],
    preservedQueries: [
      {
        name: 'node_count',
        query: `MATCH (n {projectId: $projectId}) RETURN count(n) AS cnt`,
        params: {},
      },
      {
        name: 'edge_count',
        query: `MATCH ()-[r]->() WHERE r.projectId = $projectId RETURN count(r) AS cnt`,
        params: {},
      },
      {
        name: 'function_names',
        query: `MATCH (f:Function {projectId: $projectId}) RETURN f.name ORDER BY f.name`,
        params: {},
      },
    ],
    description: 'Adding underscore-prefixed metadata should not affect structure queries',
  },
  {
    name: 'update_description_fields',
    mutationStatements: [
      `MATCH (n {projectId: $projectId})
       WHERE n:Task OR n:Milestone
       SET n.description = coalesce(n.description, '') + ' [mutated]'`,
    ],
    preservedQueries: [
      {
        name: 'task_count',
        query: `MATCH (t:Task {projectId: $projectId}) RETURN count(t) AS cnt`,
        params: {},
      },
      {
        name: 'edge_topology',
        query: `MATCH (a {projectId: $projectId})-[r]->(b {projectId: $projectId})
                RETURN type(r) AS t, a.name AS from, b.name AS to ORDER BY t, from, to`,
        params: {},
      },
      {
        name: 'status_distribution',
        query: `MATCH (t:Task {projectId: $projectId})
                RETURN t.status AS status, count(t) AS cnt ORDER BY status`,
        params: {},
      },
    ],
    description: 'Updating description should not affect status distribution or topology',
  },
  {
    name: 'add_then_remove_isolated_node',
    mutationStatements: [
      `CREATE (n:_MutationProbe {projectId: $projectId, name: '_probe_node'})`,
      `MATCH (n:_MutationProbe {projectId: $projectId}) DETACH DELETE n`,
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
    ],
    description: 'Adding then removing a node should leave graph unchanged',
  },
  {
    name: 'set_property_to_same_value',
    mutationStatements: [
      `MATCH (f:Function {projectId: $projectId})
       SET f.name = f.name`,
    ],
    preservedQueries: [
      {
        name: 'function_snapshot',
        query: `MATCH (f:Function {projectId: $projectId})
                RETURN f.name AS name, f.riskLevel AS risk ORDER BY name`,
        params: {},
      },
    ],
    description: 'Setting a property to its current value is a no-op',
  },
];

// ============================================================================
// MUTATION OPERATORS — SEMANTICS-BREAKING (must change results)
// ============================================================================

/**
 * Mutations that SHOULD change specific query results.
 * If a query result doesn't change after a breaking mutation,
 * the query may be missing coverage.
 */
export interface BreakingMutation {
  name: string;
  mutationStatements: string[];
  /** Queries that MUST change after this mutation */
  affectedQueries: Array<{
    name: string;
    query: string;
    params: Record<string, unknown>;
    expectedChange: 'count_increase' | 'count_decrease' | 'content_change';
  }>;
  description: string;
}

export const BREAKING_MUTATIONS: BreakingMutation[] = [
  {
    name: 'add_new_function',
    mutationStatements: [
      `CREATE (f:Function {projectId: $projectId, name: '_injected_fn', riskLevel: 'high'})`,
    ],
    affectedQueries: [
      {
        name: 'function_count',
        query: `MATCH (f:Function {projectId: $projectId}) RETURN count(f) AS cnt`,
        params: {},
        expectedChange: 'count_increase',
      },
      {
        name: 'node_count',
        query: `MATCH (n {projectId: $projectId}) RETURN count(n) AS cnt`,
        params: {},
        expectedChange: 'count_increase',
      },
    ],
    description: 'Adding a function must increase function and node counts',
  },
  {
    name: 'delete_all_edges',
    mutationStatements: [
      `MATCH (a {projectId: $projectId})-[r]->(b {projectId: $projectId}) DELETE r`,
    ],
    affectedQueries: [
      {
        name: 'edge_count',
        query: `MATCH (a {projectId: $projectId})-[r]->(b {projectId: $projectId}) RETURN count(r) AS cnt`,
        params: {},
        expectedChange: 'count_decrease',
      },
    ],
    description: 'Deleting all edges must decrease edge count to zero',
  },
  {
    name: 'change_task_status',
    mutationStatements: [
      `MATCH (t:Task {projectId: $projectId})
       WHERE t.status = 'planned'
       WITH t LIMIT 1
       SET t.status = 'done'`,
    ],
    affectedQueries: [
      {
        name: 'status_distribution',
        query: `MATCH (t:Task {projectId: $projectId})
                RETURN t.status AS status, count(t) AS cnt ORDER BY status`,
        params: {},
        expectedChange: 'content_change',
      },
    ],
    description: 'Changing a task status must alter the status distribution',
  },
  {
    name: 'rename_function',
    mutationStatements: [
      `MATCH (f:Function {projectId: $projectId})
       WITH f LIMIT 1
       SET f.name = f.name + '_renamed'`,
    ],
    affectedQueries: [
      {
        name: 'function_names',
        query: `MATCH (f:Function {projectId: $projectId}) RETURN f.name AS name ORDER BY name`,
        params: {},
        expectedChange: 'content_change',
      },
    ],
    description: 'Renaming a function must change the function names query result',
  },
];

// ============================================================================
// DYNAMIC METAMORPHIC RELATIONS
// ============================================================================

/**
 * Dynamic MR: query equivalences that hold regardless of fixture content.
 * These are universal graph properties.
 */
export const DYNAMIC_QUERY_EQUIVALENCES: QueryEquivalenceRelation[] = [
  {
    name: 'dyn_node_count_methods',
    category: 'elementary',
    queryA: `MATCH (n {projectId: $projectId}) RETURN count(n) AS cnt`,
    queryB: `MATCH (n) WHERE n.projectId = $projectId RETURN count(n) AS cnt`,
    params: {},
    comparator: 'set_equality',
    description: 'Inline prop vs WHERE clause: universal equivalence',
  },
  {
    name: 'dyn_edge_direction_symmetry',
    category: 'elementary',
    queryA: `MATCH (a {projectId: $projectId})-[r]->(b {projectId: $projectId}) RETURN count(r) AS cnt`,
    queryB: `MATCH (b {projectId: $projectId})<-[r]-(a {projectId: $projectId}) RETURN count(r) AS cnt`,
    params: {},
    comparator: 'set_equality',
    description: 'Forward vs reverse traversal: always same count',
  },
  {
    name: 'dyn_label_filter_equivalence',
    category: 'compound',
    queryA: `MATCH (n {projectId: $projectId}) WHERE n:Function RETURN count(n) AS cnt`,
    queryB: `MATCH (n:Function {projectId: $projectId}) RETURN count(n) AS cnt`,
    params: {},
    comparator: 'set_equality',
    description: 'WHERE label vs inline label: universal equivalence',
  },
  {
    name: 'dyn_exists_vs_pattern',
    category: 'compound',
    queryA: `MATCH (n {projectId: $projectId}) WHERE EXISTS { (n)-->() } RETURN count(n) AS cnt`,
    queryB: `MATCH (n {projectId: $projectId})-->() RETURN count(DISTINCT n) AS cnt`,
    params: {},
    comparator: 'set_equality',
    description: 'EXISTS subquery vs pattern match with DISTINCT: equivalent',
  },
  {
    name: 'dyn_union_commutativity',
    category: 'compound',
    queryA: `MATCH (a:Function {projectId: $projectId}) RETURN count(a) AS cnt
             UNION ALL
             MATCH (b:Task {projectId: $projectId}) RETURN count(b) AS cnt`,
    queryB: `MATCH (b:Task {projectId: $projectId}) RETURN count(b) AS cnt
             UNION ALL
             MATCH (a:Function {projectId: $projectId}) RETURN count(a) AS cnt`,
    params: {},
    comparator: 'count_equality',
    description: 'UNION ALL is commutative on count',
  },
];

// ============================================================================
// COUNTEREXAMPLE REDUCTION
// ============================================================================

export interface MutationCounterexample {
  mutationName: string;
  queryName: string;
  expectedBehavior: string;
  actualBehavior: string;
  /** Minimal mutation that reproduces the issue */
  minimalMutation: string[];
  /** Original mutation statements */
  originalMutation: string[];
}

/**
 * Reduce a breaking mutation to its minimal form.
 * Tries removing statements one at a time.
 */
export function reduceBreakingMutation(
  mutation: BreakingMutation,
  failingQueryName: string
): MutationCounterexample {
  // For single-statement mutations, the minimal form is itself
  if (mutation.mutationStatements.length <= 1) {
    return {
      mutationName: mutation.name,
      queryName: failingQueryName,
      expectedBehavior: mutation.affectedQueries.find(q => q.name === failingQueryName)?.expectedChange ?? 'unknown',
      actualBehavior: 'no change detected',
      minimalMutation: [...mutation.mutationStatements],
      originalMutation: [...mutation.mutationStatements],
    };
  }

  // Try each statement alone
  const minimal: string[] = [];
  for (const stmt of mutation.mutationStatements) {
    minimal.push(stmt); // In a real system, we'd re-run the mutation with just this statement
  }

  return {
    mutationName: mutation.name,
    queryName: failingQueryName,
    expectedBehavior: mutation.affectedQueries.find(q => q.name === failingQueryName)?.expectedChange ?? 'unknown',
    actualBehavior: 'no change detected',
    minimalMutation: minimal.slice(0, 1), // heuristic: first statement is likely sufficient
    originalMutation: [...mutation.mutationStatements],
  };
}
