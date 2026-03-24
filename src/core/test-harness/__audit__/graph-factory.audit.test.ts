// Fork: Drew/Jason origin (heavily extended)
// AUD-TC Audit — B6 (Health Witness)
// Spec-derived tests for graph-factory.ts (core graph construction)

import { describe, it, expect } from 'vitest';
import {
  generateDeterministicId,
  computeSymbolHash,
  generateFrameworkEdgeId,
  createFrameworkEdgeData,
  createCoreEdge,
  createCallsEdge,
  toNeo4jNode,
  toNeo4jEdge,
  toParsedEdge,
} from '../../utils/graph-factory';
import {
  CoreEdgeType,
  CoreNodeType,
  CORE_TYPESCRIPT_SCHEMA,
} from '../../config/schema';
import type { ParsedNode, ParsedEdge, Neo4jEdge, Neo4jEdgeProperties } from '../../config/schema';

describe('graph-factory audit tests', () => {
  // ─── Behavior 1: generateDeterministicId format ───
  describe('generateDeterministicId — format', () => {
    it('produces {projectId}:{coreType}:{hash} format', () => {
      const id = generateDeterministicId('proj_abc', 'Function', 'src/index.ts', 'myFunc');
      const parts = id.split(':');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe('proj_abc');
      expect(parts[1]).toBe('Function');
      expect(parts[2]).toMatch(/^[0-9a-f]{16}$/); // 16-char hex hash
    });
  });

  // ─── Behavior 2: generateDeterministicId is deterministic ───
  describe('generateDeterministicId — determinism', () => {
    it('same inputs produce same output', () => {
      const id1 = generateDeterministicId('proj_1', 'Class', 'src/foo.ts', 'Foo');
      const id2 = generateDeterministicId('proj_1', 'Class', 'src/foo.ts', 'Foo');
      expect(id1).toBe(id2);
    });

    it('different inputs produce different output', () => {
      const id1 = generateDeterministicId('proj_1', 'Class', 'src/foo.ts', 'Foo');
      const id2 = generateDeterministicId('proj_1', 'Class', 'src/foo.ts', 'Bar');
      expect(id1).not.toBe(id2);
    });
  });

  // ─── Behavior 3: parentId in hash for nested nodes ───
  describe('generateDeterministicId — parentId inclusion', () => {
    it('includes parentId in hash when provided (different from no parentId)', () => {
      const withoutParent = generateDeterministicId('proj_1', 'Method', 'src/foo.ts', 'doThing');
      const withParent = generateDeterministicId('proj_1', 'Method', 'src/foo.ts', 'doThing', 'parentNode123');
      expect(withoutParent).not.toBe(withParent);
    });

    it('different parentIds produce different IDs', () => {
      const id1 = generateDeterministicId('proj_1', 'Method', 'src/foo.ts', 'doThing', 'parentA');
      const id2 = generateDeterministicId('proj_1', 'Method', 'src/foo.ts', 'doThing', 'parentB');
      expect(id1).not.toBe(id2);
    });
  });

  // ─── Behavior 4: computeSymbolHash is project-agnostic ───
  describe('computeSymbolHash — project-agnostic', () => {
    it('same file/name/type in different projects produces same hash', () => {
      const hash1 = computeSymbolHash('src/utils.ts', 'helper', 'Function');
      const hash2 = computeSymbolHash('src/utils.ts', 'helper', 'Function');
      expect(hash1).toBe(hash2);
    });

    it('hash does not include projectId (same result regardless)', () => {
      // computeSymbolHash doesn't take projectId at all — that's the design
      // SPEC-GAP: No way to directly verify projectId is excluded; we verify by ensuring
      // the function signature has no projectId parameter and the hash is stable.
      const hash = computeSymbolHash('src/file.ts', 'myFunc', 'Function');
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('different inputs produce different hashes', () => {
      const hash1 = computeSymbolHash('src/a.ts', 'foo', 'Function');
      const hash2 = computeSymbolHash('src/b.ts', 'foo', 'Function');
      expect(hash1).not.toBe(hash2);
    });
  });

  // ─── Behavior 5: generateFrameworkEdgeId format ───
  describe('generateFrameworkEdgeId — format', () => {
    it('produces {semanticType}:{hash} format', () => {
      const id = generateFrameworkEdgeId('ROUTE_HANDLER', 'nodeA', 'nodeB');
      const parts = id.split(':');
      expect(parts.length).toBe(2);
      expect(parts[0]).toBe('ROUTE_HANDLER');
      expect(parts[1]).toMatch(/^[0-9a-f]{16}$/);
    });

    it('is deterministic', () => {
      const id1 = generateFrameworkEdgeId('MIDDLEWARE', 'src1', 'tgt1');
      const id2 = generateFrameworkEdgeId('MIDDLEWARE', 'src1', 'tgt1');
      expect(id1).toBe(id2);
    });
  });

  // ─── Behavior 6: createFrameworkEdgeData defaults ───
  describe('createFrameworkEdgeData — defaults', () => {
    it('returns properties with default confidence=0.8 and source=pattern', () => {
      const result = createFrameworkEdgeData({
        semanticType: 'PROVIDES',
        sourceNodeId: 'node1',
        targetNodeId: 'node2',
        projectId: 'proj_test',
      });

      expect(result.properties.confidence).toBe(0.8);
      expect(result.properties.source).toBe('pattern');
      expect(result.properties.projectId).toBe('proj_test');
      expect(result.properties.semanticType).toBe('PROVIDES');
      expect(result.id).toBeTruthy();
    });

    it('uses provided relationshipWeight override', () => {
      const result = createFrameworkEdgeData({
        semanticType: 'PROVIDES',
        sourceNodeId: 'node1',
        targetNodeId: 'node2',
        projectId: 'proj_test',
        relationshipWeight: 0.9,
      });
      expect(result.properties.relationshipWeight).toBe(0.9);
    });

    // SPEC-GAP: Default relationshipWeight is 0.5 (from destructuring default), not 0.8 like confidence.
    // Spec says "default confidence=0.8" but doesn't mention relationshipWeight default.
    it('has default relationshipWeight of 0.5 when not provided', () => {
      const result = createFrameworkEdgeData({
        semanticType: 'TEST',
        sourceNodeId: 'a',
        targetNodeId: 'b',
        projectId: 'proj',
      });
      expect(result.properties.relationshipWeight).toBe(0.5);
    });
  });

  // ─── Behavior 7: createCoreEdge — schema lookup and fallback ───
  describe('createCoreEdge — relationshipWeight', () => {
    it('uses CORE_TYPESCRIPT_SCHEMA weight for CONTAINS edge', () => {
      const edge = createCoreEdge({
        edgeType: CoreEdgeType.CONTAINS,
        sourceNodeId: 'src1',
        targetNodeId: 'tgt1',
        projectId: 'proj_1',
      });
      const schemaWeight = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.CONTAINS].relationshipWeight;
      expect(edge.properties.relationshipWeight).toBe(schemaWeight);
    });

    it('uses CORE_TYPESCRIPT_SCHEMA weight for IMPORTS edge', () => {
      const edge = createCoreEdge({
        edgeType: CoreEdgeType.IMPORTS,
        sourceNodeId: 'src1',
        targetNodeId: 'tgt1',
        projectId: 'proj_1',
      });
      const schemaWeight = CORE_TYPESCRIPT_SCHEMA.edgeTypes[CoreEdgeType.IMPORTS].relationshipWeight;
      expect(edge.properties.relationshipWeight).toBe(schemaWeight);
    });

    // SPEC-GAP: Cannot easily test fallback to 0.5 without an invalid edgeType,
    // since CoreEdgeType enum constrains valid values and CORE_TYPESCRIPT_SCHEMA has all entries.
    // The fallback path (?? 0.5) exists for safety but may be unreachable with typed inputs.

    it('sets source to ast and confidence to 1.0', () => {
      const edge = createCoreEdge({
        edgeType: CoreEdgeType.CONTAINS,
        sourceNodeId: 'src1',
        targetNodeId: 'tgt1',
        projectId: 'proj_1',
      });
      expect(edge.properties.source).toBe('ast');
      expect(edge.properties.confidence).toBe(1.0);
    });
  });

  // ─── Behavior 8: createCallsEdge — confidence based on receiverType ───
  describe('createCallsEdge — confidence', () => {
    it('sets confidence=0.9 when receiverType is present', () => {
      const edge = createCallsEdge({
        sourceNodeId: 'caller',
        targetNodeId: 'callee',
        projectId: 'proj_1',
        callContext: {
          receiverType: 'MyClass',
          lineNumber: 42,
        },
      });
      expect(edge.properties.confidence).toBe(0.9);
    });

    it('sets confidence=0.7 when receiverType is absent', () => {
      const edge = createCallsEdge({
        sourceNodeId: 'caller',
        targetNodeId: 'callee',
        projectId: 'proj_1',
        callContext: {
          lineNumber: 10,
        },
      });
      expect(edge.properties.confidence).toBe(0.7);
    });

    it('sets confidence=0.7 when callContext is undefined', () => {
      const edge = createCallsEdge({
        sourceNodeId: 'caller',
        targetNodeId: 'callee',
        projectId: 'proj_1',
      });
      expect(edge.properties.confidence).toBe(0.7);
    });
  });

  // ─── Behavior 9: createCallsEdge — lineNumber in edge ID ───
  describe('createCallsEdge — lineNumber in ID', () => {
    it('different lineNumbers produce different edge IDs', () => {
      const edge1 = createCallsEdge({
        sourceNodeId: 'caller',
        targetNodeId: 'callee',
        projectId: 'proj_1',
        callContext: { lineNumber: 10 },
      });
      const edge2 = createCallsEdge({
        sourceNodeId: 'caller',
        targetNodeId: 'callee',
        projectId: 'proj_1',
        callContext: { lineNumber: 20 },
      });
      expect(edge1.id).not.toBe(edge2.id);
    });

    it('same lineNumber produces same edge ID', () => {
      const edge1 = createCallsEdge({
        sourceNodeId: 'caller',
        targetNodeId: 'callee',
        projectId: 'proj_1',
        callContext: { lineNumber: 42 },
      });
      const edge2 = createCallsEdge({
        sourceNodeId: 'caller',
        targetNodeId: 'callee',
        projectId: 'proj_1',
        callContext: { lineNumber: 42 },
      });
      expect(edge1.id).toBe(edge2.id);
    });

    it('edge ID starts with CALLS:', () => {
      const edge = createCallsEdge({
        sourceNodeId: 'caller',
        targetNodeId: 'callee',
        projectId: 'proj_1',
        callContext: { lineNumber: 5 },
      });
      expect(edge.id).toMatch(/^CALLS:[0-9a-f]{16}$/);
    });
  });

  // ─── Behavior 10: toNeo4jNode / toNeo4jEdge conversion ───
  describe('toNeo4jNode — conversion', () => {
    it('correctly converts ParsedNode to Neo4jNode', () => {
      const parsedNode: ParsedNode = {
        id: 'test-node-1',
        coreType: CoreNodeType.FUNCTION_DECLARATION,
        labels: ['CodeNode', 'Function'],
        properties: {
          name: 'testFunc',
          coreType: CoreNodeType.FUNCTION_DECLARATION,
          projectId: 'proj_1',
          filePath: 'src/test.ts',
          startLine: 1,
          endLine: 10,
          createdAt: '2026-01-01T00:00:00Z',
        },
        skipEmbedding: true,
      };

      const neo4jNode = toNeo4jNode(parsedNode);
      expect(neo4jNode.id).toBe('test-node-1');
      expect(neo4jNode.labels).toEqual(['CodeNode', 'Function']);
      expect(neo4jNode.properties.name).toBe('testFunc');
      expect(neo4jNode.skipEmbedding).toBe(true);
    });
  });

  describe('toNeo4jEdge — conversion', () => {
    it('correctly converts ParsedEdge to Neo4jEdge', () => {
      const parsedEdge: ParsedEdge = {
        id: 'edge-1',
        relationshipType: 'CONTAINS',
        sourceNodeId: 'node-a',
        targetNodeId: 'node-b',
        properties: {
          coreType: CoreEdgeType.CONTAINS,
          projectId: 'proj_1',
          source: 'ast',
          confidence: 1.0,
          relationshipWeight: 0.4,
          filePath: 'src/test.ts',
          createdAt: '2026-01-01T00:00:00Z',
        },
      };

      const neo4jEdge = toNeo4jEdge(parsedEdge);
      expect(neo4jEdge.id).toBe('edge-1');
      expect(neo4jEdge.type).toBe('CONTAINS');
      expect(neo4jEdge.startNodeId).toBe('node-a');
      expect(neo4jEdge.endNodeId).toBe('node-b');
      expect(neo4jEdge.properties.confidence).toBe(1.0);
    });
  });

  // ─── Behavior 11: toParsedEdge — round-trip fidelity ───
  describe('toParsedEdge — round-trip', () => {
    it('converts Neo4jEdge back to ParsedEdge correctly', () => {
      const neo4jEdge: Neo4jEdge = {
        id: 'edge-rt',
        type: 'IMPORTS',
        startNodeId: 'src-node',
        endNodeId: 'tgt-node',
        properties: {
          coreType: CoreEdgeType.IMPORTS,
          projectId: 'proj_1',
          source: 'ast',
          confidence: 1.0,
          relationshipWeight: 0.55,
          filePath: 'src/main.ts',
          createdAt: '2026-01-01T00:00:00Z',
        },
      };

      const parsed = toParsedEdge(neo4jEdge);
      expect(parsed.id).toBe('edge-rt');
      expect(parsed.relationshipType).toBe('IMPORTS');
      expect(parsed.sourceNodeId).toBe('src-node');
      expect(parsed.targetNodeId).toBe('tgt-node');
      expect(parsed.properties).toBe(neo4jEdge.properties); // Same reference
    });

    it('round-trip: ParsedEdge → Neo4jEdge → ParsedEdge preserves data', () => {
      const original: ParsedEdge = {
        id: 'edge-round',
        relationshipType: 'EXTENDS',
        sourceNodeId: 'child',
        targetNodeId: 'parent',
        properties: {
          coreType: CoreEdgeType.EXTENDS,
          projectId: 'proj_1',
          source: 'ast',
          confidence: 1.0,
          relationshipWeight: 0.7,
          filePath: 'src/types.ts',
          createdAt: '2026-01-01T00:00:00Z',
        },
      };

      const neo4j = toNeo4jEdge(original);
      const backToParsed = toParsedEdge(neo4j);

      expect(backToParsed.id).toBe(original.id);
      expect(backToParsed.relationshipType).toBe(original.relationshipType);
      expect(backToParsed.sourceNodeId).toBe(original.sourceNodeId);
      expect(backToParsed.targetNodeId).toBe(original.targetNodeId);
      expect(backToParsed.properties).toEqual(original.properties);
    });
  });
});
