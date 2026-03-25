// Spec source: plans/codegraph/TDD_ROADMAP.md §X3

import { describe, it, expect, vi } from 'vitest';
import {
  checkQueryEquivalence,
  checkAllQueryEquivalences,
  checkSemanticsMutation,
  type QueryEquivalenceRelation,
  type SemanticsMutation,
} from '../metamorphic.js';
import type { EphemeralGraphRuntime } from '../ephemeral-graph.js';

type MockRecord = { keys: string[]; get: (key: string) => unknown };

function record(row: Record<string, unknown>): MockRecord {
  return {
    keys: Object.keys(row),
    get: (key: string) => row[key],
  };
}

describe('metamorphic.ts audit', () => {
  it('checkSemanticsMutation evaluates preserved relation over a graph mutation', async () => {
    const run = vi
      .fn()
      // before query
      .mockResolvedValueOnce({ records: [record({ cnt: 1 })] })
      // mutation statement
      .mockResolvedValueOnce({ records: [] })
      // after query (unchanged)
      .mockResolvedValueOnce({ records: [record({ cnt: 1 })] });

    const graph = {
      projectId: 'proj_x3',
      run,
    } as unknown as EphemeralGraphRuntime;

    const mutation: SemanticsMutation = {
      name: 'preserve_count_after_metadata_update',
      mutationStatements: ['MATCH (n {projectId: $projectId}) SET n.meta = true'],
      preservedQueries: [
        { name: 'node_count', query: 'MATCH (n {projectId: $projectId}) RETURN count(n) AS cnt', params: {} },
      ],
      description: 'metadata update should preserve count query output',
    };

    const result = await checkSemanticsMutation(graph, mutation);

    expect(result.mutation).toBe('preserve_count_after_metadata_update');
    expect(result.allPreserved).toBe(true);
    expect(result.preservedResults).toHaveLength(1);
    expect(result.preservedResults[0]?.preserved).toBe(true);
    expect(result.preservedResults[0]?.beforeRows).toBe(1);
    expect(result.preservedResults[0]?.afterRows).toBe(1);
  });

  it('checkQueryEquivalence verifies equivalent query outputs with project scoping', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ records: [record({ name: 'a' }), record({ name: 'b' })] })
      .mockResolvedValueOnce({ records: [record({ name: 'a' }), record({ name: 'b' })] });

    const graph = {
      projectId: 'proj_x3',
      run,
    } as unknown as EphemeralGraphRuntime;

    const relation: QueryEquivalenceRelation = {
      name: 'equivalent_function_name_queries',
      category: 'elementary',
      queryA: 'MATCH (f:Function {projectId: $projectId}) RETURN f.name AS name ORDER BY name',
      queryB: "MATCH (f) WHERE 'Function' IN labels(f) AND f.projectId = $projectId RETURN f.name AS name ORDER BY name",
      params: { limit: 50 },
      comparator: 'set_equality',
      description: 'equivalent function-name lookup forms',
    };

    const result = await checkQueryEquivalence(graph, relation);

    expect(result.holds).toBe(true);
    expect(result.queryARows).toBe(2);
    expect(result.queryBRows).toBe(2);
    expect(result.details).toContain('Set equality');
    expect(run).toHaveBeenNthCalledWith(1, relation.queryA, { limit: 50, projectId: 'proj_x3' });
    expect(run).toHaveBeenNthCalledWith(2, relation.queryB, { limit: 50, projectId: 'proj_x3' });
  });

  it('captures counterexample details when query equivalence fails', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ records: [record({ id: 1 }), record({ id: 2 })] })
      .mockResolvedValueOnce({ records: [record({ id: 1 })] });

    const graph = { projectId: 'proj_x3', run } as unknown as EphemeralGraphRuntime;

    const relation: QueryEquivalenceRelation = {
      name: 'non_equivalent_queries',
      category: 'elementary',
      queryA: 'MATCH (n {projectId: $projectId}) RETURN n.id AS id ORDER BY id',
      queryB: 'MATCH (n {projectId: $projectId}) WHERE n.id = 1 RETURN n.id AS id ORDER BY id',
      params: {},
      comparator: 'set_equality',
      description: 'intentionally non-equivalent query pair for counterexample capture',
    };

    const result = await checkQueryEquivalence(graph, relation);

    expect(result.holds).toBe(false);
    expect(result.details).toContain('FAILED');
    expect(result.details).toContain('A=2 rows');
    expect(result.details).toContain('B=1 rows');
  });

  it('tracks pass/fail counts across batched equivalence evaluations', async () => {
    const run = vi
      .fn()
      // relation 1: pass
      .mockResolvedValueOnce({ records: [record({ cnt: 2 })] })
      .mockResolvedValueOnce({ records: [record({ cnt: 2 })] })
      // relation 2: fail
      .mockResolvedValueOnce({ records: [record({ cnt: 2 })] })
      .mockResolvedValueOnce({ records: [record({ cnt: 1 })] });

    const graph = { projectId: 'proj_x3', run } as unknown as EphemeralGraphRuntime;

    const relations: QueryEquivalenceRelation[] = [
      {
        name: 'counts_equal',
        category: 'elementary',
        queryA: 'A1',
        queryB: 'B1',
        params: {},
        comparator: 'set_equality',
        description: 'passing relation',
      },
      {
        name: 'counts_not_equal',
        category: 'elementary',
        queryA: 'A2',
        queryB: 'B2',
        params: {},
        comparator: 'set_equality',
        description: 'failing relation',
      },
    ];

    const batch = await checkAllQueryEquivalences(graph, relations);
    const passCount = batch.results.filter(r => r.holds).length;
    const failCount = batch.results.filter(r => !r.holds).length;

    expect(batch.passed).toBe(false);
    expect(batch.results).toHaveLength(2);
    expect(passCount).toBe(1);
    expect(failCount).toBe(1);
  });
});
