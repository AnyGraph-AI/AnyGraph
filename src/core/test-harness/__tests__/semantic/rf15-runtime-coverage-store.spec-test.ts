import { describe, it, expect } from 'vitest';
import {
  computeLineCoverage,
  computeBranchCoverageForFunction,
} from '../../../../scripts/enrichment/store-runtime-coverage.js';

describe('RF-15: store runtime coverage metrics', () => {
  it('computes lineCoverage as covered/matched statements', () => {
    expect(computeLineCoverage(10, 3)).toBe(0.3);
    expect(computeLineCoverage(0, 0)).toBe(0);
  });

  it('computes branchCoverage from in-range branch paths', () => {
    const fn = {
      id: 'fn_a',
      name: 'alpha',
      filePath: '/tmp/a.ts',
      startLine: 10,
      endLine: 20,
    };

    const branches = [
      { branchId: 'b1', branchType: 'if', line: 12, pathCount: 2, coveredPaths: 1, totalHits: 7 },
      { branchId: 'b2', branchType: 'if', line: 16, pathCount: 2, coveredPaths: 2, totalHits: 10 },
      { branchId: 'b3', branchType: 'if', line: 40, pathCount: 2, coveredPaths: 2, totalHits: 10 },
    ];

    // In-range totals: pathCount=4, covered=3 => 0.75
    expect(computeBranchCoverageForFunction(fn, branches)).toBe(0.75);
  });

  it('returns 0 branchCoverage when no branch data intersects function', () => {
    const fn = {
      id: 'fn_b',
      name: 'beta',
      filePath: '/tmp/a.ts',
      startLine: 1,
      endLine: 5,
    };

    const branches = [
      { branchId: 'b1', branchType: 'if', line: 20, pathCount: 2, coveredPaths: 2, totalHits: 4 },
    ];

    expect(computeBranchCoverageForFunction(fn, branches)).toBe(0);
  });
});
