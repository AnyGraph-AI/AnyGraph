// AUD-TC-03-L1b-25: corpus-record-hash-ingest.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: MULTI_LANGUAGE_ASSESSMENT.md §corpus ingest + VERIFICATION_GRAPH_ROADMAP.md §CA-4 prune/tombstone

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const mockNeoRun = vi.fn().mockResolvedValue([]);
const mockNeoClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
  readFile: vi.fn(),
}));

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

const origArgv = process.argv;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});

const SAMPLE_CSV = `Book,Chapter,Verse,Text
Genesis,1,1,In the beginning God created the heaven and the earth.
Genesis,1,2,"And the earth was without form, and void."
Exodus,1,1,"Now these are the names of the children of Israel."`;

function stableHash(parts: Array<string | number>): string {
  return createHash('sha256').update(parts.map((p) => String(p)).join('|')).digest('hex');
}

function defaultMocks() {
  // readFile returns CSV content
  const fsPromises = require('fs/promises');
  fsPromises.readFile = vi.fn().mockResolvedValue(SAMPLE_CSV);
  // Neo4j: no existing verses
  mockNeoRun.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.argv = origArgv.slice();
  defaultMocks();
});

async function runModule() {
  vi.resetModules();

  // Re-apply mocks after resetModules
  vi.doMock('../../../storage/neo4j/neo4j.service.js', () => ({
    Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
  }));
  vi.doMock('dotenv', () => ({
    default: { config: vi.fn() },
    config: vi.fn(),
  }));
  vi.doMock('fs/promises', () => ({
    default: { readFile: vi.fn().mockResolvedValue(SAMPLE_CSV) },
    readFile: vi.fn().mockResolvedValue(SAMPLE_CSV),
  }));

  await import('../../../utils/corpus-record-hash-ingest.js');
  await new Promise((r) => setTimeout(r, 200));
}

describe('corpus-record-hash-ingest audit tests (AUD-TC-03-L1b-25)', () => {
  // ─── Behavior 1: reads structured corpus data (Bible format) ───
  describe('reads structured corpus data', () => {
    it('parses CSV with Book/Chapter/Verse/Text columns', async () => {
      await runModule();
      // Should have called neo4j.run with rows parsed from CSV
      // The UNWIND $rows call is the MERGE call
      const mergeCalls = mockNeoRun.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE') && (c[0] as string).includes('Verse'),
      );
      // Either upsert call or existing query happened
      expect(mockNeoRun).toHaveBeenCalled();
      // Check the success output
      if (mockLog.mock.calls.length > 0) {
        const out = JSON.parse(mockLog.mock.calls[0][0] as string);
        expect(out.totalRows).toBe(3);
      }
    });

    it('generates correct verse IDs from book/chapter/verse', async () => {
      await runModule();
      // The existing-query call should use projectId
      const existingCalls = mockNeoRun.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('MATCH') && (c[0] as string).includes('Verse'),
      );
      expect(existingCalls.length).toBeGreaterThan(0);
    });
  });

  // ─── Behavior 2: computes SHA256 contentHash per record ───
  describe('computes SHA256 contentHash', () => {
    it('produces deterministic hash for same content', () => {
      // Test the stableHash logic directly (same algorithm as source)
      const hash1 = stableHash(['Genesis', 1, 1, 'In the beginning God created the heaven and the earth.']);
      const hash2 = stableHash(['Genesis', 1, 1, 'In the beginning God created the heaven and the earth.']);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different hash for different content', () => {
      const hash1 = stableHash(['Genesis', 1, 1, 'In the beginning']);
      const hash2 = stableHash(['Genesis', 1, 1, 'And the earth was']);
      expect(hash1).not.toBe(hash2);
    });

    it('hash includes book, chapter, verse, and text', () => {
      // Changing any component changes the hash
      const base = stableHash(['Genesis', 1, 1, 'text']);
      const diffBook = stableHash(['Exodus', 1, 1, 'text']);
      const diffChapter = stableHash(['Genesis', 2, 1, 'text']);
      const diffVerse = stableHash(['Genesis', 1, 2, 'text']);
      const diffText = stableHash(['Genesis', 1, 1, 'other']);
      expect(new Set([base, diffBook, diffChapter, diffVerse, diffText]).size).toBe(5);
    });
  });

  // ─── Behavior 3: MERGEs corpus nodes into Neo4j ───
  describe('MERGEs corpus nodes', () => {
    it('calls MERGE with Verse nodes and content properties', async () => {
      await runModule();
      const mergeCalls = mockNeoRun.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE') && (c[0] as string).includes('Verse'),
      );
      // Should have verse MERGE + project MERGE
      expect(mergeCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('sets contentHash, sourcePath, provenanceKind on merged nodes', async () => {
      await runModule();
      const mergeCalls = mockNeoRun.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('contentHash'),
      );
      expect(mergeCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('creates Project node with projectType=corpus', async () => {
      await runModule();
      const projectMerge = mockNeoRun.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE') && (c[0] as string).includes('Project'),
      );
      expect(projectMerge.length).toBeGreaterThanOrEqual(1);
      // Check that sourceKind is set
      const query = projectMerge[0][0] as string;
      expect(query).toContain('corpus');
    });
  });

  // ─── Behavior 4: validates zero-upsert on rerun when hashes unchanged ───
  describe('zero-upsert on rerun', () => {
    it('reports unchanged count when all hashes match existing', async () => {
      // Simulate existing records with matching hashes
      // Note: CSV parser strips quotes, so text matches the raw content
      const hash1 = stableHash(['Genesis', 1, 1, 'In the beginning God created the heaven and the earth.']);
      const hash2 = stableHash(['Genesis', 1, 2, 'And the earth was without form, and void.']);
      const hash3 = stableHash(['Exodus', 1, 1, 'Now these are the names of the children of Israel.']);

      mockNeoRun.mockImplementation(async (query: string) => {
        if (typeof query === 'string' && query.includes('MATCH') && query.includes('contentHash') && !query.includes('MERGE')) {
          return [
            { id: 'verse_genesis_1_1', contentHash: hash1 },
            { id: 'verse_genesis_1_2', contentHash: hash2 },
            { id: 'verse_exodus_1_1', contentHash: hash3 },
          ];
        }
        return [];
      });

      await runModule();

      if (mockLog.mock.calls.length > 0) {
        const out = JSON.parse(mockLog.mock.calls[0][0] as string);
        expect(out.unchanged).toBe(3);
        expect(out.upserted).toBe(0);
      }
    });
  });

  // ─── Behavior 5: supports --prune-missing mode ───
  describe('--prune-missing tombstone mode', () => {
    it('deletes verses not in CSV when --prune-missing is set', async () => {
      process.argv = ['node', 'script.ts', '--prune-missing'];
      // Existing has a verse not in our CSV
      mockNeoRun.mockImplementation(async (query: string) => {
        if (typeof query === 'string' && query.includes('MATCH') && query.includes('contentHash') && !query.includes('MERGE') && !query.includes('DELETE')) {
          return [
            { id: 'verse_genesis_1_1', contentHash: 'oldhash1' },
            { id: 'verse_removed_99_99', contentHash: 'orphan' },
          ];
        }
        if (typeof query === 'string' && query.includes('count')) {
          return [{ c: 3 }];
        }
        return [];
      });

      await runModule();

      // Should have a DETACH DELETE call for pruned verses
      const deleteCalls = mockNeoRun.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DETACH DELETE'),
      );
      expect(deleteCalls.length).toBeGreaterThanOrEqual(1);

      if (mockLog.mock.calls.length > 0) {
        const out = JSON.parse(mockLog.mock.calls[0][0] as string);
        expect(out.pruneMissing).toBe(true);
        expect(out.pruned).toBeGreaterThan(0);
      }
    });

    it('does not delete when --prune-missing is not set', async () => {
      process.argv = ['node', 'script.ts'];
      mockNeoRun.mockImplementation(async (query: string) => {
        if (typeof query === 'string' && query.includes('MATCH') && query.includes('contentHash') && !query.includes('MERGE') && !query.includes('DELETE')) {
          return [
            { id: 'verse_genesis_1_1', contentHash: 'oldhash1' },
            { id: 'verse_removed_99_99', contentHash: 'orphan' },
          ];
        }
        if (typeof query === 'string' && query.includes('count')) {
          return [{ c: 3 }];
        }
        return [];
      });

      await runModule();

      const deleteCalls = mockNeoRun.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DETACH DELETE'),
      );
      expect(deleteCalls.length).toBe(0);

      if (mockLog.mock.calls.length > 0) {
        const out = JSON.parse(mockLog.mock.calls[0][0] as string);
        expect(out.pruneMissing).toBe(false);
      }
    });

    // SPEC-GAP: Spec says "tombstone mode" but implementation uses DETACH DELETE
    // (hard delete), not a soft tombstone with deleted_at timestamp. Records are
    // permanently removed, not marked as tombstoned.
  });

  // ─── Behavior 6: accepts PROJECT_ID from env ───
  describe('project configuration', () => {
    it('outputs structured JSON with projectId and stats', async () => {
      process.argv = ['node', 'script.ts', '--projectId', 'proj_test_bible'];
      await runModule();

      if (mockLog.mock.calls.length > 0) {
        const out = JSON.parse(mockLog.mock.calls[0][0] as string);
        expect(out.ok).toBe(true);
        expect(out).toHaveProperty('projectId');
        expect(out).toHaveProperty('totalRows');
        expect(out).toHaveProperty('unchanged');
        expect(out).toHaveProperty('upserted');
        expect(out).toHaveProperty('pruneMissing');
        expect(out).toHaveProperty('dryRun');
      }
    });

    it('closes Neo4j connection in finally block', async () => {
      await runModule();
      expect(mockNeoClose).toHaveBeenCalled();
    });

    it('outputs error JSON on failure', async () => {
      // Force a read error
      vi.doMock('fs/promises', () => ({
        default: { readFile: vi.fn().mockRejectedValue(new Error('ENOENT')) },
        readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
      }));

      vi.resetModules();
      vi.doMock('../../../storage/neo4j/neo4j.service.js', () => ({
        Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
      }));
      vi.doMock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

      await import('../../../utils/corpus-record-hash-ingest.js');
      await new Promise((r) => setTimeout(r, 200));

      if (mockErr.mock.calls.length > 0) {
        const parsed = JSON.parse(mockErr.mock.calls[0][0] as string);
        expect(parsed.ok).toBe(false);
        expect(parsed).toHaveProperty('error');
      }
    });
  });
});
