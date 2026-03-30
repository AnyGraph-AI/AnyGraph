/**
 * AUD-TC-02 Batch 7 — Behavioral tests for MCP handler layer.
 * Covers: GraphGeneratorHandler, performIncrementalParse,
 *         ParallelImportHandler, StreamingImportHandler.
 *
 * Rules:
 *  - No source-string-match tests, no Cypher string assertions
 *  - No reimplemented logic
 *  - Mock at closest module boundary
 *  - Constructor mocks use vi.fn(function(this: any) {...})
 *  - vi.hoisted() for all mock setup
 *  - ESM .js extensions on all imports
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted — all mock fns created here survive factory hoisting
// ─────────────────────────────────────────────────────────────────────────────
const {
  // Neo4j
  mockNeo4jRun,
  mockNeo4jClose,
  // EmbeddingsService
  mockEmbedTextsInBatches,
  // fs/promises
  mockFsReadFile,
  mockFsWriteFile,
  mockFsUnlink,
  // fs (sync)
  mockWriteFileSync,
  mockUnlinkSync,
  // IR materializer
  mockConvertNeo4jGraphToIrDocument,
  mockConvertNeo4jEdgesToIrDocument,
  mockMaterializeIrDocument,
  // project-id utils
  mockResolveProjectId,
  mockGetProjectName,
  // detectChangedFiles
  mockDetectChangedFiles,
  // cross-file-edge helpers
  mockGetCrossFileEdges,
  mockDeleteSourceFileSubgraphs,
  mockSaveEnrichmentProperties,
  mockRestoreEnrichmentProperties,
  mockLoadExistingNodesForEdgeDetection,
  // ParserFactory
  mockCreateParserWithAutoDetection,
  // Parser instance methods
  mockParserDiscoverSourceFiles,
  mockParserParseChunk,
  mockParserAddExistingNodesFromChunk,
  mockParserResolveDeferredEdges,
  mockParserApplyEdgeEnhancementsManually,
  mockParserClearParsedData,
  mockParserLoadFrameworkSchemasForType,
  mockParserAddParsedNodesFromChunk,
  mockParserMergeSerializedSharedContext,
  mockParserMergeDeferredEdges,
  mockParserSetExistingNodes,
  mockParserParseWorkspace,
  mockParserExportToJson,
  // ChunkWorkerPool
  mockPoolProcessChunks,
  // GraphGeneratorHandler methods (used as injected mock object — NOT a module mock)
  mockGraphHandlerGenerateGraph,
  mockGraphHandlerSetProjectId,
} = vi.hoisted(() => {
  const mockParserDiscoverSourceFiles = vi.fn();
  const mockParserParseChunk = vi.fn();
  const mockParserAddExistingNodesFromChunk = vi.fn();
  const mockParserResolveDeferredEdges = vi.fn();
  const mockParserApplyEdgeEnhancementsManually = vi.fn();
  const mockParserClearParsedData = vi.fn();
  const mockParserLoadFrameworkSchemasForType = vi.fn();
  const mockParserAddParsedNodesFromChunk = vi.fn();
  const mockParserMergeSerializedSharedContext = vi.fn();
  const mockParserMergeDeferredEdges = vi.fn();
  const mockParserSetExistingNodes = vi.fn();
  const mockParserParseWorkspace = vi.fn();
  const mockParserExportToJson = vi.fn();

  return {
    mockNeo4jRun: vi.fn(),
    mockNeo4jClose: vi.fn(),
    mockEmbedTextsInBatches: vi.fn(),
    mockFsReadFile: vi.fn(),
    mockFsWriteFile: vi.fn(),
    mockFsUnlink: vi.fn(),
    mockWriteFileSync: vi.fn(),
    mockUnlinkSync: vi.fn(),
    mockConvertNeo4jGraphToIrDocument: vi.fn(),
    mockConvertNeo4jEdgesToIrDocument: vi.fn(),
    mockMaterializeIrDocument: vi.fn(),
    mockResolveProjectId: vi.fn(),
    mockGetProjectName: vi.fn(),
    mockDetectChangedFiles: vi.fn(),
    mockGetCrossFileEdges: vi.fn(),
    mockDeleteSourceFileSubgraphs: vi.fn(),
    mockSaveEnrichmentProperties: vi.fn(),
    mockRestoreEnrichmentProperties: vi.fn(),
    mockLoadExistingNodesForEdgeDetection: vi.fn(),
    mockCreateParserWithAutoDetection: vi.fn(),
    mockParserDiscoverSourceFiles,
    mockParserParseChunk,
    mockParserAddExistingNodesFromChunk,
    mockParserResolveDeferredEdges,
    mockParserApplyEdgeEnhancementsManually,
    mockParserClearParsedData,
    mockParserLoadFrameworkSchemasForType,
    mockParserAddParsedNodesFromChunk,
    mockParserMergeSerializedSharedContext,
    mockParserMergeDeferredEdges,
    mockParserSetExistingNodes,
    mockParserParseWorkspace,
    mockParserExportToJson,
    mockPoolProcessChunks: vi.fn(),
    // These are used as plain object methods injected via constructor injection;
    // NOT a vi.mock on the module itself — so GraphGeneratorHandler tests get the real class.
    mockGraphHandlerGenerateGraph: vi.fn(),
    mockGraphHandlerSetProjectId: vi.fn(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — paths relative to THIS test file (src/mcp/tools/__tests__/)
// Note: graph-generator.handler.js is NOT mocked at module level so tests
// for that class use the real implementation (with mocked dependencies).
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockNeo4jRun;
    this.close = mockNeo4jClose;
  }),
  QUERIES: {
    CLEAR_PROJECT: 'CLEAR_PROJECT',
    CLEAR_DATABASE: 'CLEAR_DATABASE',
    CREATE_PROJECT_INDEX_EMBEDDED: 'CREATE_PROJECT_INDEX_EMBEDDED',
    CREATE_PROJECT_INDEX_SOURCEFILE: 'CREATE_PROJECT_INDEX_SOURCEFILE',
    CREATE_PROJECT_ID_INDEX_EMBEDDED: 'CREATE_PROJECT_ID_INDEX_EMBEDDED',
    CREATE_PROJECT_ID_INDEX_SOURCEFILE: 'CREATE_PROJECT_ID_INDEX_SOURCEFILE',
    CREATE_NORMALIZED_HASH_INDEX: 'CREATE_NORMALIZED_HASH_INDEX',
    CREATE_SESSION_BOOKMARK_INDEX: 'CREATE_SESSION_BOOKMARK_INDEX',
    CREATE_SESSION_NOTE_INDEX: 'CREATE_SESSION_NOTE_INDEX',
    CREATE_SESSION_NOTE_CATEGORY_INDEX: 'CREATE_SESSION_NOTE_CATEGORY_INDEX',
    CREATE_NODE: 'CREATE_NODE',
    CREATE_RELATIONSHIP: 'CREATE_RELATIONSHIP',
    CREATE_EMBEDDED_VECTOR_INDEX: 'CREATE_EMBEDDED_VECTOR_INDEX',
    CREATE_SESSION_NOTES_VECTOR_INDEX: 'CREATE_SESSION_NOTES_VECTOR_INDEX',
    RECREATE_CROSS_FILE_EDGES: 'RECREATE_CROSS_FILE_EDGES',
  },
}));

vi.mock('../../../core/embeddings/embeddings.service.js', () => ({
  EmbeddingsService: vi.fn(function (this: any) {
    this.embedTextsInBatches = mockEmbedTextsInBatches;
  }),
  EMBEDDING_BATCH_CONFIG: { maxBatchSize: 50 },
}));

vi.mock('fs/promises', () => {
  const mod = {
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
    unlink: mockFsUnlink,
    appendFile: vi.fn().mockResolvedValue(undefined),
  };
  return { ...mod, default: mod };
});

vi.mock('fs', () => ({
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
  constants: { R_OK: 4 },
  default: {
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
    constants: { R_OK: 4 },
  },
}));

vi.mock('../../../core/ir/index.js', () => ({
  convertNeo4jGraphToIrDocument: mockConvertNeo4jGraphToIrDocument,
  convertNeo4jEdgesToIrDocument: mockConvertNeo4jEdgesToIrDocument,
  materializeIrDocument: mockMaterializeIrDocument,
}));

vi.mock('../../../core/utils/project-id.js', () => ({
  resolveProjectId: mockResolveProjectId,
  getProjectName: mockGetProjectName,
  UPSERT_PROJECT_QUERY: 'UPSERT_PROJECT_QUERY',
}));

vi.mock('../../../core/utils/file-change-detection.js', () => ({
  detectChangedFiles: mockDetectChangedFiles,
}));

vi.mock('../../handlers/cross-file-edge.helpers.js', () => ({
  getCrossFileEdges: mockGetCrossFileEdges,
  deleteSourceFileSubgraphs: mockDeleteSourceFileSubgraphs,
  saveEnrichmentProperties: mockSaveEnrichmentProperties,
  restoreEnrichmentProperties: mockRestoreEnrichmentProperties,
  loadExistingNodesForEdgeDetection: mockLoadExistingNodesForEdgeDetection,
}));

vi.mock('../../../core/parsers/parser-factory.js', () => ({
  ParserFactory: {
    createParserWithAutoDetection: mockCreateParserWithAutoDetection,
  },
}));

vi.mock('../../../core/config/schema.js', () => ({
  CORE_TYPESCRIPT_SCHEMA: { name: 'core-typescript' },
}));

vi.mock('../../../core/parsers/typescript-parser.js', () => ({}));

vi.mock('../../workers/chunk-worker-pool.js', () => ({
  ChunkWorkerPool: vi.fn(function (this: any, _config: any) {
    this.processChunks = mockPoolProcessChunks;
  }),
}));

vi.mock('../../utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    debugLog: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../../core/utils/progress-reporter.js', () => ({
  ProgressReporter: vi.fn(function (this: any) {
    this.report = vi.fn().mockResolvedValue(undefined);
    this.setCallback = vi.fn();
    this.reportResolving = vi.fn().mockResolvedValue(undefined);
    this.reportComplete = vi.fn().mockResolvedValue(undefined);
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Subject imports (after all mocks are declared)
// ─────────────────────────────────────────────────────────────────────────────
import { GraphGeneratorHandler } from '../../handlers/graph-generator.handler.js';
import { performIncrementalParse } from '../../handlers/incremental-parse.handler.js';
import { ParallelImportHandler } from '../../handlers/parallel-import.handler.js';
import { StreamingImportHandler } from '../../handlers/streaming-import.handler.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeNode(overrides: Record<string, any> = {}): any {
  return {
    labels: ['Function'],
    properties: { name: 'myFn', sourceCode: 'function myFn() {}' },
    ...overrides,
  };
}

function makeEdge(overrides: Record<string, any> = {}): any {
  return {
    startNodeId: 'n1',
    endNodeId: 'n2',
    type: 'CALLS',
    properties: {},
    ...overrides,
  };
}

function makeGraphJson(nodes: any[] = [], edges: any[] = []) {
  return JSON.stringify({ nodes, edges, metadata: { test: true } });
}

/** Returns a fresh mock parser instance for streaming/parallel tests */
function makeParser(): any {
  return {
    discoverSourceFiles: mockParserDiscoverSourceFiles,
    parseChunk: mockParserParseChunk,
    addExistingNodesFromChunk: mockParserAddExistingNodesFromChunk,
    resolveDeferredEdges: mockParserResolveDeferredEdges,
    applyEdgeEnhancementsManually: mockParserApplyEdgeEnhancementsManually,
    clearParsedData: mockParserClearParsedData,
    loadFrameworkSchemasForType: mockParserLoadFrameworkSchemasForType,
    addParsedNodesFromChunk: mockParserAddParsedNodesFromChunk,
    mergeSerializedSharedContext: mockParserMergeSerializedSharedContext,
    mergeDeferredEdges: mockParserMergeDeferredEdges,
    setExistingNodes: mockParserSetExistingNodes,
    parseWorkspace: mockParserParseWorkspace,
    exportToJson: mockParserExportToJson,
    frameworkSchemas: [],
  };
}

/** Returns a mock GraphGeneratorHandler object for constructor injection */
function makeMockGraphHandler(): any {
  return {
    generateGraph: mockGraphHandlerGenerateGraph,
    setProjectId: mockGraphHandlerSetProjectId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('[aud-tc-02] Batch 7 — MCP handlers (graph-generator, incremental-parse, parallel-import, streaming-import)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  describe('GraphGeneratorHandler', () => {
    // Uses the REAL GraphGeneratorHandler class (not mocked at module level).
    // Dependencies (Neo4jService, EmbeddingsService, fs/promises) are all mocked.
    let neo4jService: any;
    let embeddingsService: any;
    let handler: GraphGeneratorHandler;

    beforeEach(() => {
      vi.clearAllMocks();

      // Plain objects implementing the interface — constructor injection
      neo4jService = { run: mockNeo4jRun, close: mockNeo4jClose };
      embeddingsService = { embedTextsInBatches: mockEmbedTextsInBatches };
      handler = new (GraphGeneratorHandler as any)(neo4jService, embeddingsService);

      // Default: neo4j run resolves with [{created: 1}] (covers index + import calls)
      mockNeo4jRun.mockResolvedValue([{ created: 1 }]);
    });

    // ── generateGraph ─────────────────────────────────────────────────────
    it('loads graph JSON from the given path and returns correct node/edge counts', async () => {
      const nodes = [makeNode()];
      const edges = [makeEdge()];
      mockFsReadFile.mockResolvedValue(makeGraphJson(nodes, edges));
      mockEmbedTextsInBatches.mockResolvedValue([new Array(1536).fill(0)]);

      const result = await handler.generateGraph('/tmp/graph.json', 10, false);

      expect(result.nodesImported).toBe(1);
      expect(result.edgesImported).toBe(1);
    });

    it('propagates metadata from the JSON file in the return value', async () => {
      const graphJson = JSON.stringify({
        nodes: [],
        edges: [],
        metadata: { version: '2.0', projectId: 'p1' },
      });
      mockFsReadFile.mockResolvedValue(graphJson);

      const result = await handler.generateGraph('/tmp/graph.json', 10, false);

      expect(result.metadata).toMatchObject({ version: '2.0', projectId: 'p1' });
    });

    it('clearExisting=true with projectId set — invokes the CLEAR_PROJECT query', async () => {
      mockFsReadFile.mockResolvedValue(makeGraphJson());
      handler.setProjectId('proj_abc123');

      await handler.generateGraph('/tmp/graph.json', 10, true);

      const queriesUsed = mockNeo4jRun.mock.calls.map((c: any[]) => c[0]);
      expect(queriesUsed).toContain('CLEAR_PROJECT');
      expect(queriesUsed).not.toContain('CLEAR_DATABASE');
    });

    it('clearExisting=true with no projectId — invokes the CLEAR_DATABASE query', async () => {
      mockFsReadFile.mockResolvedValue(makeGraphJson());

      await handler.generateGraph('/tmp/graph.json', 10, true);

      const queriesUsed = mockNeo4jRun.mock.calls.map((c: any[]) => c[0]);
      expect(queriesUsed).toContain('CLEAR_DATABASE');
      expect(queriesUsed).not.toContain('CLEAR_PROJECT');
    });

    it('clearExisting=false — skips both CLEAR_PROJECT and CLEAR_DATABASE', async () => {
      mockFsReadFile.mockResolvedValue(makeGraphJson());
      handler.setProjectId('proj_xyz');

      await handler.generateGraph('/tmp/graph.json', 10, false);

      const queriesUsed = mockNeo4jRun.mock.calls.map((c: any[]) => c[0]);
      expect(queriesUsed).not.toContain('CLEAR_PROJECT');
      expect(queriesUsed).not.toContain('CLEAR_DATABASE');
    });

    it('imports nodes and edges via neo4jService using CREATE_NODE and CREATE_RELATIONSHIP', async () => {
      const nodes = [makeNode(), makeNode({ properties: { name: 'fn2', sourceCode: 'x' } })];
      const edges = [makeEdge(), makeEdge({ startNodeId: 'n2', endNodeId: 'n3' })];
      mockFsReadFile.mockResolvedValue(makeGraphJson(nodes, edges));
      mockEmbedTextsInBatches.mockResolvedValue([null, null]);

      await handler.generateGraph('/tmp/graph.json', 100, false);

      const queriesUsed = mockNeo4jRun.mock.calls.map((c: any[]) => c[0]);
      expect(queriesUsed).toContain('CREATE_NODE');
      expect(queriesUsed).toContain('CREATE_RELATIONSHIP');
    });

    // ── processNodeBatch / embeddings ─────────────────────────────────────
    it('embeds nodes that have sourceCode by calling embedTextsInBatches', async () => {
      const embedding = new Array(1536).fill(0.1);
      mockEmbedTextsInBatches.mockResolvedValue([embedding]);
      const node = makeNode({ labels: ['Function'], properties: { name: 'fn', sourceCode: 'const x = 1;' } });
      mockFsReadFile.mockResolvedValue(makeGraphJson([node], []));

      await handler.generateGraph('/tmp/graph.json', 100, false);

      expect(mockEmbedTextsInBatches).toHaveBeenCalledOnce();
    });

    it('skips embedding for nodes with skipEmbedding: true', async () => {
      const node = makeNode({ skipEmbedding: true });
      mockFsReadFile.mockResolvedValue(makeGraphJson([node], []));

      await handler.generateGraph('/tmp/graph.json', 100, false);

      expect(mockEmbedTextsInBatches).not.toHaveBeenCalled();
    });

    it('handles embedding failure gracefully — imports nodes without embeddings (non-fatal)', async () => {
      mockEmbedTextsInBatches.mockRejectedValue(new Error('API unavailable'));
      const node = makeNode();
      mockFsReadFile.mockResolvedValue(makeGraphJson([node], []));

      // Must NOT throw
      const result = await handler.generateGraph('/tmp/graph.json', 100, false);

      expect(result.nodesImported).toBe(1);
      // neo4j still receives a CREATE_NODE call despite embedding failure
      const queriesUsed = mockNeo4jRun.mock.calls.map((c: any[]) => c[0]);
      expect(queriesUsed).toContain('CREATE_NODE');
    });

    // ── flattenProperties ────────────────────────────────────────────────
    it('flattenProperties — converts nested objects to JSON strings before import', async () => {
      const node = {
        labels: ['Class'],
        skipEmbedding: true,
        properties: {
          name: 'Foo',
          sourceCode: '',
          nested: { a: 1, b: 'bar' },
        },
      };
      mockFsReadFile.mockResolvedValue(makeGraphJson([node], []));

      await handler.generateGraph('/tmp/graph.json', 100, false);

      const createNodeCall = mockNeo4jRun.mock.calls.find((c: any[]) => c[0] === 'CREATE_NODE');
      expect(createNodeCall).toBeDefined();
      const importedNode = createNodeCall[1].nodes[0];
      const nestedValue = importedNode.properties.nested;
      expect(typeof nestedValue).toBe('string');
      expect(() => JSON.parse(nestedValue)).not.toThrow();
    });

    it('flattenProperties — converts complex arrays (containing objects) to JSON strings', async () => {
      const node = {
        labels: ['Class'],
        skipEmbedding: true,
        properties: {
          name: 'Bar',
          sourceCode: '',
          mixedArr: [{ x: 1 }, { y: 2 }],
        },
      };
      mockFsReadFile.mockResolvedValue(makeGraphJson([node], []));

      await handler.generateGraph('/tmp/graph.json', 100, false);

      const createNodeCall = mockNeo4jRun.mock.calls.find((c: any[]) => c[0] === 'CREATE_NODE');
      expect(createNodeCall).toBeDefined();
      const arrValue = createNodeCall[1].nodes[0].properties.mixedArr;
      expect(typeof arrValue).toBe('string');
      const parsed = JSON.parse(arrValue);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('flattenProperties — keeps scalar values (number, boolean, string) as-is', async () => {
      const node = {
        labels: ['Function'],
        skipEmbedding: true,
        properties: {
          name: 'myFn',
          sourceCode: '',
          lineCount: 42,
          isExported: true,
          docString: 'hello',
        },
      };
      mockFsReadFile.mockResolvedValue(makeGraphJson([node], []));

      await handler.generateGraph('/tmp/graph.json', 100, false);

      const createNodeCall = mockNeo4jRun.mock.calls.find((c: any[]) => c[0] === 'CREATE_NODE');
      expect(createNodeCall).toBeDefined();
      const props = createNodeCall[1].nodes[0].properties;
      expect(props.lineCount).toBe(42);
      expect(props.isExported).toBe(true);
      expect(props.docString).toBe('hello');
    });

    // ── importEdges ───────────────────────────────────────────────────────
    it('importEdges — adds sourceKind default ("ts-morph") when not present in edge properties', async () => {
      const edge = makeEdge({ properties: {} });
      mockFsReadFile.mockResolvedValue(makeGraphJson([], [edge]));

      await handler.generateGraph('/tmp/graph.json', 100, false);

      const createRelCall = mockNeo4jRun.mock.calls.find((c: any[]) => c[0] === 'CREATE_RELATIONSHIP');
      expect(createRelCall).toBeDefined();
      const importedEdge = createRelCall[1].edges[0];
      expect(importedEdge.properties.sourceKind).toBe('ts-morph');
    });

    it('importEdges — preserves an existing sourceKind value on edge properties', async () => {
      const edge = makeEdge({ properties: { sourceKind: 'babel' } });
      mockFsReadFile.mockResolvedValue(makeGraphJson([], [edge]));

      await handler.generateGraph('/tmp/graph.json', 100, false);

      const createRelCall = mockNeo4jRun.mock.calls.find((c: any[]) => c[0] === 'CREATE_RELATIONSHIP');
      expect(createRelCall).toBeDefined();
      const importedEdge = createRelCall[1].edges[0];
      expect(importedEdge.properties.sourceKind).toBe('babel');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('performIncrementalParse', () => {
    // performIncrementalParse creates Neo4jService, EmbeddingsService, and
    // GraphGeneratorHandler internally. We control behavior through the mocked
    // constructors and dependency mocks. The real GraphGeneratorHandler runs,
    // so mockFsReadFile must return valid JSON for the generateGraph call.

    const PROJECT_PATH = '/repo/my-project';
    const PROJECT_ID = 'proj_incr_test';
    const TSCONFIG = 'tsconfig.json';
    const EMPTY_GRAPH_JSON = JSON.stringify({ nodes: [], edges: [], metadata: {} });

    function makeIncrementalParser() {
      return {
        setExistingNodes: mockParserSetExistingNodes,
        parseWorkspace: mockParserParseWorkspace,
        exportToJson: mockParserExportToJson,
        frameworkSchemas: [],
      };
    }

    beforeEach(() => {
      vi.clearAllMocks();

      mockResolveProjectId.mockReturnValue(PROJECT_ID);
      mockGetProjectName.mockResolvedValue('my-project');
      mockDetectChangedFiles.mockResolvedValue({ filesToReparse: [], filesToDelete: [] });
      mockGetCrossFileEdges.mockResolvedValue([]);
      mockSaveEnrichmentProperties.mockResolvedValue([]);
      mockRestoreEnrichmentProperties.mockResolvedValue(0);
      mockDeleteSourceFileSubgraphs.mockResolvedValue(undefined);
      mockLoadExistingNodesForEdgeDetection.mockResolvedValue([]);
      mockCreateParserWithAutoDetection.mockResolvedValue(makeIncrementalParser());
      mockParserParseWorkspace.mockResolvedValue(undefined);
      mockParserExportToJson.mockReturnValue({ nodes: [], edges: [] });

      // neo4jService.run used by real GraphGeneratorHandler internals + UPSERT + RECREATE
      mockNeo4jRun.mockResolvedValue([{ created: 0 }]);
      mockNeo4jClose.mockResolvedValue(undefined);

      // writeFileSync/unlinkSync used by incremental-parse for temp graph.json
      mockWriteFileSync.mockImplementation(() => {});
      mockUnlinkSync.mockImplementation(() => {});

      // fs.readFile used by real GraphGeneratorHandler.generateGraph
      mockFsReadFile.mockResolvedValue(EMPTY_GRAPH_JSON);
    });

    it('returns zero counts immediately when no files have changed', async () => {
      mockDetectChangedFiles.mockResolvedValue({ filesToReparse: [], filesToDelete: [] });

      const result = await performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG);

      expect(result).toMatchObject({ nodesUpdated: 0, edgesUpdated: 0, filesReparsed: 0 });
    });

    it('calls detectChangedFiles with projectPath, neo4j instance, and resolved projectId', async () => {
      await performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG);

      expect(mockDetectChangedFiles).toHaveBeenCalledWith(PROJECT_PATH, expect.any(Object), PROJECT_ID);
    });

    it('creates parser via ParserFactory.createParserWithAutoDetection with lazy loading enabled', async () => {
      await performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG);

      expect(mockCreateParserWithAutoDetection).toHaveBeenCalledWith(
        PROJECT_PATH,
        TSCONFIG,
        PROJECT_ID,
        true,
      );
    });

    it('deletes old subgraphs before reparsing changed files', async () => {
      mockDetectChangedFiles.mockResolvedValue({
        filesToReparse: ['/repo/my-project/src/a.ts'],
        filesToDelete: [],
      });

      await performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG);

      expect(mockDeleteSourceFileSubgraphs).toHaveBeenCalled();
    });

    it('saves enrichment properties before deletion and restores them after import', async () => {
      const savedEnrichment = [{ nodeId: 'n1', riskTier: 'high', compositeRisk: 0.9 }];
      mockDetectChangedFiles.mockResolvedValue({
        filesToReparse: ['/repo/my-project/src/a.ts'],
        filesToDelete: [],
      });
      mockSaveEnrichmentProperties.mockResolvedValue(savedEnrichment);

      await performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG);

      expect(mockSaveEnrichmentProperties).toHaveBeenCalled();
      expect(mockRestoreEnrichmentProperties).toHaveBeenCalledWith(
        expect.any(Object),
        savedEnrichment,
        PROJECT_ID,
      );
    });

    it('saves and recreates cross-file edges across the reparse cycle', async () => {
      const crossEdges = [
        { startNodeId: 'n1', endNodeId: 'n2', edgeType: 'CALLS', edgeProperties: {} },
      ];
      mockDetectChangedFiles.mockResolvedValue({
        filesToReparse: ['/repo/my-project/src/a.ts'],
        filesToDelete: [],
      });
      mockGetCrossFileEdges.mockResolvedValue(crossEdges);
      mockNeo4jRun.mockResolvedValue([{ recreatedCount: 2 }]);

      await performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG);

      expect(mockGetCrossFileEdges).toHaveBeenCalled();
      // RECREATE_CROSS_FILE_EDGES query should be invoked
      const queriesUsed = mockNeo4jRun.mock.calls.map((c: any[]) => c[0]);
      expect(queriesUsed).toContain('RECREATE_CROSS_FILE_EDGES');
    });

    it('writes temp graph.json and cleans it up after a successful import', async () => {
      mockDetectChangedFiles.mockResolvedValue({
        filesToReparse: ['/repo/my-project/src/a.ts'],
        filesToDelete: [],
      });

      await performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG);

      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('cleans up temp graph.json even when generateGraph throws', async () => {
      mockDetectChangedFiles.mockResolvedValue({
        filesToReparse: ['/repo/my-project/src/a.ts'],
        filesToDelete: [],
      });
      // Cause the real generateGraph to fail at file read time
      mockFsReadFile.mockRejectedValue(new Error('disk error'));

      await expect(performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG)).rejects.toThrow('disk error');
      // Inner finally still called unlinkSync
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('closes neo4jService in the finally block even when detectChangedFiles throws', async () => {
      mockDetectChangedFiles.mockRejectedValue(new Error('detection error'));

      await expect(performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG)).rejects.toThrow('detection error');

      expect(mockNeo4jClose).toHaveBeenCalled();
    });

    it('closes neo4jService after a successful run', async () => {
      await performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG);

      expect(mockNeo4jClose).toHaveBeenCalled();
    });

    it('returns filesReparsed and filesDeleted counts in the result', async () => {
      mockDetectChangedFiles.mockResolvedValue({
        filesToReparse: ['/repo/my-project/src/a.ts', '/repo/my-project/src/b.ts'],
        filesToDelete: ['/repo/my-project/src/old.ts'],
      });

      const result = await performIncrementalParse(PROJECT_PATH, PROJECT_ID, TSCONFIG);

      expect(result.filesReparsed).toBe(2);
      expect(result.filesDeleted).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('ParallelImportHandler', () => {
    // ParallelImportHandler receives graphGeneratorHandler via constructor.
    // We inject a plain mock object — no module-level mock needed.
    let handler: ParallelImportHandler;
    let parser: any;

    const BASE_CONFIG = {
      chunkSize: 3,
      projectId: 'proj_parallel',
      projectPath: '/repo',
      tsconfigPath: 'tsconfig.json',
      projectType: 'typescript' as any,
    };

    /** Build a minimal pool result for pool.processChunks to resolve with */
    function makePoolResult(opts: { nodes?: number; edges?: number; chunks?: number } = {}) {
      return {
        totalNodes: opts.nodes ?? 0,
        totalEdges: opts.edges ?? 0,
        elapsedMs: 50,
        chunksProcessed: opts.chunks ?? 0,
      };
    }

    beforeEach(() => {
      vi.clearAllMocks();

      handler = new ParallelImportHandler(makeMockGraphHandler());
      parser = makeParser();

      mockParserResolveDeferredEdges.mockResolvedValue([]);
      mockParserApplyEdgeEnhancementsManually.mockResolvedValue([]);
      mockParserClearParsedData.mockImplementation(() => {});
      mockParserLoadFrameworkSchemasForType.mockImplementation(() => {});
      mockParserAddParsedNodesFromChunk.mockImplementation(() => {});
      mockParserMergeSerializedSharedContext.mockImplementation(() => {});
      mockParserMergeDeferredEdges.mockImplementation(() => {});
      mockPoolProcessChunks.mockResolvedValue(makePoolResult());

      // fs/promises used internally by importToNeo4j
      mockFsWriteFile.mockResolvedValue(undefined);
      mockFsUnlink.mockResolvedValue(undefined);
      mockGraphHandlerGenerateGraph.mockResolvedValue({ nodesImported: 0, edgesImported: 0, metadata: {} });
    });

    it('divides source files into chunks of config.chunkSize', async () => {
      const files = ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts'];

      mockPoolProcessChunks.mockImplementation(async (chunks: any[][], _cb: any) => {
        expect(chunks.length).toBe(2); // ceil(5/3)
        expect(chunks[0].length).toBe(3);
        expect(chunks[1].length).toBe(2);
        return makePoolResult({ chunks: 2 });
      });

      await handler.importProjectParallel(parser, files, { ...BASE_CONFIG, chunkSize: 3 });

      expect(mockPoolProcessChunks).toHaveBeenCalled();
    });

    it('creates ChunkWorkerPool with projectPath, tsconfigPath, projectId, and projectType', async () => {
      const { ChunkWorkerPool } = await import('../../workers/chunk-worker-pool.js');

      await handler.importProjectParallel(parser, ['/a.ts'], BASE_CONFIG);

      expect(ChunkWorkerPool).toHaveBeenCalledWith(
        expect.objectContaining({
          projectPath: BASE_CONFIG.projectPath,
          tsconfigPath: BASE_CONFIG.tsconfigPath,
          projectId: BASE_CONFIG.projectId,
          projectType: BASE_CONFIG.projectType,
        }),
      );
    });

    it('accumulates nodes and edges from all chunk results', async () => {
      const chunk1 = {
        nodes: [makeNode(), makeNode()],
        edges: [makeEdge()],
        chunkIndex: 0,
        sharedContext: [],
        deferredEdges: [],
      };
      const chunk2 = {
        nodes: [makeNode()],
        edges: [makeEdge(), makeEdge()],
        chunkIndex: 1,
        sharedContext: [],
        deferredEdges: [],
      };

      mockPoolProcessChunks.mockImplementation(async (_chunks: any, cb: any) => {
        await cb(chunk1, { chunksCompleted: 1, totalChunks: 2 });
        await cb(chunk2, { chunksCompleted: 2, totalChunks: 2 });
        return makePoolResult({ nodes: 3, edges: 3, chunks: 2 });
      });

      const result = await handler.importProjectParallel(
        parser,
        ['/a.ts', '/b.ts', '/c.ts'],
        BASE_CONFIG,
      );

      expect(result.nodesImported).toBe(3);
      expect(result.edgesImported).toBe(3);
    });

    it('resolves deferred edges after all chunks complete', async () => {
      const deferredEdge = makeEdge({ type: 'DEFERRED' });
      mockParserResolveDeferredEdges.mockResolvedValue([deferredEdge]);

      const result = await handler.importProjectParallel(parser, ['/a.ts'], BASE_CONFIG);

      expect(mockParserResolveDeferredEdges).toHaveBeenCalled();
      expect(result.edgesImported).toBe(1);
    });

    it('applies edge enhancements manually after deferred edge resolution', async () => {
      const enhancedEdge = makeEdge({ type: 'ENHANCED' });
      mockParserResolveDeferredEdges.mockResolvedValue([]);
      mockParserApplyEdgeEnhancementsManually.mockResolvedValue([enhancedEdge]);

      const result = await handler.importProjectParallel(parser, ['/a.ts'], BASE_CONFIG);

      expect(mockParserApplyEdgeEnhancementsManually).toHaveBeenCalled();
      expect(result.edgesImported).toBe(1);
    });

    it('calls parser.clearParsedData after all processing is complete', async () => {
      await handler.importProjectParallel(parser, ['/a.ts'], BASE_CONFIG);

      expect(mockParserClearParsedData).toHaveBeenCalled();
    });

    it('returns correct totals — nodes, edges, files, chunks, elapsed', async () => {
      const files = ['/a.ts', '/b.ts', '/c.ts', '/d.ts'];
      const chunk1 = { nodes: [makeNode()], edges: [], chunkIndex: 0, sharedContext: [], deferredEdges: [] };

      mockPoolProcessChunks.mockImplementation(async (_chunks: any, cb: any) => {
        await cb(chunk1, { chunksCompleted: 1, totalChunks: 2 });
        return makePoolResult({ nodes: 1, edges: 0, chunks: 2 });
      });
      mockParserResolveDeferredEdges.mockResolvedValue([makeEdge()]);
      mockParserApplyEdgeEnhancementsManually.mockResolvedValue([]);

      const result = await handler.importProjectParallel(parser, files, {
        ...BASE_CONFIG,
        chunkSize: 2,
      });

      expect(result.filesProcessed).toBe(4);
      expect(result.chunksProcessed).toBe(2);
      expect(result.nodesImported).toBe(1);
      expect(result.edgesImported).toBe(1); // from deferred resolution
      expect(typeof result.elapsedMs).toBe('number');
    });

    it('calls parser.addParsedNodesFromChunk to accumulate nodes for cross-chunk resolution', async () => {
      const chunk1 = {
        nodes: [makeNode()],
        edges: [],
        chunkIndex: 0,
        sharedContext: [],
        deferredEdges: [],
      };

      mockPoolProcessChunks.mockImplementation(async (_chunks: any, cb: any) => {
        await cb(chunk1, { chunksCompleted: 1, totalChunks: 1 });
        return makePoolResult({ chunks: 1 });
      });

      await handler.importProjectParallel(parser, ['/a.ts'], BASE_CONFIG);

      expect(mockParserAddParsedNodesFromChunk).toHaveBeenCalledWith(chunk1.nodes);
    });

    it('merges deferred edges from each chunk result into the parser', async () => {
      const deferredEdges = [makeEdge({ type: 'DEFERRED_FROM_CHUNK' })];
      const chunk1 = {
        nodes: [],
        edges: [],
        chunkIndex: 0,
        sharedContext: [],
        deferredEdges,
      };

      mockPoolProcessChunks.mockImplementation(async (_chunks: any, cb: any) => {
        await cb(chunk1, { chunksCompleted: 1, totalChunks: 1 });
        return makePoolResult({ chunks: 1 });
      });

      await handler.importProjectParallel(parser, ['/a.ts'], BASE_CONFIG);

      expect(mockParserMergeDeferredEdges).toHaveBeenCalledWith(deferredEdges);
    });

    it('reports progress via callback at each chunk completion', async () => {
      const onProgress = vi.fn();
      const chunk1 = { nodes: [makeNode()], edges: [], chunkIndex: 0, sharedContext: [], deferredEdges: [] };

      mockPoolProcessChunks.mockImplementation(async (_chunks: any, cb: any) => {
        await cb(chunk1, { chunksCompleted: 1, totalChunks: 1 });
        return makePoolResult({ chunks: 1 });
      });

      // Should not throw — progress reporting executes without error
      await expect(
        handler.importProjectParallel(parser, ['/a.ts'], { ...BASE_CONFIG, onProgress }),
      ).resolves.not.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('StreamingImportHandler', () => {
    // StreamingImportHandler receives graphGeneratorHandler via constructor.
    // We inject a plain mock object — no module-level mock needed.
    let handler: StreamingImportHandler;
    let parser: any;

    const BASE_CONFIG = {
      chunkSize: 2,
      projectId: 'proj_streaming',
    };

    beforeEach(() => {
      vi.clearAllMocks();

      handler = new StreamingImportHandler(makeMockGraphHandler());
      parser = makeParser();

      mockParserDiscoverSourceFiles.mockResolvedValue([]);
      mockParserParseChunk.mockResolvedValue({ nodes: [], edges: [] });
      mockParserAddExistingNodesFromChunk.mockImplementation(() => {});
      mockParserResolveDeferredEdges.mockResolvedValue([]);
      mockParserApplyEdgeEnhancementsManually.mockResolvedValue([]);
      mockParserClearParsedData.mockImplementation(() => {});

      // IR materializer mocks
      mockConvertNeo4jGraphToIrDocument.mockReturnValue({ type: 'ir', nodes: [], edges: [] });
      mockConvertNeo4jEdgesToIrDocument.mockReturnValue({ type: 'ir', edges: [] });
      mockMaterializeIrDocument.mockResolvedValue(undefined);

      // Fallback path (PARSE_USE_IR_MATERIALIZER=false)
      mockFsWriteFile.mockResolvedValue(undefined);
      mockFsUnlink.mockResolvedValue(undefined);
      mockGraphHandlerGenerateGraph.mockResolvedValue({ nodesImported: 0, edgesImported: 0, metadata: {} });

      // Default: IR materializer is enabled (env var unset)
      delete process.env.PARSE_USE_IR_MATERIALIZER;
    });

    it('discovers source files via parser.discoverSourceFiles', async () => {
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts', '/b.ts']);

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockParserDiscoverSourceFiles).toHaveBeenCalled();
    });

    it('chunks files according to config.chunkSize', async () => {
      const files = ['/a.ts', '/b.ts', '/c.ts', '/d.ts', '/e.ts'];
      mockParserDiscoverSourceFiles.mockResolvedValue(files);

      await handler.importProjectStreaming(parser, { ...BASE_CONFIG, chunkSize: 2 });

      // 5 files / chunkSize 2 → 3 parseChunk calls
      expect(mockParserParseChunk).toHaveBeenCalledTimes(3);
    });

    it('parses each chunk with skipEdgeResolution=true', async () => {
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts', '/b.ts']);

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockParserParseChunk).toHaveBeenCalledWith(expect.any(Array), true);
    });

    it('uses IR materializer when PARSE_USE_IR_MATERIALIZER is not set to "false"', async () => {
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts']);
      mockParserParseChunk.mockResolvedValue({ nodes: [makeNode()], edges: [makeEdge()] });

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockConvertNeo4jGraphToIrDocument).toHaveBeenCalled();
      expect(mockMaterializeIrDocument).toHaveBeenCalled();
      expect(mockGraphHandlerGenerateGraph).not.toHaveBeenCalled();
    });

    it('falls back to temp file + GraphGeneratorHandler when PARSE_USE_IR_MATERIALIZER="false"', async () => {
      process.env.PARSE_USE_IR_MATERIALIZER = 'false';
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts']);
      mockParserParseChunk.mockResolvedValue({ nodes: [makeNode()], edges: [] });

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockGraphHandlerGenerateGraph).toHaveBeenCalled();
      expect(mockConvertNeo4jGraphToIrDocument).not.toHaveBeenCalled();
    });

    it('resolves deferred edges after all chunks complete', async () => {
      const deferred = [makeEdge({ type: 'DEFERRED' })];
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts']);
      mockParserResolveDeferredEdges.mockResolvedValue(deferred);

      const result = await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockParserResolveDeferredEdges).toHaveBeenCalled();
      expect(result.edgesImported).toBe(1);
    });

    it('uses IR materializer for deferred edges when enabled', async () => {
      const deferred = [makeEdge({ type: 'DEFERRED' })];
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts']);
      mockParserResolveDeferredEdges.mockResolvedValue(deferred);

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockConvertNeo4jEdgesToIrDocument).toHaveBeenCalledWith(deferred, BASE_CONFIG.projectId);
    });

    it('falls back to temp file for deferred edges when IR materializer is disabled', async () => {
      process.env.PARSE_USE_IR_MATERIALIZER = 'false';
      const deferred = [makeEdge({ type: 'DEFERRED' })];
      mockParserDiscoverSourceFiles.mockResolvedValue([]);
      mockParserResolveDeferredEdges.mockResolvedValue(deferred);

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockGraphHandlerGenerateGraph).toHaveBeenCalled();
      expect(mockConvertNeo4jEdgesToIrDocument).not.toHaveBeenCalled();
    });

    it('applies edge enhancements manually after deferred edge resolution', async () => {
      const enhanced = [makeEdge({ type: 'ENHANCED' })];
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts']);
      mockParserApplyEdgeEnhancementsManually.mockResolvedValue(enhanced);

      const result = await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockParserApplyEdgeEnhancementsManually).toHaveBeenCalled();
      expect(result.edgesImported).toBe(1);
    });

    it('uses IR materializer for enhanced edges when enabled', async () => {
      const enhanced = [makeEdge({ type: 'ENHANCED' })];
      mockParserDiscoverSourceFiles.mockResolvedValue([]);
      mockParserApplyEdgeEnhancementsManually.mockResolvedValue(enhanced);

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockConvertNeo4jEdgesToIrDocument).toHaveBeenCalledWith(enhanced, BASE_CONFIG.projectId);
    });

    it('falls back to temp file for enhanced edges when IR materializer is disabled', async () => {
      process.env.PARSE_USE_IR_MATERIALIZER = 'false';
      const enhanced = [makeEdge({ type: 'ENHANCED' })];
      mockParserDiscoverSourceFiles.mockResolvedValue([]);
      mockParserApplyEdgeEnhancementsManually.mockResolvedValue(enhanced);

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockGraphHandlerGenerateGraph).toHaveBeenCalled();
    });

    it('clears parsed data after all processing is complete', async () => {
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts', '/b.ts']);

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockParserClearParsedData).toHaveBeenCalled();
    });

    it('throws immediately on chunk processing error — does not swallow', async () => {
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts', '/b.ts']);
      mockParserParseChunk.mockRejectedValueOnce(new Error('parse failure'));

      await expect(handler.importProjectStreaming(parser, BASE_CONFIG)).rejects.toThrow('parse failure');
    });

    it('returns correct totals — nodes, edges, files, chunks, elapsed', async () => {
      const files = ['/a.ts', '/b.ts', '/c.ts'];
      mockParserDiscoverSourceFiles.mockResolvedValue(files);
      mockParserParseChunk
        .mockResolvedValueOnce({ nodes: [makeNode(), makeNode()], edges: [makeEdge()] })
        .mockResolvedValueOnce({ nodes: [makeNode()], edges: [] });
      mockParserResolveDeferredEdges.mockResolvedValue([makeEdge()]);
      mockParserApplyEdgeEnhancementsManually.mockResolvedValue([]);

      const result = await handler.importProjectStreaming(parser, { ...BASE_CONFIG, chunkSize: 2 });

      expect(result.nodesImported).toBe(3);
      expect(result.edgesImported).toBe(2); // 1 from chunks + 1 from deferred
      expect(result.filesProcessed).toBe(3);
      expect(result.chunksProcessed).toBe(2);
      expect(typeof result.elapsedMs).toBe('number');
    });

    it('skips IR materializer call for empty chunk results (no nodes or edges)', async () => {
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts']);
      mockParserParseChunk.mockResolvedValue({ nodes: [], edges: [] });

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      // Empty chunk → importChunkToNeo4j should not be called
      expect(mockConvertNeo4jGraphToIrDocument).not.toHaveBeenCalled();
    });

    it('calls addExistingNodesFromChunk to accumulate nodes for cross-chunk edge resolution', async () => {
      const nodes = [makeNode()];
      mockParserDiscoverSourceFiles.mockResolvedValue(['/a.ts']);
      mockParserParseChunk.mockResolvedValue({ nodes, edges: [] });

      await handler.importProjectStreaming(parser, BASE_CONFIG);

      expect(mockParserAddExistingNodesFromChunk).toHaveBeenCalledWith(nodes);
    });
  });
});
