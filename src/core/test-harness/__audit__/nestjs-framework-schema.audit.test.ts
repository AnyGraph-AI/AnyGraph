/**
 * AUD-TC-07-L1-05: nestjs-framework-schema.ts behavioral audit tests
 *
 * Spec sources:
 *  - plans/codegraph/PLAN.md §Phase 1 "NestJS/FairSquare examples in the fork"
 *  - plans/codegraph/PLAN.md §SemanticNodeType (NestModule/NestController/NestService/etc.)
 *  - plans/codegraph/PLAN.md §SemanticEdgeType (MODULE_IMPORTS/INJECTS/EXPOSES/etc.)
 *  - AUD-TC-07.md behaviors (1)-(8)
 *
 * Accept criteria: 8+ behavioral assertions, all green.
 */
import { describe, it, expect } from 'vitest';
import {
  NESTJS_FRAMEWORK_SCHEMA,
  NESTJS_PARSE_OPTIONS,
} from '../../config/nestjs-framework-schema.js';
import { CoreNodeType, SemanticNodeType, SemanticEdgeType } from '../../config/schema.js';
import { EXCLUDE_PATTERNS_REGEX } from '../../../constants.js';

// ============================================================================
// (1) NestJS schema — conforms to FrameworkSchema interface
// ============================================================================
describe('NESTJS_FRAMEWORK_SCHEMA — FrameworkSchema interface conformance', () => {
  it('has required top-level FrameworkSchema fields', () => {
    const schema = NESTJS_FRAMEWORK_SCHEMA;
    expect(typeof schema.name).toBe('string');
    expect(typeof schema.version).toBe('string');
    expect(typeof schema.description).toBe('string');
    expect(Array.isArray(schema.enhances)).toBe(true);
    expect(typeof schema.enhancements).toBe('object');
    expect(typeof schema.edgeEnhancements).toBe('object');
    expect(Array.isArray(schema.contextExtractors)).toBe(true);
    expect(typeof schema.metadata).toBe('object');
  });

  it('enhances CLASS_DECLARATION and METHOD_DECLARATION', () => {
    expect(NESTJS_FRAMEWORK_SCHEMA.enhances).toContain(CoreNodeType.CLASS_DECLARATION);
    expect(NESTJS_FRAMEWORK_SCHEMA.enhances).toContain(CoreNodeType.METHOD_DECLARATION);
  });

  it('metadata.targetLanguages includes typescript', () => {
    expect(NESTJS_FRAMEWORK_SCHEMA.metadata.targetLanguages).toContain('typescript');
  });
});

// ============================================================================
// (2) Node enhancements — all SemanticNodeType.NEST_* types covered
// ============================================================================
describe('NestJS node enhancements — NEST_* semantic type coverage', () => {
  const enhancements = NESTJS_FRAMEWORK_SCHEMA.enhancements;

  it('covers NEST_CONTROLLER', () => {
    const ctrl = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.NEST_CONTROLLER
    );
    expect(ctrl).toBeDefined();
    expect(ctrl!.neo4j.additionalLabels).toContain('NestJS');
  });

  it('covers NEST_SERVICE', () => {
    const svc = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.NEST_SERVICE
    );
    expect(svc).toBeDefined();
    expect(svc!.neo4j.additionalLabels).toContain('NestJS');
  });

  it('covers NEST_MODULE', () => {
    const mod = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.NEST_MODULE
    );
    expect(mod).toBeDefined();
    expect(mod!.neo4j.additionalLabels).toContain('NestJS');
  });

  it('covers HTTP_ENDPOINT (method-level enhancement)', () => {
    const endpoint = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.HTTP_ENDPOINT
    );
    expect(endpoint).toBeDefined();
    expect(endpoint!.targetCoreType).toBe(CoreNodeType.METHOD_DECLARATION);
  });

  it('covers MESSAGE_HANDLER (method-level enhancement)', () => {
    const msgHandler = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.MESSAGE_HANDLER
    );
    expect(msgHandler).toBeDefined();
    expect(msgHandler!.targetCoreType).toBe(CoreNodeType.METHOD_DECLARATION);
  });

  it('covers ENTITY_CLASS', () => {
    const entity = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.ENTITY_CLASS
    );
    expect(entity).toBeDefined();
  });

  it('covers DTO_CLASS', () => {
    const dto = Object.values(enhancements).find(
      e => e.semanticType === SemanticNodeType.DTO_CLASS
    );
    expect(dto).toBeDefined();
  });

  it('each enhancement has detectionPatterns and contextExtractors', () => {
    for (const [name, enhancement] of Object.entries(enhancements)) {
      expect(enhancement.detectionPatterns.length, `${name} must have detectionPatterns`).toBeGreaterThan(0);
      expect(Array.isArray(enhancement.contextExtractors), `${name} contextExtractors must be array`).toBe(true);
    }
  });
});

// ============================================================================
// (3) extractControllerPath — extracts path from @Controller decorator
// ============================================================================
describe('NestController extractControllerPath behavior — via contextExtractor config', () => {
  it('NestController enhancement has contextExtractor for basePath extraction', () => {
    const ctrl = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.NEST_CONTROLLER
    );
    expect(ctrl!.contextExtractors.length).toBeGreaterThan(0);
    // The extractor is a function that operates on parsedNode.sourceNode
    // We verify the configuration exists and is callable
    const extractor = ctrl!.contextExtractors[0].extractor;
    expect(typeof extractor).toBe('function');
  });

  it('NestController detection uses @Controller decorator pattern (confidence >= 0.9)', () => {
    const ctrl = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.NEST_CONTROLLER
    );
    const decoratorPattern = ctrl!.detectionPatterns.find(p => p.type === 'decorator');
    expect(decoratorPattern).toBeDefined();
    expect(decoratorPattern!.pattern).toBe('Controller');
    expect(decoratorPattern!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('NestController contextExtractor returns {} when sourceNode is null/undefined', () => {
    const ctrl = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.NEST_CONTROLLER
    );
    const extractor = ctrl!.contextExtractors[0].extractor;
    const mockNode = {
      id: 't1',
      coreType: CoreNodeType.CLASS_DECLARATION,
      labels: [],
      properties: {
        id: 't1', projectId: 'p', name: 'AppController', coreType: CoreNodeType.CLASS_DECLARATION,
        filePath: 'app.controller.ts', startLine: 1, endLine: 30, sourceCode: '', createdAt: '',
      },
      sourceNode: null,
    } as any;
    const result = extractor(mockNode, new Map(), new Map());
    expect(result).toEqual({});
  });
});

// ============================================================================
// (4) countHttpEndpoints — HTTP decorator detection
// ============================================================================
describe('NestJS HTTP endpoint detection configuration', () => {
  it('HttpEndpoint enhancement detection uses pre-extracted decoratorNames from context', () => {
    const httpEndpoint = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.HTTP_ENDPOINT
    );
    const pattern = httpEndpoint!.detectionPatterns[0];
    expect(pattern.type).toBe('function');
    // Test the pattern with a mock node that has HTTP decorator names
    const mockMethodWithGet = {
      id: 'm1',
      coreType: CoreNodeType.METHOD_DECLARATION,
      labels: [],
      properties: {
        id: 'm1', projectId: 'p', name: 'getUsers', coreType: CoreNodeType.METHOD_DECLARATION,
        filePath: 'users.controller.ts', startLine: 5, endLine: 10, sourceCode: '', createdAt: '',
        context: { decoratorNames: ['Get'] },
      },
    } as any;
    expect((pattern.pattern as Function)(mockMethodWithGet)).toBe(true);
  });

  it('HttpEndpoint detection covers all HTTP methods: Get, Post, Put, Delete, Patch', () => {
    const httpEndpoint = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.HTTP_ENDPOINT
    );
    const pattern = httpEndpoint!.detectionPatterns[0];
    for (const httpMethod of ['Get', 'Post', 'Put', 'Delete', 'Patch']) {
      const mockMethod = {
        id: `m-${httpMethod}`,
        coreType: CoreNodeType.METHOD_DECLARATION,
        labels: [],
        properties: {
          id: `m-${httpMethod}`, projectId: 'p', name: `do${httpMethod}`, coreType: CoreNodeType.METHOD_DECLARATION,
          filePath: 'users.controller.ts', startLine: 1, endLine: 5, sourceCode: '', createdAt: '',
          context: { decoratorNames: [httpMethod] },
        },
      } as any;
      expect((pattern.pattern as Function)(mockMethod), `${httpMethod} must trigger HttpEndpoint`).toBe(true);
    }
  });

  it('HttpEndpoint detection does NOT match methods without HTTP decorators', () => {
    const httpEndpoint = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.HTTP_ENDPOINT
    );
    const pattern = httpEndpoint!.detectionPatterns[0];
    const mockMethod = {
      id: 'm-nohttp',
      coreType: CoreNodeType.METHOD_DECLARATION,
      labels: [],
      properties: {
        id: 'm-nohttp', projectId: 'p', name: 'internalHelper', coreType: CoreNodeType.METHOD_DECLARATION,
        filePath: 'users.service.ts', startLine: 1, endLine: 5, sourceCode: '', createdAt: '',
        context: { decoratorNames: ['Injectable'] },
      },
    } as any;
    expect((pattern.pattern as Function)(mockMethod)).toBe(false);
  });
});

// ============================================================================
// (5) extractMessagePattern — handles @EventPattern and @MessagePattern
// ============================================================================
describe('MessageHandler — @EventPattern and @MessagePattern detection', () => {
  it('MessageHandler enhancement detects both EventPattern and MessagePattern decorators', () => {
    const msgHandler = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.MESSAGE_HANDLER
    );
    const pattern = msgHandler!.detectionPatterns[0];
    expect(pattern.type).toBe('function');

    // Test with @EventPattern
    const mockEventPattern = {
      id: 'm-ep',
      coreType: CoreNodeType.METHOD_DECLARATION,
      labels: [],
      properties: {
        id: 'm-ep', projectId: 'p', name: 'handleUserCreated', coreType: CoreNodeType.METHOD_DECLARATION,
        filePath: 'users.controller.ts', startLine: 1, endLine: 5, sourceCode: '', createdAt: '',
        context: { decoratorNames: ['EventPattern'] },
      },
    } as any;
    expect((pattern.pattern as Function)(mockEventPattern)).toBe(true);

    // Test with @MessagePattern
    const mockMessagePattern = {
      id: 'm-mp',
      coreType: CoreNodeType.METHOD_DECLARATION,
      labels: [],
      properties: {
        id: 'm-mp', projectId: 'p', name: 'handleUserGet', coreType: CoreNodeType.METHOD_DECLARATION,
        filePath: 'users.controller.ts', startLine: 10, endLine: 15, sourceCode: '', createdAt: '',
        context: { decoratorNames: ['MessagePattern'] },
      },
    } as any;
    expect((pattern.pattern as Function)(mockMessagePattern)).toBe(true);
  });

  it('MessageHandler has high confidence (>=0.95) for pattern matching', () => {
    const msgHandler = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.MESSAGE_HANDLER
    );
    const pattern = msgHandler!.detectionPatterns[0];
    expect(pattern.confidence).toBeGreaterThanOrEqual(0.95);
  });
});

// ============================================================================
// (6) Edge enhancements — INJECTS/EXPOSES/MODULE_IMPORTS/GUARDED_BY
// ============================================================================
describe('NestJS edge enhancements — core semantic edges', () => {
  const edgeEnhancements = NESTJS_FRAMEWORK_SCHEMA.edgeEnhancements;

  it('has DependencyInjection edge enhancement with INJECTS semantic type', () => {
    const diEdge = Object.values(edgeEnhancements).find(
      e => e.semanticType === SemanticEdgeType.INJECTS
    );
    expect(diEdge).toBeDefined();
    expect(diEdge!.neo4j.relationshipType).toBe('INJECTS');
    expect(diEdge!.relationshipWeight).toBeGreaterThanOrEqual(0.9);
  });

  it('has EXPOSES edge enhancements for HTTP and message endpoints', () => {
    const exposesEdges = Object.values(edgeEnhancements).filter(
      e => e.semanticType === SemanticEdgeType.EXPOSES
    );
    expect(exposesEdges.length).toBeGreaterThanOrEqual(2); // HTTP and Message handler exposure
  });

  it('each edge enhancement has a detectionPattern function', () => {
    for (const [name, edge] of Object.entries(edgeEnhancements)) {
      expect(typeof edge.detectionPattern, `${name}.detectionPattern must be function`).toBe('function');
    }
  });

  it('edge detection only fires when file paths match (intra-file relationship)', () => {
    const httpExposure = Object.values(edgeEnhancements).find(
      e => e.semanticType === SemanticEdgeType.EXPOSES &&
           e.neo4j.relationshipType === 'EXPOSES'
    );
    const mockController = {
      id: 'ctrl-1',
      coreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: SemanticNodeType.NEST_CONTROLLER,
      labels: [],
      properties: {
        id: 'ctrl-1', projectId: 'p', name: 'AppController', coreType: CoreNodeType.CLASS_DECLARATION,
        filePath: 'app.controller.ts', startLine: 1, endLine: 50, sourceCode: '', createdAt: '',
        semanticType: SemanticNodeType.NEST_CONTROLLER,
      },
    } as any;
    const mockMethodDifferentFile = {
      id: 'method-1',
      coreType: CoreNodeType.METHOD_DECLARATION,
      semanticType: SemanticNodeType.HTTP_ENDPOINT,
      labels: [],
      properties: {
        id: 'method-1', projectId: 'p', name: 'getUser', coreType: CoreNodeType.METHOD_DECLARATION,
        filePath: 'different.controller.ts', // Different file - should not match
        startLine: 5, endLine: 10, sourceCode: '', createdAt: '',
        semanticType: SemanticNodeType.HTTP_ENDPOINT,
        parentClassName: 'AppController',
      },
    } as any;
    if (httpExposure) {
      const result = httpExposure.detectionPattern(mockController, mockMethodDifferentFile, new Map(), new Map());
      expect(result).toBe(false);
    }
  });
});

// ============================================================================
// (7) HTTP_ENDPOINT and MESSAGE_HANDLER — assigned to METHOD_DECLARATION
// ============================================================================
describe('HTTP_ENDPOINT and MESSAGE_HANDLER — method-level semantic types', () => {
  it('HTTP_ENDPOINT targets METHOD_DECLARATION (not class-level)', () => {
    const httpEndpoint = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.HTTP_ENDPOINT
    );
    expect(httpEndpoint!.targetCoreType).toBe(CoreNodeType.METHOD_DECLARATION);
  });

  it('MESSAGE_HANDLER targets METHOD_DECLARATION (not class-level)', () => {
    const msgHandler = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.MESSAGE_HANDLER
    );
    expect(msgHandler!.targetCoreType).toBe(CoreNodeType.METHOD_DECLARATION);
  });

  it('HTTP_ENDPOINT additionalRelationships includes ACCEPTS and RESPONDS_WITH', () => {
    const httpEndpoint = Object.values(NESTJS_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === SemanticNodeType.HTTP_ENDPOINT
    );
    expect(httpEndpoint!.additionalRelationships).toContain(SemanticEdgeType.ACCEPTS);
    expect(httpEndpoint!.additionalRelationships).toContain(SemanticEdgeType.RESPONDS_WITH);
  });
});

// ============================================================================
// (8) metadata.dependencies — includes NestJS packages
// ============================================================================
describe('NESTJS_FRAMEWORK_SCHEMA metadata — NestJS package dependencies', () => {
  it('metadata.dependencies includes @nestjs/core', () => {
    expect(NESTJS_FRAMEWORK_SCHEMA.metadata.dependencies).toContain('@nestjs/core');
  });

  it('metadata.dependencies includes @nestjs/common', () => {
    expect(NESTJS_FRAMEWORK_SCHEMA.metadata.dependencies).toContain('@nestjs/common');
  });

  it('NESTJS_PARSE_OPTIONS excludePatterns reference EXCLUDE_PATTERNS_REGEX', () => {
    expect(Array.isArray(NESTJS_PARSE_OPTIONS.excludePatterns)).toBe(true);
    for (const pattern of EXCLUDE_PATTERNS_REGEX) {
      expect(NESTJS_PARSE_OPTIONS.excludePatterns).toContain(pattern);
    }
  });

  it('NESTJS_PARSE_OPTIONS includes the NestJS framework schema', () => {
    expect(NESTJS_PARSE_OPTIONS.frameworkSchemas).toContain(NESTJS_FRAMEWORK_SCHEMA);
  });
});

// ============================================================================
// Global context extractors — verify coverage for key node types
// ============================================================================
describe('NestJS global context extractors — node type coverage', () => {
  it('has a context extractor for CLASS_DECLARATION (extracts constructor params for INJECTS detection)', () => {
    const classExtractors = NESTJS_FRAMEWORK_SCHEMA.contextExtractors.filter(
      e => e.nodeType === CoreNodeType.CLASS_DECLARATION
    );
    expect(classExtractors.length).toBeGreaterThan(0);
  });

  it('has a context extractor for METHOD_DECLARATION (extracts decoratorNames for HTTP/message detection)', () => {
    const methodExtractors = NESTJS_FRAMEWORK_SCHEMA.contextExtractors.filter(
      e => e.nodeType === CoreNodeType.METHOD_DECLARATION
    );
    expect(methodExtractors.length).toBeGreaterThan(0);
  });

  it('has a context extractor for SOURCE_FILE (module-level metadata)', () => {
    const fileExtractors = NESTJS_FRAMEWORK_SCHEMA.contextExtractors.filter(
      e => e.nodeType === CoreNodeType.SOURCE_FILE
    );
    expect(fileExtractors.length).toBeGreaterThan(0);
  });
});
