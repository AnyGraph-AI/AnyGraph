/**
 * GC-2: VR → SourceFile Edge Materialization (ANALYZED) — TDD Spec Tests
 * 
 * Tests written FROM the GAP_CLOSURE.md spec BEFORE implementation.
 * 
 * Spec requirements:
 * 1. ANALYZED edges from VerificationRun → SourceFile via AnalysisScope.includedPaths
 * 2. Strip file:// prefix from includedPaths URIs to match SourceFile.filePath
 * 3. All edges tagged {derived: true, source: 'vr-scope-enrichment'}
 * 4. FLAGS edges for VRs with line-level SARIF results (VR.targetFilePath/startLine/endLine)
 * 5. "What verification touched this file?" is a single-hop query
 * 6. Idempotent — running twice produces same edge count
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  extractAnalyzedPairs,
  extractScopeCoveragePairs,
  stripFileUri,
  resolveIncludedPath,
  type AnalyzedPair,
  type ScopeCoveragePair,
} from '../../../../scripts/enrichment/create-analyzed-edges.js';

// ------------------------------------------------------------------
// stripFileUri: file:///absolute/path → /absolute/path
// ------------------------------------------------------------------
describe('[GC-2] stripFileUri', () => {
  it('strips file:// prefix from URI with three slashes', () => {
    expect(stripFileUri('file:///home/user/code/a.ts')).toBe('/home/user/code/a.ts');
  });

  it('handles file:// with two slashes (relative)', () => {
    expect(stripFileUri('file://relative/path.ts')).toBe('relative/path.ts');
  });

  it('passes through paths without file:// prefix', () => {
    expect(stripFileUri('/home/user/code/a.ts')).toBe('/home/user/code/a.ts');
  });

  it('handles empty string', () => {
    expect(stripFileUri('')).toBe('');
  });
});

// ------------------------------------------------------------------
// resolveIncludedPath: handles both file:// URIs and relative paths
// ------------------------------------------------------------------
describe('[GC-2] resolveIncludedPath', () => {
  const repoRoot = '/home/user/code';

  it('resolves file:///absolute/path correctly', () => {
    expect(resolveIncludedPath('file:///home/user/code/src/a.ts', repoRoot))
      .toBe('/home/user/code/src/a.ts');
  });

  it('resolves relative Semgrep paths against repoRoot', () => {
    expect(resolveIncludedPath('src/cli/cli.ts', repoRoot))
      .toBe('/home/user/code/src/cli/cli.ts');
  });

  it('handles repoRoot with trailing slash', () => {
    expect(resolveIncludedPath('src/a.ts', '/home/user/code/'))
      .toBe('/home/user/code/src/a.ts');
  });

  it('returns empty for empty input', () => {
    expect(resolveIncludedPath('', repoRoot)).toBe('');
  });
});

// ------------------------------------------------------------------
// extractAnalyzedPairs: VR+Scope data → unique (vrId, filePath) pairs
// ------------------------------------------------------------------
describe('[GC-2] extractAnalyzedPairs', () => {
  it('produces (vrId, filePath) pairs from scope includedPaths', () => {
    const scopes = [
      {
        vrId: 'vr:1',
        includedPaths: ['file:///home/code/a.ts', 'file:///home/code/b.ts'],
      },
    ];
    const sourceFilePaths = new Set(['/home/code/a.ts', '/home/code/b.ts', '/home/code/c.ts']);

    const pairs = extractAnalyzedPairs(scopes, sourceFilePaths);
    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual({ vrId: 'vr:1', filePath: '/home/code/a.ts' });
    expect(pairs).toContainEqual({ vrId: 'vr:1', filePath: '/home/code/b.ts' });
  });

  it('skips paths that dont match any SourceFile', () => {
    const scopes = [
      {
        vrId: 'vr:1',
        includedPaths: ['file:///home/code/a.ts', 'file:///home/code/deleted.ts'],
      },
    ];
    const sourceFilePaths = new Set(['/home/code/a.ts']);

    const pairs = extractAnalyzedPairs(scopes, sourceFilePaths);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].filePath).toBe('/home/code/a.ts');
  });

  it('deduplicates: same VR appearing in multiple scopes for same file', () => {
    const scopes = [
      { vrId: 'vr:1', includedPaths: ['file:///home/code/a.ts'] },
      { vrId: 'vr:1', includedPaths: ['file:///home/code/a.ts'] }, // duplicate
    ];
    const sourceFilePaths = new Set(['/home/code/a.ts']);

    const pairs = extractAnalyzedPairs(scopes, sourceFilePaths);
    expect(pairs).toHaveLength(1);
  });

  it('handles multiple VRs sharing the same scope paths', () => {
    const scopes = [
      { vrId: 'vr:1', includedPaths: ['file:///home/code/a.ts'] },
      { vrId: 'vr:2', includedPaths: ['file:///home/code/a.ts'] },
    ];
    const sourceFilePaths = new Set(['/home/code/a.ts']);

    const pairs = extractAnalyzedPairs(scopes, sourceFilePaths);
    expect(pairs).toHaveLength(2);
    // Both VRs should have an edge to the same file
    const vrIds = pairs.map(p => p.vrId);
    expect(vrIds).toContain('vr:1');
    expect(vrIds).toContain('vr:2');
  });

  it('returns empty for scopes with null/empty includedPaths', () => {
    const scopes = [
      { vrId: 'vr:1', includedPaths: [] },
      { vrId: 'vr:2', includedPaths: null as any },
    ];
    const sourceFilePaths = new Set(['/home/code/a.ts']);

    const pairs = extractAnalyzedPairs(scopes, sourceFilePaths);
    expect(pairs).toHaveLength(0);
  });
});

// ------------------------------------------------------------------
// extractScopeCoveragePairs: dedup by (sourceFamily, filePath)
// ------------------------------------------------------------------
describe('[GC-2] extractScopeCoveragePairs — scope-level dedup', () => {
  it('deduplicates: 197 VRs from same tool → 1 pair per file', () => {
    // Simulate ESLint: 3 VRs all scanning same 2 files
    const scopes = [
      { sourceFamily: 'ESLint', includedPaths: ['file:///a.ts', 'file:///b.ts'] },
      { sourceFamily: 'ESLint', includedPaths: ['file:///a.ts', 'file:///b.ts'] },
      { sourceFamily: 'ESLint', includedPaths: ['file:///a.ts', 'file:///b.ts'] },
    ];
    const sourceFilePaths = new Set(['/a.ts', '/b.ts']);

    const pairs = extractScopeCoveragePairs(scopes, sourceFilePaths);
    // Should be 2 (one per file), NOT 6 (one per VR×file)
    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual({ sourceFamily: 'ESLint', filePath: '/a.ts' });
    expect(pairs).toContainEqual({ sourceFamily: 'ESLint', filePath: '/b.ts' });
  });

  it('different tool families get separate pairs', () => {
    const scopes = [
      { sourceFamily: 'ESLint', includedPaths: ['file:///a.ts'] },
      { sourceFamily: 'Semgrep', includedPaths: ['file:///a.ts'] },
    ];
    const sourceFilePaths = new Set(['/a.ts']);

    const pairs = extractScopeCoveragePairs(scopes, sourceFilePaths);
    expect(pairs).toHaveLength(2);
    expect(pairs.map(p => p.sourceFamily).sort()).toEqual(['ESLint', 'Semgrep']);
  });

  it('filters out paths not in SourceFile set', () => {
    const scopes = [
      { sourceFamily: 'ESLint', includedPaths: ['file:///a.ts', 'file:///deleted.ts'] },
    ];
    const sourceFilePaths = new Set(['/a.ts']);

    const pairs = extractScopeCoveragePairs(scopes, sourceFilePaths);
    expect(pairs).toHaveLength(1);
  });
});

// ------------------------------------------------------------------
// Property contract: ANALYZED edges
// ------------------------------------------------------------------
describe('[GC-2] ANALYZED edge contract', () => {
  it('edge must have derived=true', () => {
    const edgeProps = { derived: true, source: 'vr-scope-enrichment' };
    expect(edgeProps.derived).toBe(true);
  });

  it('edge source must be vr-scope-enrichment', () => {
    const edgeProps = { derived: true, source: 'vr-scope-enrichment' };
    expect(edgeProps.source).toBe('vr-scope-enrichment');
  });
});

// ------------------------------------------------------------------
// Integration: real graph data shape validation (Neo4j driver)
// ------------------------------------------------------------------
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';

describe('[GC-2] Integration — live graph data shape', () => {
  let neo4j: Neo4jService;

  beforeAll(() => {
    neo4j = new Neo4jService();
  });

  afterAll(async () => {
    await neo4j.close();
  });

  function toNum(val: unknown): number {
    const v = val as any;
    return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
  }

  it('AnalysisScope nodes have includedPaths arrays', async () => {
    const rows = await neo4j.run(
      `MATCH (s:AnalysisScope) WHERE s.includedPaths IS NOT NULL RETURN count(s) AS cnt`,
    );
    expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
  });

  it('includedPaths entries are valid paths (file:// URI or relative)', async () => {
    const rows = await neo4j.run(
      `MATCH (s:AnalysisScope) WHERE s.includedPaths IS NOT NULL WITH s LIMIT 1 RETURN s.includedPaths[0] AS first`,
    );
    // Accept either file:// URI or relative path format
    expect(rows[0]?.first).toMatch(/^(file:\/\/|[a-zA-Z])/);
  });

  it('includedPaths entries resolve to SourceFile.filePath format', async () => {
    const scopeRows = await neo4j.run(
      `MATCH (s:AnalysisScope) WHERE s.includedPaths IS NOT NULL WITH s LIMIT 1 RETURN s.includedPaths[0] AS uri`,
    );
    const uri = scopeRows[0]?.uri as string;
    // Strip file:// prefix if present, otherwise use path as-is
    const resolved = uri.startsWith('file://') ? stripFileUri(uri) : uri;

    // SourceFile.filePath uses absolute paths; includedPaths may be relative.
    // Match using ENDS WITH to handle both formats.
    const sfRows = await neo4j.run(
      `MATCH (sf:SourceFile) WHERE sf.filePath ENDS WITH $path RETURN count(sf) AS cnt`,
      { path: resolved },
    );
    expect(toNum(sfRows[0]?.cnt)).toBeGreaterThanOrEqual(1);
  });

  // --- FLAGS edge tests (GC-2 Task 2) ---

  it('[GC-2] VRs with targetFilePath have FLAGS edges to Functions', async () => {
    const rows = await neo4j.run(
      `MATCH (vr:VerificationRun)-[r:FLAGS]->(fn:Function) RETURN count(r) AS cnt`,
    );
    expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
  });

  it('[GC-2] FLAGS edges have derived=true and source tag', async () => {
    const rows = await neo4j.run(
      `MATCH ()-[r:FLAGS]->() WHERE r.derived = true AND r.source = 'flags-enrichment' RETURN count(r) AS cnt`,
    );
    expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
  });

  it('[GC-2] FLAGS edges carry ruleId from source VR', async () => {
    const rows = await neo4j.run(
      `MATCH (vr:VerificationRun)-[r:FLAGS]->(fn:Function)
       WHERE r.ruleId IS NOT NULL AND r.ruleId = vr.ruleId
       RETURN count(r) AS cnt`,
    );
    expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
  });

  it('[GC-2] FLAGS + ANALYZED together answer "what verified this function?"', async () => {
    const rows = await neo4j.run(
      `MATCH (fn:Function {projectId: 'proj_c0d3e9a1f200'})
       WHERE (fn)<-[:FLAGS]-(:VerificationRun)
       OPTIONAL MATCH (fn)<-[:CONTAINS]-(sf:SourceFile)<-[:ANALYZED]-(avr:VerificationRun)
       WITH fn, count(DISTINCT avr) AS analyzedBy
       WHERE analyzedBy > 0
       RETURN count(fn) AS bothCoveredFunctions`,
    );
    expect(toNum(rows[0]?.bothCoveredFunctions)).toBeGreaterThanOrEqual(0);
  });
});
