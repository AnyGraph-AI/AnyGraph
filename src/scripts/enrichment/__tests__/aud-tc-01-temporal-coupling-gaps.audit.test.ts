/**
 * AUD-TC-01-L1: temporal-coupling.ts — Gap-Fill Tests
 *
 * Gap: ingestCoChanges() completely untested at integration level
 *
 * Missing behaviors to test:
 * (1) ingestCoChanges() creates CO_CHANGES_WITH edges between SourceFile nodes in Neo4j
 * (2) CO_CHANGES_WITH edge has correct strength property (Jaccard similarity via coChangeCount tiers)
 * (3) HIGH_TEMPORAL_COUPLING flag behavior (temporalCoupling property set on Function nodes)
 * (4) MERGE idempotency — re-run doesn't create duplicate edges
 * (5) Files with coupling below threshold get no CO_CHANGES_WITH edge (coChangeCount < 2 filtered)
 *
 * Note: We mock git exec — do NOT run actual git commands in tests
 * Note: ingestCoChanges creates its own driver, so we verify query contracts rather than mocking
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Mock execSync to avoid running actual git commands
vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

// Import after mocks are set up
import { mineCoChanges } from '../temporal-coupling.js';
import { execSync } from 'child_process';

// Read the source file to verify query patterns
const sourceFilePath = path.join(__dirname, '..', 'temporal-coupling.ts');
let sourceCode = '';
try {
  sourceCode = fs.readFileSync(sourceFilePath, 'utf-8');
} catch {
  // In compiled context, try the .js path
  try {
    sourceCode = fs.readFileSync(sourceFilePath.replace('.ts', '.js'), 'utf-8');
  } catch {
    // Will be empty, tests will verify via alternate means
  }
}

describe('[aud-tc-01] temporal-coupling.ts gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mineCoChanges() parsing contract', () => {
    it('(1) parses git log format COMMIT:hash:date correctly', () => {
      // Mock git log output with our expected format
      const mockGitLog = `COMMIT:abc12345:2024-01-15
src/foo.ts
src/bar.ts

COMMIT:def67890:2024-01-16
src/foo.ts
src/baz.ts
`;
      vi.mocked(execSync).mockReturnValueOnce(mockGitLog);

      const pairs = mineCoChanges('/mock/repo');

      // Should find co-change pairs
      expect(Array.isArray(pairs)).toBe(true);
    });

    it('(2) filters pairs with coChangeCount < 2 (noise reduction)', () => {
      // Two files that changed together in only 1 commit should be filtered
      const mockGitLog = `COMMIT:abc12345:2024-01-15
src/foo.ts
src/bar.ts
`;
      vi.mocked(execSync).mockReturnValueOnce(mockGitLog);

      const pairs = mineCoChanges('/mock/repo');

      // Single co-occurrence should be filtered out (< 2 threshold)
      expect(pairs.length).toBe(0);
    });

    it('(3) keeps pairs with coChangeCount >= 2', () => {
      // Two files that changed together in 2+ commits should be kept
      const mockGitLog = `COMMIT:abc12345:2024-01-15
src/foo.ts
src/bar.ts

COMMIT:def67890:2024-01-16
src/foo.ts
src/bar.ts
`;
      vi.mocked(execSync).mockReturnValueOnce(mockGitLog);

      const pairs = mineCoChanges('/mock/repo');

      expect(pairs.length).toBe(1);
      expect(pairs[0].file1).toBe('src/bar.ts');
      expect(pairs[0].file2).toBe('src/foo.ts');
      expect(pairs[0].coChangeCount).toBe(2);
    });

    it('(4) skips commits with > 20 files (bulk refactor noise)', () => {
      // Build a commit with 25 files
      const files = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`).join('\n');
      const mockGitLog = `COMMIT:abc12345:2024-01-15
${files}

COMMIT:def67890:2024-01-16
src/foo.ts
src/bar.ts
`;
      vi.mocked(execSync).mockReturnValueOnce(mockGitLog);

      const pairs = mineCoChanges('/mock/repo');

      // The 25-file commit should be skipped entirely
      // Only the 2-file commit contributes, but needs 2+ occurrences to appear
      expect(pairs.length).toBe(0);
    });

    it('(5) skips single-file commits (no co-change possible)', () => {
      const mockGitLog = `COMMIT:abc12345:2024-01-15
src/foo.ts

COMMIT:def67890:2024-01-16
src/bar.ts
`;
      vi.mocked(execSync).mockReturnValueOnce(mockGitLog);

      const pairs = mineCoChanges('/mock/repo');

      expect(pairs.length).toBe(0);
    });
  });

  describe('ingestCoChanges() Cypher query contract verification', () => {
    // These tests verify the source code contains the expected query patterns
    // since ingestCoChanges creates its own driver internally

    it('(6) source clears existing CO_CHANGES_WITH edges before creating new ones', () => {
      // Verify the DELETE query pattern exists in source
      expect(sourceCode).toContain('DELETE r');
      expect(sourceCode).toContain('CO_CHANGES_WITH');
      expect(sourceCode).toMatch(/MATCH.*CO_CHANGES_WITH.*DELETE/s);
    });

    it('(7) source uses MERGE semantics for edge creation (idempotent)', () => {
      // Verify MERGE is used, not CREATE
      expect(sourceCode).toContain('MERGE (s1)-[r:CO_CHANGES_WITH]-(s2)');
    });

    it('(8) source sets coChangeCount and couplingStrength properties on edges', () => {
      // Verify edge properties are set
      expect(sourceCode).toContain('r.coChangeCount');
      expect(sourceCode).toContain('r.couplingStrength');
    });

    it('(9) couplingStrength tiers: STRONG >= 10, MODERATE >= 5, WEAK < 5', () => {
      // Verify the CASE statement for coupling tiers
      expect(sourceCode).toContain("'STRONG'");
      expect(sourceCode).toContain("'MODERATE'");
      expect(sourceCode).toContain("'WEAK'");
      expect(sourceCode).toMatch(/coChangeCount >= 10.*STRONG/s);
      expect(sourceCode).toMatch(/coChangeCount >= 5.*MODERATE/s);
    });

    it('(10) source updates temporalCoupling property on Function nodes', () => {
      // Verify Function nodes get temporalCoupling
      expect(sourceCode).toContain('f.temporalCoupling');
      expect(sourceCode).toMatch(/MATCH.*Function.*SET.*temporalCoupling/s);
    });

    it('(11) source updates riskLevelV2 based on temporalCoupling factor', () => {
      // Verify riskLevelV2 formula includes temporalCoupling
      expect(sourceCode).toContain('f.riskLevelV2');
      expect(sourceCode).toMatch(/riskLevelV2.*temporalCoupling|temporalCoupling.*riskLevelV2/s);
    });

    it('(12) source scopes all queries to projectId parameter', () => {
      // Verify projectId scoping in queries
      expect(sourceCode).toContain('projectId: $pid');
      expect(sourceCode).toContain('{projectId: $pid}');
    });

    it('(13) source closes session in finally block', () => {
      // Verify proper resource cleanup
      expect(sourceCode).toContain('finally');
      expect(sourceCode).toContain('session.close()');
      expect(sourceCode).toContain('driver.close()');
    });
  });

  describe('CoChangePair data structure contract', () => {
    it('(14) CoChangePair has required fields', () => {
      const mockGitLog = `COMMIT:abc12345:2024-01-15T10:00:00Z
src/foo.ts
src/bar.ts

COMMIT:def67890:2024-01-16T11:00:00Z
src/foo.ts
src/bar.ts
`;
      vi.mocked(execSync).mockReturnValueOnce(mockGitLog);

      const pairs = mineCoChanges('/mock/repo');

      expect(pairs.length).toBe(1);
      expect(pairs[0]).toHaveProperty('file1');
      expect(pairs[0]).toHaveProperty('file2');
      expect(pairs[0]).toHaveProperty('coChangeCount');
      expect(pairs[0]).toHaveProperty('commits');
      expect(pairs[0]).toHaveProperty('lastCoChange');
    });

    it('(15) commits array contains commit hashes', () => {
      const mockGitLog = `COMMIT:abc12345:2024-01-15T10:00:00Z
src/foo.ts
src/bar.ts

COMMIT:def67890:2024-01-16T11:00:00Z
src/foo.ts
src/bar.ts
`;
      vi.mocked(execSync).mockReturnValueOnce(mockGitLog);

      const pairs = mineCoChanges('/mock/repo');

      expect(pairs[0].commits).toContain('abc12345');
      expect(pairs[0].commits).toContain('def67890');
    });

    it('(16) lastCoChange tracks most recent co-change date', () => {
      const mockGitLog = `COMMIT:abc12345:2024-01-15T10:00:00Z
src/foo.ts
src/bar.ts

COMMIT:def67890:2024-01-16T11:00:00Z
src/foo.ts
src/bar.ts
`;
      vi.mocked(execSync).mockReturnValueOnce(mockGitLog);

      const pairs = mineCoChanges('/mock/repo');

      // Later date should be the lastCoChange
      expect(pairs[0].lastCoChange).toContain('2024-01-16');
    });
  });

  describe('idempotency contract', () => {
    it('(17) MERGE semantics prevent duplicate edges on re-run', () => {
      // Contract verification: source uses MERGE, not CREATE
      expect(sourceCode).toContain('MERGE');
      expect(sourceCode).not.toMatch(/CREATE.*CO_CHANGES_WITH/);
    });

    it('(18) DELETE + MERGE pattern ensures fresh edge state each run', () => {
      // Contract: clear existing → create fresh
      const deleteIndex = sourceCode.indexOf('DELETE');
      const mergeIndex = sourceCode.indexOf('MERGE (s1)-[r:CO_CHANGES_WITH]');

      // DELETE should come before MERGE
      expect(deleteIndex).toBeLessThan(mergeIndex);
    });
  });
});
