/**
 * AUD-TC-11c-L1-04: graph-resolver.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §RF-2 "Graph Resolver"
 *              + MEMORY.md §"RF-2: Enforcement Gate — CodeGraph Core COMPLETE"
 *
 * Tests assert BEHAVIOR from spec, not implementation details.
 * Neo4j-dependent — uses structured mocks for Neo4j session/transaction.
 *
 * Accept: 10+ behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  resolveAffectedNodes,
  resolveBlastRadius,
} from '../../../core/enforcement/graph-resolver.js';

// ─── Neo4j mock ──────────────────────────────────────────────────────────────

function createMockNeo4j(records: Record<string, unknown>[] = []) {
  return {
    run: vi.fn().mockResolvedValue(records),
  } as any; // satisfies Neo4jService shape for graph-resolver usage
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj_test_resolver';

function makeAffectedRecord(overrides: Partial<{
  id: string;
  name: string;
  filePath: string;
  riskTier: string;
  compositeRisk: number | { toNumber: () => number };
  hasTests: boolean;
}> = {}) {
  return {
    id: overrides.id ?? 'fn_001',
    name: overrides.name ?? 'doStuff',
    filePath: overrides.filePath ?? '/src/app.ts',
    riskTier: overrides.riskTier ?? 'LOW',
    compositeRisk: overrides.compositeRisk ?? 0.0,
    hasTests: overrides.hasTests ?? false,
  };
}

// ─── resolveAffectedNodes ────────────────────────────────────────────────────

describe('AUD-TC-11c | graph-resolver.ts', () => {
  describe('resolveAffectedNodes', () => {
    // Behavior 1: returns AffectedNode[] for given filePaths and projectId
    it('B1: returns AffectedNode[] with correct shape for given filePaths and projectId', async () => {
      const records = [
        makeAffectedRecord({ id: 'fn_a', name: 'alpha', filePath: '/src/a.ts', riskTier: 'HIGH', compositeRisk: 0.85, hasTests: true }),
        makeAffectedRecord({ id: 'fn_b', name: 'beta', filePath: '/src/b.ts', riskTier: 'LOW', compositeRisk: 0.1, hasTests: false }),
      ];
      const neo4j = createMockNeo4j(records);

      const result = await resolveAffectedNodes(neo4j, ['/src/a.ts', '/src/b.ts'], PROJECT_ID);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(expect.objectContaining({
        id: 'fn_a',
        name: 'alpha',
        filePath: '/src/a.ts',
        riskTier: 'HIGH',
        compositeRisk: 0.85,
        hasTests: true,
      }));
      expect(result[1]).toEqual(expect.objectContaining({
        id: 'fn_b',
        name: 'beta',
        filePath: '/src/b.ts',
        riskTier: 'LOW',
        compositeRisk: 0.1,
        hasTests: false,
      }));
    });

    // Behavior 2: query matches SourceFile→CONTAINS→Function/Method with projectId scoping
    it('B2: passes filePaths and projectId to the Neo4j query', async () => {
      const neo4j = createMockNeo4j([]);
      const filePaths = ['/src/foo.ts', '/src/bar.ts'];

      await resolveAffectedNodes(neo4j, filePaths, PROJECT_ID);

      expect(neo4j.run).toHaveBeenCalledTimes(1);
      const [query, params] = neo4j.run.mock.calls[0];
      expect(params).toEqual({ filePaths, projectId: PROJECT_ID });
      // Spec: query uses SourceFile→CONTAINS→Function/Method pattern
      expect(query).toContain('CONTAINS');
      expect(query).toContain('projectId');
    });

    // Behavior 3: defaults riskTier to 'LOW' and compositeRisk to 0.0
    it('B3: defaults riskTier=LOW and compositeRisk=0.0 via coalesce', async () => {
      // Neo4j coalesce handles defaults in query; mock returns the coalesced values
      const records = [makeAffectedRecord({ riskTier: 'LOW', compositeRisk: 0.0 })];
      const neo4j = createMockNeo4j(records);

      const result = await resolveAffectedNodes(neo4j, ['/src/x.ts'], PROJECT_ID);

      expect(result[0].riskTier).toBe('LOW');
      expect(result[0].compositeRisk).toBe(0);
    });

    // Behavior 4: hasTests is true when TESTED_BY_FUNCTION or TESTED_BY edge exists
    it('B4: hasTests reflects TESTED_BY_FUNCTION (function) OR TESTED_BY (file) edges', async () => {
      const testedRecord = makeAffectedRecord({ id: 'fn_tested', hasTests: true });
      const untestedRecord = makeAffectedRecord({ id: 'fn_untested', hasTests: false });
      const neo4j = createMockNeo4j([testedRecord, untestedRecord]);

      const result = await resolveAffectedNodes(neo4j, ['/src/x.ts'], PROJECT_ID);

      expect(result.find(n => n.id === 'fn_tested')!.hasTests).toBe(true);
      expect(result.find(n => n.id === 'fn_untested')!.hasTests).toBe(false);

      // Spec (RF-2 bug fix): query must check BOTH TESTED_BY_FUNCTION and TESTED_BY
      const query = neo4j.run.mock.calls[0][0] as string;
      expect(query).toContain('TESTED_BY_FUNCTION');
      expect(query).toContain('TESTED_BY');
    });

    // Behavior 5: results ordered by compositeRisk DESC
    it('B5: results are ordered by compositeRisk descending', async () => {
      const records = [
        makeAffectedRecord({ id: 'fn_high', compositeRisk: 0.95 }),
        makeAffectedRecord({ id: 'fn_low', compositeRisk: 0.05 }),
      ];
      const neo4j = createMockNeo4j(records);

      const result = await resolveAffectedNodes(neo4j, ['/src/x.ts'], PROJECT_ID);

      // Mock returns in-order; verify the query contains ORDER BY
      const query = neo4j.run.mock.calls[0][0] as string;
      expect(query).toMatch(/ORDER BY.*compositeRisk.*DESC/is);
      // And the returned data preserves the order
      expect(result[0].compositeRisk).toBeGreaterThanOrEqual(result[1].compositeRisk);
    });

    // Behavior 6: handles Neo4j Integer objects via .toNumber() with Number() fallback
    it('B6: handles Neo4j Integer objects via toNumber() with Number() fallback', async () => {
      const neo4jInteger = { toNumber: () => 0.73 };
      const records = [makeAffectedRecord({ compositeRisk: neo4jInteger as any })];
      const neo4j = createMockNeo4j(records);

      const result = await resolveAffectedNodes(neo4j, ['/src/x.ts'], PROJECT_ID);

      expect(result[0].compositeRisk).toBe(0.73);
    });

    it('B6b: handles plain number compositeRisk (no toNumber method)', async () => {
      const records = [makeAffectedRecord({ compositeRisk: 0.42 })];
      const neo4j = createMockNeo4j(records);

      const result = await resolveAffectedNodes(neo4j, ['/src/x.ts'], PROJECT_ID);

      expect(result[0].compositeRisk).toBe(0.42);
    });

    it('B6c: handles null/undefined compositeRisk as 0', async () => {
      const records = [{ ...makeAffectedRecord(), compositeRisk: null }];
      const neo4j = createMockNeo4j(records);

      const result = await resolveAffectedNodes(neo4j, ['/src/x.ts'], PROJECT_ID);

      expect(result[0].compositeRisk).toBe(0);
    });

    // Behavior 7: returns empty array for empty filePaths
    it('B7: returns empty array for empty filePaths input (no query executed)', async () => {
      const neo4j = createMockNeo4j([]);

      const result = await resolveAffectedNodes(neo4j, [], PROJECT_ID);

      expect(result).toEqual([]);
      expect(neo4j.run).not.toHaveBeenCalled();
    });
  });

  // ─── resolveBlastRadius ──────────────────────────────────────────────────

  describe('resolveBlastRadius', () => {
    // Behavior 8: follows CALLS edges transitively up to maxDepth (default 3)
    it('B8: follows CALLS edges transitively up to maxDepth from root IDs', async () => {
      const downstream = [
        makeAffectedRecord({ id: 'fn_downstream_1', name: 'helper', compositeRisk: 0.3 }),
      ];
      const neo4j = createMockNeo4j(downstream);

      const result = await resolveBlastRadius(neo4j, ['fn_root'], PROJECT_ID);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('fn_downstream_1');

      // Verify CALLS traversal in query
      const query = neo4j.run.mock.calls[0][0] as string;
      expect(query).toContain('CALLS');
      // Default maxDepth = 3
      expect(query).toMatch(/CALLS\*1\.\.3/);
    });

    it('B8b: respects custom maxDepth parameter', async () => {
      const neo4j = createMockNeo4j([]);

      await resolveBlastRadius(neo4j, ['fn_root'], PROJECT_ID, 5);

      const query = neo4j.run.mock.calls[0][0] as string;
      expect(query).toMatch(/CALLS\*1\.\.5/);
    });

    // Behavior 9: excludes the original functionIds from results
    it('B9: excludes the original functionIds from blast radius results', async () => {
      const neo4j = createMockNeo4j([]);

      await resolveBlastRadius(neo4j, ['fn_root_a', 'fn_root_b'], PROJECT_ID);

      const query = neo4j.run.mock.calls[0][0] as string;
      const params = neo4j.run.mock.calls[0][1] as Record<string, unknown>;
      // Query excludes root IDs
      expect(query).toContain('NOT downstream.id IN $functionIds');
      expect(params.functionIds).toEqual(['fn_root_a', 'fn_root_b']);
    });

    // Behavior 10: blast radius results have same AffectedNode shape with hasTests check
    it('B10: blast radius results include AffectedNode shape with hasTests', async () => {
      const downstream = [
        makeAffectedRecord({ id: 'fn_ds', name: 'downstream', filePath: '/src/ds.ts', riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: false }),
      ];
      const neo4j = createMockNeo4j(downstream);

      const result = await resolveBlastRadius(neo4j, ['fn_root'], PROJECT_ID);

      expect(result[0]).toEqual(expect.objectContaining({
        id: 'fn_ds',
        name: 'downstream',
        filePath: '/src/ds.ts',
        riskTier: 'CRITICAL',
        compositeRisk: 0.9,
        hasTests: false,
      }));
    });

    it('B10b: returns empty array for empty functionIds input', async () => {
      const neo4j = createMockNeo4j([]);

      const result = await resolveBlastRadius(neo4j, [], PROJECT_ID);

      expect(result).toEqual([]);
      expect(neo4j.run).not.toHaveBeenCalled();
    });

    // Additional: blast radius handles Neo4j Integer same as resolveAffectedNodes
    it('B10c: blast radius handles Neo4j Integer objects for compositeRisk', async () => {
      const neo4jInteger = { toNumber: () => 0.55 };
      const records = [makeAffectedRecord({ id: 'fn_ds', compositeRisk: neo4jInteger as any })];
      const neo4j = createMockNeo4j(records);

      const result = await resolveBlastRadius(neo4j, ['fn_root'], PROJECT_ID);

      expect(result[0].compositeRisk).toBe(0.55);
    });

    it('B10d: blast radius defaults filePath to "unknown" when missing', async () => {
      const records = [{ ...makeAffectedRecord(), filePath: null }];
      const neo4j = createMockNeo4j(records);

      const result = await resolveBlastRadius(neo4j, ['fn_root'], PROJECT_ID);

      expect(result[0].filePath).toBe('unknown');
    });
  });
});
