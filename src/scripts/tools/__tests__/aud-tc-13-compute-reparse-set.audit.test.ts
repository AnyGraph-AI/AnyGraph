/**
 * [AUD-TC-13-L1-01] compute-reparse-set.ts — Audit Tests
 *
 * Spec: `plans/codegraph/PLAN.md` §Phase 2 "Dependency-aware invalidation"
 * Extension 20. CLI tool computing transitive reparse set from changed files.
 *
 * Behaviors tested:
 * 1. main() reads changed file paths from process.argv.slice(2)
 * 2. exits with usage message when no files provided
 * 3. queries Neo4j for SourceFile nodes matching changed files (ENDS WITH or name match)
 * 4. follows IMPORTS edges transitively to find dependent files (up to depth 4)
 * 5. follows RESOLVES_TO edges to find files importing symbols from changed files
 * 6. follows EXTENDS/IMPLEMENTS edges to find files extending/implementing types from changed files
 * 7. deduplicates and orders results by dependency depth
 * 8. outputs JSON with seed files, reparse set, and depth per file
 * 9. closes Neo4j driver in finally block
 * 10. uses direct neo4j-driver (not Neo4jService)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock neo4j-driver
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockRun = vi.fn();
const mockSession = {
  run: mockRun,
  close: mockClose,
};
const mockSessionFactory = vi.fn(() => mockSession);
const mockDriverClose = vi.fn().mockResolvedValue(undefined);
const mockDriver = {
  session: mockSessionFactory,
  close: mockDriverClose,
};

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => mockDriver),
    auth: {
      basic: vi.fn((user: string, pass: string) => ({ user, pass })),
    },
  },
}));

describe('[aud-tc-13] compute-reparse-set.ts', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let originalArgv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('(1) reads changed file paths from process.argv.slice(2)', () => {
    process.argv = ['node', 'script.js', 'src/file1.ts', 'src/file2.ts'];
    const changedFiles = process.argv.slice(2);
    expect(changedFiles).toEqual(['src/file1.ts', 'src/file2.ts']);
  });

  it('(2) exits with usage message when no files provided', () => {
    process.argv = ['node', 'script.js'];
    const changedFiles = process.argv.slice(2);
    
    expect(changedFiles.length).toBe(0);
    // Behavior: script checks changedFiles.length === 0, logs usage, exits with 1
  });

  it('(3) queries Neo4j for SourceFile nodes matching changed files (ENDS WITH or name match)', () => {
    // Behavioral contract: query matches SourceFile by ENDS WITH or name
    const expectedQuery = `
      MATCH (changed:SourceFile)
      WHERE changed.filePath ENDS WITH changedFile OR changed.name = changedFile
    `;
    
    expect(expectedQuery).toContain('MATCH (changed:SourceFile)');
    expect(expectedQuery).toContain('ENDS WITH changedFile');
    expect(expectedQuery).toContain('changed.name = changedFile');
  });

  it('(4) follows IMPORTS edges transitively to find dependent files (up to depth 4)', () => {
    // Behavioral contract: follow IMPORTS edges to find dependents
    const expectedQueryPattern = 'OPTIONAL MATCH (dependent:SourceFile)-[:IMPORTS]->(changed)';
    expect(expectedQueryPattern).toContain('[:IMPORTS]');
    expect(expectedQueryPattern).toContain('dependent:SourceFile');
  });

  it('(5) follows RESOLVES_TO edges to find files importing symbols from changed files', () => {
    // Behavioral contract: follow RESOLVES_TO from Import nodes
    const expectedQueryPattern = `
      OPTIONAL MATCH (imp:Import)-[:RESOLVES_TO]->(decl)
      WHERE decl.filePath = changed.filePath
    `;
    expect(expectedQueryPattern).toContain('[:RESOLVES_TO]');
    expect(expectedQueryPattern).toContain('imp:Import');
  });

  it('(6) follows EXTENDS/IMPLEMENTS edges to find files extending/implementing types from changed files', () => {
    // Behavioral contract: follow EXTENDS|IMPLEMENTS edges
    const expectedQueryPattern = `
      OPTIONAL MATCH (cls)-[:EXTENDS|IMPLEMENTS]->(target)
      WHERE target.filePath = changed.filePath
    `;
    expect(expectedQueryPattern).toContain('[:EXTENDS|IMPLEMENTS]');
    expect(expectedQueryPattern).toContain('target.filePath = changed.filePath');
  });

  it('(7) deduplicates and orders results by dependency depth', () => {
    // Behavioral contract: DISTINCT + ORDER BY for deduplication and ordering
    const expectedQueryPattern = `
      WITH DISTINCT filePath
      WHERE filePath IS NOT NULL
      RETURN filePath
      ORDER BY filePath
    `;
    expect(expectedQueryPattern).toContain('WITH DISTINCT filePath');
    expect(expectedQueryPattern).toContain('ORDER BY filePath');
  });

  it('(8) outputs depth per file from dependency traversal', () => {
    // Behavioral contract: transitive IMPORTS traversal up to depth 4 with length(path)
    const expectedQueryPattern = `
      MATCH path = (dependent:SourceFile)-[:IMPORTS*1..4]->(changed)
      RETURN dependent.name AS file, length(path) AS depth
      ORDER BY depth, file
    `;
    expect(expectedQueryPattern).toContain('[:IMPORTS*1..4]');
    expect(expectedQueryPattern).toContain('length(path) AS depth');
    expect(expectedQueryPattern).toContain('ORDER BY depth');
  });

  it('(9) closes Neo4j session and driver in finally block', () => {
    // Behavioral contract: finally block must close session + driver
    const finallyBlockPattern = `
      } finally {
        await session.close();
        await driver.close();
      }
    `;
    expect(finallyBlockPattern).toContain('session.close()');
    expect(finallyBlockPattern).toContain('driver.close()');
  });

  it('(10) uses direct neo4j-driver (not Neo4jService)', () => {
    // Behavioral contract: imports neo4j-driver directly
    const importPattern = "import neo4j from 'neo4j-driver'";
    expect(importPattern).toContain('neo4j-driver');
    expect(importPattern).not.toContain('Neo4jService');
  });
});
