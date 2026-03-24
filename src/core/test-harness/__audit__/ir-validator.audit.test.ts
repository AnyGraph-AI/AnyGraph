/**
 * AUD-TC-06-L1-02: ir-validator.ts behavioral audit tests
 *
 * Spec sources:
 *  - plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §2 "Parser Integration Layer (IR)"
 *  - plans/codegraph/ADAPTER_ROADMAP.md — M1 "IR v1 Schema": "Build IR validator (validates parser output before Neo4j)"
 *
 * Tests assert BEHAVIOR from specs, not implementation details.
 * Accept criteria: 5+ behavioral assertions, all green.
 */
import { describe, it, expect } from 'vitest';
import { validateIrDocument, assertValidIrDocument } from '../../ir/ir-validator.js';

// ============================================================================
// Helpers
// ============================================================================

function makeValidDoc() {
  return {
    version: 'ir.v1',
    projectId: 'proj_test',
    sourceKind: 'code',
    nodes: [
      {
        id: 'n1',
        type: 'Symbol',
        kind: 'Function',
        name: 'foo',
        projectId: 'proj_test',
        parserTier: 0,
        confidence: 1,
        provenanceKind: 'parser',
        properties: {},
      },
    ],
    edges: [],
    metadata: {},
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ir-validator.ts behavioral audit', () => {
  it('(1) validateIrDocument returns {ok: true, data} for valid documents', () => {
    const result = validateIrDocument(makeValidDoc());
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.version).toBe('ir.v1');
    expect(result.errors).toEqual([]);
  });

  it('(2) validateIrDocument returns {ok: false, errors} with path-specific error messages for invalid docs', () => {
    const invalid = {
      version: 'ir.v1',
      projectId: 'proj_test',
      sourceKind: 'code',
      nodes: [
        {
          // missing id, type, kind, name
          projectId: 'proj_test',
          parserTier: 0,
        },
      ],
      edges: [],
      metadata: {},
    };
    const result = validateIrDocument(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Errors should reference the path into the document
    expect(result.errors.some((e) => e.includes('nodes'))).toBe(true);
  });

  it('(3) assertValidIrDocument returns the validated document for valid input', () => {
    const doc = makeValidDoc();
    const result = assertValidIrDocument(doc);
    expect(result.version).toBe('ir.v1');
    expect(result.projectId).toBe('proj_test');
  });

  it('(4) assertValidIrDocument throws with formatted error messages listing all issues for invalid input', () => {
    const invalid = {
      version: 'ir.v1',
      projectId: 'proj_test',
      sourceKind: 'code',
      nodes: [{ projectId: 'proj_test', parserTier: 0 }],
      edges: [],
      metadata: {},
    };
    expect(() => assertValidIrDocument(invalid)).toThrow('Invalid IR v1 document');
  });

  it('(5) error messages include Zod path (e.g., nodes.0.id: Required)', () => {
    const invalid = {
      version: 'ir.v1',
      projectId: 'proj_test',
      sourceKind: 'code',
      nodes: [
        {
          // missing id
          type: 'Symbol',
          kind: 'Function',
          name: 'foo',
          projectId: 'proj_test',
          parserTier: 0,
          properties: {},
        },
      ],
      edges: [],
      metadata: {},
    };
    const result = validateIrDocument(invalid);
    expect(result.ok).toBe(false);
    // Should contain path like "nodes.0.id"
    expect(result.errors.some((e) => /nodes\.0\.id/.test(e))).toBe(true);
  });
});
