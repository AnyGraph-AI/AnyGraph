/**
 * AUD-TC-03-L1b-35: governance-metrics-report.ts audit tests
 *
 * Spec: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §GM governance metric reporting
 *
 * Behaviors:
 *   (1) queries latest governance metrics via CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST
 *   (2) queries governance metric trend via CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND
 *   (3) formats report with latest values + trend
 *   (4) toNum/toStr helpers handle Neo4j types safely
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ──

const { mockRun, mockClose, mockQ18Latest, mockQ18Trend } = vi.hoisted(() => ({
  mockRun: vi.fn().mockResolvedValue([]),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockQ18Latest: 'MOCK_Q18_LATEST_QUERY',
  mockQ18Trend: 'MOCK_Q18_TREND_QUERY',
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4jService {
    run = mockRun;
    close = mockClose;
  },
}));

vi.mock('../../../utils/query-contract.js', () => ({
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST: mockQ18Latest,
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND: mockQ18Trend,
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

function latestSnapshotRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'gms-001',
    timestamp: '2026-03-20T10:00:00Z',
    snapshotWindow: '24h',
    schemaVersion: 'v2',
    verificationRuns: 5,
    gateFailures: 1,
    failuresResolvedBeforeCommit: 1,
    regressionsAfterMerge: 0,
    preventedRuns: 2,
    preventedEdgesDiagnostic: 2,
    totalRegressionEvents: 3,
    interceptionRate: 0.8,
    operationalInterceptionRate: 0.67,
    invariantViolations: 0,
    falseCompletionEvents: 0,
    meanRecoveryRuns: 1.5,
    ...overrides,
  };
}

function trendRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    timestamp: '2026-03-20T10:00:00Z',
    interceptionRate: 0.8,
    gateFailures: 1,
    failuresResolvedBeforeCommit: 1,
    regressionsAfterMerge: 0,
    invariantViolations: 0,
    falseCompletionEvents: 0,
    meanRecoveryRuns: 1.5,
    ...overrides,
  };
}

function operationalRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    total: 3,
    preventedRuns: 2,
    preventedEdgesDiagnostic: 2,
    ...overrides,
  };
}

async function runModule(argv2?: string, argv3?: string): Promise<void> {
  const origArgv = process.argv;
  const args = ['node', 'script'];
  // argv[2] = projectId, argv[3] = mode — must maintain positional order
  if (argv2 || argv3) args.push(argv2 ?? 'proj_c0d3e9a1f200');
  if (argv3) args.push(argv3);
  process.argv = args;
  try {
    await import('../../../utils/governance-metrics-report.js');
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.argv = origArgv;
  }
}

describe('governance-metrics-report audit tests', () => {
  // ─── Behavior 1: queries latest via Q18 contract query ───
  describe('B1: queries latest governance metrics', () => {
    it('uses CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST for default "latest" mode', async () => {
      // First call: Q18 latest query
      mockRun.mockResolvedValueOnce([latestSnapshotRow()]);
      // Second call: operational query
      mockRun.mockResolvedValueOnce([operationalRow()]);

      await runModule();

      expect(mockRun).toHaveBeenCalledWith(mockQ18Latest, expect.objectContaining({ projectId: expect.any(String) }));
    });

    it('also runs operational query for live regression counts', async () => {
      mockRun.mockResolvedValueOnce([latestSnapshotRow()]);
      mockRun.mockResolvedValueOnce([operationalRow()]);

      await runModule();

      expect(mockRun).toHaveBeenCalledTimes(2);
      const secondCall = mockRun.mock.calls[1];
      const cypher = secondCall[0] as string;
      expect(cypher).toContain('RegressionEvent');
      expect(cypher).toContain('PREVENTED');
    });
  });

  // ─── Behavior 2: queries trend via Q18 contract query ───
  describe('B2: queries governance metric trend', () => {
    it('uses CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND when mode is "trend"', async () => {
      mockRun.mockResolvedValueOnce([trendRow(), trendRow({ timestamp: '2026-03-19T10:00:00Z' })]);

      await runModule(undefined, 'trend');

      expect(mockRun).toHaveBeenCalledWith(mockQ18Trend, expect.objectContaining({ projectId: expect.any(String) }));
    });

    it('returns trend array in output', async () => {
      mockRun.mockResolvedValueOnce([
        trendRow({ timestamp: '2026-03-20' }),
        trendRow({ timestamp: '2026-03-19', interceptionRate: 0.7 }),
      ]);

      await runModule(undefined, 'trend');

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.mode).toBe('trend');
      expect(parsed.trend).toHaveLength(2);
      expect(parsed.count).toBe(2);
    });
  });

  // ─── Behavior 3: formats report with latest values ───
  describe('B3: formats report', () => {
    it('includes snapshot fields in latest report', async () => {
      mockRun.mockResolvedValueOnce([latestSnapshotRow()]);
      mockRun.mockResolvedValueOnce([operationalRow()]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);

      expect(parsed.ok).toBe(true);
      expect(parsed.mode).toBe('latest');
      expect(parsed.snapshot).toBeDefined();
      expect(parsed.snapshot.id).toBe('gms-001');
      expect(parsed.snapshot.verificationRuns).toBe(5);
      expect(parsed.snapshot.gateFailures).toBe(1);
      expect(parsed.snapshot.strictInterceptionRate).toBe(0.8);
    });

    it('includes operationalView with live regression data', async () => {
      mockRun.mockResolvedValueOnce([latestSnapshotRow()]);
      mockRun.mockResolvedValueOnce([operationalRow()]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);

      expect(parsed.operationalView).toBeDefined();
      expect(parsed.operationalView.totalRegressionEvents).toBe(3);
      expect(parsed.operationalView.preventedRuns).toBe(2);
      expect(parsed.operationalView.operationalInterceptionRate).toBeCloseTo(2 / 3);
    });

    it('outputs null snapshot when no snapshot rows exist', async () => {
      mockRun.mockResolvedValueOnce([]); // no snapshots
      mockRun.mockResolvedValueOnce([operationalRow()]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.snapshot).toBeNull();
    });

    it('trend mode maps all fields per row', async () => {
      mockRun.mockResolvedValueOnce([trendRow()]);

      await runModule(undefined, 'trend');

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      const entry = parsed.trend[0];
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('interceptionRate');
      expect(entry).toHaveProperty('gateFailures');
      expect(entry).toHaveProperty('failuresResolvedBeforeCommit');
      expect(entry).toHaveProperty('regressionsAfterMerge');
      expect(entry).toHaveProperty('invariantViolations');
      expect(entry).toHaveProperty('falseCompletionEvents');
      expect(entry).toHaveProperty('meanRecoveryRuns');
    });
  });

  // ─── Behavior 4: toNum/toStr handle Neo4j types ───
  describe('B4: toNum/toStr handle Neo4j types safely', () => {
    it('handles Neo4j Integer objects via .toNumber()', async () => {
      const neo4jInt = { toNumber: () => 42 };
      mockRun.mockResolvedValueOnce([
        latestSnapshotRow({ verificationRuns: neo4jInt, gateFailures: neo4jInt }),
      ]);
      mockRun.mockResolvedValueOnce([operationalRow({ total: neo4jInt, preventedRuns: neo4jInt })]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.snapshot.verificationRuns).toBe(42);
      expect(parsed.operationalView.totalRegressionEvents).toBe(42);
    });

    it('handles null/undefined without crashing', async () => {
      mockRun.mockResolvedValueOnce([
        latestSnapshotRow({ id: null, timestamp: undefined }),
      ]);
      mockRun.mockResolvedValueOnce([operationalRow()]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.snapshot.id).toBe('');
      expect(parsed.snapshot.timestamp).toBe('');
    });

    it('operationalInterceptionRate is 1 when totalRegressionEvents is 0', async () => {
      mockRun.mockResolvedValueOnce([latestSnapshotRow()]);
      mockRun.mockResolvedValueOnce([operationalRow({ total: 0, preventedRuns: 0 })]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.operationalView.operationalInterceptionRate).toBe(1);
    });
  });

  // SPEC-GAP: The dual-query pattern (Q18 snapshot + live operational count) is not explicit in the spec — spec says "report from Q18 queries"
  // SPEC-GAP: Default mode 'latest' vs 'trend' toggle via argv[3] is implementation-specific

  describe('projectId passthrough', () => {
    it('accepts custom projectId from argv[2]', async () => {
      mockRun.mockResolvedValueOnce([latestSnapshotRow()]);
      mockRun.mockResolvedValueOnce([operationalRow()]);

      await runModule('proj_custom');

      const params = mockRun.mock.calls[0][1] as Record<string, unknown>;
      expect(params.projectId).toBe('proj_custom');
    });
  });

  describe('cleanup: always closes Neo4j', () => {
    it('closes Neo4jService on success', async () => {
      mockRun.mockResolvedValueOnce([latestSnapshotRow()]);
      mockRun.mockResolvedValueOnce([operationalRow()]);
      await runModule();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
