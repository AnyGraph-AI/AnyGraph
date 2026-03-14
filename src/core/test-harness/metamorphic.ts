/**
 * Metamorphic Testing — Query Equivalence & Semantics-Preserving Mutations
 *
 * Metamorphic relations define properties that must hold between
 * related test inputs/outputs. Instead of checking specific outputs,
 * we check relationships between outputs.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X3
 */

import { createHash } from 'node:crypto';
import type { EphemeralGraphRuntime } from './ephemeral-graph.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A metamorphic relation: given source input → source output,
 * applying a transformation to the input should produce
 * a predictable relationship in the output.
 */
export interface MetamorphicRelation<TInput, TOutput> {
  /** Relation name */
  name: string;
  /** Category: elementary, compound, or dynamic */
  category: 'elementary' | 'compound' | 'dynamic';
  /** Transform the input (follow-up input) */
  transformInput: (input: TInput) => TInput;
  /** Check the output relation holds */
  checkRelation: (sourceOutput: TOutput, followupOutput: TOutput, sourceInput: TInput, followupInput: TInput) => RelationResult;
  /** Human description */
  description: string;
}

export interface RelationResult {
  /** Did the relation hold? */
  holds: boolean;
  /** Explanation */
  details: string;
}

/**
 * A query-equivalence relation for graph queries.
 * Two different Cypher queries should produce equivalent results.
 */
export interface QueryEquivalenceRelation {
  /** Relation name */
  name: string;
  /** Category */
  category: 'elementary' | 'compound';
  /** Primary query */
  queryA: string;
  /** Equivalent query (should produce same logical result) */
  queryB: string;
  /** Parameters shared by both queries */
  params: Record<string, unknown>;
  /** How to compare results (default: set equality) */
  comparator?: 'set_equality' | 'count_equality' | 'subset' | 'superset';
  /** Description */
  description: string;
}

/**
 * A semantics-preserving mutation for graph data.
 * After applying the mutation, certain queries should produce unchanged results.
 */
export interface SemanticsMutation {
  /** Mutation name */
  name: string;
  /** Cypher statements to apply the mutation */
  mutationStatements: string[];
  /** Parameters for mutation statements */
  mutationParams?: Record<string, unknown>;
  /** Queries whose results should be UNCHANGED after mutation */
  preservedQueries: Array<{
    name: string;
    query: string;
    params: Record<string, unknown>;
  }>;
  /** Queries whose results MAY change (documented expected changes) */
  changedQueries?: Array<{
    name: string;
    query: string;
    params: Record<string, unknown>;
    expectedChange: string;
  }>;
  /** Description */
  description: string;
}

// ============================================================================
// QUERY EQUIVALENCE RUNNER
// ============================================================================

export interface QueryEquivalenceResult {
  relation: string;
  holds: boolean;
  queryARows: number;
  queryBRows: number;
  details: string;
}

/**
 * Run a query-equivalence check on an ephemeral graph.
 */
export async function checkQueryEquivalence(
  graph: EphemeralGraphRuntime,
  relation: QueryEquivalenceRelation
): Promise<QueryEquivalenceResult> {
  const resultA = await graph.run(relation.queryA, {
    ...relation.params,
    projectId: graph.projectId,
  });
  const resultB = await graph.run(relation.queryB, {
    ...relation.params,
    projectId: graph.projectId,
  });

  const rowsA = resultA.records.length;
  const rowsB = resultB.records.length;
  const comparator = relation.comparator ?? 'set_equality';

  let holds: boolean;
  let details: string;

  switch (comparator) {
    case 'count_equality':
      holds = rowsA === rowsB;
      details = holds
        ? `Both queries return ${rowsA} rows`
        : `Query A: ${rowsA} rows, Query B: ${rowsB} rows`;
      break;

    case 'subset':
      holds = rowsA <= rowsB;
      details = holds
        ? `Query A (${rowsA}) ⊆ Query B (${rowsB})`
        : `Query A (${rowsA}) NOT subset of Query B (${rowsB})`;
      break;

    case 'superset':
      holds = rowsA >= rowsB;
      details = holds
        ? `Query A (${rowsA}) ⊇ Query B (${rowsB})`
        : `Query A (${rowsA}) NOT superset of Query B (${rowsB})`;
      break;

    case 'set_equality':
    default: {
      // Compare serialized results
      const serA = serializeResults(resultA.records);
      const serB = serializeResults(resultB.records);
      holds = serA === serB;
      details = holds
        ? `Set equality: ${rowsA} rows match`
        : `Set equality FAILED: A=${rowsA} rows, B=${rowsB} rows, content differs`;
      break;
    }
  }

  return { relation: relation.name, holds, queryARows: rowsA, queryBRows: rowsB, details };
}

/**
 * Run multiple query-equivalence checks.
 */
export async function checkAllQueryEquivalences(
  graph: EphemeralGraphRuntime,
  relations: QueryEquivalenceRelation[]
): Promise<{ passed: boolean; results: QueryEquivalenceResult[] }> {
  const results: QueryEquivalenceResult[] = [];
  for (const rel of relations) {
    results.push(await checkQueryEquivalence(graph, rel));
  }
  return {
    passed: results.every(r => r.holds),
    results,
  };
}

// ============================================================================
// SEMANTICS-PRESERVING MUTATION RUNNER
// ============================================================================

export interface MutationResult {
  mutation: string;
  allPreserved: boolean;
  preservedResults: Array<{
    queryName: string;
    preserved: boolean;
    beforeRows: number;
    afterRows: number;
    details: string;
  }>;
}

/**
 * Run a semantics-preserving mutation check:
 * 1. Execute preserved queries (before)
 * 2. Apply mutation
 * 3. Execute preserved queries (after)
 * 4. Check results are unchanged
 */
export async function checkSemanticsMutation(
  graph: EphemeralGraphRuntime,
  mutation: SemanticsMutation
): Promise<MutationResult> {
  const params = { ...mutation.mutationParams, projectId: graph.projectId };

  // Step 1: Capture "before" state of preserved queries
  const beforeResults = new Map<string, { rows: number; hash: string }>();
  for (const pq of mutation.preservedQueries) {
    const result = await graph.run(pq.query, { ...pq.params, projectId: graph.projectId });
    beforeResults.set(pq.name, {
      rows: result.records.length,
      hash: hashResults(result.records),
    });
  }

  // Step 2: Apply mutation
  for (const stmt of mutation.mutationStatements) {
    await graph.run(stmt, params);
  }

  // Step 3: Capture "after" state and compare
  const preservedResults: MutationResult['preservedResults'] = [];
  for (const pq of mutation.preservedQueries) {
    const result = await graph.run(pq.query, { ...pq.params, projectId: graph.projectId });
    const before = beforeResults.get(pq.name)!;
    const afterHash = hashResults(result.records);
    const preserved = before.hash === afterHash;

    preservedResults.push({
      queryName: pq.name,
      preserved,
      beforeRows: before.rows,
      afterRows: result.records.length,
      details: preserved
        ? `Preserved: ${before.rows} rows unchanged`
        : `BROKEN: ${before.rows} → ${result.records.length} rows, content hash differs`,
    });
  }

  return {
    mutation: mutation.name,
    allPreserved: preservedResults.every(r => r.preserved),
    preservedResults,
  };
}

// ============================================================================
// INTERNALS
// ============================================================================

function serializeResults(records: any[]): string {
  const rows = records.map(r => {
    const obj: Record<string, unknown> = {};
    for (const key of r.keys) {
      let val = r.get(key);
      if (val && typeof val === 'object' && 'low' in val && 'high' in val) {
        val = val.low; // Neo4j Integer → number
      }
      obj[key] = val;
    }
    return obj;
  });
  // Sort for determinism
  rows.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  return JSON.stringify(rows);
}

function hashResults(records: any[]): string {
  return createHash('sha256').update(serializeResults(records)).digest('hex');
}
