/**
 * AUD-TC-01-L1: scoring.ts — Gap-Fill Tests
 *
 * Source: src/lib/scoring.ts
 *
 * Gap: getProjectMaxima(), cache behavior, normalize() edge cases untested
 *
 * Missing behaviors to test:
 * (1) getProjectMaxima() reads from Neo4j and returns ProjectMaxima with correct fields
 * (2) Cache hit: second call within 30s returns same object without hitting Neo4j again
 * (3) clearScoringCache() forces next call to re-query Neo4j
 * (4) normalize() with max=0 returns 0 (zero-safe)
 * (5) getMaxPainScore() / getMaxAdjustedPain() convenience wrappers return correct values
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Driver, Session, Result, Record as Neo4jRecord } from 'neo4j-driver';

// Mock session for Neo4j
const mockRun = vi.fn();
const mockClose = vi.fn();
const mockSession: Partial<Session> = {
  run: mockRun,
  close: mockClose,
};

const mockDriver: Partial<Driver> = {
  session: vi.fn(() => mockSession as Session),
  close: vi.fn(),
};

describe('[aud-tc-01] scoring.ts gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReset();
    mockClose.mockReset();
    // Clear module cache to reset internal cache state
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalize() contract', () => {
    it('(1) normalize() returns value/max ratio', async () => {
      const { normalize } = await import('../../../lib/scoring.js');

      expect(normalize(50, 100)).toBe(0.5);
      expect(normalize(25, 100)).toBe(0.25);
      expect(normalize(100, 100)).toBe(1.0);
    });

    it('(2) normalize() with max=0 returns 0 (zero-safe division)', async () => {
      const { normalize } = await import('../../../lib/scoring.js');

      expect(normalize(50, 0)).toBe(0);
      expect(normalize(0, 0)).toBe(0);
    });

    it('(3) normalize() handles decimal values', async () => {
      const { normalize } = await import('../../../lib/scoring.js');

      expect(normalize(0.5, 1.0)).toBe(0.5);
      expect(normalize(3.5, 7.0)).toBe(0.5);
    });
  });

  describe('getProjectMaxima() contract', () => {
    it('(4) getProjectMaxima() queries Project node for max values', async () => {
      const { getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValueOnce({
        records: [{
          get: (key: string) => {
            const values: Record<string, number> = {
              maxPainScore: 100,
              maxAdjustedPain: 150,
              maxFragility: 0.8,
              maxCentrality: 50,
            };
            return values[key] ?? 0;
          },
        }],
      });

      const maxima = await getProjectMaxima('proj_test', mockDriver as Driver);

      // Verify query was made
      expect(mockRun).toHaveBeenCalled();
      const query = mockRun.mock.calls[0][0];
      expect(query).toContain('Project');
      expect(query).toContain('projectId');
    });

    it('(5) getProjectMaxima() returns ProjectMaxima with all fields', async () => {
      const { getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValueOnce({
        records: [{
          get: (key: string) => {
            const values: Record<string, number> = {
              maxPainScore: 100,
              maxAdjustedPain: 150,
              maxFragility: 0.8,
              maxCentrality: 50,
            };
            return values[key] ?? 0;
          },
        }],
      });

      const maxima = await getProjectMaxima('proj_test', mockDriver as Driver);

      expect(maxima).toHaveProperty('maxPainScore');
      expect(maxima).toHaveProperty('maxAdjustedPain');
      expect(maxima).toHaveProperty('maxFragility');
      expect(maxima).toHaveProperty('maxCentrality');
      expect(typeof maxima.maxPainScore).toBe('number');
    });

    it('(6) getProjectMaxima() handles Neo4j Integer via toNumber()', async () => {
      const { getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      // Mock Neo4j Integer object
      const neo4jInt = { toNumber: () => 123 };

      mockRun.mockResolvedValueOnce({
        records: [{
          get: (_key: string) => neo4jInt,
        }],
      });

      const maxima = await getProjectMaxima('proj_test', mockDriver as Driver);

      expect(maxima.maxPainScore).toBe(123);
    });

    it('(7) getProjectMaxima() handles missing Project node (returns zeros)', async () => {
      const { getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValueOnce({
        records: [{ get: () => null }],
      });

      const maxima = await getProjectMaxima('proj_nonexistent', mockDriver as Driver);

      expect(maxima.maxPainScore).toBe(0);
      expect(maxima.maxAdjustedPain).toBe(0);
    });

    it('(8) getProjectMaxima() closes session after execution', async () => {
      const { getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValueOnce({
        records: [{ get: () => 50 }],
      });

      await getProjectMaxima('proj_test', mockDriver as Driver);

      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('cache behavior contract', () => {
    it('(9) second call within TTL returns cached value without Neo4j query', async () => {
      const { getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            const values: Record<string, number> = {
              maxPainScore: 100,
              maxAdjustedPain: 150,
              maxFragility: 0.8,
              maxCentrality: 50,
            };
            return values[key] ?? 0;
          },
        }],
      });

      // First call - should query
      const first = await getProjectMaxima('proj_test', mockDriver as Driver);
      const callsAfterFirst = mockRun.mock.calls.length;

      // Second call - should use cache
      const second = await getProjectMaxima('proj_test', mockDriver as Driver);

      // No additional Neo4j calls
      expect(mockRun.mock.calls.length).toBe(callsAfterFirst);
      // Same values returned
      expect(first.maxPainScore).toBe(second.maxPainScore);
    });

    it('(10) cache is keyed by projectId', async () => {
      const { getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValue({
        records: [{ get: () => 100 }],
      });

      await getProjectMaxima('proj_a', mockDriver as Driver);
      const callsAfterFirst = mockRun.mock.calls.length;

      // Different projectId should trigger new query
      await getProjectMaxima('proj_b', mockDriver as Driver);

      expect(mockRun.mock.calls.length).toBe(callsAfterFirst + 1);
    });
  });

  describe('clearScoringCache() contract', () => {
    it('(11) clearScoringCache() forces next call to re-query Neo4j', async () => {
      const { getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValue({
        records: [{ get: () => 100 }],
      });

      // First call
      await getProjectMaxima('proj_test', mockDriver as Driver);
      const callsAfterFirst = mockRun.mock.calls.length;

      // Clear cache
      clearScoringCache();

      // Next call should query again
      await getProjectMaxima('proj_test', mockDriver as Driver);

      expect(mockRun.mock.calls.length).toBe(callsAfterFirst + 1);
    });
  });

  describe('getMaxPainScore() convenience wrapper', () => {
    it('(12) getMaxPainScore() returns maxPainScore from ProjectMaxima', async () => {
      const { getMaxPainScore, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValueOnce({
        records: [{
          get: (key: string) => {
            if (key === 'maxPainScore') return 123;
            return 0;
          },
        }],
      });

      const maxPain = await getMaxPainScore('proj_test', mockDriver as Driver);

      expect(maxPain).toBe(123);
    });

    it('(13) getMaxPainScore() uses same cache as getProjectMaxima()', async () => {
      const { getMaxPainScore, getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            const values: Record<string, number> = {
              maxPainScore: 100,
              maxAdjustedPain: 150,
              maxFragility: 0.8,
              maxCentrality: 50,
            };
            return values[key] ?? 0;
          },
        }],
      });

      // Call getProjectMaxima first (populates cache)
      await getProjectMaxima('proj_test', mockDriver as Driver);
      const callsAfterFirst = mockRun.mock.calls.length;

      // getMaxPainScore should use cached value
      await getMaxPainScore('proj_test', mockDriver as Driver);

      expect(mockRun.mock.calls.length).toBe(callsAfterFirst);
    });
  });

  describe('getMaxAdjustedPain() convenience wrapper', () => {
    it('(14) getMaxAdjustedPain() returns maxAdjustedPain from ProjectMaxima', async () => {
      const { getMaxAdjustedPain, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValueOnce({
        records: [{
          get: (key: string) => {
            if (key === 'maxAdjustedPain') return 250;
            return 0;
          },
        }],
      });

      const maxAdj = await getMaxAdjustedPain('proj_test', mockDriver as Driver);

      expect(maxAdj).toBe(250);
    });

    it('(15) getMaxAdjustedPain() uses same cache as getProjectMaxima()', async () => {
      const { getMaxAdjustedPain, getProjectMaxima, clearScoringCache } = await import('../../../lib/scoring.js');
      clearScoringCache();

      mockRun.mockResolvedValue({
        records: [{
          get: (key: string) => {
            const values: Record<string, number> = {
              maxPainScore: 100,
              maxAdjustedPain: 150,
              maxFragility: 0.8,
              maxCentrality: 50,
            };
            return values[key] ?? 0;
          },
        }],
      });

      // Call getProjectMaxima first
      await getProjectMaxima('proj_test', mockDriver as Driver);
      const callsAfterFirst = mockRun.mock.calls.length;

      // getMaxAdjustedPain should use cached value
      await getMaxAdjustedPain('proj_test', mockDriver as Driver);

      expect(mockRun.mock.calls.length).toBe(callsAfterFirst);
    });
  });
});
