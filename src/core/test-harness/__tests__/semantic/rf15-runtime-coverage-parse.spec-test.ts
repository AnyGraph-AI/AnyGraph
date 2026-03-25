import { describe, it, expect } from 'vitest';
import {
  parseCoverageJson,
  type ParsedCoverageFile,
} from '../../../../scripts/enrichment/parse-runtime-coverage.js';

describe('RF-15: parse runtime coverage JSON', () => {
  it('extracts statement line ranges with hit counts', () => {
    const fixture = {
      '/tmp/demo.ts': {
        path: '/tmp/demo.ts',
        statementMap: {
          '0': { start: { line: 10, column: 0 }, end: { line: 10, column: 20 } },
          '1': { start: { line: 12, column: 0 }, end: { line: 14, column: 1 } },
        },
        fnMap: {},
        branchMap: {},
        s: { '0': 3, '1': 0 },
        f: {},
        b: {},
      },
    };

    const parsed = parseCoverageJson(JSON.stringify(fixture));
    expect(parsed).toHaveLength(1);
    const file = parsed[0] as ParsedCoverageFile;

    expect(file.filePath).toBe('/tmp/demo.ts');
    expect(file.lineRanges).toEqual([
      { statementId: '0', startLine: 10, endLine: 10, hits: 3 },
      { statementId: '1', startLine: 12, endLine: 14, hits: 0 },
    ]);
  });

  it('extracts function hit data from fnMap + f counters', () => {
    const fixture = {
      '/tmp/demo.ts': {
        path: '/tmp/demo.ts',
        statementMap: {},
        fnMap: {
          '0': {
            name: 'computeScore',
            decl: { start: { line: 20, column: 0 }, end: { line: 20, column: 20 } },
            loc: { start: { line: 20, column: 0 }, end: { line: 32, column: 1 } },
            line: 20,
          },
        },
        branchMap: {},
        s: {},
        f: { '0': 5 },
        b: {},
      },
    };

    const parsed = parseCoverageJson(JSON.stringify(fixture));
    const file = parsed[0] as ParsedCoverageFile;

    expect(file.functionHits).toEqual([
      {
        functionId: '0',
        name: 'computeScore',
        startLine: 20,
        endLine: 32,
        hits: 5,
      },
    ]);
  });

  it('extracts branch counts and covered path totals', () => {
    const fixture = {
      '/tmp/demo.ts': {
        path: '/tmp/demo.ts',
        statementMap: {},
        fnMap: {},
        branchMap: {
          '0': {
            type: 'if',
            line: 40,
            locations: [
              { start: { line: 40, column: 2 }, end: { line: 41, column: 3 } },
              { start: { line: 42, column: 2 }, end: { line: 43, column: 3 } },
            ],
          },
        },
        s: {},
        f: {},
        b: { '0': [7, 0] },
      },
    };

    const parsed = parseCoverageJson(JSON.stringify(fixture));
    const file = parsed[0] as ParsedCoverageFile;

    expect(file.branchCounts).toEqual([
      {
        branchId: '0',
        branchType: 'if',
        line: 40,
        pathCount: 2,
        coveredPaths: 1,
        totalHits: 7,
      },
    ]);
  });

  it('drops malformed statement ranges and falls back to object-key file path', () => {
    const fixture = {
      '/tmp/key-path.ts': {
        statementMap: {
          bad1: { start: { line: 0, column: 0 }, end: { line: 10, column: 0 } },
          bad2: { start: { line: 12, column: 0 }, end: { line: 11, column: 0 } },
          ok: { start: { line: 20, column: 0 }, end: { line: 21, column: 0 } },
        },
        s: { bad1: 3, bad2: 2, ok: 1 },
      },
    };

    const parsed = parseCoverageJson(JSON.stringify(fixture));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.filePath).toBe('/tmp/key-path.ts');
    expect(parsed[0]?.lineRanges).toHaveLength(1);
    expect(parsed[0]?.lineRanges[0]).toMatchObject({ statementId: 'ok', startLine: 20, endLine: 21, hits: 1 });
  });

  it('filters malformed fnMap entries and defaults missing names/hits', () => {
    const fixture = {
      '/tmp/fns.ts': {
        path: '/tmp/fns.ts',
        statementMap: {},
        fnMap: {
          bad: { name: 'bad', loc: { start: { line: 5, column: 0 }, end: { line: 4, column: 0 } } },
          unnamed: { loc: { start: { line: 8, column: 0 }, end: { line: 9, column: 0 } } },
        },
        f: {},
      },
    };

    const parsed = parseCoverageJson(JSON.stringify(fixture));
    expect(parsed[0]?.functionHits).toHaveLength(1);
    expect(parsed[0]?.functionHits[0]).toMatchObject({
      functionId: 'unnamed',
      name: 'fn_unnamed',
      startLine: 8,
      endLine: 9,
      hits: 0,
    });
  });

  it('handles missing coverage sections as empty arrays/objects', () => {
    const fixture = {
      '/tmp/minimal.ts': {
        path: '/tmp/minimal.ts',
      },
    };

    const parsed = parseCoverageJson(JSON.stringify(fixture));
    const file = parsed[0] as ParsedCoverageFile;
    expect(file.lineRanges).toEqual([]);
    expect(file.branchCounts).toEqual([]);
    expect(file.functionHits).toEqual([]);
  });
});
