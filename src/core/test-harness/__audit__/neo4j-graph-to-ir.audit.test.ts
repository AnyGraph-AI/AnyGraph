/**
 * AUD-TC-06-L1-03: neo4j-graph-to-ir.ts behavioral audit tests
 *
 * Spec sources:
 *  - plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §2 "Parser Integration Layer (IR)"
 *  - plans/codegraph/ADAPTER_ROADMAP.md — M1 "IR Foundation": "Build IR → Neo4j materializer"
 *
 * Tests assert BEHAVIOR from specs, not implementation details.
 * Accept criteria: 8+ behavioral assertions, all green.
 */
import { describe, it, expect } from 'vitest';
import {
  convertNeo4jGraphToIrDocument,
  convertNeo4jEdgesToIrDocument,
} from '../../ir/neo4j-graph-to-ir.js';
import type { Neo4jNode, Neo4jEdge } from '../../config/schema.js';
import { CoreNodeType, CoreEdgeType } from '../../config/schema.js';
import { IrDocumentSchema } from '../../ir/ir-v1.schema.js';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj_test';

function makeNeo4jNode(overrides: Partial<Neo4jNode> & { labels?: string[] } = {}): Neo4jNode {
  return {
    id: 'node-1',
    labels: ['Function'],
    properties: {
      id: 'node-1',
      projectId: PROJECT_ID,
      name: 'doStuff',
      coreType: CoreNodeType.FUNCTION_DECLARATION,
      filePath: 'src/index.ts',
      startLine: 10,
      endLine: 30,
      sourceCode: 'function doStuff() {}',
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  } as Neo4jNode;
}

function makeNeo4jEdge(overrides: Partial<Neo4jEdge> = {}): Neo4jEdge {
  return {
    id: 'edge-1',
    type: 'CALLS',
    startNodeId: 'node-1',
    endNodeId: 'node-2',
    properties: {
      coreType: CoreEdgeType.CALLS,
      projectId: PROJECT_ID,
      source: 'ast',
      confidence: 0.95,
      relationshipWeight: 1,
      filePath: 'src/index.ts',
      createdAt: new Date().toISOString(),
    },
    ...overrides,
  } as Neo4jEdge;
}

// ============================================================================
// Tests
// ============================================================================

describe('neo4j-graph-to-ir.ts behavioral audit', () => {
  it('(1) mapIrNodeType maps labels correctly: SourceFile→Artifact, Class/Interface→Container, Function/Method/Variable/TypeAlias→Symbol, Import/Parameter→Site, Field/Entrypoint/Author/Project→Entity, unknown→Assertion', () => {
    const labelToExpected: Record<string, string> = {
      SourceFile: 'Artifact',
      Class: 'Container',
      Interface: 'Container',
      Function: 'Symbol',
      Method: 'Symbol',
      Variable: 'Symbol',
      TypeAlias: 'Symbol',
      Import: 'Site',
      Parameter: 'Site',
      Field: 'Entity',
      Entrypoint: 'Entity',
      Author: 'Entity',
      Project: 'Entity',
    };

    for (const [label, expectedType] of Object.entries(labelToExpected)) {
      const node = makeNeo4jNode({ id: `node-${label}`, labels: [label] });
      const doc = convertNeo4jGraphToIrDocument([node], [], PROJECT_ID);
      expect(doc.nodes[0].type).toBe(expectedType);
    }

    // Unknown label → Assertion
    const unknownNode = makeNeo4jNode({ id: 'node-unknown', labels: ['SomethingWeird'] });
    const unknownDoc = convertNeo4jGraphToIrDocument([unknownNode], [], PROJECT_ID);
    expect(unknownDoc.nodes[0].type).toBe('Assertion');
  });

  it('(2) mapIrEdgeType preserves direct IR vocabulary matches (CONTAINS/CALLS/IMPORTS/RESOLVES_TO/REFERENCES/MENTIONS/QUOTES/REGISTERED_BY)', () => {
    const directTypes = ['CONTAINS', 'CALLS', 'IMPORTS', 'RESOLVES_TO', 'REFERENCES', 'MENTIONS', 'QUOTES', 'REGISTERED_BY'];

    for (const edgeType of directTypes) {
      const node1 = makeNeo4jNode({ id: 'n1' });
      const node2 = makeNeo4jNode({ id: 'n2', labels: ['Function'] });
      const edge = makeNeo4jEdge({ type: edgeType, startNodeId: 'n1', endNodeId: 'n2' });
      const doc = convertNeo4jGraphToIrDocument([node1, node2], [edge], PROJECT_ID);
      expect(doc.edges[0].type).toBe(edgeType);
    }
  });

  it('(3) mapIrEdgeType maps structural edges (HAS_PARAMETER/HAS_MEMBER/EXTENDS/IMPLEMENTS) to DECLARES', () => {
    const structuralTypes = ['HAS_PARAMETER', 'HAS_MEMBER', 'EXTENDS', 'IMPLEMENTS'];

    for (const edgeType of structuralTypes) {
      const node1 = makeNeo4jNode({ id: 'n1' });
      const node2 = makeNeo4jNode({ id: 'n2', labels: ['Function'] });
      const edge = makeNeo4jEdge({ type: edgeType, startNodeId: 'n1', endNodeId: 'n2' });
      const doc = convertNeo4jGraphToIrDocument([node1, node2], [edge], PROJECT_ID);
      expect(doc.edges[0].type).toBe('DECLARES');
      expect(doc.edges[0].properties.originalEdgeType).toBe(edgeType);
    }
  });

  it('(4) mapIrEdgeType maps unknown enrichment edges to REFERENCES with originalEdgeType preserved in properties', () => {
    const unknownTypes = ['ORIGINATES_IN', 'READS_STATE', 'WRITES_STATE', 'FOUND', 'OWNED_BY'];

    for (const edgeType of unknownTypes) {
      const node1 = makeNeo4jNode({ id: 'n1' });
      const node2 = makeNeo4jNode({ id: 'n2', labels: ['Function'] });
      const edge = makeNeo4jEdge({ type: edgeType, startNodeId: 'n1', endNodeId: 'n2' });
      const doc = convertNeo4jGraphToIrDocument([node1, node2], [edge], PROJECT_ID);
      expect(doc.edges[0].type).toBe('REFERENCES');
      expect(doc.edges[0].properties.originalEdgeType).toBe(edgeType);
    }
  });

  it('(5) convertNeo4jGraphToIrDocument produces valid IrDocument with version=ir.v1, sourceKind=code, language=typescript', () => {
    const node = makeNeo4jNode();
    const doc = convertNeo4jGraphToIrDocument([node], [], PROJECT_ID, '/src');

    expect(doc.version).toBe('ir.v1');
    expect(doc.sourceKind).toBe('code');
    expect(doc.nodes[0].language).toBe('typescript');

    // Validate against schema
    const result = IrDocumentSchema.safeParse(doc);
    expect(result.success).toBe(true);
  });

  it('(6) convertNeo4jGraphToIrDocument preserves node range (startLine/endLine) when present', () => {
    const node = makeNeo4jNode({
      properties: {
        ...makeNeo4jNode().properties,
        startLine: 5,
        endLine: 25,
      },
    });
    const doc = convertNeo4jGraphToIrDocument([node], [], PROJECT_ID);
    expect(doc.nodes[0].range).toBeDefined();
    expect(doc.nodes[0].range!.startLine).toBe(5);
    expect(doc.nodes[0].range!.endLine).toBe(25);
  });

  it('(7) convertNeo4jEdgesToIrDocument creates edge-only document with allowExternalEdgeEndpoints: true in metadata', () => {
    const edge = makeNeo4jEdge();
    const doc = convertNeo4jEdgesToIrDocument([edge], PROJECT_ID);

    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toHaveLength(1);
    expect(doc.metadata.allowExternalEdgeEndpoints).toBe(true);

    // Should validate despite missing nodes because of the flag
    const result = IrDocumentSchema.safeParse(doc);
    expect(result.success).toBe(true);
  });

  it('(8) edge confidence defaults to 1 when source confidence is non-numeric', () => {
    const edge = makeNeo4jEdge({
      properties: {
        ...makeNeo4jEdge().properties,
        confidence: 'not-a-number' as unknown as number,
      },
    });
    const node1 = makeNeo4jNode({ id: 'node-1' });
    const node2 = makeNeo4jNode({ id: 'node-2', labels: ['Function'] });
    const doc = convertNeo4jGraphToIrDocument([node1, node2], [edge], PROJECT_ID);
    expect(doc.edges[0].confidence).toBe(1);
  });
});
