/**
 * RF-14: Function-Level Test Coverage (phase 1) — Spec Tests
 *
 * Scope covered here:
 * 1) Identify test files by naming convention and tag as isTestFile.
 * 2) Trace calls from test functions to imported source functions.
 */
import { describe, it, expect } from 'vitest';
import {
  isTestFileByConvention,
  extractImportBindings,
  traceTestFunctionCalls,
  analyzeTestFile,
  resolveImportMap,
  type ImportBinding,
} from '../../../../scripts/enrichment/create-test-coverage-edges.js';

describe('RF-14: test file identification', () => {
  it('marks *.test.ts as test files', () => {
    expect(isTestFileByConvention('/tmp/foo/bar.service.test.ts')).toBe(true);
  });

  it('marks *.spec.ts as test files', () => {
    expect(isTestFileByConvention('/tmp/foo/bar.service.spec.ts')).toBe(true);
  });

  it('marks *.spec-test.ts as test files (repo compatibility)', () => {
    expect(isTestFileByConvention('/tmp/foo/rf14-semantic.spec-test.ts')).toBe(true);
  });

  it('does not mark non-test files', () => {
    expect(isTestFileByConvention('/tmp/foo/bar.service.ts')).toBe(false);
  });
});

describe('RF-14: import binding extraction', () => {
  it('extracts named imports including aliases', () => {
    const code = `
      import { alpha, beta as b } from './lib';
    `;
    const bindings = extractImportBindings(code);

    expect(bindings.get('alpha')?.imported).toBe('alpha');
    expect(bindings.get('b')?.imported).toBe('beta');
  });

  it('extracts namespace imports for member-call tracing', () => {
    const code = `
      import * as score from './score';
    `;
    const bindings = extractImportBindings(code);

    expect(bindings.get('score')?.namespace).toBe(true);
  });
});

describe('RF-14: test call tracing', () => {
  it('traces direct calls to named imports inside test blocks', () => {
    const code = `
      import { compute } from './calc';
      describe('calc', () => {
        it('works', () => {
          compute(1, 2);
        });
      });
    `;

    const traces = traceTestFunctionCalls(code);
    expect(traces.length).toBe(1);
    expect(traces[0]?.calls.some((c) => c.alias === 'compute')).toBe(true);
  });

  it('traces namespace member calls inside test blocks', () => {
    const code = `
      import * as score from './score';
      test('risk', () => {
        score.computeRisk();
      });
    `;

    const traces = traceTestFunctionCalls(code);
    expect(traces.length).toBe(1);
    expect(
      traces[0]?.calls.some((c) => c.alias === 'score' && c.member === 'computeRisk'),
    ).toBe(true);
  });
});

// ─── Characterization tests for CRITICAL functions ─────────────

describe('RF-14: analyzeTestFile (CRITICAL characterization)', () => {
  it('returns structured analysis of this very test file', () => {
    const thisFile = import.meta.url.replace('file://', '');
    const info = analyzeTestFile(thisFile);

    expect(info.name).toContain('rf14-test-call-tracing');
    expect(info.filePath).toBe(thisFile);
    expect(info.testCount).toBeGreaterThan(0);
    expect(info.describeBlocks.length).toBeGreaterThan(0);
    expect(Array.isArray(info.imports)).toBe(true);
    expect(Array.isArray(info.traces)).toBe(true);
  });

  it('extracts describe block names', () => {
    const thisFile = import.meta.url.replace('file://', '');
    const info = analyzeTestFile(thisFile);

    expect(info.describeBlocks).toContain('RF-14: test file identification');
  });
});

describe('RF-14: resolveImportMap (CRITICAL characterization)', () => {
  it('resolves relative bindings to absolute paths when file exists', () => {
    const bindings = new Map<string, ImportBinding>();
    bindings.set('foo', { imported: 'foo', sourceSpec: './create-test-coverage-edges' });

    const dir = '/home/jonathan/.openclaw/workspace/codegraph/src/scripts/enrichment';
    const resolved = resolveImportMap(bindings, dir);

    expect(resolved.has('foo')).toBe(true);
    expect(resolved.get('foo')?.targetPath).toContain('create-test-coverage-edges.ts');
  });

  it('skips non-relative imports (bare specifiers)', () => {
    const bindings = new Map<string, ImportBinding>();
    bindings.set('neo4j', { imported: 'default', sourceSpec: 'neo4j-driver' });

    const resolved = resolveImportMap(bindings, '/tmp');
    expect(resolved.size).toBe(0);
  });

  it('returns empty map for empty bindings', () => {
    const resolved = resolveImportMap(new Map(), '/tmp');
    expect(resolved.size).toBe(0);
  });

  it('resolves @/ alias imports to source files', () => {
    const bindings = new Map<string, ImportBinding>();
    bindings.set('QUERIES', { imported: 'QUERIES', sourceSpec: '@/lib/queries' });

    // dir is the UI test directory; project root has tsconfig with @/ → ./src/
    const dir = '/home/jonathan/.openclaw/workspace/codegraph/ui/src/__tests__';
    const resolved = resolveImportMap(bindings, dir);

    expect(resolved.has('QUERIES')).toBe(true);
    expect(resolved.get('QUERIES')?.targetPath).toContain('ui/src/lib/queries.ts');
  });
});

describe('RF-14: dynamic import extraction', () => {
  it('extracts dynamic import() specifiers', () => {
    const code = `
      const { cachedQuery } = await import('@/lib/neo4j');
      const { QUERIES } = await import('@/lib/queries');
    `;
    const bindings = extractImportBindings(code);

    // Should capture both dynamic imports
    const specs = Array.from(bindings.values()).map(b => b.sourceSpec);
    expect(specs).toContain('@/lib/neo4j');
    expect(specs).toContain('@/lib/queries');
  });

  it('does not duplicate bindings for same dynamic import', () => {
    const code = `
      const a = await import('./foo');
      const b = await import('./foo');
    `;
    const bindings = extractImportBindings(code);
    const fooBindings = Array.from(bindings.values()).filter(b => b.sourceSpec === './foo');
    expect(fooBindings.length).toBe(1);
  });
});
