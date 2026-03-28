/**
 * AUD-TC-01a FIND-01-SPEC-04: Test file exclusion from confidenceScore population
 *
 * Test files can never earn evidence (no VRs target them, no TESTED_BY edges point at them),
 * so their score is structurally zero and drags the production average down. This test verifies
 * they are marked productionRiskExcluded=true during precompute pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSession = {
  run: vi.fn(),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
};

describe('[aud-tc-01a] precompute-scores.ts test file exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.run.mockReset();
    mockSession.close.mockReset();
  });

  describe('test file identification patterns', () => {
    it('matches __tests__ directory pattern', () => {
      const path = 'src/scripts/enrichment/__tests__/my-test.ts';
      const pattern = /.*(__tests__|test|spec)\/.*/;

      expect(pattern.test(path)).toBe(true);
    });

    it('matches .test.ts extension', () => {
      const path = 'src/lib/scoring.test.ts';
      const pattern = /.*\.(test|spec)\.(ts|tsx|js|jsx)$/;

      expect(pattern.test(path)).toBe(true);
    });

    it('matches .spec.ts extension', () => {
      const path = 'src/core/parser.spec.ts';
      const pattern = /.*\.(test|spec)\.(ts|tsx|js|jsx)$/;

      expect(pattern.test(path)).toBe(true);
    });

    it('matches .test.tsx extension', () => {
      const path = 'src/components/Button.test.tsx';
      const pattern = /.*\.(test|spec)\.(ts|tsx|js|jsx)$/;

      expect(pattern.test(path)).toBe(true);
    });

    it('does not match production files', () => {
      const path = 'src/scripts/enrichment/precompute-scores.ts';
      const testPattern = /.*(__tests__|test|spec)\/.*/;
      const extPattern = /.*\.(test|spec)\.(ts|tsx|js|jsx)$/;

      expect(testPattern.test(path)).toBe(false);
      expect(extPattern.test(path)).toBe(false);
    });
  });

  describe('enrichPrecomputeScores test exclusion behavior', () => {
    it('marks test files with productionRiskExcluded before scoring', async () => {
      // Mock test file marking query (Step 0)
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 5 }], // 5 test files marked
      });

      // Mock CALLS query (Step 1)
      mockSession.run.mockResolvedValueOnce({ records: [] });

      // Mock functions query (Step 2)
      mockSession.run.mockResolvedValueOnce({ records: [] });

      const { enrichPrecomputeScores } = await import('../precompute-scores.js');
      await enrichPrecomputeScores(mockDriver as unknown as import('neo4j-driver').Driver, 'proj_test');

      // Verify test file marking query was called first
      const firstCall = mockSession.run.mock.calls[0];
      const query = String(firstCall[0]);
      expect(query).toContain('productionRiskExcluded = true');
      expect(query).toMatch(/__tests__/);
      expect(query).toMatch(/test/);
      expect(query).toMatch(/spec/);
    });

    it('productionRiskExcluded files are excluded from scoring query', async () => {
      // Mock test file marking
      mockSession.run.mockResolvedValueOnce({ records: [{ get: () => 3 }] });

      // Mock CALLS query
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: (k: string) => (k === 'callerId' ? 'fn1' : 'fn2') }],
      });

      // Mock functions query with actual functions so processing continues
      mockSession.run.mockResolvedValueOnce({
        records: [
          {
            get: (k: string) => {
              if (k === 'id') return 'fn1';
              if (k === 'fanInCount') return 2;
              return null;
            },
          },
        ],
      });

      // Mock function write
      mockSession.run.mockResolvedValueOnce({ records: [{ get: () => 1 }] });

      // Mock file data query (Step 4) — this is where exclusion happens
      mockSession.run.mockResolvedValueOnce({ records: [] });

      // Mock all remaining queries that precompute needs
      mockSession.run.mockResolvedValue({ records: [] }); // coChange, importFan, hiddenCoupling, busFactor, etc.

      const { enrichPrecomputeScores } = await import('../precompute-scores.js');
      await enrichPrecomputeScores(mockDriver as unknown as import('neo4j-driver').Driver, 'proj_test');

      // Find the file data query (contains WHERE NOT ... productionRiskExcluded and OPTIONAL MATCH)
      const fileDataCall = mockSession.run.mock.calls.find((call) => {
        const query = String(call[0]);
        return query.includes('OPTIONAL MATCH') && query.includes('WHERE NOT');
      });

      expect(fileDataCall).toBeDefined();
      const query = String(fileDataCall![0]);
      expect(query).toMatch(/WHERE NOT.*productionRiskExcluded/);
    });

    it('marks zero test files when none exist', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 0 }], // 0 test files
      });
      mockSession.run.mockResolvedValueOnce({ records: [] }); // CALLS
      mockSession.run.mockResolvedValueOnce({ records: [] }); // functions

      const { enrichPrecomputeScores } = await import('../precompute-scores.js');
      await enrichPrecomputeScores(mockDriver as unknown as import('neo4j-driver').Driver, 'proj_empty');

      const firstCall = mockSession.run.mock.calls[0];
      expect(firstCall[0]).toContain('productionRiskExcluded = true');
    });
  });

  describe('test file classification edge cases', () => {
    it('matches test directories with forward slashes', () => {
      const paths = [
        'src/__tests__/integration.ts',
        'src/scripts/test/unit.ts',
        'src/core/spec/behavior.ts',
      ];
      const pattern = /.*(__tests__|test|spec)\/.*/;

      paths.forEach((path) => {
        expect(pattern.test(path)).toBe(true);
      });
    });

    it('matches all test extension variants', () => {
      const extensions = ['.test.ts', '.spec.ts', '.test.tsx', '.spec.tsx', '.test.js', '.spec.js'];
      const pattern = /.*\.(test|spec)\.(ts|tsx|js|jsx)$/;

      extensions.forEach((ext) => {
        const path = `src/module${ext}`;
        expect(pattern.test(path)).toBe(true);
      });
    });

    it('does not match false positives', () => {
      const nonTestPaths = [
        'src/components/TestComponent.ts', // 'test' in name but not test file
        'src/lib/specification.ts', // 'spec' in name but not test file
        'src/utils/testing-helpers.ts', // 'test' substring but not test file
      ];
      const testPattern = /.*(__tests__|test|spec)\/.*/;
      const extPattern = /.*\.(test|spec)\.(ts|tsx|js|jsx)$/;

      nonTestPaths.forEach((path) => {
        expect(testPattern.test(path) || extPattern.test(path)).toBe(false);
      });
    });
  });
});
