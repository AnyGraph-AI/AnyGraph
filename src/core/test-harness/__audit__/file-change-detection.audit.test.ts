/**
 * AUD-TC B6: src/core/utils/file-change-detection.ts — Behavioral Audit Tests
 * Fork: Drew/Jason origin
 *
 * Spec source: No formal spec — fork code. Incremental parsing infrastructure.
 * Accept: 9 behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// SPEC-GAP: No formal spec defines EXCLUDE_PATTERNS_REGEX content — depends on constants.ts
// SPEC-GAP: No spec defines hashFile algorithm (SHA-256 vs others) — relies on file-utils.ts
// SPEC-GAP: No spec defines behavior when Neo4j query itself fails (network error etc.)
// SPEC-GAP: No spec defines whether ENOENT during realpath (symlink resolution phase) should warn or silently skip

// We need to mock dependencies before importing the module under test
vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock('glob', () => ({
  glob: vi.fn(),
}));

vi.mock('../../constants.js', () => ({
  EXCLUDE_PATTERNS_GLOB: ['**/node_modules/**'],
  EXCLUDE_PATTERNS_REGEX: ['node_modules', '\\.test\\.ts$'],
}));

vi.mock('../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class {},
  QUERIES: {
    GET_SOURCE_FILE_TRACKING_INFO: 'MOCK_QUERY',
  },
}));

// hashFile lives in same directory as the file under test, so mock relative to that
const mockHashFileFn = vi.fn();
vi.mock('../../utils/file-utils.js', () => ({
  hashFile: (...args: any[]) => mockHashFileFn(...args),
}));

import { detectChangedFiles, type IndexedFileInfo } from '../../utils/file-change-detection.js';
import { stat, realpath } from 'fs/promises';
import { glob } from 'glob';

const mockStat = vi.mocked(stat);
const mockRealpath = vi.mocked(realpath);
const mockGlob = vi.mocked(glob);

const createMockNeo4j = (indexedFiles: IndexedFileInfo[] = []) => ({
  run: vi.fn().mockResolvedValue(indexedFiles),
});

describe('AUD-TC B6 | file-change-detection.ts', () => {
  const PROJECT_PATH = '/home/dev/project';
  const PROJECT_ID = 'proj_a1b2c3d4e5f6';

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: realpath resolves to same path (no symlinks)
    mockRealpath.mockImplementation(async (p: any) => String(p));
  });

  // ─── Behavior 1: New files (on disk but not in Neo4j) → filesToReparse ───
  describe('Behavior 1: new files detected', () => {
    it('returns new files in filesToReparse', async () => {
      mockGlob.mockResolvedValue(['src/new-file.ts'] as any);
      mockRealpath.mockImplementation(async (p: any) => String(p));
      const neo4j = createMockNeo4j([]);

      const result = await detectChangedFiles(PROJECT_PATH, neo4j as any, PROJECT_ID, { logWarnings: false });

      expect(result.filesToReparse).toContain(`${PROJECT_PATH}/src/new-file.ts`);
      expect(result.filesToDelete).toHaveLength(0);
    });
  });

  // ─── Behavior 2: Deleted files (in Neo4j but not on disk) → filesToDelete ─
  describe('Behavior 2: deleted files detected', () => {
    it('returns deleted files in filesToDelete', async () => {
      mockGlob.mockResolvedValue([] as any);
      const neo4j = createMockNeo4j([
        { filePath: '/home/dev/project/src/old-file.ts', mtime: 1000, size: 100, contentHash: 'abc123' },
      ]);

      const result = await detectChangedFiles(PROJECT_PATH, neo4j as any, PROJECT_ID, { logWarnings: false });

      expect(result.filesToDelete).toContain('/home/dev/project/src/old-file.ts');
      expect(result.filesToReparse).toHaveLength(0);
    });
  });

  // ─── Behavior 3: Unchanged files in neither list ────────────────────────
  describe('Behavior 3: unchanged files skipped', () => {
    it('skips files where mtime, size, and hash all match', async () => {
      const filePath = `${PROJECT_PATH}/src/stable.ts`;
      mockGlob.mockResolvedValue(['src/stable.ts'] as any);
      mockRealpath.mockImplementation(async (p: any) => String(p));
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 200 } as any);
      mockHashFileFn.mockResolvedValue('hash123');

      const neo4j = createMockNeo4j([
        { filePath, mtime: 1000, size: 200, contentHash: 'hash123' },
      ]);

      const result = await detectChangedFiles(PROJECT_PATH, neo4j as any, PROJECT_ID, { logWarnings: false });

      expect(result.filesToReparse).not.toContain(filePath);
      expect(result.filesToDelete).not.toContain(filePath);
    });
  });

  // ─── Behavior 4: Changed hash → filesToReparse even if mtime matches ───
  describe('Behavior 4: hash change triggers reparse', () => {
    it('detects changed hash even when mtime and size match', async () => {
      const filePath = `${PROJECT_PATH}/src/changed.ts`;
      mockGlob.mockResolvedValue(['src/changed.ts'] as any);
      mockRealpath.mockImplementation(async (p: any) => String(p));
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 200 } as any);
      mockHashFileFn.mockResolvedValue('new_hash');

      const neo4j = createMockNeo4j([
        { filePath, mtime: 1000, size: 200, contentHash: 'old_hash' },
      ]);

      const result = await detectChangedFiles(PROJECT_PATH, neo4j as any, PROJECT_ID, { logWarnings: false });

      expect(result.filesToReparse).toContain(filePath);
    });
  });

  // ─── Behavior 5: Exclude files matching EXCLUDE_PATTERNS_REGEX ──────────
  describe('Behavior 5: exclusion patterns', () => {
    it('excludes new files matching EXCLUDE_PATTERNS_REGEX', async () => {
      mockGlob.mockResolvedValue(['src/utils.test.ts'] as any);
      mockRealpath.mockImplementation(async (p: any) => String(p));
      const neo4j = createMockNeo4j([]);

      const result = await detectChangedFiles(PROJECT_PATH, neo4j as any, PROJECT_ID, { logWarnings: false });

      // .test.ts matches EXCLUDE_PATTERNS_REGEX pattern '\.test\.ts$'
      expect(result.filesToReparse).not.toContain(`${PROJECT_PATH}/src/utils.test.ts`);
    });
  });

  // ─── Behavior 6: SECURITY — symlinks outside project directory skipped ──
  describe('Behavior 6: symlink security', () => {
    it('skips files whose realpath resolves outside project directory', async () => {
      mockGlob.mockResolvedValue(['src/sneaky-link.ts'] as any);
      // Project realpath
      mockRealpath.mockImplementation(async (p: any) => {
        const ps = String(p);
        if (ps === PROJECT_PATH) return PROJECT_PATH;
        if (ps.includes('sneaky-link')) return '/etc/passwd'; // outside project!
        return ps;
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const neo4j = createMockNeo4j([]);

      const result = await detectChangedFiles(PROJECT_PATH, neo4j as any, PROJECT_ID, { logWarnings: true });

      expect(result.filesToReparse).not.toContain('/etc/passwd');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SECURITY'));
      warnSpy.mockRestore();
    });
  });

  // ─── Behavior 7: SECURITY — file paths resolved via realpath ────────────
  describe('Behavior 7: realpath resolution for Neo4j matching', () => {
    it('uses realpath-resolved paths for Neo4j comparison', async () => {
      const realFilePath = `${PROJECT_PATH}/src/actual.ts`;
      mockGlob.mockResolvedValue(['src/link.ts'] as any);
      mockRealpath.mockImplementation(async (p: any) => {
        const ps = String(p);
        if (ps === PROJECT_PATH) return PROJECT_PATH;
        if (ps.includes('link.ts')) return realFilePath;
        return ps;
      });
      mockStat.mockResolvedValue({ mtimeMs: 1000, size: 100 } as any);
      mockHashFileFn.mockResolvedValue('hash1');

      const neo4j = createMockNeo4j([
        { filePath: realFilePath, mtime: 1000, size: 100, contentHash: 'hash1' },
      ]);

      const result = await detectChangedFiles(PROJECT_PATH, neo4j as any, PROJECT_ID, { logWarnings: false });

      // Should match via realpath, so file is unchanged
      expect(result.filesToReparse).not.toContain(realFilePath);
      expect(result.filesToDelete).not.toContain(realFilePath);
    });
  });

  // ─── Behavior 8: ENOENT between glob and stat handled gracefully ────────
  describe('Behavior 8: ENOENT handling', () => {
    it('does not throw when file disappears between glob and stat', async () => {
      const filePath = `${PROJECT_PATH}/src/vanishing.ts`;
      mockGlob.mockResolvedValue(['src/vanishing.ts'] as any);
      mockRealpath.mockImplementation(async (p: any) => String(p));
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockStat.mockRejectedValue(enoent);

      const neo4j = createMockNeo4j([
        { filePath, mtime: 1000, size: 100, contentHash: 'abc' },
      ]);

      // Should not throw
      const result = await detectChangedFiles(PROJECT_PATH, neo4j as any, PROJECT_ID, { logWarnings: false });
      expect(result).toBeDefined();
    });
  });

  // ─── Behavior 9: EACCES assumes changed (added to reparse) ─────────────
  describe('Behavior 9: EACCES handling', () => {
    it('adds file to reparse when permission denied', async () => {
      const filePath = `${PROJECT_PATH}/src/locked.ts`;
      mockGlob.mockResolvedValue(['src/locked.ts'] as any);
      mockRealpath.mockImplementation(async (p: any) => String(p));
      const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      mockStat.mockRejectedValue(eacces);

      const neo4j = createMockNeo4j([
        { filePath, mtime: 1000, size: 100, contentHash: 'abc' },
      ]);

      const result = await detectChangedFiles(PROJECT_PATH, neo4j as any, PROJECT_ID, { logWarnings: false });

      expect(result.filesToReparse).toContain(filePath);
    });
  });
});
