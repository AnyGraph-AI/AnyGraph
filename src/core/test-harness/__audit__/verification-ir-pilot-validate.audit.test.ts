/**
 * AUD-TC-03-L1b-07: verification-ir-pilot-validate.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §VG-5
 * "Pilot Hardening (IR module)" (lines ~722-746)
 *
 * Role: B6 (Health Witness)
 * Accept: 10 behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── hoisted mocks ─────────────────────────────────────────────── */
const { mockNeo4jRun, mockNeo4jClose, mockMaterialize, mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockNeo4jRun: vi.fn(),
  mockNeo4jClose: vi.fn(),
  mockMaterialize: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4j {
    run = mockNeo4jRun;
    close = mockNeo4jClose;
  },
}));

vi.mock('../../../core/ir/ir-materializer.js', () => ({
  IrMaterializer: class MockMaterializer {
    materialize = mockMaterialize;
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
  };
});

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const originalArgv = [...process.argv];

describe('AUD-TC-03-L1b-07 | verification-ir-pilot-validate.ts', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  /**
   * Helper: configure mockNeo4jRun to return different results based on query content.
   * This simulates the various Neo4j queries the validation script performs.
   */
  function configureMockNeo4j(overrides: {
    firstRunCounts?: { nodeCount: number; edgeCount: number };
    secondRunCounts?: { nodeCount: number; edgeCount: number };
    rebuildRunACounts?: { nodeCount: number; edgeCount: number };
    rebuildRunBCounts?: { nodeCount: number; edgeCount: number };
    duplicateNodeIds?: number;
    duplicateEdgeIds?: number;
    projectScopeViolations?: number;
    persistedOriginalEdgeType?: string | null;
    orphanEdgeWrites?: number;
  } = {}) {
    const defaults = {
      firstRunCounts: { nodeCount: 3, edgeCount: 2 },
      secondRunCounts: { nodeCount: 3, edgeCount: 2 },
      rebuildRunACounts: { nodeCount: 3, edgeCount: 2 },
      rebuildRunBCounts: { nodeCount: 3, edgeCount: 2 },
      duplicateNodeIds: 0,
      duplicateEdgeIds: 0,
      projectScopeViolations: 0,
      persistedOriginalEdgeType: 'READS_STATE',
      orphanEdgeWrites: 0,
      ...overrides,
    };

    // Track call count to getCounts to return different snapshots per call
    let getCountsCallIndex = 0;
    const countSequence = [
      defaults.firstRunCounts,
      defaults.secondRunCounts,
      defaults.rebuildRunACounts,
      defaults.rebuildRunBCounts,
    ];

    mockNeo4jRun.mockImplementation(async (query: string) => {
      // DETACH DELETE (clearProject) — no return needed
      if (query.includes('DETACH DELETE')) return [];

      // getCounts — returns nodeCount/edgeCount
      if (query.includes('AS nodeCount') && query.includes('AS edgeCount')) {
        const counts = countSequence[getCountsCallIndex] ?? defaults.firstRunCounts;
        getCountsCallIndex++;
        return [{ nodeCount: counts.nodeCount, edgeCount: counts.edgeCount }];
      }

      // getDuplicateNodeIds
      if (query.includes('AS duplicateIds') && query.includes('n.id')) {
        return [{ duplicateIds: defaults.duplicateNodeIds }];
      }

      // getDuplicateEdgeIds
      if (query.includes('AS duplicateIds') && query.includes('r.id')) {
        return [{ duplicateEdgeIds: defaults.duplicateEdgeIds }];
      }

      // getProjectScopeViolations
      if (query.includes('AS violations')) {
        return [{ violations: defaults.projectScopeViolations }];
      }

      // getPersistedOriginalEdgeType
      if (query.includes('edge-original-type')) {
        return defaults.persistedOriginalEdgeType
          ? [{ edgeType: defaults.persistedOriginalEdgeType }]
          : [];
      }

      // getOrphanEdgeWrites
      if (query.includes('edge-orphan')) {
        return [{ orphanWrites: defaults.orphanEdgeWrites }];
      }

      return [];
    });
  }

  beforeEach(() => {
    mockNeo4jRun.mockReset();
    mockNeo4jClose.mockReset().mockResolvedValue(undefined);
    mockMaterialize.mockReset().mockResolvedValue(undefined);
    mockMkdirSync.mockReset();
    mockWriteFileSync.mockReset();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  async function runCLI() {
    process.argv = ['node', 'verification-ir-pilot-validate.ts'];
    vi.resetModules();
    await import('../../../utils/verification-ir-pilot-validate.js');
    await new Promise((r) => setTimeout(r, 150));
  }

  // ─── B1: creates pilot IR document with 3 nodes + 2 edges for proj_vg5_ir_pilot ───
  it('B1: creates pilot IR document with 3 nodes + 2 edges for proj_vg5_ir_pilot', async () => {
    configureMockNeo4j();
    await runCLI();

    expect(mockMaterialize).toHaveBeenCalled();
    const firstCallDoc = mockMaterialize.mock.calls[0][0];
    expect(firstCallDoc.projectId).toBe('proj_vg5_ir_pilot');
    expect(firstCallDoc.nodes).toHaveLength(3);
    expect(firstCallDoc.edges).toHaveLength(2);
    expect(firstCallDoc.version).toBe('ir.v1');
    expect(firstCallDoc.sourceKind).toBe('code');
  });

  // ─── B2: validates materialization idempotency ───
  it('B2: validates materialization idempotency — two materializations produce same counts + 0 duplicate IDs', async () => {
    configureMockNeo4j({
      firstRunCounts: { nodeCount: 3, edgeCount: 2 },
      secondRunCounts: { nodeCount: 3, edgeCount: 2 },
      duplicateNodeIds: 0,
      duplicateEdgeIds: 0,
    });
    await runCLI();

    const written = mockWriteFileSync.mock.calls[0]?.[1];
    expect(written).toBeDefined();
    const summary = JSON.parse(written as string);
    expect(summary.checks.materializationIdempotency).toBe(true);
    expect(summary.metrics.duplicateNodeIds).toBe(0);
    expect(summary.metrics.duplicateEdgeIds).toBe(0);
  });

  // ─── B3: validates project-scope integrity ───
  it('B3: validates project-scope integrity — 0 edges cross project boundaries', async () => {
    configureMockNeo4j({ projectScopeViolations: 0 });
    await runCLI();

    const written = mockWriteFileSync.mock.calls[0]?.[1];
    const summary = JSON.parse(written as string);
    expect(summary.checks.projectScopeIntegrity).toBe(true);
    expect(summary.metrics.projectScopeViolations).toBe(0);
  });

  // ─── B4: validates original-edge-type fidelity ───
  it('B4: validates original-edge-type fidelity — REFERENCES edge with originalEdgeType=READS_STATE persists', async () => {
    configureMockNeo4j({ persistedOriginalEdgeType: 'READS_STATE' });
    await runCLI();

    const written = mockWriteFileSync.mock.calls[0]?.[1];
    const summary = JSON.parse(written as string);
    expect(summary.checks.originalEdgeTypeFidelity).toBe(true);
    expect(summary.metrics.persistedOriginalEdgeType).toBe('READS_STATE');
  });

  // ─── B5: validates deterministic rebuild ───
  it('B5: validates deterministic rebuild — two clear-and-rebuild runs produce identical counts', async () => {
    configureMockNeo4j({
      rebuildRunACounts: { nodeCount: 3, edgeCount: 2 },
      rebuildRunBCounts: { nodeCount: 3, edgeCount: 2 },
    });
    await runCLI();

    const written = mockWriteFileSync.mock.calls[0]?.[1];
    const summary = JSON.parse(written as string);
    expect(summary.checks.deterministicRebuildTotals).toBe(true);
    expect(summary.metrics.rebuildRunA.nodeCount).toBe(summary.metrics.rebuildRunB.nodeCount);
    expect(summary.metrics.rebuildRunA.edgeCount).toBe(summary.metrics.rebuildRunB.edgeCount);
  });

  // ─── B6: validates no orphan relationship writes ───
  it('B6: validates no orphan relationship writes — edges referencing missing nodes produce 0 orphans', async () => {
    configureMockNeo4j({ orphanEdgeWrites: 0 });
    await runCLI();

    const written = mockWriteFileSync.mock.calls[0]?.[1];
    const summary = JSON.parse(written as string);
    expect(summary.checks.noOrphanRelationshipWrites).toBe(true);
    expect(summary.metrics.orphanEdgeWrites).toBe(0);
  });

  // ─── B7: writes ValidationSummary artifact JSON to artifacts/verification-pilot/ ───
  it('B7: writes ValidationSummary artifact JSON to artifacts/verification-pilot/', async () => {
    configureMockNeo4j();
    await runCLI();

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('artifacts/verification-pilot'),
      { recursive: true },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('vg5-ir-module-latest.json'),
      expect.any(String),
    );

    const written = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
    expect(written).toHaveProperty('ok');
    expect(written).toHaveProperty('projectId', 'proj_vg5_ir_pilot');
    expect(written).toHaveProperty('checks');
    expect(written).toHaveProperty('metrics');
    expect(written).toHaveProperty('generatedAt');
  });

  // ─── B8: cleans up pilot project from Neo4j after validation ───
  it('B8: cleans up pilot project from Neo4j after validation', async () => {
    configureMockNeo4j();
    await runCLI();

    // clearProject is called at start AND after validation — look for DETACH DELETE calls
    const deleteQueries = mockNeo4jRun.mock.calls.filter(
      ([query]: [string]) => query.includes('DETACH DELETE'),
    );
    // Should have at least 2 DETACH DELETE calls: one at start, one cleanup at end
    expect(deleteQueries.length).toBeGreaterThanOrEqual(2);
    // All should target the pilot project ID
    deleteQueries.forEach(([, params]: [string, { projectId: string }]) => {
      expect(params.projectId).toBe('proj_vg5_ir_pilot');
    });
  });

  // ─── B9: exits with code 1 when any check fails ───
  it('B9: exits with code 1 when any check fails', async () => {
    configureMockNeo4j({
      projectScopeViolations: 5, // force project-scope integrity to fail
    });
    await runCLI();

    const written = mockWriteFileSync.mock.calls[0]?.[1];
    const summary = JSON.parse(written as string);
    expect(summary.ok).toBe(false);
    expect(summary.checks.projectScopeIntegrity).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // ─── B10: toNumber helper handles Neo4j Integer objects ───
  it('B10: toNumber helper handles Neo4j Integer objects', async () => {
    configureMockNeo4j();

    // Override getCounts to return Neo4j Integer-like objects
    const neo4jInt = { toNumber: () => 3 };
    let callIndex = 0;
    mockNeo4jRun.mockImplementation(async (query: string) => {
      if (query.includes('DETACH DELETE')) return [];
      if (query.includes('AS nodeCount') && query.includes('AS edgeCount')) {
        callIndex++;
        return [{ nodeCount: neo4jInt, edgeCount: { toNumber: () => 2 } }];
      }
      if (query.includes('AS duplicateIds') && query.includes('n.id'))
        return [{ duplicateIds: { toNumber: () => 0 } }];
      if (query.includes('AS duplicateIds') && query.includes('r.id'))
        return [{ duplicateEdgeIds: { toNumber: () => 0 } }];
      if (query.includes('AS violations'))
        return [{ violations: { toNumber: () => 0 } }];
      if (query.includes('edge-original-type'))
        return [{ edgeType: 'READS_STATE' }];
      if (query.includes('edge-orphan'))
        return [{ orphanWrites: { toNumber: () => 0 } }];
      return [];
    });

    await runCLI();

    const written = mockWriteFileSync.mock.calls[0]?.[1];
    const summary = JSON.parse(written as string);
    // If toNumber wasn't handled, counts would be NaN or wrong
    expect(summary.metrics.firstRun.nodeCount).toBe(3);
    expect(summary.metrics.firstRun.edgeCount).toBe(2);
    expect(summary.ok).toBe(true);
  });

  // ─── SPEC-GAP checks ───
  // SPEC-GAP: §VG-5 does not specify behavior when Neo4j connection fails mid-validation
  // SPEC-GAP: §VG-5 does not specify whether artifact is written when validation partially completes before crash
  // SPEC-GAP: §VG-5 does not define maximum acceptable node/edge counts for pilot project (only invariant checks)
});
