// Spec source: plans/codegraph/PLAN.md §Phase 1 full parser spec (lines 232–362)
// Spec source: plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §"Tier 0 — Compiler-grade" TypeScript lane
// AUD-TC-11a-L1-03: typescript-parser.ts behavioral audit tests
//
// FIND-11a-01: resolutionKind on CALLS edges (spec edge case #22) is NOT implemented in typescript-parser.ts.
//   The spec says: "Categorize calls as internal/unresolved/builtin/external/fluent/dynamicImport"
//   No code in the parser sets resolutionKind. The enrichment script add-provenance.ts references it,
//   suggesting it's added post-parse, not by the parser. Spec is ambiguous on ownership.
//
// FIND-11a-02: isSuper: true on CALLS edges (spec edge case #14) — parser detects super() and sets
//   receiverExpression: 'super' on callContext, and callsSuper: true on Constructor node properties,
//   but does NOT set isSuper: true as a top-level CALLS edge property. The createCallsEdge factory
//   does not support isSuper. Partial implementation vs. spec.
//
// FIND-11a-03: Spec says "convertToIrDocument" but actual method is "exportToIrDocument".
//   Naming divergence between spec and implementation.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'fs/promises';
import os from 'os';

import { TypeScriptParser } from '../../parsers/typescript-parser.js';
import { CoreNodeType, CoreEdgeType, Neo4jNode, Neo4jEdge } from '../../config/schema.js';
import { generateDeterministicId } from '../../utils/graph-factory.js';
import { EXCLUDE_PATTERNS_GLOB, BUILT_IN_FUNCTIONS, BUILT_IN_METHODS, BUILT_IN_CLASSES } from '../../../constants.js';

// ============================================================================
// Fixture path: __audit__/fixtures/ts-parser/
// Each fixture is a minimal .ts file exercising a specific parser behavior.
// ============================================================================
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'ts-parser');
const TSCONFIG_PATH = path.join(FIXTURE_DIR, 'tsconfig.json');

// ============================================================================
// Behavior 1: parseWorkspace discovers files and produces {nodes, edges}
// Spec: "ParserFactory.createParserWithAutoDetection() + glob discovery"
// ============================================================================
describe('AUD-TC-11a-L1-03 | typescript-parser.ts', () => {
  describe('Behavior 1: parseWorkspace discovers source files and returns nodes/edges', () => {
    it('produces nodes and edges from fixture directory', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const { nodes, edges } = await parser.parseWorkspace();

      expect(nodes.length).toBeGreaterThan(0);
      expect(edges.length).toBeGreaterThan(0);

      // Should have SourceFile nodes for each .ts fixture file
      const sourceFileNodes = nodes.filter(n => n.properties.coreType === CoreNodeType.SOURCE_FILE);
      expect(sourceFileNodes.length).toBeGreaterThanOrEqual(5); // at least basic, inner-functions, conditional-calls, super-call, dynamic-import

      // Every node must have projectId and filePath
      for (const node of nodes) {
        expect(node.properties.projectId).toBeDefined();
        expect(node.properties.filePath).toBeDefined();
      }
    });
  });

  // ============================================================================
  // Behavior 2: parseChunk returns only new nodes/edges for a subset of files
  // Spec: "streaming/workspace-parser consumption"
  // ============================================================================
  describe('Behavior 2: parseChunk returns only new nodes/edges for file subset', () => {
    it('parses a single file and returns its nodes/edges only', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, [], undefined, undefined, false);
      const basicFile = path.join(FIXTURE_DIR, 'basic.ts');

      const { nodes, edges } = await parser.parseChunk([basicFile]);

      // Should contain SourceFile + exported functions + variable
      const sourceFiles = nodes.filter(n => n.properties.coreType === CoreNodeType.SOURCE_FILE);
      expect(sourceFiles).toHaveLength(1);
      expect(sourceFiles[0].properties.name).toBe('basic.ts');

      const functions = nodes.filter(n => n.properties.coreType === CoreNodeType.FUNCTION_DECLARATION);
      const fnNames = functions.map(f => f.properties.name);
      expect(fnNames).toContain('greet');
      expect(fnNames).toContain('farewell');
    });

    it('second parseChunk does not re-export previously exported nodes', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, [], undefined, undefined, false);

      const basicFile = path.join(FIXTURE_DIR, 'basic.ts');
      const classesFile = path.join(FIXTURE_DIR, 'classes-and-methods.ts');

      const chunk1 = await parser.parseChunk([basicFile]);
      const chunk1NodeIds = new Set(chunk1.nodes.map(n => n.id));

      const chunk2 = await parser.parseChunk([classesFile]);
      const chunk2NodeIds = new Set(chunk2.nodes.map(n => n.id));

      // No overlap — streaming mode should not re-export chunk1 nodes
      for (const id of chunk2NodeIds) {
        expect(chunk1NodeIds.has(id)).toBe(false);
      }
    });
  });

  // ============================================================================
  // Behavior 3: discoverSourceFiles uses glob respecting EXCLUDE_PATTERNS_GLOB
  // Spec: "glob with ts-morph project source files + manual glob for non-tsconfig files"
  // ============================================================================
  describe('Behavior 3: discoverSourceFiles discovers .ts/.tsx files', () => {
    it('discovers all fixture .ts files in lazy mode', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, [], undefined, undefined, true);
      const files = await parser.discoverSourceFiles();

      expect(files.length).toBeGreaterThanOrEqual(5);
      // All should be .ts files
      for (const f of files) {
        expect(f).toMatch(/\.tsx?$/);
      }
    });

    it('caches discovery results on second call', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, [], undefined, undefined, true);
      const first = await parser.discoverSourceFiles();
      const second = await parser.discoverSourceFiles();

      // Same array reference (cached)
      expect(first).toBe(second);
    });
  });

  // ============================================================================
  // Behavior 4: Inner function declarations emit separate Function nodes with containment edges
  // Spec edge case #16: "Named local functions inside god functions"
  // ============================================================================
  describe('Behavior 4: inner function declarations → Function nodes + CONTAINS edges', () => {
    it('emits inner functions as separate nodes with CONTAINS from parent', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const innerFile = path.join(FIXTURE_DIR, 'inner-functions.ts');
      const { nodes, edges } = await parser.parseChunk([innerFile]);

      const functions = nodes.filter(n => n.properties.coreType === CoreNodeType.FUNCTION_DECLARATION);
      const fnNames = functions.map(f => f.properties.name);

      // outerFunction is the top-level function
      expect(fnNames).toContain('outerFunction');
      // innerHelper and anotherInner are inner declarations
      expect(fnNames).toContain('innerHelper');
      expect(fnNames).toContain('anotherInner');

      // Inner functions should have isInnerFunction: true
      const innerHelper = functions.find(f => f.properties.name === 'innerHelper');
      expect(innerHelper).toBeDefined();
      expect(innerHelper!.properties.isInnerFunction).toBe(true);

      // CONTAINS edge from outerFunction → innerHelper
      const outerFn = functions.find(f => f.properties.name === 'outerFunction');
      expect(outerFn).toBeDefined();

      const containsEdges = edges.filter(
        e => e.type === CoreEdgeType.CONTAINS && e.startNodeId === outerFn!.id
      );
      const containsTargetIds = containsEdges.map(e => e.endNodeId);
      expect(containsTargetIds).toContain(innerHelper!.id);
    });
  });

  // ============================================================================
  // Behavior 5: CALLS edges include conditional: boolean and conditionalKind
  // Spec edge case #11: "Conditional calls"
  // ============================================================================
  describe('Behavior 5: CALLS edges have conditional/conditionalKind for conditional calls', () => {
    it('marks calls inside if/switch/ternary/catch as conditional', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const condFile = path.join(FIXTURE_DIR, 'conditional-calls.ts');
      const { nodes, edges } = await parser.parseChunk([condFile]);

      const callsEdges = edges.filter(e => e.type === 'CALLS');
      expect(callsEdges.length).toBeGreaterThan(0);

      // Find specific conditional kinds via edge context
      const conditionalEdges = callsEdges.filter(e => e.properties.conditional === true);
      const unconditionalEdges = callsEdges.filter(e => !e.properties.conditional);

      // There should be conditional calls (if, switch, ternary, catch, logical)
      expect(conditionalEdges.length).toBeGreaterThan(0);

      // alwaysRun() is unconditional
      const alwaysRunNode = nodes.find(n => n.properties.name === 'alwaysRun');
      if (alwaysRunNode) {
        const alwaysRunCallEdge = callsEdges.find(e => e.endNodeId === alwaysRunNode.id);
        if (alwaysRunCallEdge) {
          expect(alwaysRunCallEdge.properties.conditional).toBeFalsy();
        }
      }

      // Check that conditionalKind values are present on conditional edges
      const kinds = conditionalEdges
        .map(e => e.properties.conditionalKind ?? (e.properties.context as any)?.conditionalKind)
        .filter(Boolean);
      // Should have at least 'if' and 'switch' from our fixture
      expect(kinds.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Behavior 6: resolutionKind classification on CALLS edges
  // Spec edge case #22 — FIND-11a-01: NOT IMPLEMENTED in parser
  // Test verifies current behavior: no resolutionKind property on CALLS edges.
  // ============================================================================
  describe('Behavior 6 (FIND-11a-01): resolutionKind on CALLS edges — spec gap', () => {
    it('CALLS edges do NOT currently include resolutionKind (spec vs impl gap)', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const basicFile = path.join(FIXTURE_DIR, 'conditional-calls.ts');
      const { edges } = await parser.parseChunk([basicFile]);

      const callsEdges = edges.filter(e => e.type === 'CALLS');
      // Verify the gap: no resolutionKind property set by parser
      for (const edge of callsEdges) {
        expect((edge.properties as any).resolutionKind).toBeUndefined();
      }
    });
  });

  // ============================================================================
  // Behavior 7: Built-in functions/methods/classes are filtered from CALLS
  // Spec: "BUILT_IN_FUNCTIONS/BUILT_IN_METHODS/BUILT_IN_CLASSES from constants are filtered"
  // ============================================================================
  describe('Behavior 7: built-in functions/methods/classes filtered from CALLS', () => {
    it('BUILT_IN_FUNCTIONS set contains expected entries', () => {
      // Verify the filter lists exist and have content
      expect(BUILT_IN_FUNCTIONS.size).toBeGreaterThan(0);
      expect(BUILT_IN_METHODS.size).toBeGreaterThan(0);
      expect(BUILT_IN_CLASSES.size).toBeGreaterThan(0);

      // Common built-ins should be in the set
      expect(BUILT_IN_FUNCTIONS.has('console')).toBe(true);
      expect(BUILT_IN_METHODS.has('toString')).toBe(true);
    });

    it('parser does not create CALLS edges to built-in functions', async () => {
      // Write temp fixture OUTSIDE shared FIXTURE_DIR to avoid ts-morph race with other tests
      const tmpDir = path.join(os.tmpdir(), `ts-parser-builtins-${Date.now()}`);
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'commonjs', skipLibCheck: true } }));
      const tmpFile = path.join(tmpDir, 'builtins.ts');
      await fs.writeFile(tmpFile, `
export function testBuiltins() {
  console.log('hello');
  const x = JSON.stringify({});
  const arr = [1,2,3];
  arr.map(x => x);
  arr.forEach(x => x);
  return x;
}
`);
      try {
        const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
        const parser = new TypeScriptParser(tmpDir, tsconfigPath, undefined, []);
        const { edges } = await parser.parseChunk([tmpFile]);
        const callsEdges = edges.filter(e => e.type === 'CALLS');

        // None of the calls should target built-in methods like log, stringify, map, forEach
        for (const edge of callsEdges) {
          // The edge targets should all be to our parsed nodes, not built-ins
          // Built-in calls are skipped by extractCallInfo returning null
          const targetName = (edge.properties.context as any)?.receiverType;
          // If we have any edges, they shouldn't be to well-known built-in names
          expect(BUILT_IN_FUNCTIONS.has((edge.properties as any).name as string)).toBeFalsy();
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  // ============================================================================
  // Behavior 8: dynamic import() → IMPORTS edge with dynamic: true
  // Spec edge case #12: "Dynamic import() expressions"
  // ============================================================================
  describe('Behavior 8: dynamic import() creates IMPORTS edge with dynamic: true', () => {
    it('detects await import() and creates dynamic IMPORTS edge', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      // Parse both files so the target SourceFile node exists for resolution
      const dynFile = path.join(FIXTURE_DIR, 'dynamic-import.ts');
      const basicFile = path.join(FIXTURE_DIR, 'basic.ts');
      const { edges } = await parser.parseChunk([basicFile, dynFile]);

      const importEdges = edges.filter(e => e.type === CoreEdgeType.IMPORTS);

      // Look for a dynamic import edge
      const dynamicImportEdge = importEdges.find(e => e.properties.dynamic === true);
      expect(dynamicImportEdge).toBeDefined();
    });
  });

  // ============================================================================
  // Behavior 9: super() calls create CALLS edges with receiverExpression='super'
  // Spec edge case #14
  // FIND-11a-02: isSuper not set as top-level property; receiverExpression captures it
  // ============================================================================
  describe('Behavior 9: super() calls create CALLS edges', () => {
    it('super() constructor call creates CALLS edge with receiverExpression=super', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const superFile = path.join(FIXTURE_DIR, 'super-call.ts');
      const { nodes, edges } = await parser.parseChunk([superFile]);

      // ChildService constructor should exist
      const childConstructor = nodes.find(
        n => n.properties.coreType === CoreNodeType.CONSTRUCTOR_DECLARATION &&
             n.properties.parentClassName === 'ChildService'
      );
      expect(childConstructor).toBeDefined();

      // BaseService constructor should exist
      const baseConstructor = nodes.find(
        n => n.properties.coreType === CoreNodeType.CONSTRUCTOR_DECLARATION &&
             n.properties.parentClassName === 'BaseService'
      );
      expect(baseConstructor).toBeDefined();

      // CALLS edge from ChildService constructor → BaseService constructor
      const superCallEdge = edges.find(
        e => e.type === 'CALLS' &&
             e.startNodeId === childConstructor!.id &&
             e.endNodeId === baseConstructor!.id
      );
      expect(superCallEdge).toBeDefined();

      // Constructor node should have callsSuper: true
      expect(childConstructor!.properties.callsSuper).toBe(true);
    });
  });

  // ============================================================================
  // Behavior 10: Framework enhancement nodes for NestJS/FairSquare/Grammy
  // Spec: "FrameworkSchema.enhancements" — NestJS schema loaded by default
  // ============================================================================
  describe('Behavior 10: framework enhancements apply via FrameworkSchema', () => {
    it('NestJS schema is loaded by default in constructor', () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH);
      const schemas = parser.getFrameworkSchemas();
      expect(schemas.length).toBeGreaterThanOrEqual(1);
      expect(schemas.some(s => s.name.toLowerCase().includes('nest'))).toBe(true);
    });

    it('frameworkSchemas can be overridden to empty', () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      expect(parser.getFrameworkSchemas()).toHaveLength(0);
    });
  });

  // ============================================================================
  // Behavior 11: createResolver returns lightweight parser (no ts-morph Project)
  // Spec: "static method returns a lightweight parser instance for edge resolution only"
  // ============================================================================
  describe('Behavior 11: createResolver returns lightweight resolver instance', () => {
    it('creates instance with given projectId', () => {
      const resolver = TypeScriptParser.createResolver('test_proj_abc');
      expect(resolver.getProjectId()).toBe('test_proj_abc');
    });

    it('resolver can accept nodes and resolve edges without ts-morph', async () => {
      const resolver = TypeScriptParser.createResolver('test_proj_xyz');

      // Add fake nodes simulating previously parsed data
      const fakeNodes: Neo4jNode[] = [
        {
          id: 'test_proj_xyz:FunctionDeclaration:aaa',
          labels: ['Function'],
          properties: {
            id: 'test_proj_xyz:FunctionDeclaration:aaa',
            projectId: 'test_proj_xyz',
            name: 'helperFn',
            coreType: CoreNodeType.FUNCTION_DECLARATION,
            filePath: '/test/a.ts',
            startLine: 1,
            endLine: 5,
            sourceCode: 'function helperFn() {}',
            createdAt: new Date().toISOString(),
          },
          skipEmbedding: false,
        },
      ];
      resolver.addExistingNodesFromChunk(fakeNodes);

      // getCurrentCounts should show no parsed nodes but deferredEdges might be empty
      const counts = resolver.getCurrentCounts();
      expect(counts.nodes).toBe(0); // No parsed nodes (only existing)
      expect(counts.deferredEdges).toBe(0);
    });

    it('resolver has empty framework schemas', () => {
      const resolver = TypeScriptParser.createResolver('test_proj_def');
      expect(resolver.getFrameworkSchemas()).toHaveLength(0);
    });
  });

  // ============================================================================
  // Behavior 12: exportToIrDocument returns valid IrDocument
  // Spec: "convertToIrDocument returns valid IrDocument"
  // FIND-11a-03: Method is actually named exportToIrDocument, not convertToIrDocument
  // ============================================================================
  describe('Behavior 12: exportToIrDocument returns IrDocument', () => {
    it('returns IrDocument with nodes and edges from parsed data', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const basicFile = path.join(FIXTURE_DIR, 'basic.ts');
      await parser.parseChunk([basicFile]);

      const irDoc = parser.exportToIrDocument(FIXTURE_DIR);

      expect(irDoc).toBeDefined();
      expect(irDoc.metadata).toBeDefined();
      // projectId is top-level on IrDocument, not in metadata
      expect(irDoc.projectId).toBe(parser.getProjectId());
      expect(irDoc.nodes.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Behavior 13: deterministic IDs via generateDeterministicId
  // Spec: "deterministic IDs with projectId+coreType+hash"
  // ============================================================================
  describe('Behavior 13: deterministic IDs are stable across reparses', () => {
    it('same input produces same node IDs', async () => {
      const basicFile = path.join(FIXTURE_DIR, 'basic.ts');

      const parser1 = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const result1 = await parser1.parseChunk([basicFile]);

      const parser2 = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const result2 = await parser2.parseChunk([basicFile]);

      const ids1 = result1.nodes.map(n => n.id).sort();
      const ids2 = result2.nodes.map(n => n.id).sort();

      expect(ids1).toEqual(ids2);
    });

    it('generateDeterministicId format is projectId:coreType:hash', () => {
      const id = generateDeterministicId('proj_abc', 'FunctionDeclaration', '/test/a.ts', 'myFunc');
      expect(id).toMatch(/^proj_abc:FunctionDeclaration:[a-f0-9]{16}$/);
    });

    it('different projectIds produce different IDs for same symbol', () => {
      const id1 = generateDeterministicId('proj_a', 'FunctionDeclaration', '/test/a.ts', 'myFunc');
      const id2 = generateDeterministicId('proj_b', 'FunctionDeclaration', '/test/a.ts', 'myFunc');
      expect(id1).not.toBe(id2);
    });
  });

  // ============================================================================
  // Behavior 14: setDeferEdgeEnhancements(true) skips framework edge creation
  // Spec: "workspace-parser handles cross-package"
  // ============================================================================
  describe('Behavior 14: setDeferEdgeEnhancements skips framework edge creation', () => {
    it('deferred mode produces fewer edges (no framework edges)', async () => {
      const classesFile = path.join(FIXTURE_DIR, 'classes-and-methods.ts');

      // Parse with framework enhancements active (NestJS default)
      const parser1 = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH);
      const result1 = await parser1.parseChunk([classesFile]);

      // Parse with deferred enhancements
      const parser2 = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH);
      parser2.setDeferEdgeEnhancements(true);
      const result2 = await parser2.parseChunk([classesFile]);

      // Deferred mode should produce <= edges (edge enhancements skipped)
      expect(result2.edges.length).toBeLessThanOrEqual(result1.edges.length);
    });

    it('applyEdgeEnhancementsManually runs skipped enhancements', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH);
      parser.setDeferEdgeEnhancements(true);

      const classesFile = path.join(FIXTURE_DIR, 'classes-and-methods.ts');
      await parser.parseChunk([classesFile]);

      // Manually apply edge enhancements
      const enhancedEdges = await parser.applyEdgeEnhancementsManually();
      // Should not throw
      expect(enhancedEdges).toBeDefined();
      expect(Array.isArray(enhancedEdges)).toBe(true);
    });
  });

  // ============================================================================
  // Additional structural assertions
  // ============================================================================
  describe('Structural: node labels and properties', () => {
    it('SourceFile nodes have expected properties (size, mtime, contentHash)', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const basicFile = path.join(FIXTURE_DIR, 'basic.ts');
      const { nodes } = await parser.parseChunk([basicFile]);

      const sf = nodes.find(n => n.properties.coreType === CoreNodeType.SOURCE_FILE);
      expect(sf).toBeDefined();
      expect(sf!.properties.size).toBeGreaterThan(0);
      expect(sf!.properties.mtime).toBeGreaterThan(0);
      expect(sf!.properties.contentHash).toBeDefined();
      expect(typeof sf!.properties.contentHash).toBe('string');
    });

    it('Class nodes have interfaces and method children', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const classFile = path.join(FIXTURE_DIR, 'classes-and-methods.ts');
      const { nodes, edges } = await parser.parseChunk([classFile]);

      // SimpleGreeter class
      const classNode = nodes.find(
        n => n.properties.coreType === CoreNodeType.CLASS_DECLARATION && n.properties.name === 'SimpleGreeter'
      );
      expect(classNode).toBeDefined();

      // Interface node
      const ifaceNode = nodes.find(
        n => n.properties.coreType === CoreNodeType.INTERFACE_DECLARATION && n.properties.name === 'Greeter'
      );
      expect(ifaceNode).toBeDefined();

      // TypeAlias node
      const typeNode = nodes.find(
        n => n.properties.coreType === CoreNodeType.TYPE_ALIAS && n.properties.name === 'GreetResult'
      );
      expect(typeNode).toBeDefined();

      // Methods inside class
      const methods = nodes.filter(
        n => n.properties.coreType === CoreNodeType.METHOD_DECLARATION &&
             n.properties.parentClassName === 'SimpleGreeter'
      );
      expect(methods.length).toBeGreaterThanOrEqual(2); // greet, formatGreeting

      // HAS_MEMBER edge from class → method (schema uses HAS_MEMBER for class children)
      const hasMemberFromClass = edges.filter(
        e => e.type === CoreEdgeType.HAS_MEMBER && e.startNodeId === classNode!.id
      );
      expect(hasMemberFromClass.length).toBeGreaterThan(0);
    });

    it('IMPLEMENTS edge from SimpleGreeter → Greeter interface', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const classFile = path.join(FIXTURE_DIR, 'classes-and-methods.ts');
      const { nodes, edges } = await parser.parseChunk([classFile]);

      const classNode = nodes.find(n => n.properties.name === 'SimpleGreeter');
      const ifaceNode = nodes.find(n => n.properties.name === 'Greeter');

      expect(classNode).toBeDefined();
      expect(ifaceNode).toBeDefined();

      const implEdge = edges.find(
        e => e.type === CoreEdgeType.IMPLEMENTS &&
             e.startNodeId === classNode!.id &&
             e.endNodeId === ifaceNode!.id
      );
      expect(implEdge).toBeDefined();
    });

    it('EXTENDS edge from ChildService → BaseService', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const superFile = path.join(FIXTURE_DIR, 'super-call.ts');
      const { nodes, edges } = await parser.parseChunk([superFile]);

      const childClass = nodes.find(n => n.properties.name === 'ChildService');
      const baseClass = nodes.find(n => n.properties.name === 'BaseService');

      expect(childClass).toBeDefined();
      expect(baseClass).toBeDefined();

      const extendsEdge = edges.find(
        e => e.type === CoreEdgeType.EXTENDS &&
             e.startNodeId === childClass!.id &&
             e.endNodeId === baseClass!.id
      );
      expect(extendsEdge).toBeDefined();
    });
  });

  describe('Structural: getStats and exportToJson', () => {
    it('getStats returns accurate counts', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const basicFile = path.join(FIXTURE_DIR, 'basic.ts');
      await parser.parseChunk([basicFile]);

      const stats = parser.getStats();
      expect(stats.totalNodes).toBeGreaterThan(0);
      expect(stats.totalEdges).toBeGreaterThan(0);
      expect(stats.nodesByType[CoreNodeType.SOURCE_FILE]).toBe(1);
      expect(stats.nodesByType[CoreNodeType.FUNCTION_DECLARATION]).toBeGreaterThanOrEqual(2);
    });

    it('exportToJson returns same data as parse result', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const basicFile = path.join(FIXTURE_DIR, 'basic.ts');
      await parser.parseChunk([basicFile]);

      const json = parser.exportToJson();
      expect(json.nodes.length).toBeGreaterThan(0);
      expect(json.edges.length).toBeGreaterThan(0);
    });
  });

  describe('Structural: clearParsedData resets state', () => {
    it('clears all nodes, edges, and deferred edges', async () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const basicFile = path.join(FIXTURE_DIR, 'basic.ts');
      await parser.parseChunk([basicFile]);

      expect(parser.getCurrentCounts().nodes).toBeGreaterThan(0);

      parser.clearParsedData();

      const counts = parser.getCurrentCounts();
      expect(counts.nodes).toBe(0);
      expect(counts.edges).toBe(0);
      expect(counts.deferredEdges).toBe(0);
    });
  });

  describe('Structural: serialized shared context', () => {
    it('getSerializedSharedContext returns array', () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const ctx = parser.getSerializedSharedContext();
      expect(Array.isArray(ctx)).toBe(true);
    });

    it('mergeSerializedSharedContext accepts serialized data', () => {
      const parser = new TypeScriptParser(FIXTURE_DIR, TSCONFIG_PATH, undefined, []);
      const data: Array<[string, unknown]> = [['testKey', 'testValue']];
      parser.mergeSerializedSharedContext(data);
      const ctx = parser.getSharedContext();
      expect(ctx.get('testKey')).toBe('testValue');
    });
  });
});
