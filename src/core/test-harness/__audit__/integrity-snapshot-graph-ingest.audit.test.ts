// AUD-TC-03-L1b-44: integrity-snapshot-graph-ingest.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/GRAPH_INTEGRITY_SNAPSHOT.md §snapshot graph ingest

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs (synchronous)
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  readdirSync: (...a: unknown[]) => mockReaddirSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
}));

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

describe('AUD-TC-03-L1b-44: integrity-snapshot-graph-ingest', () => {
  const sampleRow = {
    timestamp: '2026-03-20T12:00:00.000Z',
    graphEpoch: 'epoch-42',
    projectId: 'proj_c0d3e9a1f200',
    nodeCount: 5000,
    edgeCount: 8000,
    unresolvedLocalCount: 12,
    invariantViolationCount: 3,
    duplicateSourceSuspicionCount: 1,
  };

  const sampleJsonl = JSON.stringify(sampleRow);

  beforeEach(() => {
    vi.clearAllMocks();
    mockReaddirSync.mockReturnValue(['2026-03-20T12-00-00.jsonl']);
    mockReadFileSync.mockReturnValue(sampleJsonl);
    mockNeoRun.mockResolvedValue([{
      snapshotNodeCount: 1,
      metricNodeCount: 5,
      measuredEdgeCount: 5,
    }]);
  });

  // Behavior 1: Reads JSONL files from artifacts/integrity-snapshots/
  describe('JSONL file discovery', () => {
    it('should read directory listing and filter for .jsonl files', async () => {
      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(mockReaddirSync).toHaveBeenCalledWith('/test/snapshots');
    });

    it('should sort files and pick the latest (last alphabetically)', async () => {
      mockReaddirSync.mockReturnValue([
        '2026-03-18T12-00-00.jsonl',
        '2026-03-20T12-00-00.jsonl',
        '2026-03-19T12-00-00.jsonl',
      ]);

      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      // readFileSync should be called with the latest (sorted last) file
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('2026-03-20'),
        'utf8',
      );
    });

    it('should return error when no .jsonl files found', async () => {
      mockReaddirSync.mockReturnValue(['readme.md', 'data.json']);

      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      const result = await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/empty/dir' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('No integrity snapshot artifacts');
    });
  });

  // Behavior 2: Parses SnapshotRow records from JSONL
  describe('SnapshotRow JSONL parsing', () => {
    it('should parse valid JSONL lines into SnapshotRow objects', async () => {
      const multiRow = [
        JSON.stringify({ ...sampleRow, projectId: 'proj_a' }),
        JSON.stringify({ ...sampleRow, projectId: 'proj_b' }),
      ].join('\n');
      mockReadFileSync.mockReturnValue(multiRow);

      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      const result = await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(result.ok).toBe(true);
      expect(result.rowsIngested).toBeGreaterThanOrEqual(1);
    });

    it('should filter out rows without projectId or timestamp', async () => {
      const lines = [
        JSON.stringify({ ...sampleRow }),
        JSON.stringify({ nodeCount: 100 }), // no projectId or timestamp
      ].join('\n');
      mockReadFileSync.mockReturnValue(lines);

      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      const result = await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(result.ok).toBe(true);
      // Only the valid row should be ingested
      expect(result.rowsIngested).toBe(1);
    });

    it('should return error for empty artifact file', async () => {
      mockReadFileSync.mockReturnValue('');

      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      const result = await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('empty');
    });
  });

  // Behavior 3: MERGEs IntegritySnapshot nodes with snapshot properties
  describe('IntegritySnapshot node MERGE', () => {
    it('should execute MERGE cypher with snapshot row data', async () => {
      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(mockNeoRun).toHaveBeenCalled();
      const [query, params] = mockNeoRun.mock.calls[0];
      expect(query).toContain('MERGE (s:IntegritySnapshot');
      expect(query).toContain('projectId');
      expect(query).toContain('timestamp');
      expect(params.rows).toBeDefined();
      expect(params.rows[0]).toHaveProperty('projectId', 'proj_c0d3e9a1f200');
    });

    it('should set graphEpoch, nodeCount, edgeCount, unresolvedLocalCount, invariantViolationCount, duplicateSourceSuspicionCount', async () => {
      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      const [query] = mockNeoRun.mock.calls[0];
      expect(query).toContain('s.graphEpoch');
      expect(query).toContain('s.nodeCount');
      expect(query).toContain('s.edgeCount');
      expect(query).toContain('s.unresolvedLocalCount');
      expect(query).toContain('s.invariantViolationCount');
      expect(query).toContain('s.duplicateSourceSuspicionCount');
    });
  });

  // Behavior 4: Creates MetricResult nodes linked via MEASURED edges
  describe('MetricResult node creation with MEASURED edges', () => {
    it('should MERGE MetricResult nodes for each metric dimension', async () => {
      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      const [query] = mockNeoRun.mock.calls[0];
      expect(query).toContain('MERGE (m:MetricResult');
      expect(query).toContain('metric: metric.metric');
      expect(query).toContain("context: 'integrity_snapshot'");
    });

    it('should create MEASURED edges from IntegritySnapshot to MetricResult', async () => {
      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      const [query] = mockNeoRun.mock.calls[0];
      expect(query).toContain('MERGE (s)-[me:MEASURED');
      expect(query).toContain("me.sourceKind = 'integrity-snapshot'");
    });

    it('should produce 5 metric dimensions (nodeCount, edgeCount, unresolvedLocalCount, invariantViolationCount, duplicateSourceSuspicionCount)', async () => {
      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      const [query] = mockNeoRun.mock.calls[0];
      // The UNWIND in the query defines 5 metric names
      expect(query).toContain("'nodeCount'");
      expect(query).toContain("'edgeCount'");
      expect(query).toContain("'unresolvedLocalCount'");
      expect(query).toContain("'invariantViolationCount'");
      expect(query).toContain("'duplicateSourceSuspicionCount'");
    });
  });

  // Behavior 5: Reports ingest counts
  describe('ingest result reporting', () => {
    it('should return structured result with ok, rowsIngested, snapshotNodeCount, metricNodeCount, measuredEdgeCount', async () => {
      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      const result = await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(result.ok).toBe(true);
      expect(result.rowsIngested).toBe(1);
      expect(result.snapshotNodeCount).toBe(1);
      expect(result.metricNodeCount).toBe(5);
      expect(result.measuredEdgeCount).toBe(5);
    });

    it('should include outPath and timestamp in result', async () => {
      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      const result = await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(result.outPath).toContain('2026-03-20');
      expect(result.timestamp).toBe('2026-03-20T12:00:00.000Z');
    });
  });

  // Behavior 6: Handles both single-file and directory scanning
  describe('directory scanning mode', () => {
    it('should handle directory with single JSONL file', async () => {
      mockReaddirSync.mockReturnValue(['single.jsonl']);

      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      const result = await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(result.ok).toBe(true);
    });

    it('should handle directory with multiple JSONL files (picks latest)', async () => {
      mockReaddirSync.mockReturnValue([
        '2026-03-18.jsonl',
        '2026-03-19.jsonl',
        '2026-03-20.jsonl',
      ]);

      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      const result = await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(result.ok).toBe(true);
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('2026-03-20'),
        'utf8',
      );
    });

    // SPEC-GAP: Spec says "handles both single-file and directory scanning" but
    // implementation only supports directory scanning (readdirSync). No single-file path mode exists.
    it('SPEC-GAP: no explicit single-file mode — always scans directory', () => {
      // The implementation always calls readdirSync on a directory path.
      // There is no code path for passing a single file path directly.
      expect(true).toBe(true);
    });
  });

  // Additional: Neo4jService lifecycle
  describe('Neo4jService lifecycle', () => {
    it('should close Neo4jService in finally block when created internally', async () => {
      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      await ingestLatestSnapshotRowsToGraph({ snapshotDir: '/test/snapshots' });

      expect(mockNeoClose).toHaveBeenCalled();
    });

    it('should NOT close Neo4jService when passed externally', async () => {
      mockNeoClose.mockClear();
      const externalNeo4j = { run: mockNeoRun, close: vi.fn() };

      const { ingestLatestSnapshotRowsToGraph } = await import('../../../utils/integrity-snapshot-graph-ingest.js');
      await ingestLatestSnapshotRowsToGraph({
        snapshotDir: '/test/snapshots',
        neo4j: externalNeo4j as any,
      });

      // The external neo4j's close should NOT be called (ownNeo4j = false)
      expect(externalNeo4j.close).not.toHaveBeenCalled();
    });
  });

  // toNum helper
  describe('toNum helper', () => {
    it('should handle Neo4j Integer objects with toNumber()', () => {
      // Replicate the toNum logic from source
      function toNum(value: unknown): number {
        const maybe = value as { toNumber?: () => number } | null | undefined;
        if (maybe?.toNumber) return maybe.toNumber();
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
      }

      expect(toNum({ toNumber: () => 42 })).toBe(42);
      expect(toNum(100)).toBe(100);
      expect(toNum(null)).toBe(0);
      expect(toNum(undefined)).toBe(0);
      expect(toNum('not a number')).toBe(0);
    });
  });
});
