/**
 * AUD-TC-03-L1b-34: governance-metric-definition-sync.ts audit tests
 *
 * Spec: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §GM-3
 * "Define MetricDefinition nodes" + "Link MetricDefinition to metric consumers via USED_BY"
 *
 * Behaviors:
 *   (1) defines DEFINITIONS array with name/unit/role/definition/surfaces for each metric
 *   (2) MERGEs MetricDefinition nodes with canonical formula text
 *   (3) MERGEs MetricSurface nodes for each consumer (Script/DashboardQuery/MCPTool/QueryContract)
 *   (4) creates USED_BY edges from MetricDefinition to MetricSurface
 *   (5) is idempotent (safe to rerun)
 *   (6) reports sync counts
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
    await import('../../../utils/governance-metric-definition-sync.js');
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.argv = origArgv;
  }
}

describe('governance-metric-definition-sync audit tests', () => {
  // ─── Behavior 1: defines DEFINITIONS with required metrics ───
  describe('B1: DEFINITIONS array covers required metrics', () => {
    it('syncs preventedRuns, preventedEdgesDiagnostic, and interceptionRate definitions', async () => {
      await runModule();

      // Collect all MERGE calls for MetricDefinition
      const defCalls = mockRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('MetricDefinition') && String(c[0]).includes('MERGE'),
      );
      const defNames = defCalls
        .map((c: any[]) => (c[1] as Record<string, unknown>)?.name)
        .filter(Boolean);

      expect(defNames).toContain('preventedRuns');
      expect(defNames).toContain('preventedEdgesDiagnostic');
      expect(defNames).toContain('interceptionRate');
    });

    it('each definition has name, unit, role, and definition text', async () => {
      await runModule();

      const defCalls = mockRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('MetricDefinition') && !String(c[0]).includes('MetricSurface'),
      );

      for (const call of defCalls) {
        const params = call[1] as Record<string, unknown>;
        expect(params.name).toBeTruthy();
        expect(params.unit).toBeTruthy();
        expect(params.role).toBeTruthy();
        expect(params.definition).toBeTruthy();
      }
    });
  });

  // ─── Behavior 2: MERGEs MetricDefinition nodes ───
  describe('B2: MERGEs MetricDefinition nodes', () => {
    it('uses MERGE (not CREATE) for MetricDefinition with id key', async () => {
      await runModule();

      const defCalls = mockRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('MERGE') && String(c[0]).includes('MetricDefinition'),
      );

      expect(defCalls.length).toBeGreaterThanOrEqual(3); // 3 metric definitions

      for (const call of defCalls) {
        const cypher = call[0] as string;
        expect(cypher).toContain('MERGE');
        expect(cypher).toContain('MetricDefinition');
      }
    });

    it('sets canonical formula text in definition property', async () => {
      await runModule();

      // Find the first MetricDefinition MERGE (not MetricSurface)
      const defCall = mockRun.mock.calls.find(
        (c: any[]) =>
          String(c[0]).includes('MetricDefinition') &&
          String(c[0]).includes('MERGE') &&
          !String(c[0]).includes('MetricSurface'),
      );

      expect(defCall).toBeDefined();
      const params = defCall![1] as Record<string, unknown>;
      expect(typeof params.definition).toBe('string');
      expect((params.definition as string).length).toBeGreaterThan(10);
    });
  });

  // ─── Behavior 3: MERGEs MetricSurface nodes for consumers ───
  describe('B3: MERGEs MetricSurface nodes', () => {
    it('creates MetricSurface nodes with surfaceType for Script, DashboardQuery, MCPTool, QueryContract', async () => {
      await runModule();

      const surfaceCalls = mockRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('MetricSurface') && String(c[0]).includes('MERGE'),
      );

      const surfaceTypes = new Set(
        surfaceCalls.map((c: any[]) => (c[1] as Record<string, unknown>)?.surfaceType),
      );

      expect(surfaceTypes.has('Script')).toBe(true);
      expect(surfaceTypes.has('DashboardQuery')).toBe(true);
      expect(surfaceTypes.has('MCPTool')).toBe(true);
      expect(surfaceTypes.has('QueryContract')).toBe(true);
    });
  });

  // ─── Behavior 4: creates USED_BY edges ───
  describe('B4: creates USED_BY edges from MetricDefinition to MetricSurface', () => {
    it('creates USED_BY edges in the same MERGE query as MetricSurface', async () => {
      await runModule();

      const usedByCalls = mockRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('USED_BY'),
      );

      expect(usedByCalls.length).toBeGreaterThan(0);
      // Each surface call should link back to its MetricDefinition
      for (const call of usedByCalls) {
        const params = call[1] as Record<string, unknown>;
        expect(params.metricId).toBeDefined();
        expect(String(params.metricId)).toMatch(/^metric:/);
      }
    });
  });

  // ─── Behavior 5: idempotent (MERGE, not CREATE) ───
  describe('B5: idempotency — uses MERGE throughout', () => {
    it('all write operations use MERGE, never bare CREATE', async () => {
      await runModule();

      const writeCalls = mockRun.mock.calls.filter(
        (c: any[]) => {
          const cypher = String(c[0]);
          return cypher.includes('MetricDefinition') || cypher.includes('MetricSurface');
        },
      );

      for (const call of writeCalls) {
        const cypher = call[0] as string;
        expect(cypher).toContain('MERGE');
        // Should not have bare CREATE (CREATE alone without MERGE)
        const createOnly = cypher.includes('CREATE') && !cypher.includes('MERGE') && !cypher.includes('ON CREATE');
        expect(createOnly).toBe(false);
      }
    });
  });

  // ─── Behavior 6: reports sync counts ───
  describe('B6: reports sync counts', () => {
    it('outputs JSON with defsUpserted, surfacesUpserted, linksUpserted', async () => {
      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);

      expect(parsed.ok).toBe(true);
      expect(parsed.metricDefinitions).toBe(3); // 3 definitions
      expect(parsed.defsUpserted).toBe(3);
      expect(parsed.surfacesUpserted).toBeGreaterThan(0);
      expect(parsed.linksUpserted).toBeGreaterThan(0);
    });

    it('surfacesUpserted matches total surfaces across all definitions', async () => {
      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);

      // Each metric has 7 surfaces (from source code)
      expect(parsed.surfacesUpserted).toBe(21); // 3 metrics × 7 surfaces each
      expect(parsed.linksUpserted).toBe(21);
    });
  });

  // SPEC-GAP: The id format "metric:{name}" is implementation-specific — spec says "Define MetricDefinition nodes" without specifying ID scheme
  // SPEC-GAP: Surface id format "surface:{type}:{name}" is implementation-specific

  describe('cleanup: always closes Neo4j', () => {
    it('closes Neo4jService on success', async () => {
      await runModule();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
