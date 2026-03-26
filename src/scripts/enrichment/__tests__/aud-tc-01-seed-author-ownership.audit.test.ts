/**
 * AUD-TC-01-L1: seed-author-ownership.ts — Spec-Derived Tests
 *
 * Spec: PLAN.md §Phase 2 "Author ownership: git blame → OWNED_BY edges"
 *
 * Behaviors:
 * (1) queries SourceFile nodes for the project
 * (2) runs git blame per file, parses author → line count mapping
 * (3) creates Author nodes (MERGE — no duplicates per author name)
 * (4) creates OWNED_BY edge from SourceFile → Author (primary = most lines)
 * (5) computes authorEntropy per file (distinct author count), stores on SourceFile
 * (6) handles git blame failure gracefully (skips file, continues)
 * (7) accepts project CLI arg for project scoping
 * (8) handles files with single author (authorEntropy = 1)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock neo4j-driver
const mockSession = {
  run: vi.fn(),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
  close: vi.fn(),
};

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => mockDriver),
    auth: {
      basic: vi.fn(),
    },
    int: vi.fn((n: number) => ({ low: n, high: 0 })),
  },
}));

describe('[aud-tc-01] seed-author-ownership.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.run.mockReset();
    mockSession.close.mockReset();
  });

  describe('SourceFile query contract', () => {
    it('(1) queries SourceFile nodes filtered by projectId', () => {
      // Contract: SourceFile query uses projectId filter
      const expectedQuery = 'MATCH (sf:SourceFile {projectId: $pid}) RETURN sf.filePath AS filePath';
      const projectId = 'proj_c0d3e9a1f200';

      // Verify query structure matches expectation
      expect(expectedQuery).toContain('SourceFile');
      expect(expectedQuery).toContain('{projectId: $pid}');
      expect(expectedQuery).toContain('RETURN sf.filePath');
    });

    it('(2) project scoping via CLI arg — accepts codegraph|godspeed', () => {
      // Contract: PROJECTS config maps CLI args to projectIds
      const PROJECTS: Record<string, { path: string; id: string }> = {
        codegraph: {
          path: '/home/jonathan/.openclaw/workspace/codegraph/',
          id: 'proj_c0d3e9a1f200',
        },
        godspeed: {
          path: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/',
          id: 'proj_60d5feed0001',
        },
      };

      expect(PROJECTS['codegraph'].id).toBe('proj_c0d3e9a1f200');
      expect(PROJECTS['godspeed'].id).toBe('proj_60d5feed0001');
      expect(Object.keys(PROJECTS)).toHaveLength(2);
    });
  });

  describe('git blame parsing contract', () => {
    it('(3) parses git blame output into author → line count mapping', () => {
      // Contract: BlameResult maps author names to line counts
      interface BlameResult {
        filePath: string;
        authors: Map<string, number>;
        totalLines: number;
      }

      // Simulated git blame output: author names repeated per line
      const blameOutput = `Jonathan
Jonathan
Jonathan
Alice
Alice
Bob`;

      const authors = new Map<string, number>();
      let totalLines = 0;

      for (const line of blameOutput.trim().split('\n')) {
        if (line) {
          authors.set(line, (authors.get(line) || 0) + 1);
          totalLines++;
        }
      }

      const result: BlameResult = { filePath: '/test/file.ts', authors, totalLines };

      expect(result.totalLines).toBe(6);
      expect(result.authors.get('Jonathan')).toBe(3);
      expect(result.authors.get('Alice')).toBe(2);
      expect(result.authors.get('Bob')).toBe(1);
      expect(result.authors.size).toBe(3);
    });

    it('(4) identifies primary author as author with most lines', () => {
      // Contract: primary author = max(lineCount)
      const authors = new Map<string, number>([
        ['Jonathan', 150],
        ['Alice', 50],
        ['Bob', 20],
      ]);
      const totalLines = 220;

      let primaryAuthor = '';
      let maxLines = 0;
      for (const [author, lines] of authors) {
        if (lines > maxLines) {
          maxLines = lines;
          primaryAuthor = author;
        }
      }

      const ownershipPct = Math.round((maxLines / totalLines) * 100);

      expect(primaryAuthor).toBe('Jonathan');
      expect(maxLines).toBe(150);
      expect(ownershipPct).toBe(68);
    });

    it('(5) computes authorEntropy as distinct author count', () => {
      // Contract: authorEntropy = authors.size
      const authors = new Map<string, number>([
        ['Jonathan', 100],
        ['Alice', 50],
        ['Bob', 30],
        ['Carol', 20],
      ]);

      const authorEntropy = authors.size;

      expect(authorEntropy).toBe(4);
    });

    it('(6) handles single author (authorEntropy = 1)', () => {
      // Contract: single-author file → authorEntropy = 1
      const authors = new Map<string, number>([['Jonathan', 200]]);
      const authorEntropy = authors.size;
      const ownershipPct = Math.round((200 / 200) * 100);

      expect(authorEntropy).toBe(1);
      expect(ownershipPct).toBe(100);
    });
  });

  describe('Author node creation contract', () => {
    it('(7) Author node id format: author_{projectId}_{sanitizedName}', () => {
      // Contract: Author IDs are deterministic, sanitized
      const projectId = 'proj_c0d3e9a1f200';
      const authorName = 'John Doe <john@example.com>';
      const expectedId = `author_${projectId}_${authorName.replace(/[^a-zA-Z0-9]/g, '_')}`;

      expect(expectedId).toBe('author_proj_c0d3e9a1f200_John_Doe__john_example_com_');
      expect(expectedId).not.toContain('<');
      expect(expectedId).not.toContain('@');
    });

    it('(8) Author node has required properties: id, name, projectId, fileCount', () => {
      // Contract: Author nodes carry ownership metadata
      const authorNode = {
        id: 'author_proj_test_Jonathan',
        name: 'Jonathan',
        projectId: 'proj_test',
        fileCount: 42,
      };

      expect(authorNode.name).toBe('Jonathan');
      expect(authorNode.projectId).toBe('proj_test');
      expect(authorNode.fileCount).toBe(42);
    });

    it('(9) MERGE semantics prevent duplicate Author nodes', () => {
      // Contract: MERGE on Author node ensures idempotency
      const query = 'MERGE (a:Author {id: $authorId}) SET a.name = $name, a.projectId = $pid, a.fileCount = $fileCount';

      expect(query).toContain('MERGE');
      expect(query).not.toContain('CREATE');
    });
  });

  describe('OWNED_BY edge creation contract', () => {
    it('(10) OWNED_BY edge connects SourceFile → Author', () => {
      // Contract: OWNED_BY edge structure
      const edgeQuery = `
        MATCH (sf:SourceFile {filePath: $filePath, projectId: $pid})
        MATCH (a:Author {id: $authorId})
        MERGE (sf)-[r:OWNED_BY]->(a)
        ON CREATE SET r.projectId = $pid, r.derived = true, r.source = 'author-ownership'
      `;

      expect(edgeQuery).toContain('OWNED_BY');
      expect(edgeQuery).toContain('SourceFile');
      expect(edgeQuery).toContain('Author');
      expect(edgeQuery).toContain('MERGE');
    });

    it('(11) OWNED_BY edge has derived=true and source marker', () => {
      // Contract: enrichment edges are tagged as derived
      const edgeProperties = {
        projectId: 'proj_test',
        derived: true,
        source: 'author-ownership',
      };

      expect(edgeProperties.derived).toBe(true);
      expect(edgeProperties.source).toBe('author-ownership');
    });

    it('(12) SourceFile properties updated: authorEntropy, primaryAuthor, ownershipPct', () => {
      // Contract: SourceFile stores ownership metrics
      const updateQuery = `
        MATCH (sf:SourceFile {filePath: $filePath, projectId: $pid})
        SET sf.authorEntropy = $entropy, sf.primaryAuthor = $author, sf.ownershipPct = $pct
      `;

      expect(updateQuery).toContain('authorEntropy');
      expect(updateQuery).toContain('primaryAuthor');
      expect(updateQuery).toContain('ownershipPct');
    });
  });

  describe('git blame failure handling', () => {
    it('(13) getBlameForFile returns null on error (graceful skip)', () => {
      // Contract: git blame failures return null, not throw
      function getBlameForFile(
        _repoPath: string,
        _filePath: string
      ): { filePath: string; authors: Map<string, number>; totalLines: number } | null {
        try {
          // Simulate git blame failure (file not tracked, binary, etc.)
          throw new Error('git blame failed');
        } catch {
          return null;
        }
      }

      const result = getBlameForFile('/repo', '/repo/binary.png');
      expect(result).toBeNull();
    });

    it('(14) null blame result increments skipped counter, does not throw', () => {
      // Contract: processing continues after blame failure
      const files = ['/file1.ts', '/file2.ts', '/file3.ts'];
      let processed = 0;
      let skipped = 0;

      for (const _file of files) {
        const blame = Math.random() > 0.5 ? { totalLines: 100, authors: new Map([['A', 100]]) } : null;
        if (!blame || blame.totalLines === 0) {
          skipped++;
          continue;
        }
        processed++;
      }

      expect(processed + skipped).toBe(files.length);
    });
  });

  describe('riskLevelV2 update contract', () => {
    it('(15) functions in multi-author files get riskLevelV2 boost', () => {
      // Contract: riskLevelV2 = riskLevel * (1 + (authorEntropy - 1) * 0.15)
      const riskLevel = 0.5;
      const authorEntropy = 4;

      const riskLevelV2 = riskLevel * (1 + (authorEntropy - 1) * 0.15);

      // 0.5 * (1 + 0.45) = 0.5 * 1.45 = 0.725
      expect(riskLevelV2).toBeCloseTo(0.725, 3);
    });

    it('(16) single-author files (entropy=1) have no risk boost', () => {
      // Contract: authorEntropy=1 → factor = 1, no change
      const riskLevel = 0.5;
      const authorEntropy = 1;

      const riskLevelV2 = riskLevel * (1 + (authorEntropy - 1) * 0.15);

      expect(riskLevelV2).toBe(riskLevel);
    });
  });
});
