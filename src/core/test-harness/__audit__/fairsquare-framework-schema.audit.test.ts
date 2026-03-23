/**
 * AUD-TC-07-L1-03: fairsquare-framework-schema.ts behavioral audit tests
 *
 * Spec sources:
 *  - plans/codegraph/PLAN.md §Phase 1 "Architecture: Dual-schema system (core AST types + pluggable framework schemas)"
 *  - schema.ts FrameworkSchema interface contract
 *  - AUD-TC-07.md behaviors (1)-(8)
 *
 * Accept criteria: 8+ behavioral assertions, all green.
 */
import { describe, it, expect } from 'vitest';
import {
  FAIRSQUARE_FRAMEWORK_SCHEMA,
  FairSquareSemanticNodeType,
  FairSquareSemanticEdgeType,
} from '../../config/fairsquare-framework-schema.js';
import { CoreNodeType } from '../../config/schema.js';

// ============================================================================
// (1) FAIRSQUARE_FRAMEWORK_SCHEMA — conforms to FrameworkSchema interface
// ============================================================================
describe('FAIRSQUARE_FRAMEWORK_SCHEMA — FrameworkSchema interface conformance', () => {
  it('has required top-level FrameworkSchema fields', () => {
    const schema = FAIRSQUARE_FRAMEWORK_SCHEMA;
    expect(typeof schema.name).toBe('string');
    expect(typeof schema.version).toBe('string');
    expect(typeof schema.description).toBe('string');
    expect(Array.isArray(schema.enhances)).toBe(true);
    expect(typeof schema.enhancements).toBe('object');
    expect(typeof schema.edgeEnhancements).toBe('object');
    expect(Array.isArray(schema.contextExtractors)).toBe(true);
    expect(typeof schema.metadata).toBe('object');
  });

  it('metadata has targetLanguages and dependencies', () => {
    const meta = FAIRSQUARE_FRAMEWORK_SCHEMA.metadata;
    expect(Array.isArray(meta.targetLanguages)).toBe(true);
    expect(meta.targetLanguages).toContain('typescript');
    expect(Array.isArray(meta.dependencies)).toBe(true);
  });
});

// ============================================================================
// (2) enhances — exactly CLASS_DECLARATION and METHOD_DECLARATION
// ============================================================================
describe('FAIRSQUARE_FRAMEWORK_SCHEMA.enhances — exact targets', () => {
  it('enhances exactly 2 core types: CLASS_DECLARATION and METHOD_DECLARATION', () => {
    expect(FAIRSQUARE_FRAMEWORK_SCHEMA.enhances).toHaveLength(2);
    expect(FAIRSQUARE_FRAMEWORK_SCHEMA.enhances).toContain(CoreNodeType.CLASS_DECLARATION);
    expect(FAIRSQUARE_FRAMEWORK_SCHEMA.enhances).toContain(CoreNodeType.METHOD_DECLARATION);
  });

  it('does not enhance FUNCTION_DECLARATION or SOURCE_FILE', () => {
    expect(FAIRSQUARE_FRAMEWORK_SCHEMA.enhances).not.toContain(CoreNodeType.FUNCTION_DECLARATION);
    expect(FAIRSQUARE_FRAMEWORK_SCHEMA.enhances).not.toContain(CoreNodeType.SOURCE_FILE);
  });
});

// ============================================================================
// (3) Node enhancements — 7 FairSquare semantic types
// ============================================================================
describe('FairSquare node enhancements — 7 semantic types', () => {
  const enhancements = FAIRSQUARE_FRAMEWORK_SCHEMA.enhancements;

  it('has exactly 7 node enhancements', () => {
    expect(Object.keys(enhancements).length).toBe(7);
  });

  it('has Controller enhancement with detectionPatterns and neo4j labels', () => {
    const ctrl = Object.values(enhancements).find(
      e => e.semanticType === FairSquareSemanticNodeType.FS_CONTROLLER
    );
    expect(ctrl).toBeDefined();
    expect(ctrl!.detectionPatterns.length).toBeGreaterThan(0);
    expect(ctrl!.neo4j.additionalLabels).toContain('FairSquare');
  });

  it('has Service enhancement', () => {
    const svc = Object.values(enhancements).find(
      e => e.semanticType === FairSquareSemanticNodeType.FS_SERVICE
    );
    expect(svc).toBeDefined();
    expect(svc!.detectionPatterns.length).toBeGreaterThan(0);
  });

  it('has Repository enhancement', () => {
    const repo = Object.values(enhancements).find(
      e => e.semanticType === FairSquareSemanticNodeType.FS_REPOSITORY
    );
    expect(repo).toBeDefined();
  });

  it('has DAL enhancement', () => {
    const dal = Object.values(enhancements).find(
      e => e.semanticType === FairSquareSemanticNodeType.FS_DAL
    );
    expect(dal).toBeDefined();
    expect(dal!.neo4j.additionalLabels).toContain('DataAccess');
  });

  it('has PermissionManager enhancement', () => {
    const pm = Object.values(enhancements).find(
      e => e.semanticType === FairSquareSemanticNodeType.FS_PERMISSION_MANAGER
    );
    expect(pm).toBeDefined();
    expect(pm!.neo4j.additionalLabels).toContain('Security');
  });

  it('has VendorClient enhancement', () => {
    const vc = Object.values(enhancements).find(
      e => e.semanticType === FairSquareSemanticNodeType.FS_VENDOR_CLIENT
    );
    expect(vc).toBeDefined();
    expect(vc!.neo4j.additionalLabels).toContain('ExternalIntegration');
  });

  it('has RouteDefinition enhancement targeting VARIABLE_DECLARATION', () => {
    const rd = Object.values(enhancements).find(
      e => e.semanticType === FairSquareSemanticNodeType.FS_ROUTE_DEFINITION
    );
    expect(rd).toBeDefined();
    expect(rd!.targetCoreType).toBe(CoreNodeType.VARIABLE_DECLARATION);
  });

  it('each enhancement has detectionPatterns with confidence and priority', () => {
    for (const [name, enhancement] of Object.entries(enhancements)) {
      expect(enhancement.detectionPatterns.length, `${name} must have at least one detectionPattern`).toBeGreaterThan(0);
      for (const pattern of enhancement.detectionPatterns) {
        expect(typeof pattern.confidence, `${name} pattern confidence must be number`).toBe('number');
        expect(typeof pattern.priority, `${name} pattern priority must be number`).toBe('number');
        expect(pattern.confidence).toBeGreaterThan(0);
        expect(pattern.confidence).toBeLessThanOrEqual(1.0);
      }
    }
  });
});

// ============================================================================
// (4) Edge enhancements — 7 edge types
// ============================================================================
describe('FairSquare edge enhancements — 7 edge types', () => {
  const edgeEnhancements = FAIRSQUARE_FRAMEWORK_SCHEMA.edgeEnhancements;

  it('has exactly 7 edge enhancements', () => {
    expect(Object.keys(edgeEnhancements).length).toBe(7);
  });

  it('has INJECTS edge enhancement with high relationshipWeight', () => {
    const injects = Object.values(edgeEnhancements).find(
      e => e.semanticType === FairSquareSemanticEdgeType.FS_INJECTS
    );
    expect(injects).toBeDefined();
    expect(injects!.relationshipWeight).toBeGreaterThanOrEqual(0.9);
    expect(injects!.neo4j.relationshipType).toBe('INJECTS');
  });

  it('has USES_DAL edge enhancement', () => {
    const usesDal = Object.values(edgeEnhancements).find(
      e => e.semanticType === FairSquareSemanticEdgeType.FS_REPOSITORY_USES_DAL
    );
    expect(usesDal).toBeDefined();
    expect(usesDal!.neo4j.relationshipType).toBe('USES_DAL');
  });

  it('has PROTECTED_BY edge enhancement', () => {
    const protectedBy = Object.values(edgeEnhancements).find(
      e => e.semanticType === FairSquareSemanticEdgeType.FS_PROTECTED_BY
    );
    expect(protectedBy).toBeDefined();
    expect(protectedBy!.neo4j.relationshipType).toBe('PROTECTED_BY');
  });

  it('has ROUTES_TO edge enhancement', () => {
    const routesTo = Object.values(edgeEnhancements).find(
      e => e.semanticType === FairSquareSemanticEdgeType.FS_ROUTES_TO
    );
    expect(routesTo).toBeDefined();
    expect(routesTo!.neo4j.relationshipType).toBe('ROUTES_TO');
  });

  it('has ROUTES_TO_HANDLER edge enhancement', () => {
    const routesToHandler = Object.values(edgeEnhancements).find(
      e => e.semanticType === FairSquareSemanticEdgeType.FS_ROUTES_TO_HANDLER
    );
    expect(routesToHandler).toBeDefined();
    expect(routesToHandler!.neo4j.relationshipType).toBe('ROUTES_TO_HANDLER');
  });

  it('has INTERNAL_API_CALL edge enhancement', () => {
    const internalApi = Object.values(edgeEnhancements).find(
      e => e.semanticType === FairSquareSemanticEdgeType.FS_INTERNAL_API_CALL
    );
    expect(internalApi).toBeDefined();
    expect(internalApi!.neo4j.relationshipType).toBe('INTERNAL_API_CALL');
  });

  it('has USES_REPOSITORY edge enhancement', () => {
    const usesRepo = Object.values(edgeEnhancements).find(
      e => e.semanticType === 'USES_REPOSITORY'
    );
    expect(usesRepo).toBeDefined();
    expect(usesRepo!.neo4j.relationshipType).toBe('USES_REPOSITORY');
  });

  it('each edge enhancement has a detectionPattern function', () => {
    for (const [name, edge] of Object.entries(edgeEnhancements)) {
      expect(typeof edge.detectionPattern, `${name}.detectionPattern must be a function`).toBe('function');
    }
  });

  it('all edge enhancement relationship weights are valid (0-1 range)', () => {
    for (const [name, edge] of Object.entries(edgeEnhancements)) {
      expect(edge.relationshipWeight, `${name} weight must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(edge.relationshipWeight, `${name} weight must be <= 1`).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================================
// (5) extractInjectableDependencies behavior — via contextExtractors
// ============================================================================
describe('Injectable dependency extractor configuration', () => {
  it('global contextExtractors includes an extractor for CLASS_DECLARATION', () => {
    const classExtractors = FAIRSQUARE_FRAMEWORK_SCHEMA.contextExtractors.filter(
      e => e.nodeType === CoreNodeType.CLASS_DECLARATION
    );
    expect(classExtractors.length).toBeGreaterThan(0);
  });

  it('Controller enhancement has contextExtractors for dependency extraction', () => {
    const ctrl = Object.values(FAIRSQUARE_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === FairSquareSemanticNodeType.FS_CONTROLLER
    );
    const classExtractors = ctrl!.contextExtractors.filter(
      e => e.nodeType === CoreNodeType.CLASS_DECLARATION
    );
    expect(classExtractors.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// (6) extractRouteDefinitions behavior — configuration via RouteDefinition enhancement
// ============================================================================
describe('Route definition context extraction configuration', () => {
  it('RouteDefinition enhancement has contextExtractor for VARIABLE_DECLARATION', () => {
    const rd = Object.values(FAIRSQUARE_FRAMEWORK_SCHEMA.enhancements).find(
      e => e.semanticType === FairSquareSemanticNodeType.FS_ROUTE_DEFINITION
    );
    const varExtractors = rd!.contextExtractors.filter(
      e => e.nodeType === CoreNodeType.VARIABLE_DECLARATION
    );
    expect(varExtractors.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// (7) Edge detection uses exact name matching — no substring false positives
// ============================================================================
describe('Edge detection — exact name matching (no substring false positives)', () => {
  it('INJECTS detection rejects when dependency name is partial match', () => {
    const injectsEdge = Object.values(FAIRSQUARE_FRAMEWORK_SCHEMA.edgeEnhancements).find(
      e => e.semanticType === FairSquareSemanticEdgeType.FS_INJECTS
    );
    // Mock: source has dependency "UserService", target is "Service" (partial match - should fail)
    const mockSource = {
      id: 's1',
      coreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_CONTROLLER,
      labels: ['Class'],
      properties: {
        id: 's1', projectId: 'p', name: 'AuthController', coreType: CoreNodeType.CLASS_DECLARATION,
        filePath: 'auth.controller.ts', startLine: 1, endLine: 50,
        sourceCode: '', createdAt: '',
        context: { dependencies: ['UserService'] },
      },
    } as any;
    const mockTarget = {
      id: 't1',
      coreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_SERVICE,
      labels: ['Class'],
      properties: {
        id: 't1', projectId: 'p', name: 'Service', coreType: CoreNodeType.CLASS_DECLARATION,
        filePath: 'service.ts', startLine: 1, endLine: 20,
        sourceCode: '', createdAt: '',
        context: {},
      },
    } as any;
    const result = injectsEdge!.detectionPattern(mockSource, mockTarget, new Map(), new Map());
    expect(result).toBe(false); // "Service" !== "UserService" exact match
  });

  it('INJECTS detection accepts when dependency name exactly matches target name', () => {
    const injectsEdge = Object.values(FAIRSQUARE_FRAMEWORK_SCHEMA.edgeEnhancements).find(
      e => e.semanticType === FairSquareSemanticEdgeType.FS_INJECTS
    );
    const mockSource = {
      id: 's2',
      coreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_CONTROLLER,
      labels: ['Class'],
      properties: {
        id: 's2', projectId: 'p', name: 'AuthController', coreType: CoreNodeType.CLASS_DECLARATION,
        filePath: 'auth.controller.ts', startLine: 1, endLine: 50,
        sourceCode: '', createdAt: '',
        context: { dependencies: ['UserService'] },
      },
    } as any;
    const mockTarget = {
      id: 't2',
      coreType: CoreNodeType.CLASS_DECLARATION,
      semanticType: FairSquareSemanticNodeType.FS_SERVICE,
      labels: ['Class'],
      properties: {
        id: 't2', projectId: 'p', name: 'UserService', coreType: CoreNodeType.CLASS_DECLARATION,
        filePath: 'user.service.ts', startLine: 1, endLine: 40,
        sourceCode: '', createdAt: '',
        context: {},
      },
    } as any;
    const result = injectsEdge!.detectionPattern(mockSource, mockTarget, new Map(), new Map());
    expect(result).toBe(true);
  });
});

// ============================================================================
// (8) parseVariablesFrom — includes route file globs
// ============================================================================
describe('parseVariablesFrom — route file globs', () => {
  it('metadata.parseVariablesFrom is defined and includes .routes.ts globs', () => {
    const parseFrom = FAIRSQUARE_FRAMEWORK_SCHEMA.metadata.parseVariablesFrom;
    expect(Array.isArray(parseFrom)).toBe(true);
    // Must include route-related glob patterns
    const hasRoutesGlob = parseFrom!.some(glob => glob.includes('routes') || glob.includes('route'));
    expect(hasRoutesGlob).toBe(true);
  });

  it('parseVariablesFrom includes *.routes.ts pattern', () => {
    const parseFrom = FAIRSQUARE_FRAMEWORK_SCHEMA.metadata.parseVariablesFrom!;
    expect(parseFrom).toContain('**/*.routes.ts');
  });
});
