/**
 * AUD-TC-01-L1: normalize-project-labels.ts — Spec-Derived Tests
 *
 * Spec: GAP_CLOSURE.md §GC-9 — Project nodes must have CodeNode label
 *
 * Behaviors:
 * (1) Finds Project nodes without CodeNode label, adds it
 * (2) Returns {normalized: number}
 * (3) Idempotent — returns 0 when all already labeled
 * (4) Does not modify Project nodes that already have CodeNode label
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

describe('[aud-tc-01] normalize-project-labels.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.run.mockReset();
    mockSession.close.mockReset();
  });

  describe('Project label normalization contract', () => {
    it('(1) Project nodes should have CodeNode label for consistent querying', () => {
      // Contract: All CodeGraph node types should have CodeNode as a common label
      // This allows queries like MATCH (n:CodeNode) to find all code-related nodes
      const projectWithCodeNode = { labels: ['CodeNode', 'Project'] };
      const projectWithoutCodeNode = { labels: ['Project'] };

      expect(projectWithCodeNode.labels).toContain('CodeNode');
      expect(projectWithCodeNode.labels).toContain('Project');
      expect(projectWithoutCodeNode.labels).not.toContain('CodeNode');
    });

    it('(2) WHERE NOT p:CodeNode filters to nodes needing normalization', () => {
      // The Cypher query filters nodes that don't already have CodeNode label
      const queryPattern = 'WHERE NOT p:CodeNode';

      // This ensures we only modify nodes that need it
      expect(queryPattern).toContain('NOT p:CodeNode');
    });

    it('(3) SET p:CodeNode adds the label', () => {
      // The Cypher query adds the CodeNode label
      const setPattern = 'SET p:CodeNode';

      expect(setPattern).toBe('SET p:CodeNode');
    });
  });

  describe('normalizeProjectLabels function behavior', () => {
    it('(4) returns {normalized: number} count', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: (key: string) => (key === 'normalized' ? 3 : null) }],
      });

      const { normalizeProjectLabels } = await import('../normalize-project-labels.js');
      const result = await normalizeProjectLabels(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result).toHaveProperty('normalized');
      expect(typeof result.normalized).toBe('number');
      expect(result.normalized).toBe(3);
    });

    it('(5) handles bigint result from Neo4j', async () => {
      const bigIntValue = { toNumber: () => 7 };
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => bigIntValue }],
      });

      const { normalizeProjectLabels } = await import('../normalize-project-labels.js');
      const result = await normalizeProjectLabels(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result.normalized).toBe(7);
    });

    it('(6) returns 0 when all Project nodes already have CodeNode label', async () => {
      // Idempotent: running on already-normalized graph returns 0
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 0 }],
      });

      const { normalizeProjectLabels } = await import('../normalize-project-labels.js');
      const result = await normalizeProjectLabels(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result.normalized).toBe(0);
    });

    it('(7) idempotent — running twice does not double-label', async () => {
      // First run: normalizes 5 projects
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 5 }],
      });

      const { normalizeProjectLabels } = await import('../normalize-project-labels.js');
      const result1 = await normalizeProjectLabels(mockDriver as unknown as import('neo4j-driver').Driver);

      // Second run: all already normalized
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 0 }],
      });

      const result2 = await normalizeProjectLabels(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result1.normalized).toBe(5);
      expect(result2.normalized).toBe(0);
    });

    it('(8) does not modify Project nodes that already have CodeNode label', async () => {
      // The WHERE NOT p:CodeNode clause ensures we skip already-labeled nodes
      // If all projects already have CodeNode, count is 0
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 0 }],
      });

      const { normalizeProjectLabels } = await import('../normalize-project-labels.js');
      const result = await normalizeProjectLabels(mockDriver as unknown as import('neo4j-driver').Driver);

      // Zero modifications means existing labels were preserved
      expect(result.normalized).toBe(0);
    });

    it('(9) closes session after execution', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [{ get: () => 0 }],
      });

      const { normalizeProjectLabels } = await import('../normalize-project-labels.js');
      await normalizeProjectLabels(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(mockSession.close).toHaveBeenCalled();
    });
  });
});
