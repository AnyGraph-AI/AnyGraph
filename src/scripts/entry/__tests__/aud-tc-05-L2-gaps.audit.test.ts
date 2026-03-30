/**
 * AUD-TC-05 L2 Gap-Fill Tests — Entry Point Behaviors
 *
 * Supplementary tests for SHALLOW / INCOMPLETE entry points:
 *   L2-01: graph-metrics.ts     — existing test is type-only; behaviors 1-6 untested
 *   L2-02: probe-architecture.ts — existing test only checks Q44/Q45 existence; gaps 7,8,10
 *   L2-04: self-diagnosis.ts    — existing test checks length+D37 only; gaps 3,5,6,7,9
 *   L2-06: watch-all.ts         — only reEnrichPlanEvidence is exported; 11/12 behaviors
 *                                  are unexported (SPEC-GAP-L2-06, see bottom of file)
 *
 * L2-03 (run-done-check-quiescent.ts) — ADEQUATE, no supplementary tests needed.
 * L2-05 (tc-pipeline.ts)             — ADEQUATE, no supplementary tests needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Stable mock objects (hoisted before module imports) ─────────────────────
const { mockSession, mockModuleDriver } = vi.hoisted(() => {
  const s = {
    run: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const d = {
    session: vi.fn(() => s),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { mockSession: s, mockModuleDriver: d };
});

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => mockModuleDriver),
    auth: {
      basic: vi.fn((u: string, p: string) => ({ scheme: 'basic', principal: u, credentials: p })),
    },
  },
}));

// ─── Imports (after vi.mock hoisting) ────────────────────────────────────────
import { collectGraphMetrics } from '../graph-metrics.js';
import { query as probeQuery, getProjectId as probeGetProjectId } from '../probe-architecture.js';
import { query as diagQuery, getProjectId as diagGetProjectId } from '../self-diagnosis.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Simulate a Neo4j record with a .get() method */
const makeRecord = (data: Record<string, unknown>) => ({
  get: (key: string) => data[key],
  keys: Object.keys(data),
});

/** Simulate a Neo4j Integer (driver returns these for INTEGER fields) */
const neo4jInt = (n: number) => ({ toNumber: () => n, low: n, high: 0 });

// ─── L2-01: graph-metrics.ts ─────────────────────────────────────────────────
describe('[L2-01] collectGraphMetrics — behaviors 1-6', () => {
  /**
   * Build a local mock session that returns canned responses for the 8 session.run()
   * calls that collectGraphMetrics makes. Each test creates a fresh session so
   * mockResolvedValueOnce queues do not bleed between tests.
   */
  function makeLocalSession() {
    const session = {
      run: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    // 1. node/edge counts
    session.run.mockResolvedValueOnce({
      records: [makeRecord({ nodeCount: neo4jInt(17000), edgeCount: neo4jInt(33000) })],
    });
    // 2. degree stats
    session.run.mockResolvedValueOnce({
      records: [makeRecord({ avgDegree: 3.8, maxDegree: neo4jInt(900) })],
    });
    // 3. max-degree node
    session.run.mockResolvedValueOnce({
      records: [makeRecord({ id: 'node_hub', name: 'bigHub' })],
    });
    // 4. derived edge counts
    session.run.mockResolvedValueOnce({
      records: [makeRecord({ derivedCount: neo4jInt(2000), total: neo4jInt(33000) })],
    });
    // 5. code node ratio
    session.run.mockResolvedValueOnce({
      records: [makeRecord({ codeCount: neo4jInt(10000), total: neo4jInt(17000) })],
    });
    // 6. edge type distribution
    session.run.mockResolvedValueOnce({
      records: [
        makeRecord({ edgeType: 'CONTAINS', cnt: neo4jInt(5000) }),
        makeRecord({ edgeType: 'CALLS', cnt: neo4jInt(3000) }),
      ],
    });
    // 7. label distribution
    session.run.mockResolvedValueOnce({
      records: [
        makeRecord({ lbl: 'CodeNode', cnt: neo4jInt(10000) }),
        makeRecord({ lbl: 'Function', cnt: neo4jInt(5000) }),
      ],
    });
    // 8. CREATE GraphMetricsSnapshot (no return needed)
    session.run.mockResolvedValueOnce({ records: [] });
    return session;
  }

  it('(B1) queries nodeCount and edgeCount, converting Neo4j Integers', async () => {
    const session = makeLocalSession();
    const driver = { session: () => session };
    const metrics = await collectGraphMetrics(driver as any);
    expect(metrics.nodeCount).toBe(17000);
    expect(metrics.edgeCount).toBe(33000);
    expect(typeof metrics.nodeCount).toBe('number');
  });

  it('(B2) queries edge type distribution and converts Integer counts', async () => {
    const session = makeLocalSession();
    const driver = { session: () => session };
    const metrics = await collectGraphMetrics(driver as any);
    expect(metrics.edgeTypeDistribution).toEqual({ CONTAINS: 5000, CALLS: 3000 });
  });

  it('(B3) queries label distribution (project-level metrics) and converts Integer counts', async () => {
    const session = makeLocalSession();
    const driver = { session: () => session };
    const metrics = await collectGraphMetrics(driver as any);
    expect(metrics.labelDistribution).toEqual({ CodeNode: 10000, Function: 5000 });
  });

  it('(B4) writes GraphMetricsSnapshot node via CREATE — session.run called 8 times', async () => {
    const session = makeLocalSession();
    const driver = { session: () => session };
    await collectGraphMetrics(driver as any);
    expect(session.run).toHaveBeenCalledTimes(8);
    const createCall = session.run.mock.calls[7];
    expect(createCall[0]).toContain('CREATE (s:GraphMetricsSnapshot');
    expect((createCall[1] as any).nodeCount).toBe(17000);
    expect((createCall[1] as any).edgeCount).toBe(33000);
  });

  it('(B5) toNum converts Neo4j Integer objects — derivedEdgeCount and codeNodeCount are plain numbers', async () => {
    const session = makeLocalSession();
    const driver = { session: () => session };
    const metrics = await collectGraphMetrics(driver as any);
    expect(metrics.derivedEdgeCount).toBe(2000);
    expect(typeof metrics.derivedEdgeCount).toBe('number');
    expect(metrics.codeNodeCount).toBe(10000);
    expect(metrics.derivedEdgeRatio).toBeCloseTo(2000 / 33000, 5);
    expect(metrics.codeNodeRatio).toBeCloseTo(10000 / 17000, 5);
  });

  it('(B6) session.close() is called in finally block even when first query throws', async () => {
    const session = makeLocalSession();
    session.run.mockReset();
    session.run.mockRejectedValueOnce(new Error('DB connection refused'));
    const driver = { session: () => session };

    await expect(collectGraphMetrics(driver as any)).rejects.toThrow('DB connection refused');
    expect(session.close).toHaveBeenCalledOnce();
  });
});

// ─── L2-02: probe-architecture.ts — behaviors 7 (query integer handling), 6 (getProjectId) ──
describe('[L2-02] probe-architecture — query helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults cleared by clearAllMocks
    mockSession.close.mockResolvedValue(undefined);
    // mockModuleDriver.session implementation () => mockSession is preserved (vi.fn(() => s))
  });

  it('(B7) query() converts Neo4j Integer field values to plain JS numbers', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [{
        keys: ['nodeCount'],
        get: (k: string) => k === 'nodeCount' ? neo4jInt(17000) : null,
      }],
    });
    const rows = await probeQuery('MATCH (n) RETURN count(n) AS nodeCount');
    expect(rows[0].nodeCount).toBe(17000);
    expect(typeof rows[0].nodeCount).toBe('number');
  });

  it('(B7) query() leaves non-Integer values unchanged', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [{
        keys: ['name', 'score'],
        get: (k: string) => ({ name: 'SomeNode', score: 0.87 })[k as 'name' | 'score'],
      }],
    });
    const rows = await probeQuery('MATCH (n) RETURN n.name AS name, n.score AS score');
    expect(rows[0].name).toBe('SomeNode');
    expect(rows[0].score).toBe(0.87);
  });

  it('(B6) getProjectId() returns default fallback when graph has no projects', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });
    const pid = await probeGetProjectId();
    expect(pid).toBe('proj_c0d3e9a1f200');
  });

  it('(B6) getProjectId() returns the projectId from the first row when present', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [{
        keys: ['pid'],
        get: (_k: string) => 'proj_test_abc',
      }],
    });
    const pid = await probeGetProjectId();
    expect(pid).toBe('proj_test_abc');
  });
});

// ─── L2-04: self-diagnosis.ts — behaviors 6 (query integer handling), 5 (getProjectId) ──
describe('[L2-04] self-diagnosis — query helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.close.mockResolvedValue(undefined);
  });

  it('(B6) query() converts Neo4j Integer values to plain numbers', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [{
        keys: ['cnt'],
        get: (k: string) => k === 'cnt' ? neo4jInt(42) : null,
      }],
    });
    const rows = await diagQuery('MATCH (n) RETURN count(n) AS cnt');
    expect(rows[0].cnt).toBe(42);
    expect(typeof rows[0].cnt).toBe('number');
  });

  it('(B6) query() handles multiple Neo4j Integer fields in a single record', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [{
        keys: ['analyzed', 'total'],
        get: (k: string) => k === 'analyzed' ? neo4jInt(346) : neo4jInt(408),
      }],
    });
    const rows = await diagQuery('MATCH (sf) RETURN ...');
    expect(rows[0].analyzed).toBe(346);
    expect(rows[0].total).toBe(408);
  });

  it('(B5) getProjectId() returns default fallback when no projects exist', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });
    const pid = await diagGetProjectId();
    expect(pid).toBe('proj_c0d3e9a1f200');
  });

  it('(B5) getProjectId() returns resolved project ID from graph', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [{
        keys: ['pid'],
        get: (_k: string) => 'proj_resolved_id',
      }],
    });
    const pid = await diagGetProjectId();
    expect(pid).toBe('proj_resolved_id');
  });
});

/*
 * ─── L2-06: watch-all.ts — SPEC-GAP-L2-06 ─────────────────────────────────
 *
 * Only `reEnrichPlanEvidence` is exported from watch-all.ts (behavior 1).
 * Behaviors 2-12 map to functions that are module-private:
 *
 *   (2)  discoverProjects()         — private
 *   (3)  inferProjectKind()         — private
 *   (4)  waitForNeo4j()             — private
 *   (5)  ingestDocumentProject()    — private
 *   (6)  startWatchingCode()        — private (nested inside main())
 *   (7)  startWatchingDocument()    — private (nested inside main())
 *   (8)  runPostParseEnrichment()   — private (nested inside main())
 *   (9)  reParsePlans()             — private (nested inside main())
 *   (10) watchPlansDir()            — private (nested inside main())
 *   (11) setInterval re-scan        — private (inside main())
 *   (12) per-project queue          — private (inside main())
 *
 * SPEC-GAP-L2-06 (HIGH): 11/12 behaviors untestable without refactoring.
 * Fix: export inferProjectKind, discoverProjects, runPostParseEnrichment, and
 * the queue mechanism, or extract to a WatchAllOrchestrator class with DI.
 * Until then, these behaviors are covered only by system-level integration
 * (the codegraph-watcher.service running in production).
 *
 * Behavior (1) reEnrichPlanEvidence is already ADEQUATELY covered by
 * src/scripts/entry/__tests__/watch-all-evidence-relink.test.ts.
 */
