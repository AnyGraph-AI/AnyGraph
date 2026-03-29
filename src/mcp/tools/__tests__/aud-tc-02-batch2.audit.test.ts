/**
 * AUD-TC-02 Batch 2 — Direct behavioral tests for 7 core analysis MCP tools.
 * Tests captured handler functions, not registration metadata.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// vi.hoisted — all mock fns created here survive hoisting
// ────────────────────────────────────────────────────────────────────────────
const {
  mockRun, mockClose,
  mockTraversalHandlerTraverseFromNode, mockTraversalHandlerResolveNodeIdFromFilePath,
  mockTraversalHandlerHandleSearch,
  mockEmbedText,
  mockPromptToQuery, mockGetOrCreateAssistant,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockTraversalHandlerTraverseFromNode: vi.fn(),
  mockTraversalHandlerResolveNodeIdFromFilePath: vi.fn(),
  mockTraversalHandlerHandleSearch: vi.fn(),
  mockEmbedText: vi.fn(),
  mockPromptToQuery: vi.fn(),
  mockGetOrCreateAssistant: vi.fn().mockResolvedValue(undefined),
}));

// ────────────────────────────────────────────────────────────────────────────
// Capture registered handlers for BOTH registration patterns
// ────────────────────────────────────────────────────────────────────────────
const registeredTools = new Map<string, Function>();
const mockServer = {
  registerTool: vi.fn((name: string, _meta: any, handler: Function) => {
    registeredTools.set(name, handler);
  }),
  tool: vi.fn((name: string, _desc: any, _schema: any, handler: Function) => {
    registeredTools.set(name, handler);
  }),
};

// ────────────────────────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────────────────────────
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.close = mockClose;
  }),
  QUERIES: {
    GET_PROJECT_SEMANTIC_TYPES: 'GET_PROJECT_SEMANTIC_TYPES',
    FIND_UNREFERENCED_EXPORTS: 'FIND_UNREFERENCED_EXPORTS',
    FIND_UNCALLED_PRIVATE_METHODS: 'FIND_UNCALLED_PRIVATE_METHODS',
    FIND_UNREFERENCED_INTERFACES: 'FIND_UNREFERENCED_INTERFACES',
    GET_FRAMEWORK_ENTRY_POINTS: 'GET_FRAMEWORK_ENTRY_POINTS',
    FIND_STRUCTURAL_DUPLICATES: 'FIND_STRUCTURAL_DUPLICATES',
    FIND_SEMANTIC_DUPLICATES: 'FIND_SEMANTIC_DUPLICATES',
    GET_NODE_BY_ID: 'GET_NODE_BY_ID',
    GET_NODE_IMPACT: 'GET_NODE_IMPACT',
    GET_TRANSITIVE_DEPENDENTS: vi.fn(() => 'GET_TRANSITIVE_DEPENDENTS'),
    VECTOR_SEARCH: 'VECTOR_SEARCH',
  },
}));

vi.mock('../utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    debugLog: vi.fn(),
    resolveProjectIdOrError: vi.fn(async (projectId: string) => ({
      success: true,
      projectId,
    })),
    createErrorResponse: actual.createErrorResponse,
    createSuccessResponse: actual.createSuccessResponse,
    sanitizeNumericInput: actual.sanitizeNumericInput,
    formatQueryResults: vi.fn((results: any, query: string, cypherResult: any) => ({
      query,
      cypher: cypherResult.cypher,
      results,
    })),
  };
});

vi.mock('../index.js', () => ({
  logToolCallStart: vi.fn().mockResolvedValue(1),
  logToolCallEnd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../core/utils/shared-utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    toNumber: (v: any) => (typeof v === 'number' ? v : Number(v) || 0),
  };
});

vi.mock('../../../core/utils/project-id.js', () => ({
  LIST_PROJECTS_QUERY: 'MATCH (p:Project) RETURN p',
  resolveProjectIdFromInput: vi.fn(async (id: string) => id),
}));

vi.mock('../../handlers/traversal.handler.js', () => ({
  TraversalHandler: vi.fn(function (this: any) {
    this.traverseFromNode = mockTraversalHandlerTraverseFromNode;
    this.resolveNodeIdFromFilePath = mockTraversalHandlerResolveNodeIdFromFilePath;
    this.handleSearch = mockTraversalHandlerHandleSearch;
  }),
}));

vi.mock('../../../core/embeddings/embeddings.service.js', () => ({
  EmbeddingsService: vi.fn(function (this: any) {
    this.embedText = mockEmbedText;
  }),
}));

vi.mock('../../../core/embeddings/natural-language-to-cypher.service.js', () => ({
  NaturalLanguageToCypherService: vi.fn(function (this: any) {
    this.promptToQuery = mockPromptToQuery;
    this.getOrCreateAssistant = mockGetOrCreateAssistant;
  }),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { createTraverseFromNodeTool } from '../traverse-from-node.tool.js';
import { createDetectDeadCodeTool } from '../detect-dead-code.tool.js';
import { createDetectDuplicateCodeTool } from '../detect-duplicate-code.tool.js';
import { createDetectHotspotsTool } from '../detect-hotspots.tool.js';
import { createImpactAnalysisTool } from '../impact-analysis.tool.js';
import { createSearchCodebaseTool } from '../search-codebase.tool.js';
import { createNaturalLanguageToCypherTool, initializeNaturalLanguageService } from '../natural-language-to-cypher.tool.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function textOf(result: any): string {
  return result?.content?.[0]?.text ?? '';
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════════════════
describe('[aud-tc-02] Batch 2 — core analysis MCP tools', () => {
  beforeEach(() => {
    registeredTools.clear();
    // mockReset clears queued mockResolvedValueOnce values (clearAllMocks does NOT)
    mockRun.mockReset();
    mockClose.mockReset().mockResolvedValue(undefined);
    mockTraversalHandlerTraverseFromNode.mockReset();
    mockTraversalHandlerResolveNodeIdFromFilePath.mockReset();
    mockTraversalHandlerHandleSearch.mockReset();
    mockEmbedText.mockReset();
    mockPromptToQuery.mockReset();
    mockGetOrCreateAssistant.mockReset().mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  // ── 1. traverse-from-node ─────────────────────────────────────────────
  describe('traverse-from-node tool', () => {
    it('registers via registerTool with correct name', () => {
      createTraverseFromNodeTool(mockServer as any);
      expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('traverse_from_node')).toBe(true);
    });

    it('returns error when neither nodeId nor filePath provided', async () => {
      createTraverseFromNodeTool(mockServer as any);
      const result = await registeredTools.get('traverse_from_node')!({
        projectId: 'proj_1',
      });
      const text = textOf(result);
      expect(text).toContain('Either nodeId or filePath must be provided');
    });

    it('delegates nodeId traversal to TraversalHandler', async () => {
      mockTraversalHandlerTraverseFromNode.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'traversal results' }],
      });

      createTraverseFromNodeTool(mockServer as any);
      const result = await registeredTools.get('traverse_from_node')!({
        projectId: 'proj_1',
        nodeId: 'node_abc',
      });
      expect(mockTraversalHandlerTraverseFromNode).toHaveBeenCalledWith(
        'node_abc',
        [],
        expect.objectContaining({ projectId: 'proj_1' }),
      );
      expect(textOf(result)).toBe('traversal results');
    });

    it('resolves filePath to nodeId before traversal', async () => {
      mockTraversalHandlerResolveNodeIdFromFilePath.mockResolvedValueOnce('resolved_node_id');
      mockTraversalHandlerTraverseFromNode.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'file traversal' }],
      });

      createTraverseFromNodeTool(mockServer as any);
      await registeredTools.get('traverse_from_node')!({
        projectId: 'proj_1',
        filePath: 'src/main.ts',
      });
      expect(mockTraversalHandlerResolveNodeIdFromFilePath).toHaveBeenCalledWith('src/main.ts', 'proj_1');
      expect(mockTraversalHandlerTraverseFromNode).toHaveBeenCalledWith(
        'resolved_node_id',
        [],
        expect.objectContaining({ projectId: 'proj_1' }),
      );
    });

    it('returns error when filePath cannot be resolved', async () => {
      mockTraversalHandlerResolveNodeIdFromFilePath.mockResolvedValueOnce(null);

      createTraverseFromNodeTool(mockServer as any);
      const result = await registeredTools.get('traverse_from_node')!({
        projectId: 'proj_1',
        filePath: 'nonexistent.ts',
      });
      const text = textOf(result);
      expect(text).toContain('No SourceFile node found');
      expect(text).toContain('nonexistent.ts');
    });

    it('closes Neo4jService in finally block', async () => {
      mockTraversalHandlerTraverseFromNode.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'ok' }],
      });

      createTraverseFromNodeTool(mockServer as any);
      await registeredTools.get('traverse_from_node')!({
        projectId: 'proj_1',
        nodeId: 'node_1',
      });
      expect(mockClose).toHaveBeenCalled();
    });

    it('returns error response and closes on handler exception', async () => {
      mockTraversalHandlerTraverseFromNode.mockRejectedValueOnce(new Error('traversal boom'));

      createTraverseFromNodeTool(mockServer as any);
      const result = await registeredTools.get('traverse_from_node')!({
        projectId: 'proj_1',
        nodeId: 'node_1',
      });
      expect(textOf(result)).toContain('traversal boom');
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 2. detect-dead-code ───────────────────────────────────────────────
  describe('detect-dead-code tool', () => {
    // Helper to set up 4 parallel query results (semanticTypes, exports, private, interfaces, entryPoints)
    function setupDeadCodeQueries(opts: {
      semanticTypes?: any[];
      exports?: any[];
      privateMethods?: any[];
      interfaces?: any[];
      entryPoints?: any[];
    }) {
      // First call: GET_PROJECT_SEMANTIC_TYPES
      mockRun.mockResolvedValueOnce(opts.semanticTypes ?? []);
      // Then 4 parallel calls: exports, private, interfaces, entryPoints
      mockRun.mockResolvedValueOnce(opts.exports ?? []);
      mockRun.mockResolvedValueOnce(opts.privateMethods ?? []);
      mockRun.mockResolvedValueOnce(opts.interfaces ?? []);
      mockRun.mockResolvedValueOnce(opts.entryPoints ?? []);
    }

    it('registers via registerTool with correct name', () => {
      createDetectDeadCodeTool(mockServer as any);
      expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('detect_dead_code')).toBe(true);
    });

    it('returns "No potentially dead code found" when all queries empty', async () => {
      setupDeadCodeQueries({});

      createDetectDeadCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_dead_code')!({
        projectId: 'proj_1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.summary).toContain('No potentially dead code found');
      expect(parsed.totalCount).toBe(0);
    });

    it('classifies unreferenced exports with HIGH confidence', async () => {
      setupDeadCodeQueries({
        exports: [{
          nodeId: 'n1',
          name: 'unusedFn',
          coreType: 'FunctionDeclaration',
          semanticType: null,
          filePath: 'src/utils/helpers.ts',
          lineNumber: 10,
          reason: 'Exported but never imported',
        }],
      });

      createDetectDeadCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_dead_code')!({
        projectId: 'proj_1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.totalCount).toBe(1);
      expect(parsed.deadCode[0].name).toBe('unusedFn');
      expect(parsed.deadCode[0].confidence).toBe('HIGH');
    });

    it('classifies private methods with MEDIUM confidence', async () => {
      setupDeadCodeQueries({
        privateMethods: [{
          nodeId: 'n2',
          name: 'privateHelper',
          coreType: 'MethodDeclaration',
          semanticType: null,
          filePath: 'src/service.ts',
          lineNumber: 42,
          reason: 'Private method with no callers',
        }],
      });

      createDetectDeadCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_dead_code')!({
        projectId: 'proj_1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.totalCount).toBe(1);
      expect(parsed.deadCode[0].confidence).toBe('MEDIUM');
    });

    it('filters by category when filterCategory specified', async () => {
      setupDeadCodeQueries({
        exports: [
          {
            nodeId: 'n1', name: 'UIComp', coreType: 'FunctionDeclaration',
            semanticType: null, filePath: '/home/project/packages/ui/src/Button.tsx',
            lineNumber: 1, reason: 'Exported but never imported',
          },
          {
            nodeId: 'n2', name: 'helper', coreType: 'FunctionDeclaration',
            semanticType: null, filePath: 'src/utils/calc.ts',
            lineNumber: 5, reason: 'Exported but never imported',
          },
        ],
      });

      createDetectDeadCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_dead_code')!({
        projectId: 'proj_1',
        filterCategory: 'internal-unused',
      });
      const parsed = JSON.parse(textOf(result));
      // Only the non-UI, non-package item should appear
      expect(parsed.totalCount).toBe(1);
      expect(parsed.deadCode[0].name).toBe('helper');
    });

    it('excludes entry point nodes from results', async () => {
      setupDeadCodeQueries({
        exports: [{
          nodeId: 'ep_node',
          name: 'AppModule',
          coreType: 'ClassDeclaration',
          semanticType: null,
          filePath: 'src/app.module.ts',
          lineNumber: 1,
          reason: 'Exported but never imported',
        }],
        entryPoints: [{
          nodeId: 'ep_node',
          name: 'AppModule',
          coreType: 'ClassDeclaration',
          semanticType: null,
          filePath: 'src/app.module.ts',
        }],
      });

      createDetectDeadCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_dead_code')!({
        projectId: 'proj_1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.totalCount).toBe(0);
    });

    it('returns error response and closes on exception', async () => {
      mockRun.mockRejectedValueOnce(new Error('DB crash'));

      createDetectDeadCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_dead_code')!({
        projectId: 'proj_1',
      });
      expect(textOf(result)).toContain('DB crash');
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 3. detect-duplicate-code ──────────────────────────────────────────
  describe('detect-duplicate-code tool', () => {
    it('registers via registerTool with correct name', () => {
      createDetectDuplicateCodeTool(mockServer as any);
      expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('detect_duplicate_code')).toBe(true);
    });

    it('groups structural duplicates by normalizedHash', async () => {
      mockRun.mockResolvedValueOnce([
        { nodeId: 'n1', name: 'fnA', coreType: 'FunctionDeclaration', semanticType: null, filePath: 'src/a.ts', lineNumber: 1, normalizedHash: 'hash1', sourceCode: '' },
        { nodeId: 'n2', name: 'fnB', coreType: 'FunctionDeclaration', semanticType: null, filePath: 'src/b.ts', lineNumber: 5, normalizedHash: 'hash1', sourceCode: '' },
      ]);

      createDetectDuplicateCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_duplicate_code')!({
        projectId: 'proj_1',
        type: 'structural',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.totalGroups).toBe(1);
      expect(parsed.duplicates[0].type).toBe('structural');
      expect(parsed.duplicates[0].similarity).toBe(1.0);
      expect(parsed.duplicates[0].confidence).toBe('HIGH');
      expect(parsed.duplicates[0].items).toHaveLength(2);
    });

    it('finds semantic duplicates and filters structural pairs', async () => {
      // structural query returns empty
      mockRun.mockResolvedValueOnce([]);
      // semantic query
      mockRun.mockResolvedValueOnce([
        {
          nodeId1: 's1', name1: 'processA', coreType1: 'FunctionDeclaration', semanticType1: null,
          filePath1: 'src/a.ts', lineNumber1: 1, sourceCode1: '',
          nodeId2: 's2', name2: 'processB', coreType2: 'FunctionDeclaration', semanticType2: null,
          filePath2: 'src/b.ts', lineNumber2: 10, sourceCode2: '',
          similarity: 0.92,
        },
      ]);
      // embedding count check (since semantic groups found, this won't be called but mock just in case)
      mockRun.mockResolvedValueOnce([{ count: 100 }]);

      createDetectDuplicateCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_duplicate_code')!({
        projectId: 'proj_1',
        type: 'semantic',
        minSimilarity: 0.8,
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.totalGroups).toBe(1);
      expect(parsed.duplicates[0].type).toBe('semantic');
      expect(parsed.duplicates[0].similarity).toBeGreaterThanOrEqual(0.9);
      expect(parsed.duplicates[0].confidence).toBe('HIGH');
    });

    it('returns "No duplicate code found" with empty results', async () => {
      mockRun.mockResolvedValueOnce([]); // structural
      mockRun.mockResolvedValueOnce([]); // semantic
      mockRun.mockResolvedValueOnce([{ count: 50 }]); // embedding count

      createDetectDuplicateCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_duplicate_code')!({
        projectId: 'proj_1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.summary).toContain('No duplicate code found');
      expect(parsed.totalGroups).toBe(0);
    });

    it('handles vector index not available gracefully', async () => {
      mockRun.mockResolvedValueOnce([]); // structural
      mockRun.mockRejectedValueOnce(new Error('vector index not found')); // semantic
      mockRun.mockResolvedValueOnce([{ count: 0 }]); // embedding count

      createDetectDuplicateCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_duplicate_code')!({
        projectId: 'proj_1',
        type: 'all',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.summary).toContain('Warning');
      expect(parsed.summary).toContain('embeddings');
    });

    it('returns error response and closes on fatal exception', async () => {
      mockRun.mockRejectedValueOnce(new Error('connection lost'));

      createDetectDuplicateCodeTool(mockServer as any);
      const result = await registeredTools.get('detect_duplicate_code')!({
        projectId: 'proj_1',
        type: 'structural',
      });
      expect(textOf(result)).toContain('connection lost');
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 4. detect-hotspots ────────────────────────────────────────────────
  describe('detect-hotspots tool', () => {
    it('registers via server.tool (not registerTool)', () => {
      createDetectHotspotsTool(mockServer as any);
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('detect_hotspots')).toBe(true);
    });

    it('returns function hotspots with correct columns', async () => {
      mockRun.mockResolvedValueOnce([{
        name: 'processOrder',
        filePath: 'src/services/order.ts',
        riskLevel: 7.5,
        riskTier: 'high',
        gitChangeFrequency: 0.8,
        fanIn: 5,
        fanOut: 3,
        lineCount: 120,
        hotspotScore: 24.5,
        authorEntropy: 2.1,
        temporalCoupling: 0.3,
        testCoverage: false,
      }]);

      createDetectHotspotsTool(mockServer as any);
      const result = await registeredTools.get('detect_hotspots')!({
        projectId: 'proj_1',
        level: 'function',
      });
      const text = textOf(result);
      expect(text).toContain('Function Hotspots');
      expect(text).toContain('processOrder');
      expect(text).toContain('❌'); // no test coverage
    });

    it('returns file hotspots with aggregated stats', async () => {
      mockRun.mockResolvedValueOnce([{
        filePath: 'src/core/engine.ts',
        funcCount: 15,
        dependentCount: 8,
        gitChangeFrequency: 0.6,
        avgRiskLevel: 5.2,
        maxRiskLevel: 9.0,
        hotspotScore: 42.0,
        authorCount: 3,
      }]);

      createDetectHotspotsTool(mockServer as any);
      const result = await registeredTools.get('detect_hotspots')!({
        projectId: 'proj_1',
        level: 'file',
      });
      const text = textOf(result);
      expect(text).toContain('File Hotspots');
      expect(text).toContain('engine.ts');
    });

    it('returns both function and file hotspots in "both" mode', async () => {
      // function query
      mockRun.mockResolvedValueOnce([{
        name: 'fn1', filePath: 'src/a.ts', riskLevel: 3, riskTier: 'medium',
        gitChangeFrequency: 0.5, fanIn: 2, fanOut: 1, lineCount: 50,
        hotspotScore: 10, authorEntropy: 1, temporalCoupling: 0, testCoverage: true,
      }]);
      // file query
      mockRun.mockResolvedValueOnce([{
        filePath: 'src/a.ts', funcCount: 5, dependentCount: 2,
        gitChangeFrequency: 0.5, avgRiskLevel: 3, maxRiskLevel: 5,
        hotspotScore: 20, authorCount: 2,
      }]);

      createDetectHotspotsTool(mockServer as any);
      const result = await registeredTools.get('detect_hotspots')!({
        projectId: 'proj_1',
        level: 'both',
      });
      const text = textOf(result);
      expect(text).toContain('Function Hotspots');
      expect(text).toContain('File Hotspots');
    });

    it('shows untested hotspot warning', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'fn1', filePath: 'a.ts', riskLevel: 5, riskTier: 'high', gitChangeFrequency: 0.5, fanIn: 1, fanOut: 1, lineCount: 30, hotspotScore: 15, authorEntropy: 1, temporalCoupling: 0, testCoverage: false },
        { name: 'fn2', filePath: 'b.ts', riskLevel: 4, riskTier: 'medium', gitChangeFrequency: 0.3, fanIn: 1, fanOut: 1, lineCount: 20, hotspotScore: 10, authorEntropy: 1, temporalCoupling: 0, testCoverage: false },
      ]);

      createDetectHotspotsTool(mockServer as any);
      const result = await registeredTools.get('detect_hotspots')!({
        projectId: 'proj_1',
        level: 'function',
      });
      const text = textOf(result);
      expect(text).toContain('⚠️');
      expect(text).toContain('2/2 hotspots have NO test coverage');
    });

    it('returns "No function hotspots found" when empty', async () => {
      mockRun.mockResolvedValueOnce([]);

      createDetectHotspotsTool(mockServer as any);
      const result = await registeredTools.get('detect_hotspots')!({
        projectId: 'proj_1',
        level: 'function',
      });
      expect(textOf(result)).toContain('No function hotspots found');
    });

    it('returns error on exception', async () => {
      mockRun.mockRejectedValueOnce(new Error('timeout'));

      createDetectHotspotsTool(mockServer as any);
      const result = await registeredTools.get('detect_hotspots')!({
        projectId: 'proj_1',
        level: 'function',
      });
      expect(textOf(result)).toContain('Hotspot detection failed');
    });
  });

  // ── 5. impact-analysis ────────────────────────────────────────────────
  describe('impact-analysis tool', () => {
    it('registers via registerTool with correct name', () => {
      createImpactAnalysisTool(mockServer as any);
      expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('impact_analysis')).toBe(true);
    });

    it('returns error when neither nodeId nor filePath provided', async () => {
      createImpactAnalysisTool(mockServer as any);
      const result = await registeredTools.get('impact_analysis')!({
        projectId: 'proj_1',
      });
      expect(textOf(result)).toContain('Either nodeId or filePath must be provided');
    });

    it('returns "not found" for unknown nodeId', async () => {
      mockRun.mockResolvedValueOnce([]); // GET_NODE_BY_ID returns empty

      createImpactAnalysisTool(mockServer as any);
      const result = await registeredTools.get('impact_analysis')!({
        projectId: 'proj_1',
        nodeId: 'nonexistent',
      });
      expect(textOf(result)).toContain('not found');
    });

    it('returns safe-to-modify for node with no dependents', async () => {
      // GET_NODE_BY_ID
      mockRun.mockResolvedValueOnce([{
        id: 'node_1', name: 'isolatedFn', semanticType: 'Function',
        coreType: 'FunctionDeclaration', labels: ['Function'],
        filePath: 'src/isolated.ts',
      }]);
      // GET_NODE_IMPACT
      mockRun.mockResolvedValueOnce([]);
      // GET_TRANSITIVE_DEPENDENTS
      mockRun.mockResolvedValueOnce([]);

      createImpactAnalysisTool(mockServer as any);
      const result = await registeredTools.get('impact_analysis')!({
        projectId: 'proj_1',
        nodeId: 'node_1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.riskLevel).toBe('LOW');
      expect(parsed.summary).toContain('safe to modify');
      expect(parsed.directDependents.count).toBe(0);
    });

    it('computes risk score based on direct and transitive dependents', async () => {
      // GET_NODE_BY_ID
      mockRun.mockResolvedValueOnce([{
        id: 'node_base', name: 'BaseService', semanticType: 'Service',
        coreType: 'ClassDeclaration', labels: ['Class'],
        filePath: 'src/base.ts',
      }]);
      // GET_NODE_IMPACT — several direct dependents
      mockRun.mockResolvedValueOnce([
        { nodeId: 'd1', name: 'UserService', labels: ['Class'], semanticType: 'Service', coreType: 'ClassDeclaration', filePath: 'src/user.ts', relationshipType: 'EXTENDS', weight: 0.95 },
        { nodeId: 'd2', name: 'OrderService', labels: ['Class'], semanticType: 'Service', coreType: 'ClassDeclaration', filePath: 'src/order.ts', relationshipType: 'EXTENDS', weight: 0.95 },
        { nodeId: 'd3', name: 'handleReq', labels: ['Function'], semanticType: null, coreType: 'FunctionDeclaration', filePath: 'src/handler.ts', relationshipType: 'CALLS', weight: 0.75 },
      ]);
      // GET_TRANSITIVE_DEPENDENTS
      mockRun.mockResolvedValueOnce([
        { nodeId: 't1', name: 'Controller', labels: ['Class'], semanticType: 'Controller', coreType: 'ClassDeclaration', filePath: 'src/ctrl.ts', relationshipPath: ['CALLS'], depth: 2 },
      ]);

      createImpactAnalysisTool(mockServer as any);
      const result = await registeredTools.get('impact_analysis')!({
        projectId: 'proj_1',
        nodeId: 'node_base',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.directDependents.count).toBe(3);
      expect(parsed.transitiveDependents.count).toBe(1);
      expect(parsed.riskScore).toBeGreaterThan(0);
      expect(parsed.affectedFiles.length).toBeGreaterThan(0);
    });

    it('merges framework config relationship weights', async () => {
      // GET_NODE_BY_ID
      mockRun.mockResolvedValueOnce([{
        id: 'n1', name: 'MyProvider', semanticType: 'Provider',
        coreType: 'ClassDeclaration', labels: ['Class'], filePath: 'src/p.ts',
      }]);
      // GET_NODE_IMPACT with INJECTS relationship
      mockRun.mockResolvedValueOnce([
        { nodeId: 'd1', name: 'Consumer', labels: ['Class'], semanticType: null, coreType: 'ClassDeclaration', filePath: 'src/c.ts', relationshipType: 'INJECTS', weight: 0.5 },
      ]);
      // Transitive
      mockRun.mockResolvedValueOnce([]);

      createImpactAnalysisTool(mockServer as any);
      const result = await registeredTools.get('impact_analysis')!({
        projectId: 'proj_1',
        nodeId: 'n1',
        frameworkConfig: {
          relationshipWeights: { INJECTS: 0.9 },
          highRiskTypes: ['Provider'],
        },
      });
      const parsed = JSON.parse(textOf(result));
      // Should have computed with the custom weights
      expect(parsed.riskScore).toBeGreaterThan(0);
      expect(parsed.directDependents.count).toBe(1);
    });

    it('returns error on exception and closes', async () => {
      mockRun.mockRejectedValueOnce(new Error('neo4j down'));

      createImpactAnalysisTool(mockServer as any);
      const result = await registeredTools.get('impact_analysis')!({
        projectId: 'proj_1',
        nodeId: 'n1',
      });
      expect(textOf(result)).toContain('neo4j down');
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 6. search-codebase ────────────────────────────────────────────────
  describe('search-codebase tool', () => {
    it('registers via registerTool with correct name', () => {
      createSearchCodebaseTool(mockServer as any);
      expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('search_codebase')).toBe(true);
    });

    it('returns results via vector search and traversal', async () => {
      const fakeEmbedding = [0.1, 0.2, 0.3];
      mockEmbedText.mockResolvedValueOnce(fakeEmbedding);
      mockRun.mockResolvedValueOnce([{
        node: { properties: { id: 'found_node' } },
        score: 0.85,
      }]);
      mockTraversalHandlerTraverseFromNode.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'search results from traversal' }],
      });

      createSearchCodebaseTool(mockServer as any);
      const result = await registeredTools.get('search_codebase')!({
        projectId: 'proj_1',
        query: 'find auth logic',
      });
      expect(mockEmbedText).toHaveBeenCalledWith('find auth logic');
      expect(mockTraversalHandlerTraverseFromNode).toHaveBeenCalledWith(
        'found_node',
        fakeEmbedding,
        expect.objectContaining({ projectId: 'proj_1' }),
      );
      expect(textOf(result)).toContain('search results from traversal');
    });

    it('returns no-results message when vector search empty', async () => {
      mockEmbedText.mockResolvedValueOnce([0.1]);
      mockRun.mockResolvedValueOnce([]);

      createSearchCodebaseTool(mockServer as any);
      const result = await registeredTools.get('search_codebase')!({
        projectId: 'proj_1',
        query: 'obscure code',
      });
      const text = textOf(result);
      expect(text).toContain('No code found');
      expect(text).toContain('obscure code');
    });

    it('returns low-similarity message when best match below threshold', async () => {
      mockEmbedText.mockResolvedValueOnce([0.1]);
      mockRun.mockResolvedValueOnce([{
        node: { properties: { id: 'weak_match' } },
        score: 0.3,
      }]);

      createSearchCodebaseTool(mockServer as any);
      const result = await registeredTools.get('search_codebase')!({
        projectId: 'proj_1',
        query: 'random stuff',
        minSimilarity: 0.65,
      });
      const text = textOf(result);
      expect(text).toContain('No sufficiently relevant code found');
    });

    it('returns error on embeddings failure', async () => {
      mockEmbedText.mockRejectedValueOnce(new Error('OpenAI rate limit'));

      createSearchCodebaseTool(mockServer as any);
      const result = await registeredTools.get('search_codebase')!({
        projectId: 'proj_1',
        query: 'test',
      });
      expect(textOf(result)).toContain('OpenAI rate limit');
      expect(mockClose).toHaveBeenCalled();
    });

    it('closes Neo4jService in finally block', async () => {
      mockEmbedText.mockResolvedValueOnce([0.1]);
      mockRun.mockResolvedValueOnce([]);

      createSearchCodebaseTool(mockServer as any);
      await registeredTools.get('search_codebase')!({
        projectId: 'proj_1',
        query: 'test',
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 7. natural-language-to-cypher ─────────────────────────────────────
  describe('natural-language-to-cypher tool', () => {
    it('registers via registerTool with correct name', () => {
      createNaturalLanguageToCypherTool(mockServer as any);
      expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('natural_language_to_cypher')).toBe(true);
    });

    it('returns service-not-initialized message when service is null', async () => {
      // Service starts as null (module-level variable)
      createNaturalLanguageToCypherTool(mockServer as any);
      const result = await registeredTools.get('natural_language_to_cypher')!({
        projectId: 'proj_1',
        query: 'find all classes',
      });
      const text = textOf(result);
      // Should contain the service not initialized message
      expect(text.length).toBeGreaterThan(0);
      // Should NOT contain an error marker
      expect(result.isError).toBeFalsy();
    });

    it('converts NL to Cypher, validates, and executes', async () => {
      // Initialize the service first
      await initializeNaturalLanguageService();

      createNaturalLanguageToCypherTool(mockServer as any);

      mockPromptToQuery.mockResolvedValueOnce({
        cypher: 'MATCH (n:Class) RETURN n.name',
        parameters: {},
      });
      // EXPLAIN validation
      mockRun.mockResolvedValueOnce([]);
      // Actual execution
      mockRun.mockResolvedValueOnce([{ name: 'MyClass' }]);

      const result = await registeredTools.get('natural_language_to_cypher')!({
        projectId: 'proj_1',
        query: 'find all classes',
      });
      // Should have called promptToQuery
      expect(mockPromptToQuery).toHaveBeenCalledWith('find all classes', 'proj_1');
      // Should have run EXPLAIN first, then the actual query
      expect(mockRun).toHaveBeenCalledTimes(2);
      expect(result.isError).toBeFalsy();
    });

    it('returns syntax error when EXPLAIN validation fails', async () => {
      await initializeNaturalLanguageService();

      createNaturalLanguageToCypherTool(mockServer as any);

      mockPromptToQuery.mockResolvedValueOnce({
        cypher: 'MATC (n) RETUR n',
        parameters: {},
      });
      // EXPLAIN fails — the tool catches this and calls createErrorResponse(string)
      mockRun.mockRejectedValueOnce(new Error('Invalid input'));

      const result = await registeredTools.get('natural_language_to_cypher')!({
        projectId: 'proj_1',
        query: 'bad query',
      });
      const text = textOf(result);
      // createErrorResponse formats as "ERROR: <message>"
      expect(text).toContain('Invalid input');
      expect(text).toContain('Cypher');
    });

    it('returns error on promptToQuery exception', async () => {
      await initializeNaturalLanguageService();

      createNaturalLanguageToCypherTool(mockServer as any);

      mockPromptToQuery.mockRejectedValueOnce(new Error('LLM timeout'));

      const result = await registeredTools.get('natural_language_to_cypher')!({
        projectId: 'proj_1',
        query: 'something',
      });
      expect(textOf(result)).toContain('LLM timeout');
      expect(mockClose).toHaveBeenCalled();
    });

    it('closes Neo4jService in finally block', async () => {
      createNaturalLanguageToCypherTool(mockServer as any);
      await registeredTools.get('natural_language_to_cypher')!({
        projectId: 'proj_1',
        query: 'test',
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
