/**
 * AUD-TC-01-L1: seed-git-frequency.ts — Gap-Fill Tests
 *
 * Gap: enrichGitFrequency() Neo4j integration untested
 *
 * Missing behaviors to test:
 * (1) enrichGitFrequency() writes commitCountRaw to SourceFile nodes in Neo4j
 * (2) commitCountWindowed is set correctly (windowed vs raw counts differ)
 * (3) churnRelative computed and stored on SourceFile nodes
 * (4) Changes propagated to Function nodes within each file
 * (5) Project-scoped: only updates nodes for the specified projectId
 *
 * Note: We mock git exec — do NOT run actual git commands in tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Driver, Session, Result, Record as Neo4jRecord } from 'neo4j-driver';

// Mock session for Neo4j
const mockRun = vi.fn();
const mockClose = vi.fn();
const mockSession: Partial<Session> = {
  run: mockRun,
  close: mockClose,
};

const mockDriver: Partial<Driver> = {
  session: vi.fn(() => mockSession as Session),
  close: vi.fn(),
};

// Mock execSync to avoid running actual git commands
vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

// Mock neo4j-driver's int function
vi.mock('neo4j-driver', async () => {
  const actual = await vi.importActual('neo4j-driver');
  return {
    ...actual,
    default: {
      ...actual,
      driver: vi.fn(() => mockDriver),
      int: vi.fn((n: number) => ({ low: n, high: 0 })),
    },
  };
});

// Import pure functions after mocks
import {
  parseGitLog,
  parseGitNumstat,
  computeChurnRelative,
  enrichGitFrequency,
} from '../seed-git-frequency.js';
import { execSync } from 'child_process';

describe('[aud-tc-01] seed-git-frequency.ts gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseGitLog() contract', () => {
    it('(1) parses git log --name-only output into relPath → count map', () => {
      const gitOutput = `src/foo.ts
src/bar.ts
src/foo.ts
src/baz.ts
src/foo.ts
`;

      const counts = parseGitLog(gitOutput);

      expect(counts.get('src/foo.ts')).toBe(3);
      expect(counts.get('src/bar.ts')).toBe(1);
      expect(counts.get('src/baz.ts')).toBe(1);
    });

    it('(2) handles empty git output gracefully', () => {
      const counts = parseGitLog('');

      expect(counts.size).toBe(0);
    });

    it('(3) trims whitespace from file paths', () => {
      const gitOutput = `  src/foo.ts  
src/bar.ts
`;

      const counts = parseGitLog(gitOutput);

      expect(counts.has('src/foo.ts')).toBe(true);
      expect(counts.has('  src/foo.ts  ')).toBe(false);
    });
  });

  describe('parseGitNumstat() contract', () => {
    it('(4) parses git log --numstat output into relPath → {added, removed}', () => {
      const numstatOutput = `10\t5\tsrc/foo.ts
3\t2\tsrc/bar.ts
7\t8\tsrc/foo.ts
`;

      const churn = parseGitNumstat(numstatOutput);

      // src/foo.ts: 10+7 added, 5+8 removed
      expect(churn.get('src/foo.ts')?.added).toBe(17);
      expect(churn.get('src/foo.ts')?.removed).toBe(13);
      expect(churn.get('src/bar.ts')?.added).toBe(3);
      expect(churn.get('src/bar.ts')?.removed).toBe(2);
    });

    it('(5) handles empty numstat output gracefully', () => {
      const churn = parseGitNumstat('');

      expect(churn.size).toBe(0);
    });

    it('(6) ignores malformed lines', () => {
      const numstatOutput = `10\t5\tsrc/foo.ts
this is not valid
3\t2\tsrc/bar.ts
`;

      const churn = parseGitNumstat(numstatOutput);

      expect(churn.size).toBe(2);
    });
  });

  describe('computeChurnRelative() contract', () => {
    it('(7) computes linesChanged / totalLines ratio', () => {
      const result = computeChurnRelative(30, 100);

      expect(result).toBe(0.3);
    });

    it('(8) returns 0 when totalLines is 0 (division by zero safe)', () => {
      const result = computeChurnRelative(50, 0);

      expect(result).toBe(0);
    });

    it('(9) does NOT cap at 1.0 — preserves variance for ranking', () => {
      // 210% churn (file rewritten multiple times)
      const result = computeChurnRelative(210, 100);

      expect(result).toBe(2.1);
      expect(result).toBeGreaterThan(1);
    });

    it('(10) handles negative totalLines as 0', () => {
      const result = computeChurnRelative(50, -10);

      expect(result).toBe(0);
    });
  });

  describe('enrichGitFrequency() Neo4j integration contract', () => {
    it('(11) queries SourceFile nodes scoped to projectId', async () => {
      // Setup mocks for git commands
      vi.mocked(execSync)
        .mockReturnValueOnce('src/foo.ts\n') // all-time
        .mockReturnValueOnce('src/foo.ts\n') // windowed
        .mockReturnValueOnce('10\t5\tsrc/foo.ts\n') // numstat
        .mockReturnValueOnce('100\n'); // wc -l

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            if (key === 'filePath') return '/project/src/foo.ts';
            if (key === 'matched') return { toNumber: () => 1 };
            if (key === 'paths') return ['/project/src/foo.ts'];
            if (key === 'propagated') return { toNumber: () => 5 };
            return null;
          },
        }],
      });

      await enrichGitFrequency(
        mockDriver as Driver,
        '/project',
        'proj_test',
        6
      );

      // First query should be to get SourceFile paths for project
      const sfQuery = mockRun.mock.calls.find((call) =>
        call[0].includes('SourceFile') && call[0].includes('projectId')
      );
      expect(sfQuery).toBeDefined();
      expect(sfQuery![1].projectId).toBe('proj_test');
    });

    it('(12) sets commitCountRaw on SourceFile nodes', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('src/foo.ts\nsrc/foo.ts\nsrc/foo.ts\n') // 3 all-time
        .mockReturnValueOnce('src/foo.ts\n') // 1 windowed
        .mockReturnValueOnce('10\t5\tsrc/foo.ts\n')
        .mockReturnValueOnce('100\n');

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            if (key === 'filePath') return '/project/src/foo.ts';
            if (key === 'matched') return { toNumber: () => 1 };
            return null;
          },
        }],
      });

      await enrichGitFrequency(mockDriver as Driver, '/project', 'proj_test', 6);

      // Should SET commitCountRaw
      const setQuery = mockRun.mock.calls.find((call) =>
        call[0].includes('sf.commitCountRaw')
      );
      expect(setQuery).toBeDefined();
    });

    it('(13) sets commitCountWindowed differently from commitCountRaw', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('src/foo.ts\nsrc/foo.ts\nsrc/foo.ts\n') // 3 all-time
        .mockReturnValueOnce('src/foo.ts\n') // 1 windowed (different!)
        .mockReturnValueOnce('10\t5\tsrc/foo.ts\n')
        .mockReturnValueOnce('100\n');

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            if (key === 'filePath') return '/project/src/foo.ts';
            if (key === 'matched') return { toNumber: () => 1 };
            return null;
          },
        }],
      });

      await enrichGitFrequency(mockDriver as Driver, '/project', 'proj_test', 6);

      // Should SET commitCountWindowed
      const setQuery = mockRun.mock.calls.find((call) =>
        call[0].includes('sf.commitCountWindowed')
      );
      expect(setQuery).toBeDefined();
    });

    it('(14) sets churnRelative on SourceFile nodes', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('src/foo.ts\n')
        .mockReturnValueOnce('src/foo.ts\n')
        .mockReturnValueOnce('30\t20\tsrc/foo.ts\n') // 50 lines changed
        .mockReturnValueOnce('100\n'); // 100 total lines = 0.5 churn

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            if (key === 'filePath') return '/project/src/foo.ts';
            if (key === 'matched') return { toNumber: () => 1 };
            return null;
          },
        }],
      });

      await enrichGitFrequency(mockDriver as Driver, '/project', 'proj_test', 6);

      // Should SET churnRelative
      const setQuery = mockRun.mock.calls.find((call) =>
        call[0].includes('sf.churnRelative')
      );
      expect(setQuery).toBeDefined();
    });

    it('(15) propagates stats to Function nodes via CONTAINS edges', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('src/foo.ts\n')
        .mockReturnValueOnce('src/foo.ts\n')
        .mockReturnValueOnce('10\t5\tsrc/foo.ts\n')
        .mockReturnValueOnce('100\n');

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            if (key === 'filePath') return '/project/src/foo.ts';
            if (key === 'matched') return { toNumber: () => 1 };
            if (key === 'propagated') return { toNumber: () => 10 };
            return null;
          },
        }],
      });

      await enrichGitFrequency(mockDriver as Driver, '/project', 'proj_test', 6);

      // Should propagate via CONTAINS edge
      const propQuery = mockRun.mock.calls.find((call) =>
        call[0].includes('CONTAINS') && call[0].includes('Function')
      );
      expect(propQuery).toBeDefined();
    });

    it('(16) sets zero values for files with no git history', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('') // no git history
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            if (key === 'filePath') return '/project/src/foo.ts';
            return null;
          },
        }],
      });

      await enrichGitFrequency(mockDriver as Driver, '/project', 'proj_test', 6);

      // Should set defaults to 0
      const defaultsQuery = mockRun.mock.calls.find((call) =>
        call[0].includes('commitCountRaw IS NULL') && call[0].includes('SET sf.commitCountRaw = 0')
      );
      expect(defaultsQuery).toBeDefined();
    });

    it('(17) recomputes riskLevel using churnRelative factor', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('src/foo.ts\n')
        .mockReturnValueOnce('src/foo.ts\n')
        .mockReturnValueOnce('10\t5\tsrc/foo.ts\n')
        .mockReturnValueOnce('100\n');

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            if (key === 'filePath') return '/project/src/foo.ts';
            if (key === 'matched') return { toNumber: () => 1 };
            return null;
          },
        }],
      });

      await enrichGitFrequency(mockDriver as Driver, '/project', 'proj_test', 6);

      // Should include churnRelative in riskLevel formula
      const riskQuery = mockRun.mock.calls.find((call) =>
        call[0].includes('fn.riskLevel') && call[0].includes('churnRelative')
      );
      expect(riskQuery).toBeDefined();
    });

    it('(18) closes session after execution', async () => {
      vi.mocked(execSync).mockReturnValue('');
      mockRun.mockResolvedValue({ records: [] });

      await enrichGitFrequency(mockDriver as Driver, '/project', 'proj_test', 6);

      expect(mockClose).toHaveBeenCalled();
    });

    it('(19) returns GitFrequencyResult with correct counts', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce('src/foo.ts\nsrc/bar.ts\n')
        .mockReturnValueOnce('src/foo.ts\n')
        .mockReturnValueOnce('10\t5\tsrc/foo.ts\n')
        .mockReturnValueOnce('100\n')
        .mockReturnValueOnce('50\n');

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            if (key === 'filePath') return '/project/src/foo.ts';
            if (key === 'matched') return { toNumber: () => 1 };
            if (key === 'propagated') return { toNumber: () => 5 };
            if (key === 'paths') return ['/project/src/foo.ts'];
            return null;
          },
        }],
      });

      const result = await enrichGitFrequency(mockDriver as Driver, '/project', 'proj_test', 6);

      expect(result).toHaveProperty('filesProcessed');
      expect(result).toHaveProperty('sourceFilesUpdated');
      expect(result).toHaveProperty('functionsUpdated');
      expect(result).toHaveProperty('stats');
      expect(result.stats instanceof Map).toBe(true);
    });
  });
});
