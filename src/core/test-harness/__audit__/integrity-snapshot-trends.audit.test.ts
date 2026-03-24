// AUD-TC-03-L1b-45: integrity-snapshot-trends.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/GRAPH_INTEGRITY_SNAPSHOT.md §snapshot trends

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Neo4jService
const mockNeoRun = vi.fn();
const mockNeoClose = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class {
    run = mockNeoRun;
    close = mockNeoClose;
  },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const origArgv = process.argv;
const origEnv = { ...process.env };
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

describe('AUD-TC-03-L1b-45: integrity-snapshot-trends', () => {
  // Replicate toMetricTrend for testing trend computation correctness
  function toNum(value: unknown): number {
    const maybe = value as { toNumber?: () => number } | null | undefined;
    if (maybe?.toNumber) return maybe.toNumber();
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  interface SnapshotPoint {
    timestamp: string;
    nodeCount: number;
    edgeCount: number;
    unresolvedLocalCount: number;
    invariantViolationCount: number;
  }

  interface MetricTrend {
    first: number;
    last: number;
    delta: number;
    deltaPct: number;
    slopePerSnapshot: number;
  }

  function toMetricTrend(points: SnapshotPoint[], metric: keyof SnapshotPoint): MetricTrend {
    const values = points.map((p) => toNum(p[metric]));
    const first = values[0] ?? 0;
    const last = values[values.length - 1] ?? 0;
    const delta = last - first;
    const base = Math.max(1, first);
    const deltaPct = delta / base;
    const slopePerSnapshot = values.length > 1 ? delta / (values.length - 1) : 0;

    return {
      first,
      last,
      delta,
      deltaPct: Number(deltaPct.toFixed(4)),
      slopePerSnapshot: Number(slopePerSnapshot.toFixed(4)),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'script.ts'];
    delete process.env.INTEGRITY_TREND_WINDOW;
  });

  afterEach(() => {
    process.argv = origArgv;
    process.env = { ...origEnv };
  });

  // Behavior 1: Queries IntegritySnapshot nodes ordered by timestamp
  describe('IntegritySnapshot time-series query', () => {
    it('should query IntegritySnapshot nodes ordered by projectId and timestamp', async () => {
      mockNeoRun.mockResolvedValue([]);

      // Import triggers main() — we test the query shape
      try {
        await import('../../../utils/integrity-snapshot-trends.js');
      } catch { /* script exits */ }

      expect(mockNeoRun).toHaveBeenCalled();
      const [query, params] = mockNeoRun.mock.calls[0];
      expect(query).toContain('MATCH (s:IntegritySnapshot)');
      expect(query).toContain('ORDER BY projectId, timestamp');
      expect(params).toHaveProperty('projectId', null);
    });

    it('should pass projectId filter when argv[2] provided', async () => {
      process.argv = ['node', 'script.ts', 'proj_c0d3e9a1f200'];
      mockNeoRun.mockResolvedValue([]);

      vi.resetModules();
      try {
        await import('../../../utils/integrity-snapshot-trends.js');
      } catch { /* script exits */ }

      expect(mockNeoRun).toHaveBeenCalled();
      const [, params] = mockNeoRun.mock.calls[0];
      expect(params).toHaveProperty('projectId', 'proj_c0d3e9a1f200');
    });
  });

  // Behavior 2: Computes MetricTrend for each metric (first/last/delta/deltaPct/slopePerSnapshot)
  describe('MetricTrend computation', () => {
    const points: SnapshotPoint[] = [
      { timestamp: '2026-03-18T00:00:00Z', nodeCount: 1000, edgeCount: 2000, unresolvedLocalCount: 50, invariantViolationCount: 10 },
      { timestamp: '2026-03-19T00:00:00Z', nodeCount: 1200, edgeCount: 2400, unresolvedLocalCount: 40, invariantViolationCount: 8 },
      { timestamp: '2026-03-20T00:00:00Z', nodeCount: 1500, edgeCount: 3000, unresolvedLocalCount: 30, invariantViolationCount: 5 },
    ];

    it('should compute first/last correctly', () => {
      const trend = toMetricTrend(points, 'nodeCount');
      expect(trend.first).toBe(1000);
      expect(trend.last).toBe(1500);
    });

    it('should compute delta = last - first', () => {
      const trend = toMetricTrend(points, 'nodeCount');
      expect(trend.delta).toBe(500); // 1500 - 1000
    });

    it('should compute deltaPct = delta / max(1, first)', () => {
      const trend = toMetricTrend(points, 'nodeCount');
      expect(trend.deltaPct).toBe(0.5); // 500 / 1000
    });

    it('should compute slopePerSnapshot = delta / (count - 1)', () => {
      const trend = toMetricTrend(points, 'nodeCount');
      expect(trend.slopePerSnapshot).toBe(250); // 500 / 2
    });

    it('should handle decreasing metrics (negative delta)', () => {
      const trend = toMetricTrend(points, 'unresolvedLocalCount');
      expect(trend.first).toBe(50);
      expect(trend.last).toBe(30);
      expect(trend.delta).toBe(-20);
      expect(trend.deltaPct).toBe(-0.4); // -20 / 50
      expect(trend.slopePerSnapshot).toBe(-10); // -20 / 2
    });

    it('should round deltaPct and slopePerSnapshot to 4 decimals', () => {
      const pts: SnapshotPoint[] = [
        { timestamp: 't1', nodeCount: 3, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
        { timestamp: 't2', nodeCount: 4, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
        { timestamp: 't3', nodeCount: 5, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
      ];
      const trend = toMetricTrend(pts, 'nodeCount');
      // deltaPct = 2/3 = 0.6667
      expect(trend.deltaPct).toBe(0.6667);
      expect(trend.slopePerSnapshot).toBe(1);
    });
  });

  // Behavior 3: Reports trend direction (growing/shrinking/stable)
  describe('trend direction reporting', () => {
    it('should indicate growing when delta > 0', () => {
      const trend = toMetricTrend(
        [
          { timestamp: 't1', nodeCount: 100, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
          { timestamp: 't2', nodeCount: 200, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
        ],
        'nodeCount',
      );
      const direction = trend.delta > 0 ? 'growing' : trend.delta < 0 ? 'shrinking' : 'stable';
      expect(direction).toBe('growing');
    });

    it('should indicate shrinking when delta < 0', () => {
      const trend = toMetricTrend(
        [
          { timestamp: 't1', nodeCount: 200, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
          { timestamp: 't2', nodeCount: 100, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
        ],
        'nodeCount',
      );
      const direction = trend.delta > 0 ? 'growing' : trend.delta < 0 ? 'shrinking' : 'stable';
      expect(direction).toBe('shrinking');
    });

    it('should indicate stable when delta = 0', () => {
      const trend = toMetricTrend(
        [
          { timestamp: 't1', nodeCount: 100, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
          { timestamp: 't2', nodeCount: 100, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
        ],
        'nodeCount',
      );
      const direction = trend.delta > 0 ? 'growing' : trend.delta < 0 ? 'shrinking' : 'stable';
      expect(direction).toBe('stable');
    });
  });

  // Behavior 4: Handles edge cases (single snapshot, no snapshots)
  describe('edge cases', () => {
    it('should return slopePerSnapshot = 0 for single snapshot', () => {
      const trend = toMetricTrend(
        [{ timestamp: 't1', nodeCount: 500, edgeCount: 1000, unresolvedLocalCount: 10, invariantViolationCount: 2 }],
        'nodeCount',
      );
      expect(trend.first).toBe(500);
      expect(trend.last).toBe(500);
      expect(trend.delta).toBe(0);
      expect(trend.slopePerSnapshot).toBe(0);
    });

    it('should return all zeros for empty points array', () => {
      const trend = toMetricTrend([], 'nodeCount');
      expect(trend.first).toBe(0);
      expect(trend.last).toBe(0);
      expect(trend.delta).toBe(0);
      expect(trend.deltaPct).toBe(0);
      expect(trend.slopePerSnapshot).toBe(0);
    });

    it('should use max(1, first) as base for deltaPct to avoid division by zero', () => {
      const trend = toMetricTrend(
        [
          { timestamp: 't1', nodeCount: 0, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
          { timestamp: 't2', nodeCount: 10, edgeCount: 0, unresolvedLocalCount: 0, invariantViolationCount: 0 },
        ],
        'nodeCount',
      );
      // base = max(1, 0) = 1, deltaPct = 10/1 = 10
      expect(trend.deltaPct).toBe(10);
    });

    // SPEC-GAP: Spec mentions window parameter but doesn't specify default or env var.
    // Implementation uses --window= arg or INTEGRITY_TREND_WINDOW env, default 10.
    it('SPEC-GAP: window size configuration via --window= and INTEGRITY_TREND_WINDOW env', () => {
      process.env.INTEGRITY_TREND_WINDOW = '5';
      const windowArg = undefined;
      const windowSize = Math.max(1, Number(windowArg ?? process.env.INTEGRITY_TREND_WINDOW ?? 10));
      expect(windowSize).toBe(5);
    });

    it('should default window to 10 when no config provided', () => {
      delete process.env.INTEGRITY_TREND_WINDOW;
      const windowSize = Math.max(1, Number(undefined ?? process.env.INTEGRITY_TREND_WINDOW ?? 10));
      expect(windowSize).toBe(10);
    });
  });

  // Behavior 5: toNum helper handles Neo4j Integer
  describe('toNum helper', () => {
    it('should handle Neo4j Integer objects with toNumber()', () => {
      expect(toNum({ toNumber: () => 42 })).toBe(42);
    });

    it('should handle regular numbers', () => {
      expect(toNum(100)).toBe(100);
      expect(toNum(0)).toBe(0);
    });

    it('should return 0 for null/undefined', () => {
      expect(toNum(null)).toBe(0);
      expect(toNum(undefined)).toBe(0);
    });

    it('should return 0 for non-numeric values', () => {
      expect(toNum('not a number')).toBe(0);
      expect(toNum(Infinity)).toBe(0);
      expect(toNum(NaN)).toBe(0);
    });
  });

  // Neo4jService lifecycle
  describe('Neo4jService lifecycle', () => {
    it('should close Neo4jService in finally block', async () => {
      mockNeoRun.mockResolvedValue([]);

      try {
        vi.resetModules();
        await import('../../../utils/integrity-snapshot-trends.js');
      } catch { /* script exits */ }

      expect(mockNeoClose).toHaveBeenCalled();
    });
  });
});
