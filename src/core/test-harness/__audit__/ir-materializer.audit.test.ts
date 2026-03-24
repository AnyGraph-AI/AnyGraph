/**
 * AUD-TC-06-L2-01: ir-materializer.ts behavioral audit tests
 *
 * Spec-derived gap tests for behaviors NOT covered by rf17-live-guard-integration.spec-test.ts
 *
 * RF17 existing test verdict: INCOMPLETE
 *   Covered: (2) validateProjectWrite guard (live path), (9) materializeIrDocument convenience
 *   Missing: (1) input validation, (3) clearProjectFirst, (4) node MERGE key shape,
 *            (5) edge MERGE with apoc, (6) mapNode label assignment, (7) mapEdge originalEdgeType,
 *            (8) batching, (10) result counts
 *
 * These tests mock Neo4j to test materializer BEHAVIOR (cypher shape, batching, label logic).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks (hoisted so vi.mock factories can reference them) ──

const { mockRun, mockClose, mockDriverClose, mockValidateProjectWrite } = vi.hoisted(() => ({
  mockRun: vi.fn().mockResolvedValue([{ created: 1 }]),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockDriverClose: vi.fn().mockResolvedValue(undefined),
  mockValidateProjectWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => {
  return {
    Neo4jService: class MockNeo4jService {
      run = mockRun;
      getDriver = vi.fn().mockReturnValue({ close: mockDriverClose });
      close = mockClose;
    },
  };
});

vi.mock('../../guards/project-write-guard.js', () => ({
  validateProjectWrite: mockValidateProjectWrite,
}));

import { IrMaterializer, materializeIrDocument } from '../../ir/ir-materializer.js';
import type { IrDocument } from '../../ir/ir-v1.schema.js';

// ── Fixtures ──

function validDoc(overrides: Partial<IrDocument> = {}): IrDocument {
  return {
    version: 'ir.v1',
    projectId: 'test-project',
    sourceKind: 'code',
    nodes: [
      {
        id: 'n1',
        type: 'Symbol',
        kind: 'Function',
        name: 'foo',
        projectId: 'test-project',
        parserTier: 0,
        confidence: 1,
        provenanceKind: 'parser',
        properties: {},
      },
    ],
    edges: [],
    metadata: {},
    ...overrides,
  } as IrDocument;
}

function docWithEdge(): IrDocument {
  return {
    version: 'ir.v1',
    projectId: 'test-project',
    sourceKind: 'code',
    nodes: [
      {
        id: 'n1', type: 'Symbol', kind: 'Function', name: 'foo',
        projectId: 'test-project', parserTier: 0, confidence: 1, provenanceKind: 'parser', properties: {},
      },
      {
        id: 'n2', type: 'Symbol', kind: 'Function', name: 'bar',
        projectId: 'test-project', parserTier: 0, confidence: 1, provenanceKind: 'parser', properties: {},
      },
    ],
    edges: [
      {
        type: 'CALLS', from: 'n1', to: 'n2',
        projectId: 'test-project', parserTier: 0, confidence: 1, provenanceKind: 'parser', properties: {},
      },
    ],
    metadata: {},
  } as IrDocument;
}

// ── Tests ──

describe('AUD-TC-06-L2-01: IrMaterializer behavioral audit', () => {
  let materializer: IrMaterializer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue([{ created: 1 }]);
    materializer = new IrMaterializer();
  });

  // ── (1) materialize validates input via assertValidIrDocument ──
  it('(1) rejects invalid IR document (missing required fields)', async () => {
    await expect(materializer.materialize({ garbage: true })).rejects.toThrow(/Invalid IR/);
    // validateProjectWrite should NOT have been called
    expect(mockValidateProjectWrite).not.toHaveBeenCalled();
  });

  it('(1b) rejects document with wrong version', async () => {
    await expect(
      materializer.materialize({ version: 'ir.v2', projectId: 'x', sourceKind: 'code', nodes: [], edges: [], metadata: {} }),
    ).rejects.toThrow();
  });

  // ── (2) materialize calls validateProjectWrite before any graph mutation ──
  it('(2) calls validateProjectWrite before any Neo4j writes', async () => {
    const doc = validDoc();
    await materializer.materialize(doc);

    expect(mockValidateProjectWrite).toHaveBeenCalledTimes(1);
    // validateProjectWrite is called BEFORE run
    const validateOrder = mockValidateProjectWrite.mock.invocationCallOrder[0];
    const runOrder = mockRun.mock.invocationCallOrder[0];
    expect(validateOrder).toBeLessThan(runOrder);
  });

  it('(2b) propagates validateProjectWrite rejection', async () => {
    mockValidateProjectWrite.mockRejectedValueOnce(new Error('Not registered'));
    await expect(materializer.materialize(validDoc())).rejects.toThrow('Not registered');
    expect(mockRun).not.toHaveBeenCalled();
  });

  // ── (3) clearProjectFirst deletes existing project nodes ──
  it('(3) clears existing project nodes when clearProjectFirst: true', async () => {
    await materializer.materialize(validDoc(), { clearProjectFirst: true });

    // First call after validateProjectWrite should be the DETACH DELETE
    const firstRunCall = mockRun.mock.calls[0];
    expect(firstRunCall[0]).toMatch(/DETACH DELETE/);
    expect(firstRunCall[1]).toEqual({ projectId: 'test-project' });
  });

  it('(3b) does not clear when clearProjectFirst is false/absent', async () => {
    await materializer.materialize(validDoc(), { clearProjectFirst: false });

    const calls = mockRun.mock.calls;
    const deleteCall = calls.find(([q]: [string]) => q.includes('DETACH DELETE'));
    expect(deleteCall).toBeUndefined();
  });

  // ── (4) node MERGE uses {id, projectId} as key ──
  it('(4) node MERGE cypher uses id+projectId as merge key (idempotent upserts)', async () => {
    await materializer.materialize(validDoc());

    const nodeCall = mockRun.mock.calls.find(([q]: [string]) => q.includes('apoc.merge.node'));
    expect(nodeCall).toBeDefined();
    // The cypher should merge on {id, projectId}
    expect(nodeCall![0]).toContain('{id: nodeData.properties.id, projectId: nodeData.properties.projectId}');
    // The payload should include the node properties
    const payload = nodeCall![1].nodes;
    expect(payload[0].properties.id).toBe('n1');
    expect(payload[0].properties.projectId).toBe('test-project');
  });

  // ── (5) edge MERGE uses apoc.merge.relationship with projectId scoping ──
  it('(5) edge MERGE uses apoc.merge.relationship with projectId scoping', async () => {
    const doc = docWithEdge();
    await materializer.materialize(doc);

    const edgeCall = mockRun.mock.calls.find(([q]: [string]) => q.includes('apoc.merge.relationship'));
    expect(edgeCall).toBeDefined();
    expect(edgeCall![0]).toContain('{projectId: $projectId}');
    expect(edgeCall![1].projectId).toBe('test-project');
  });

  // ── (6) mapNode assigns correct labels ──
  it('(6a) mapNode assigns labels [IRNode, type] for code sourceKind', async () => {
    await materializer.materialize(validDoc());

    const nodeCall = mockRun.mock.calls.find(([q]: [string]) => q.includes('apoc.merge.node'));
    const payload = nodeCall![1].nodes;
    expect(payload[0].labels).toContain('IRNode');
    expect(payload[0].labels).toContain('Symbol');
  });

  it('(6b) mapNode adds document-specific labels for sourceKind=document', async () => {
    const doc = validDoc({
      sourceKind: 'document',
      nodes: [
        {
          id: 'doc1', type: 'Entity', kind: 'ExtractedEntity', name: 'Person X',
          projectId: 'test-project', parserTier: 0, confidence: 1, provenanceKind: 'parser', properties: {},
        } as any,
      ],
    });

    await materializer.materialize(doc);

    const nodeCall = mockRun.mock.calls.find(([q]: [string]) => q.includes('apoc.merge.node'));
    const payload = nodeCall![1].nodes;
    // Entity type with sourceKind=document should get ExtractedEntity label
    expect(payload[0].labels).toContain('IRNode');
    expect(payload[0].labels).toContain('Entity');
    expect(payload[0].labels).toContain('ExtractedEntity');
  });

  it('(6c) mapNode adds DocumentNode label for document sourceKind', async () => {
    const doc = validDoc({
      sourceKind: 'document',
      nodes: [
        {
          id: 'dn1', type: 'Artifact', kind: 'DocumentNode', name: 'doc-1',
          projectId: 'test-project', parserTier: 0, confidence: 1, provenanceKind: 'parser', properties: {},
        } as any,
      ],
    });

    await materializer.materialize(doc);

    const nodeCall = mockRun.mock.calls.find(([q]: [string]) => q.includes('apoc.merge.node'));
    const payload = nodeCall![1].nodes;
    expect(payload[0].labels).toContain('DocumentNode');
  });

  // ── (7) mapEdge restores originalEdgeType ──
  it('(7) mapEdge restores originalEdgeType when IR mapping collapsed the type', async () => {
    const doc: IrDocument = {
      version: 'ir.v1',
      projectId: 'test-project',
      sourceKind: 'code',
      nodes: [
        { id: 'n1', type: 'Symbol', kind: 'Function', name: 'a', projectId: 'test-project', parserTier: 0, confidence: 1, provenanceKind: 'parser', properties: {} },
        { id: 'n2', type: 'Symbol', kind: 'Variable', name: 'b', projectId: 'test-project', parserTier: 0, confidence: 1, provenanceKind: 'parser', properties: {} },
      ],
      edges: [
        {
          type: 'REFERENCES', from: 'n1', to: 'n2',
          projectId: 'test-project', parserTier: 0, confidence: 1, provenanceKind: 'parser',
          properties: { originalEdgeType: 'READS_STATE' },
        },
      ],
      metadata: {},
    } as IrDocument;

    await materializer.materialize(doc);

    const edgeCall = mockRun.mock.calls.find(([q]: [string]) => q.includes('apoc.merge.relationship'));
    const payload = edgeCall![1].edges;
    // The edge type in the Cypher payload should be the restored READS_STATE, not REFERENCES
    expect(payload[0].type).toBe('READS_STATE');
  });

  it('(7b) mapEdge keeps original type when no originalEdgeType present', async () => {
    const doc = docWithEdge();
    await materializer.materialize(doc);

    const edgeCall = mockRun.mock.calls.find(([q]: [string]) => q.includes('apoc.merge.relationship'));
    const payload = edgeCall![1].edges;
    expect(payload[0].type).toBe('CALLS');
  });

  // ── (8) batching chunks by batchSize ──
  it('(8) batching chunks nodes by batchSize', async () => {
    const nodes = Array.from({ length: 5 }, (_, i) => ({
      id: `n${i}`, type: 'Symbol' as const, kind: 'Function', name: `fn${i}`,
      projectId: 'test-project', parserTier: 0 as const, confidence: 1,
      provenanceKind: 'parser' as const, properties: {},
    }));

    const doc = validDoc({ nodes });
    await materializer.materialize(doc, { batchSize: 2 });

    // 5 nodes with batchSize=2 → 3 node batches
    const nodeCalls = mockRun.mock.calls.filter(([q]: [string]) => q.includes('apoc.merge.node'));
    expect(nodeCalls).toHaveLength(3);
    expect(nodeCalls[0][1].nodes).toHaveLength(2);
    expect(nodeCalls[1][1].nodes).toHaveLength(2);
    expect(nodeCalls[2][1].nodes).toHaveLength(1);
  });

  // ── (9) materializeIrDocument convenience function closes driver ──
  it('(9) materializeIrDocument closes driver after use', async () => {
    const doc = validDoc();
    await materializeIrDocument(doc);
    expect(mockDriverClose).toHaveBeenCalled();
  });

  // ── (10) result reports accurate counts ──
  it('(10) result reports accurate counts (nodesCreated, edgesCreated, batches)', async () => {
    mockRun.mockImplementation(async (query: string) => {
      if (query.includes('DETACH DELETE')) return [];
      return [{ created: 3 }];
    });

    const doc = docWithEdge(); // 2 nodes, 1 edge
    const result = await materializer.materialize(doc, { batchSize: 500 });

    expect(result.projectId).toBe('test-project');
    expect(result.nodesCreated).toBe(3); // mock returns created:3 for node batch
    expect(result.edgesCreated).toBe(3); // mock returns created:3 for edge batch
    expect(result.batches).toBe(2); // 1 node batch + 1 edge batch
  });
});
