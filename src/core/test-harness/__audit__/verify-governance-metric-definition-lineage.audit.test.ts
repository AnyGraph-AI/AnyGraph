/**
 * AUD-TC-03-L1b-17: verify-governance-metric-definition-lineage.ts audit tests
 *
 * Spec: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §GM-3
 * "Define MetricDefinition nodes" + "Link MetricDefinition to metric consumers via USED_BY"
 *
 * Behaviors:
 *   (1) queries MetricDefinition nodes for required metrics (preventedRuns, preventedEdgesDiagnostic, interceptionRate)
 *   (2) checks each has USED_BY edges to MetricSurface nodes
 *   (3) reports usedByCount and surfaceTypes per metric
 *   (4) exits with code 1 if required definitions are missing or under-linked
 *   (5) accepts projectId from argv[2]
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ──

const { mockRun, mockClose } = vi.hoisted(() => ({
  mockRun: vi.fn().mockResolvedValue([]),
  mockClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4jService {
    run = mockRun;
    close = mockClose;
  },
}));

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  mockRun.mockReset().mockResolvedValue([]);
  mockClose.mockReset().mockResolvedValue(undefined);
  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mockExit.mockRestore();
  mockConsoleLog.mockRestore();
  mockConsoleError.mockRestore();
});

async function runModule(argv2?: string): Promise<void> {
  const origArgv = process.argv;
  process.argv = argv2 ? ['node', 'script', argv2] : ['node', 'script'];
  try {
    await import('../../../utils/verify-governance-metric-definition-lineage.js');
    // Allow microtask queue to flush (main() is called at module level)
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.argv = origArgv;
  }
}

describe('verify-governance-metric-definition-lineage audit tests', () => {
  // ─── Behavior 1: queries MetricDefinition nodes for required metrics ───
  describe('B1: queries required metrics', () => {
    it('queries for preventedRuns, preventedEdgesDiagnostic, interceptionRate', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'preventedRuns', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool'], surfaces: ['a'] },
        { name: 'preventedEdgesDiagnostic', usedByCount: 7, surfaceTypes: ['Script'], surfaces: ['b'] },
        { name: 'interceptionRate', usedByCount: 7, surfaceTypes: ['Script'], surfaces: ['c'] },
      ]);

      await runModule();

      expect(mockRun).toHaveBeenCalledTimes(1);
      const call = mockRun.mock.calls[0];
      const cypher = call[0] as string;
      const params = call[1] as Record<string, unknown>;

      expect(cypher).toContain('MetricDefinition');
      expect(cypher).toContain('USED_BY');
      expect(cypher).toContain('MetricSurface');
      expect(params.required).toEqual(
        expect.arrayContaining(['preventedRuns', 'preventedEdgesDiagnostic', 'interceptionRate']),
      );
    });
  });

  // ─── Behavior 2: checks each has USED_BY edges ───
  describe('B2: checks USED_BY edge coverage', () => {
    it('passes when all metrics have sufficient USED_BY edges', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'preventedRuns', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
        { name: 'preventedEdgesDiagnostic', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
        { name: 'interceptionRate', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
      ]);

      await runModule();

      expect(mockExit).not.toHaveBeenCalledWith(1);
    });

    it('reports lowCoverage when usedByCount < 3', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'preventedRuns', usedByCount: 2, surfaceTypes: ['Script'], surfaces: [] },
        { name: 'preventedEdgesDiagnostic', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
        { name: 'interceptionRate', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
      ]);

      await runModule();

      expect(mockExit).toHaveBeenCalledWith(1);
      const errOutput = mockConsoleError.mock.calls.flat().join(' ');
      expect(errOutput).toContain('preventedRuns');
    });
  });

  // ─── Behavior 3: reports usedByCount and surfaceTypes per metric ───
  describe('B3: reports metric details', () => {
    it('includes usedByCount and surfaceTypes in output', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'preventedRuns', usedByCount: 5, surfaceTypes: ['Script', 'MCPTool'], surfaces: [] },
        { name: 'preventedEdgesDiagnostic', usedByCount: 4, surfaceTypes: ['Script'], surfaces: [] },
        { name: 'interceptionRate', usedByCount: 6, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
      ]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.metrics).toBeDefined();
      expect(parsed.metrics[0]).toHaveProperty('usedByCount');
      expect(parsed.metrics[0]).toHaveProperty('surfaceTypes');
    });
  });

  // ─── Behavior 4: exits with code 1 if required definitions missing ───
  describe('B4: exits 1 on missing definitions', () => {
    it('exits 1 when a required metric definition is missing from results', async () => {
      // Only 2 of 3 returned
      mockRun.mockResolvedValueOnce([
        { name: 'preventedRuns', usedByCount: 7, surfaceTypes: ['Script'], surfaces: [] },
        { name: 'interceptionRate', usedByCount: 7, surfaceTypes: ['Script'], surfaces: [] },
        // preventedEdgesDiagnostic missing
      ]);

      await runModule();

      expect(mockExit).toHaveBeenCalledWith(1);
      const errOutput = mockConsoleError.mock.calls.flat().join(' ');
      expect(errOutput).toContain('preventedEdgesDiagnostic');
    });

    it('exits 1 when no definitions exist at all', async () => {
      mockRun.mockResolvedValueOnce([]);

      await runModule();

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ─── Behavior 5: accepts projectId from argv[2] ───
  describe('B5: custom projectId', () => {
    it('passes custom projectId from argv[2] to query', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'preventedRuns', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
        { name: 'preventedEdgesDiagnostic', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
        { name: 'interceptionRate', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
      ]);

      await runModule('proj_custom123');

      const params = mockRun.mock.calls[0][1] as Record<string, unknown>;
      expect(params.projectId).toBe('proj_custom123');
    });

    it('defaults to proj_c0d3e9a1f200 when no argv[2]', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'preventedRuns', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
        { name: 'preventedEdgesDiagnostic', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
        { name: 'interceptionRate', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
      ]);

      await runModule();

      const params = mockRun.mock.calls[0][1] as Record<string, unknown>;
      expect(params.projectId).toBe('proj_c0d3e9a1f200');
    });
  });

  // ─── SPEC-GAP: lowCoverage threshold (< 3) is not in spec ───
  // SPEC-GAP: The threshold of usedByCount < 3 for lowCoverage is implementation-specific — spec says "under-linked" without defining the threshold

  // ─── Behavior: closes Neo4j in finally block ───
  describe('cleanup: always closes Neo4j', () => {
    it('closes Neo4jService even on success', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'preventedRuns', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
        { name: 'preventedEdgesDiagnostic', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
        { name: 'interceptionRate', usedByCount: 7, surfaceTypes: ['Script', 'MCPTool', 'QueryContract'], surfaces: [] },
      ]);

      await runModule();

      expect(mockClose).toHaveBeenCalled();
    });
  });
});
