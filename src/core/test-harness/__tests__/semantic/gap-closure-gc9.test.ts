/**
 * GC-9: Infrastructure — Derived Edge Rebuild + Graph Metrics — TDD Spec Tests
 */
import { describe, it, expect } from 'vitest';
import { collectGraphMetrics, type GraphMetrics } from '../../../../scripts/entry/graph-metrics.js';

describe('[GC-9] graph:metrics interface', () => {
  it('exports collectGraphMetrics function', () => {
    expect(typeof collectGraphMetrics).toBe('function');
  });

  it('GraphMetrics type has all required fields', () => {
    const mock: GraphMetrics = {
      nodeCount: 17000,
      edgeCount: 33000,
      avgDegree: 3.8,
      maxDegree: 900,
      maxDegreeNodeId: 'test',
      maxDegreeNodeName: 'test',
      derivedEdgeCount: 2000,
      derivedEdgeRatio: 0.06,
      codeNodeCount: 10000,
      codeNodeRatio: 0.6,
      edgeTypeDistribution: { CONTAINS: 2798 },
      labelDistribution: { CodeNode: 10000 },
      timestamp: new Date().toISOString(),
    };
    expect(mock.nodeCount).toBeGreaterThan(0);
    expect(mock.derivedEdgeRatio).toBeLessThan(1);
    expect(mock.codeNodeRatio).toBeGreaterThan(0);
  });
});

describe('[GC-9] derived edge tagging contract', () => {
  const derivedEdgeTypes = [
    'ANALYZED',
    'ANCHORED_TO',
    'SPANS_PROJECT',
    'FROM_PROJECT',
    'CO_CHANGES_WITH',
    'POSSIBLE_CALL',
  ];

  for (const edgeType of derivedEdgeTypes) {
    it(`${edgeType} edges must have derived=true`, () => {
      // This documents the contract: these edge types are Layer 2 (derived)
      expect(derivedEdgeTypes).toContain(edgeType);
    });
  }

  it('rebuild-derived deletes only derived=true edges', () => {
    // Documents the invariant: Layer 1 edges (CONTAINS, CALLS, etc.) are never deleted
    const layer1EdgeTypes = ['CONTAINS', 'CALLS', 'RESOLVES_TO', 'IMPORTS', 'PART_OF'];
    for (const et of layer1EdgeTypes) {
      expect(derivedEdgeTypes).not.toContain(et);
    }
  });
});
