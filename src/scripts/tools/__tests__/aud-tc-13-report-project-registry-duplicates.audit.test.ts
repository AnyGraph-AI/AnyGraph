/**
 * [AUD-TC-13-L1-06] report-project-registry-duplicates.ts — Behavioral + Pure Function Tests
 *
 * Now importable (main() guarded). Tests mock Neo4jService + fs
 * to verify query, duplicate detection, file output, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
vi.mock('fs', () => ({
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
}));

// Mock Neo4jService
const mockRun = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.close = mockClose;
  }),
}));

import { main } from '../report-project-registry-duplicates.js';

// Re-implement toNum to test it independently (not exported)
function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

describe('[aud-tc-13] report-project-registry-duplicates.ts', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('main() — behavioral tests', () => {
    it('(1) queries Project nodes grouped by displayName for duplicates', async () => {
      mockRun.mockResolvedValueOnce([]);
      await main();
      const query = mockRun.mock.calls[0][0] as string;
      expect(query).toContain('MATCH (p:Project)');
      expect(query).toContain('displayName');
      expect(query).toContain('collect(DISTINCT p.projectId)');
      expect(query).toContain('size(projectIds) > 1');
    });

    it('(2) creates output directory recursively', async () => {
      mockRun.mockResolvedValueOnce([]);
      await main();
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('artifacts'),
        { recursive: true },
      );
    });

    it('(3) writes timestamped JSON report and latest symlink file', async () => {
      mockRun.mockResolvedValueOnce([]);
      await main();
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      // First: timestamped file
      const timestampedPath = mockWriteFileSync.mock.calls[0][0] as string;
      expect(timestampedPath).toContain('duplicate-display-names-');
      expect(timestampedPath).toContain('.json');
      // Second: latest file
      const latestPath = mockWriteFileSync.mock.calls[1][0] as string;
      expect(latestPath).toContain('duplicate-display-names-latest.json');
    });

    it('(4) report contains duplicate details when duplicates exist', async () => {
      mockRun.mockResolvedValueOnce([
        { displayName: 'MyProject', projectIds: ['proj_a', 'proj_b'], projectCount: 2 },
      ]);
      await main();
      const reportJson = mockWriteFileSync.mock.calls[0][1] as string;
      const report = JSON.parse(reportJson);
      expect(report.ok).toBe(true);
      expect(report.duplicateDisplayNameCount).toBe(1);
      expect(report.duplicates[0].displayName).toBe('MyProject');
      expect(report.duplicates[0].projectIds).toEqual(['proj_a', 'proj_b']);
      expect(report.duplicates[0].projectCount).toBe(2);
    });

    it('(5) outputs console JSON summary with paths', async () => {
      mockRun.mockResolvedValueOnce([]);
      await main();
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.ok).toBe(true);
      expect(output.duplicateDisplayNameCount).toBe(0);
      expect(output.outPath).toBeDefined();
      expect(output.latestPath).toBeDefined();
    });

    it('(6) handles empty results (no duplicates) gracefully', async () => {
      mockRun.mockResolvedValueOnce([]);
      await main();
      const reportJson = mockWriteFileSync.mock.calls[0][1] as string;
      const report = JSON.parse(reportJson);
      expect(report.duplicates).toEqual([]);
      expect(report.duplicateDisplayNameCount).toBe(0);
    });

    it('(7) orders results by projectCount DESC, displayName', async () => {
      mockRun.mockResolvedValueOnce([]);
      await main();
      const query = mockRun.mock.calls[0][0] as string;
      expect(query).toContain('ORDER BY projectCount DESC, displayName');
    });

    it('(8) closes Neo4j in finally block even on error', async () => {
      mockRun.mockRejectedValueOnce(new Error('query failed'));
      await expect(main()).rejects.toThrow('query failed');
      expect(mockClose).toHaveBeenCalledOnce();
    });
  });

  describe('toNum — pure function logic (reimplemented)', () => {
    it('handles plain numbers', () => {
      expect(toNum(42)).toBe(42);
      expect(toNum(0)).toBe(0);
    });

    it('handles Neo4j Integer with toNumber()', () => {
      expect(toNum({ toNumber: () => 7 })).toBe(7);
    });

    it('falls back to Number() for strings', () => {
      expect(toNum('123')).toBe(123);
    });

    it('returns 0 for non-finite values', () => {
      expect(toNum(null)).toBe(0);
      expect(toNum(undefined)).toBe(0);
      expect(toNum('not-a-number')).toBe(0);
    });
  });
});
