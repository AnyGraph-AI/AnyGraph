// Spec source: plans/codegraph/ADAPTER_ROADMAP.md §Milestone 7 "Define parser-stage node schema"
// Spec source: plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §"Parser Self-Modeling" (line ~485)
// AUD-TC-11a-L1-08: meta/parser-contract-schema.ts (60 lines)
import { describe, it, expect } from 'vitest';
import {
  ParserStageTypeSchema,
  ParserContractNodeSchema,
  ParserContractEdgeSchema,
  ParserContractGraphSchema,
} from '../../parsers/meta/parser-contract-schema.js';

describe('ParserStageTypeSchema', () => {
  it('(1) accepts exactly 5 stage values: parse, normalize, enrich, materialize, verify', () => {
    const validStages = ['parse', 'normalize', 'enrich', 'materialize', 'verify'] as const;
    for (const stage of validStages) {
      expect(ParserStageTypeSchema.parse(stage)).toBe(stage);
    }
    // Ensure enum has exactly 5 options
    expect(ParserStageTypeSchema.options).toHaveLength(5);
    expect(ParserStageTypeSchema.options).toEqual(
      expect.arrayContaining(['parse', 'normalize', 'enrich', 'materialize', 'verify']),
    );
  });
});

describe('ParserContractNodeSchema', () => {
  const validNode = {
    id: 'test:parser:plan-parser:stage:parse',
    projectId: 'plan_codegraph',
    parserName: 'plan-parser',
    stage: 'parse' as const,
    name: 'parse markdown plan files',
  };

  it('(2) validates objects with required fields: id, projectId, parserName, stage, name; optional: sourcePath, functionName, confidence, createdAt', () => {
    const result = ParserContractNodeSchema.parse(validNode);
    expect(result.id).toBe(validNode.id);
    expect(result.projectId).toBe(validNode.projectId);
    expect(result.parserName).toBe(validNode.parserName);
    expect(result.stage).toBe(validNode.stage);
    expect(result.name).toBe(validNode.name);

    // Optional fields accepted
    const withOptional = ParserContractNodeSchema.parse({
      ...validNode,
      sourcePath: '/some/path.ts',
      functionName: 'parsePlanDirectory',
      confidence: 0.85,
      createdAt: '2026-03-24T12:00:00.000Z',
    });
    expect(withOptional.sourcePath).toBe('/some/path.ts');
    expect(withOptional.functionName).toBe('parsePlanDirectory');
    expect(withOptional.confidence).toBe(0.85);
    expect(withOptional.createdAt).toBe('2026-03-24T12:00:00.000Z');
  });

  it('(3) has array defaults: emitsNodeTypes=[], emitsEdgeTypes=[], readsPlanFields=[], mutatesTaskFields=[]', () => {
    const result = ParserContractNodeSchema.parse(validNode);
    expect(result.emitsNodeTypes).toEqual([]);
    expect(result.emitsEdgeTypes).toEqual([]);
    expect(result.readsPlanFields).toEqual([]);
    expect(result.mutatesTaskFields).toEqual([]);
  });

  it('(4) confidence is bounded 0–1 with default 1', () => {
    // Default
    const result = ParserContractNodeSchema.parse(validNode);
    expect(result.confidence).toBe(1);

    // Boundary values
    expect(ParserContractNodeSchema.parse({ ...validNode, confidence: 0 }).confidence).toBe(0);
    expect(ParserContractNodeSchema.parse({ ...validNode, confidence: 1 }).confidence).toBe(1);
    expect(ParserContractNodeSchema.parse({ ...validNode, confidence: 0.5 }).confidence).toBe(0.5);
  });
});

describe('ParserContractEdgeSchema', () => {
  it('(5) validates with type enum: NEXT_STAGE, EMITS_NODE_TYPE, EMITS_EDGE_TYPE, READS_PLAN_FIELD, MUTATES_TASK_FIELD', () => {
    const edgeTypes = [
      'NEXT_STAGE',
      'EMITS_NODE_TYPE',
      'EMITS_EDGE_TYPE',
      'READS_PLAN_FIELD',
      'MUTATES_TASK_FIELD',
    ] as const;

    for (const type of edgeTypes) {
      const result = ParserContractEdgeSchema.parse({
        type,
        from: 'node-a',
        to: 'node-b',
        projectId: 'plan_codegraph',
      });
      expect(result.type).toBe(type);
    }
  });
});

describe('ParserContractGraphSchema', () => {
  it('(6) enforces version literal parser-contract.v1', () => {
    const validGraph = {
      version: 'parser-contract.v1' as const,
      projectId: 'plan_codegraph',
      parserName: 'plan-parser',
      nodes: [],
      edges: [],
    };
    const result = ParserContractGraphSchema.parse(validGraph);
    expect(result.version).toBe('parser-contract.v1');
  });
});

describe('Zod rejection', () => {
  it('(7) rejects invalid input: missing required fields, out-of-range confidence, unknown stage types', () => {
    // Missing required fields
    expect(() => ParserContractNodeSchema.parse({})).toThrow();
    expect(() => ParserContractNodeSchema.parse({ id: 'x' })).toThrow();

    // Out-of-range confidence
    expect(() =>
      ParserContractNodeSchema.parse({
        id: 'x',
        projectId: 'p',
        parserName: 'n',
        stage: 'parse',
        name: 'test',
        confidence: 1.5,
      }),
    ).toThrow();
    expect(() =>
      ParserContractNodeSchema.parse({
        id: 'x',
        projectId: 'p',
        parserName: 'n',
        stage: 'parse',
        name: 'test',
        confidence: -0.1,
      }),
    ).toThrow();

    // Unknown stage type
    expect(() => ParserStageTypeSchema.parse('unknown_stage')).toThrow();

    // Invalid graph version
    expect(() =>
      ParserContractGraphSchema.parse({
        version: 'wrong-version',
        projectId: 'p',
        parserName: 'n',
        nodes: [],
        edges: [],
      }),
    ).toThrow();

    // Invalid edge type
    expect(() =>
      ParserContractEdgeSchema.parse({
        type: 'INVALID_TYPE',
        from: 'a',
        to: 'b',
        projectId: 'p',
      }),
    ).toThrow();
  });

  it('(8) TypeScript types are correctly inferred from schemas (compile-time structural check)', () => {
    // This test verifies type inference by constructing typed objects
    // If z.infer types were wrong, this file would fail to compile (no @ts-nocheck)
    const node: import('../../parsers/meta/parser-contract-schema.js').ParserContractNode = {
      id: 'test',
      projectId: 'proj',
      parserName: 'p',
      stage: 'parse',
      name: 'n',
      emitsNodeTypes: [],
      emitsEdgeTypes: [],
      readsPlanFields: [],
      mutatesTaskFields: [],
      confidence: 1,
    };
    // Verify the typed object passes schema validation round-trip
    const parsed = ParserContractNodeSchema.parse(node);
    expect(parsed.id).toBe(node.id);
    expect(parsed.stage).toBe(node.stage);

    const edge: import('../../parsers/meta/parser-contract-schema.js').ParserContractEdge = {
      type: 'NEXT_STAGE',
      from: 'a',
      to: 'b',
      projectId: 'p',
      confidence: 1,
    };
    const parsedEdge = ParserContractEdgeSchema.parse(edge);
    expect(parsedEdge.type).toBe(edge.type);
  });
});
