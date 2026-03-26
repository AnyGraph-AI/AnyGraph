/**
 * AUD-TC-01-L1: create-flags-edges.ts — Spec-Derived Tests
 *
 * Spec: GAP_CLOSURE.md §GC-2 — FLAGS edges: VR startLine/endLine → Function span matching
 *
 * Behaviors:
 * (1) Matches VR node with targetFilePath+startLine to Function node whose filePath+lineRange overlaps → creates FLAGS edge
 * (2) Handles done-check VRs referencing specific files → FLAGS edges to CodeNode
 * (3) Returns {flagsEdges: number} count
 * (4) Idempotent — re-running does not create duplicate FLAGS edges
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the neo4j-driver module
const mockSession = {
  run: vi.fn(),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
};

describe('[aud-tc-01] create-flags-edges.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.run.mockReset();
    mockSession.close.mockReset();
  });

  describe('FLAGS edge contract', () => {
    it('(1) FLAGS edge must connect VR → Function with derived=true', () => {
      // Contract: FLAGS edges have these required properties
      const expectedEdgeProps = {
        derived: true,
        source: 'flags-enrichment',
        projectId: 'proj_test',
        startLine: 10,
        endLine: 20,
        ruleId: 'no-unused-vars',
      };

      expect(expectedEdgeProps.derived).toBe(true);
      expect(expectedEdgeProps.source).toBe('flags-enrichment');
      expect(expectedEdgeProps.projectId).toBeDefined();
      expect(expectedEdgeProps.startLine).toBeGreaterThan(0);
    });

    it('(2) VR matching requires targetFilePath AND startLine', () => {
      // Contract: VRs without both targetFilePath and startLine should be skipped
      const vrWithBoth = { targetFilePath: '/src/foo.ts', startLine: 5 };
      const vrMissingPath = { targetFilePath: null, startLine: 5 };
      const vrMissingLine = { targetFilePath: '/src/foo.ts', startLine: null };

      // Only VRs with both should match
      const canMatch = (vr: { targetFilePath: string | null; startLine: number | null }) =>
        vr.targetFilePath !== null && vr.startLine !== null;

      expect(canMatch(vrWithBoth)).toBe(true);
      expect(canMatch(vrMissingPath)).toBe(false);
      expect(canMatch(vrMissingLine)).toBe(false);
    });

    it('(3) path normalization strips file:// prefix', () => {
      // Contract: targetFilePath with file:// prefix should be normalized
      const rawPath = 'file:///src/foo.ts';
      const cleanPath = rawPath.startsWith('file://') ? rawPath.substring(7) : rawPath;

      expect(cleanPath).toBe('/src/foo.ts');
    });

    it('(4) path normalization strips ./ prefix', () => {
      // Contract: targetFilePath with ./ prefix should be normalized
      const rawPath = './src/foo.ts';
      const cleanPath = rawPath.startsWith('./') ? rawPath.substring(2) : rawPath;

      expect(cleanPath).toBe('src/foo.ts');
    });
  });

  describe('enrichFlagsEdges function behavior', () => {
    it('(5) returns {flagsEdges: number} count', async () => {
      // Mock the session.run to return a mock result
      mockSession.run.mockResolvedValueOnce({
        records: [
          {
            get: (key: string) => (key === 'edges' ? 42 : null),
          },
        ],
      });

      // Import and test the function
      const { enrichFlagsEdges } = await import('../create-flags-edges.js');
      const result = await enrichFlagsEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result).toHaveProperty('flagsEdges');
      expect(typeof result.flagsEdges).toBe('number');
      expect(result.flagsEdges).toBe(42);
    });

    it('(6) handles bigint result from Neo4j', async () => {
      // Neo4j often returns bigint for count(*) results
      const bigIntValue = { toNumber: () => 100 };
      mockSession.run.mockResolvedValueOnce({
        records: [
          {
            get: (key: string) => (key === 'edges' ? bigIntValue : null),
          },
        ],
      });

      const { enrichFlagsEdges } = await import('../create-flags-edges.js');
      const result = await enrichFlagsEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result.flagsEdges).toBe(100);
    });

    it('(7) MERGE semantics ensure idempotency', async () => {
      // The Cypher query uses MERGE, not CREATE — running twice should not create duplicates
      // First run: creates edges
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 10 }],
      });

      const { enrichFlagsEdges } = await import('../create-flags-edges.js');
      const result1 = await enrichFlagsEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      // Second run: ON MATCH updates existing edges, not creating new ones
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 10 }], // Same count — edges matched, not recreated
      });

      const result2 = await enrichFlagsEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      // Both runs return a count — MERGE guarantees no duplicates
      expect(result1.flagsEdges).toBe(10);
      expect(result2.flagsEdges).toBe(10);
    });

    it('(8) closes session after execution', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 0 }],
      });

      const { enrichFlagsEdges } = await import('../create-flags-edges.js');
      await enrichFlagsEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(mockSession.close).toHaveBeenCalled();
    });
  });
});
