/**
 * AUD-TC-06-L1-01: ir-v1.schema.ts behavioral audit tests
 *
 * Spec sources:
 *  - plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §2 "Parser Integration Layer (IR)"
 *  - plans/codegraph/ADAPTER_ROADMAP.md — Sprint 1 "IR Foundation"
 *
 * Tests assert BEHAVIOR from specs, not implementation details.
 * Accept criteria: 10+ behavioral assertions, all green.
 */
import { describe, it, expect } from 'vitest';
import {
  IrNodeTypeSchema,
  IrEdgeTypeSchema,
  IrNodeSchema,
  IrEdgeSchema,
  IrRangeSchema,
  IrDocumentSchema,
} from '../../ir/ir-v1.schema.js';

// ============================================================================
// Helpers
// ============================================================================

function makeValidNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-1',
    type: 'Symbol',
    kind: 'Function',
    name: 'doSomething',
    projectId: 'proj_test',
    parserTier: 0,
    confidence: 0.95,
    provenanceKind: 'parser',
    properties: {},
    ...overrides,
  };
}

function makeValidEdge(overrides: Record<string, unknown> = {}) {
  return {
    type: 'CALLS',
    from: 'node-1',
    to: 'node-2',
    projectId: 'proj_test',
    parserTier: 0,
    confidence: 1,
    provenanceKind: 'parser',
    properties: {},
    ...overrides,
  };
}

function makeValidDocument(overrides: Record<string, unknown> = {}) {
  return {
    version: 'ir.v1',
    projectId: 'proj_test',
    sourceKind: 'code',
    nodes: [
      makeValidNode({ id: 'node-1' }),
      makeValidNode({ id: 'node-2', name: 'otherFn' }),
    ],
    edges: [makeValidEdge()],
    metadata: {},
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ir-v1.schema.ts behavioral audit', () => {
  it('(1) IrNodeTypeSchema accepts exactly 6 values: Artifact/Container/Symbol/Site/Entity/Assertion', () => {
    const expected = ['Artifact', 'Container', 'Symbol', 'Site', 'Entity', 'Assertion'];
    for (const val of expected) {
      expect(IrNodeTypeSchema.safeParse(val).success).toBe(true);
    }
    // Exactly 6 — no extras
    expect(IrNodeTypeSchema.options).toHaveLength(6);
    expect(new Set(IrNodeTypeSchema.options)).toEqual(new Set(expected));
    // Reject unknown
    expect(IrNodeTypeSchema.safeParse('Module').success).toBe(false);
  });

  it('(2) IrEdgeTypeSchema accepts exactly 9 values: CONTAINS/DECLARES/IMPORTS/CALLS/RESOLVES_TO/REFERENCES/MENTIONS/QUOTES/REGISTERED_BY', () => {
    const expected = [
      'CONTAINS', 'DECLARES', 'IMPORTS', 'CALLS', 'RESOLVES_TO',
      'REFERENCES', 'MENTIONS', 'QUOTES', 'REGISTERED_BY',
    ];
    for (const val of expected) {
      expect(IrEdgeTypeSchema.safeParse(val).success).toBe(true);
    }
    expect(IrEdgeTypeSchema.options).toHaveLength(9);
    expect(new Set(IrEdgeTypeSchema.options)).toEqual(new Set(expected));
    // Reject unknown
    expect(IrEdgeTypeSchema.safeParse('EXTENDS').success).toBe(false);
  });

  it('(3) IrNodeSchema rejects nodes with missing required fields (id/type/kind/name/projectId)', () => {
    const requiredFields = ['id', 'type', 'kind', 'name', 'projectId'];
    for (const field of requiredFields) {
      const node = makeValidNode();
      delete (node as Record<string, unknown>)[field];
      const result = IrNodeSchema.safeParse(node);
      expect(result.success).toBe(false);
    }
  });

  it('(4) IrNodeSchema enforces parserTier is int 0-2 and confidence is 0-1', () => {
    // parserTier must be int 0-2
    expect(IrNodeSchema.safeParse(makeValidNode({ parserTier: -1 })).success).toBe(false);
    expect(IrNodeSchema.safeParse(makeValidNode({ parserTier: 3 })).success).toBe(false);
    expect(IrNodeSchema.safeParse(makeValidNode({ parserTier: 1.5 })).success).toBe(false);
    expect(IrNodeSchema.safeParse(makeValidNode({ parserTier: 0 })).success).toBe(true);
    expect(IrNodeSchema.safeParse(makeValidNode({ parserTier: 2 })).success).toBe(true);

    // confidence must be 0-1
    expect(IrNodeSchema.safeParse(makeValidNode({ confidence: -0.1 })).success).toBe(false);
    expect(IrNodeSchema.safeParse(makeValidNode({ confidence: 1.1 })).success).toBe(false);
    expect(IrNodeSchema.safeParse(makeValidNode({ confidence: 0.5 })).success).toBe(true);
  });

  it('(5) IrRangeSchema enforces startLine >= 1 and is strict (no extra fields)', () => {
    // startLine must be >= 1
    expect(IrRangeSchema.safeParse({ startLine: 0 }).success).toBe(false);
    expect(IrRangeSchema.safeParse({ startLine: 1 }).success).toBe(true);

    // Strict mode — no extra fields
    expect(IrRangeSchema.safeParse({ startLine: 1, extraField: 'bad' }).success).toBe(false);
  });

  it('(6) IrDocumentSchema version must be literal ir.v1', () => {
    const doc = makeValidDocument({ version: 'ir.v2' });
    const result = IrDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);

    const validDoc = makeValidDocument({ version: 'ir.v1' });
    const validResult = IrDocumentSchema.safeParse(validDoc);
    expect(validResult.success).toBe(true);
  });

  it('(7) IrDocumentSchema.superRefine rejects nodes with mismatched projectId', () => {
    const doc = makeValidDocument({
      nodes: [
        makeValidNode({ id: 'node-1', projectId: 'proj_test' }),
        makeValidNode({ id: 'node-2', name: 'otherFn', projectId: 'proj_WRONG' }),
      ],
      edges: [],
    });
    const result = IrDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('nodes must match document projectId'))).toBe(true);
  });

  it('(8) IrDocumentSchema.superRefine rejects edges referencing missing nodes (unless allowExternalEdgeEndpoints)', () => {
    // Edges to missing nodes — should fail
    const doc = makeValidDocument({
      nodes: [makeValidNode({ id: 'node-1' })],
      edges: [makeValidEdge({ from: 'node-1', to: 'node-MISSING' })],
    });
    const result = IrDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('references missing node'))).toBe(true);

    // With allowExternalEdgeEndpoints — should pass
    const docWithFlag = makeValidDocument({
      nodes: [makeValidNode({ id: 'node-1' })],
      edges: [makeValidEdge({ from: 'node-1', to: 'node-MISSING' })],
      metadata: { allowExternalEdgeEndpoints: true },
    });
    const flagResult = IrDocumentSchema.safeParse(docWithFlag);
    expect(flagResult.success).toBe(true);
  });

  it('(9) IrDocumentSchema.superRefine rejects edges with mismatched projectId', () => {
    const doc = makeValidDocument({
      edges: [makeValidEdge({ projectId: 'proj_WRONG' })],
    });
    const result = IrDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => i.message.includes('edges must match document projectId'))).toBe(true);
  });

  it('(10) IrEdgeSchema allows optional id field (edge IDs are optional per spec)', () => {
    // Without id — valid
    const edgeNoId = makeValidEdge();
    expect(IrEdgeSchema.safeParse(edgeNoId).success).toBe(true);

    // With id — valid
    const edgeWithId = makeValidEdge({ id: 'edge-001' });
    expect(IrEdgeSchema.safeParse(edgeWithId).success).toBe(true);
  });
});
