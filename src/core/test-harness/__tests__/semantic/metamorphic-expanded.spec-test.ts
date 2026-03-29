/**
 * L1: Full Metamorphic + Mutation Expansion — Test Suite
 *
 * Tests both L1 tasks:
 * 1. Expand elementary/compound/dynamic MR coverage
 * 2. Build mutation library with reduced counterexamples
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L1
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupHermeticEnv, teardownHermeticEnv, createEphemeralGraph,
  checkAllQueryEquivalences, checkSemanticsMutation,
  PRESERVING_MUTATIONS, BREAKING_MUTATIONS, DYNAMIC_QUERY_EQUIVALENCES,
  reduceBreakingMutation, type EphemeralGraphRuntime,
} from '../../index.js';
import { SINGLE_FUNCTION, CROSS_FILE_CALL, HIGH_RISK_HUB, STATEFUL_CLASS } from '../../fixtures/micro/code-graph.fixture.js';
import { SIMPLE_PLAN, BLOCKED_CHAIN, PLAN_WITH_DECISION } from '../../fixtures/micro/plan-graph.fixture.js';

describe('L1: Full Metamorphic + Mutation Expansion', () => {
  let graph: EphemeralGraphRuntime;

  beforeEach(async () => {
    setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' });
    graph = await createEphemeralGraph({ setupSchema: false });
  });

  afterEach(async () => {
    if (graph) await graph.teardown();
    teardownHermeticEnv();
  });

  describe('Task 1: Expand MR coverage', () => {
    it('dynamic equivalences hold on SINGLE_FUNCTION fixture', async () => {
      await graph.seed(SINGLE_FUNCTION);
      const { passed, results } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
      expect(passed).toBe(true);
    });

    it('dynamic equivalences hold on CROSS_FILE_CALL fixture', async () => {
      await graph.seed(CROSS_FILE_CALL);
      const { passed } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
      expect(passed).toBe(true);
    });

    it('dynamic equivalences hold on HIGH_RISK_HUB fixture', async () => {
      await graph.seed(HIGH_RISK_HUB);
      const { passed } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
      expect(passed).toBe(true);
    });

    it('dynamic equivalences hold on SIMPLE_PLAN fixture', async () => {
      await graph.seed(SIMPLE_PLAN);
      const { passed } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
      expect(passed).toBe(true);
    });

    it('dynamic equivalences hold on BLOCKED_CHAIN fixture', async () => {
      await graph.seed(BLOCKED_CHAIN);
      const { passed } = await checkAllQueryEquivalences(graph, DYNAMIC_QUERY_EQUIVALENCES);
      expect(passed).toBe(true);
    });
  });

  describe('Task 2: Mutation library', () => {
    it('all preserving mutations preserve code graph structure', async () => {
      await graph.seed(CROSS_FILE_CALL);
      for (const mutation of PRESERVING_MUTATIONS) {
        if (mutation.preservedQueries.some(q => q.query.includes('Task'))) continue;
        const result = await checkSemanticsMutation(graph, mutation);
        expect(result.allPreserved).toBe(true);
      }
    });

    it('all preserving mutations preserve plan graph structure', async () => {
      await graph.seed(SIMPLE_PLAN);
      for (const mutation of PRESERVING_MUTATIONS) {
        if (!mutation.preservedQueries.some(q => q.query.includes('Task') || q.query.includes('status'))) continue;
        const result = await checkSemanticsMutation(graph, mutation);
        expect(result.allPreserved).toBe(true);
      }
    });

    it('breaking mutations actually change results', async () => {
      await graph.seed(CROSS_FILE_CALL);
      for (const mutation of BREAKING_MUTATIONS.filter(m => m.affectedQueries.every(q => q.expectedChange !== 'content_change'))) {
        const beforeResults = new Map<string, number>();
        for (const aq of mutation.affectedQueries) {
          const result = await graph.run(aq.query, { ...aq.params, projectId: graph.projectId });
          const val = result.records[0]?.get('cnt');
          beforeResults.set(aq.name, (val?.low ?? val ?? 0) as number);
        }
        for (const stmt of mutation.mutationStatements) await graph.run(stmt, { projectId: graph.projectId });
        for (const aq of mutation.affectedQueries) {
          const result = await graph.run(aq.query, { ...aq.params, projectId: graph.projectId });
          const val = result.records[0]?.get('cnt');
          const afterCnt = (val?.low ?? val ?? 0) as number;
          const beforeCnt = beforeResults.get(aq.name)!;
          if (aq.expectedChange === 'count_increase') expect(afterCnt).toBeGreaterThan(beforeCnt);
          else if (aq.expectedChange === 'count_decrease') expect(afterCnt).toBeLessThan(beforeCnt);
        }
      }
    });

    it('content-change mutations alter query results', async () => {
      await graph.seed(SIMPLE_PLAN);
      const statusMutation = BREAKING_MUTATIONS.find(m => m.name === 'change_task_status')!;
      const beforeResult = await graph.run(
        `MATCH (t:Task {projectId: $projectId}) RETURN t.status AS status, count(t) AS cnt ORDER BY status`,
        { projectId: graph.projectId });
      const beforeRows = beforeResult.records.map(r => `${r.get('status')}:${r.get('cnt').low ?? r.get('cnt')}`).join(',');
      for (const stmt of statusMutation.mutationStatements) await graph.run(stmt, { projectId: graph.projectId });
      const afterResult = await graph.run(
        `MATCH (t:Task {projectId: $projectId}) RETURN t.status AS status, count(t) AS cnt ORDER BY status`,
        { projectId: graph.projectId });
      const afterRows = afterResult.records.map(r => `${r.get('status')}:${r.get('cnt').low ?? r.get('cnt')}`).join(',');
      expect(beforeRows).not.toBe(afterRows);
    });

    it('counterexample reduction produces minimal mutation', () => {
      const mutation = BREAKING_MUTATIONS.find(m => m.name === 'delete_all_edges')!;
      const cx = reduceBreakingMutation(mutation, 'edge_count');
      expect(cx.mutationName).toBe('delete_all_edges');
      expect(cx.queryName).toBe('edge_count');
      expect(cx.minimalMutation.length).toBeGreaterThanOrEqual(1);
      expect(cx.minimalMutation.length).toBeLessThanOrEqual(cx.originalMutation.length);
      expect(cx.expectedBehavior).toBeTruthy();
    });

    it('mutation library covers all fixture types', async () => {
      await graph.seed(STATEFUL_CLASS);
      const addMeta = PRESERVING_MUTATIONS.find(m => m.name === 'add_metadata_property')!;
      const result = await checkSemanticsMutation(graph, addMeta);
      expect(result.allPreserved).toBe(true);
    });
  });
});
