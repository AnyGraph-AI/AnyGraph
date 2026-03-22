/**
 * UI-7 Task 5: Filename Disambiguation — Spec Tests
 *
 * Verifies the shortestUniqueSuffix utility:
 * - Unique basenames return just the basename
 * - Duplicate basenames get shortest disambiguating prefix
 * - Edge cases: empty list, single entry, deeply nested duplicates
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── shortestUniqueSuffix utility ────────────────────────────

describe('[UI-7] shortestUniqueSuffix utility', () => {
  it('exports shortestUniqueSuffix', async () => {
    const mod = await import('@/lib/filename-disambig');
    expect(mod.shortestUniqueSuffix).toBeDefined();
    expect(typeof mod.shortestUniqueSuffix).toBe('function');
  });

  it('returns empty map for empty input', async () => {
    const { shortestUniqueSuffix } = await import('@/lib/filename-disambig');
    const result = shortestUniqueSuffix([]);
    expect(result.size).toBe(0);
  });

  it('unique basenames are returned as-is', async () => {
    const { shortestUniqueSuffix } = await import('@/lib/filename-disambig');
    const paths = ['src/utils/helper.ts', 'src/api/client.ts', 'src/lib/colors.ts'];
    const result = shortestUniqueSuffix(paths);
    expect(result.get('src/utils/helper.ts')).toBe('helper.ts');
    expect(result.get('src/api/client.ts')).toBe('client.ts');
    expect(result.get('src/lib/colors.ts')).toBe('colors.ts');
  });

  it('duplicate basenames get parent directory prefix', async () => {
    const { shortestUniqueSuffix } = await import('@/lib/filename-disambig');
    const paths = ['src/api/route.ts', 'src/graph/query/route.ts'];
    const result = shortestUniqueSuffix(paths);
    expect(result.get('src/api/route.ts')).toBe('api/route.ts');
    expect(result.get('src/graph/query/route.ts')).toBe('query/route.ts');
  });

  it('three-way collision adds enough segments', async () => {
    const { shortestUniqueSuffix } = await import('@/lib/filename-disambig');
    const paths = [
      'app/api/graph/route.ts',
      'app/api/plan/route.ts',
      'app/api/risk/route.ts',
    ];
    const result = shortestUniqueSuffix(paths);
    expect(result.get('app/api/graph/route.ts')).toBe('graph/route.ts');
    expect(result.get('app/api/plan/route.ts')).toBe('plan/route.ts');
    expect(result.get('app/api/risk/route.ts')).toBe('risk/route.ts');
  });

  it('mixed unique and duplicate: unique stays short', async () => {
    const { shortestUniqueSuffix } = await import('@/lib/filename-disambig');
    const paths = [
      'src/utils/helper.ts',        // unique
      'src/api/route.ts',           // duplicate basename
      'src/graph/query/route.ts',   // duplicate basename
    ];
    const result = shortestUniqueSuffix(paths);
    expect(result.get('src/utils/helper.ts')).toBe('helper.ts');
    expect(result.get('src/api/route.ts')).toBe('api/route.ts');
    expect(result.get('src/graph/query/route.ts')).toBe('query/route.ts');
  });

  it('single file returns just its basename', async () => {
    const { shortestUniqueSuffix } = await import('@/lib/filename-disambig');
    const result = shortestUniqueSuffix(['src/components/Button.tsx']);
    expect(result.get('src/components/Button.tsx')).toBe('Button.tsx');
  });

  it('all entries get a result (same count as input)', async () => {
    const { shortestUniqueSuffix } = await import('@/lib/filename-disambig');
    const paths = ['a/b/c.ts', 'x/y/c.ts', 'p/q/c.ts', 'a/d.ts'];
    const result = shortestUniqueSuffix(paths);
    expect(result.size).toBe(paths.length);
    for (const p of paths) {
      expect(result.has(p)).toBe(true);
    }
  });
});

// ─── GodFilesTable uses disambiguation ───────────────────────

describe('[UI-7] GodFilesTable uses filename disambiguation', () => {
  it('imports shortestUniqueSuffix', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/components/GodFilesTable.tsx'),
      'utf-8'
    );
    expect(src).toContain('shortestUniqueSuffix');
    expect(src).toContain('filename-disambig');
  });
});
