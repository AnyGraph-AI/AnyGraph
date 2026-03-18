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
});
