/**
 * AUD-TC-01a SPEC-GAP-02: create-possible-call-edges.ts tests
 *
 * Tests for exported functions and refactored API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractTernaryFunctionCandidates,
  hasCallbackRegistrationPattern,
  enrichPossibleCallEdges,
} from '../create-possible-call-edges.js';

// Mock Neo4j driver
const mockSession = {
  run: vi.fn(),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
};

describe('[aud-tc-01a] create-possible-call-edges.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.run.mockReset();
    mockSession.close.mockReset();
  });

  describe('extractTernaryFunctionCandidates', () => {
    it('extracts ternary function pairs from source code', () => {
      const source = `
        const handler = isAdmin ? handleAdmin : handleUser;
        const strategy = mode === 'fast' ? quickSort : mergeSort;
      `;

      const result = extractTernaryFunctionCandidates(source);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ trueFn: 'handleAdmin', falseFn: 'handleUser' });
      expect(result[1]).toEqual({ trueFn: 'quickSort', falseFn: 'mergeSort' });
    });

    it('filters out literals and non-function values', () => {
      const source = `
        const x = condition ? true : false;
        const y = test ? 42 : null;
        const z = check ? fnA : fnB;
      `;

      const result = extractTernaryFunctionCandidates(source);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ trueFn: 'fnA', falseFn: 'fnB' });
    });

    it('handles multiple ternaries in single line', () => {
      const source = 'const f = a ? fnA : fnB, g = c ? fnC : fnD;';

      const result = extractTernaryFunctionCandidates(source);

      expect(result).toHaveLength(2);
    });

    it('returns empty array when no ternaries found', () => {
      const source = 'const x = 42; function test() { return true; }';

      const result = extractTernaryFunctionCandidates(source);

      expect(result).toEqual([]);
    });
  });

  describe('hasCallbackRegistrationPattern', () => {
    it('detects setCallback pattern', () => {
      const source = 'this.callback = fn;';
      const fnName = 'setCallback';

      expect(hasCallbackRegistrationPattern(source, fnName)).toBe(true);
    });

    it('detects registerHandler pattern', () => {
      const source = 'function body';
      const fnName = 'registerOnMessageHandler';

      expect(hasCallbackRegistrationPattern(source, fnName)).toBe(true);
    });

    it('detects addEventListener pattern', () => {
      const source = 'function body';
      const fnName = 'addEventListenerAsync';

      expect(hasCallbackRegistrationPattern(source, fnName)).toBe(true);
    });

    it('detects on* pattern', () => {
      const source = 'function body';
      const fnName = 'onReady';

      expect(hasCallbackRegistrationPattern(source, fnName)).toBe(true);
    });

    it('detects this.handler assignment in source', () => {
      const source = 'this.handler = callback;';
      const fnName = 'someFunction';

      expect(hasCallbackRegistrationPattern(source, fnName)).toBe(true);
    });

    it('rejects non-callback patterns', () => {
      const source = 'const x = 42;';
      const fnName = 'calculateSum';

      expect(hasCallbackRegistrationPattern(source, fnName)).toBe(false);
    });
  });

  describe('enrichPossibleCallEdges', () => {
    it('returns result with expected shape', async () => {
      // Mock all query results to return empty sets
      mockSession.run.mockResolvedValue({ records: [] });

      const result = await enrichPossibleCallEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result).toHaveProperty('ternary');
      expect(result).toHaveProperty('hof');
      expect(result).toHaveProperty('registration');
      expect(result).toHaveProperty('total');
      expect(typeof result.ternary).toBe('number');
      expect(typeof result.hof).toBe('number');
      expect(typeof result.registration).toBe('number');
      expect(typeof result.total).toBe('number');
    });

    it('closes session after execution', async () => {
      mockSession.run.mockResolvedValue({ records: [] });

      await enrichPossibleCallEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(mockSession.close).toHaveBeenCalled();
    });

    it('aggregates counts correctly', async () => {
      // Mock ternary query returning 2 results
      mockSession.run
        .mockResolvedValueOnce({
          records: [
            { get: (k: string) => (k === 'fnId' ? 'fn1' : k === 'fnName' ? 'test' : k === 'sourceCode' ? 'x ? a : b' : '') },
          ],
        })
        .mockResolvedValueOnce({
          records: [{ get: () => ({ toNumber: () => 1 }) }],
        })
        .mockResolvedValueOnce({
          records: [{ get: () => ({ toNumber: () => 1 }) }],
        })
        // Mock HOF query returning 1 result
        .mockResolvedValueOnce({
          records: [
            { get: (k: string) => (k === 'created' ? { toNumber: () => 1 } : 'hof') },
          ],
        })
        // Mock registration query returning 0 results
        .mockResolvedValueOnce({ records: [] })
        // Mock diagnostic query
        .mockResolvedValueOnce({ records: [] });

      const result = await enrichPossibleCallEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result.ternary).toBe(2);
      expect(result.hof).toBe(1);
      expect(result.registration).toBe(0);
      expect(result.total).toBe(3);
    });
  });
});
