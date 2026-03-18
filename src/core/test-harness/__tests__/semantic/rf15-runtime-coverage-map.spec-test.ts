import { describe, it, expect } from 'vitest';
import {
  rangesOverlap,
  mapStatementsToFunctions,
} from '../../../../scripts/enrichment/map-runtime-coverage-to-functions.js';

describe('RF-15: map runtime coverage to functions', () => {
  it('detects range overlap correctly', () => {
    expect(rangesOverlap(10, 20, 20, 30)).toBe(true);
    expect(rangesOverlap(10, 20, 21, 30)).toBe(false);
  });

  it('maps statement ranges to function spans and computes hit totals', () => {
    const functions = [
      {
        id: 'fn_a',
        name: 'alpha',
        filePath: '/tmp/a.ts',
        startLine: 10,
        endLine: 20,
      },
      {
        id: 'fn_b',
        name: 'beta',
        filePath: '/tmp/a.ts',
        startLine: 22,
        endLine: 30,
      },
    ];

    const statements = [
      { statementId: 's1', startLine: 11, endLine: 12, hits: 3 },
      { statementId: 's2', startLine: 15, endLine: 15, hits: 0 },
      { statementId: 's3', startLine: 24, endLine: 26, hits: 5 },
      { statementId: 's4', startLine: 40, endLine: 41, hits: 9 },
    ];

    const mapped = mapStatementsToFunctions(functions, statements);

    expect(mapped).toEqual([
      {
        functionId: 'fn_a',
        functionName: 'alpha',
        filePath: '/tmp/a.ts',
        startLine: 10,
        endLine: 20,
        matchedStatementCount: 2,
        coveredStatementCount: 1,
        statementHitTotal: 3,
      },
      {
        functionId: 'fn_b',
        functionName: 'beta',
        filePath: '/tmp/a.ts',
        startLine: 22,
        endLine: 30,
        matchedStatementCount: 1,
        coveredStatementCount: 1,
        statementHitTotal: 5,
      },
    ]);
  });
});
