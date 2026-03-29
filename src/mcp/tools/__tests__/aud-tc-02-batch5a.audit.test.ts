/**
 * AUD-TC-02 Batch 5a — Behavioral tests for start-watch-project and parse-typescript-project.
 * B6 Health Witness — covers registration, success, error, edge-cases, and cleanup paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted — all mock fns created here survive hoisting
// ─────────────────────────────────────────────────────────────────────────────
const {
  mockRun,
  mockClose,
  mockAccess,
  mockStat,
  mockRealpath,
  mockWriteFileSync,
  mockResolveProjectId,
  mockGetProjectName,
  mockStartWatching,
  mockCreateJob,
  mockStartJob,
  mockImportProjectStreaming,
  mockDetectChangedFiles,
  mockGetCrossFileEdges,
  mockDeleteSourceFileSubgraphs,
  mockLoadExistingNodesForEdgeDetection,
  mockMaterializeIrDocument,
  mockCreateParserAuto,
  mockCreateParser,
  mockEmbedText,
  mockGenerateGraph,
  mockSetProjectId,
  mockParserDiscoverSourceFiles,
  mockParserParseWorkspace,
  mockParserExportToJson,
  mockParserGetProjectId,
  mockParserExportToIrDocument,
  mockParserSetIrMode,
  mockParserSetExistingNodes,
} = vi.hoisted(() => {
  const mockParserDiscoverSourceFiles = vi.fn();
  const mockParserParseWorkspace = vi.fn();
  const mockParserExportToJson = vi.fn();
  const mockParserGetProjectId = vi.fn();
  const mockParserExportToIrDocument = vi.fn();
  const mockParserSetIrMode = vi.fn();
  const mockParserSetExistingNodes = vi.fn();

  return {
    mockRun: vi.fn(),
    mockClose: vi.fn(),
    mockAccess: vi.fn(),
    mockStat: vi.fn(),
    mockRealpath: vi.fn(),
    mockWriteFileSync: vi.fn(),
    mockResolveProjectId: vi.fn(),
    mockGetProjectName: vi.fn(),
    mockStartWatching: vi.fn(),
    mockCreateJob: vi.fn(),
    mockStartJob: vi.fn(),
    mockImportProjectStreaming: vi.fn(),
    mockDetectChangedFiles: vi.fn(),
    mockGetCrossFileEdges: vi.fn(),
    mockDeleteSourceFileSubgraphs: vi.fn(),
    mockLoadExistingNodesForEdgeDetection: vi.fn(),
    mockMaterializeIrDocument: vi.fn(),
    mockCreateParserAuto: vi.fn(),
    mockCreateParser: vi.fn(),
    mockEmbedText: vi.fn(),
    mockGenerateGraph: vi.fn(),
    mockSetProjectId: vi.fn(),
    mockParserDiscoverSourceFiles,
    mockParserParseWorkspace,
    mockParserExportToJson,
    mockParserGetProjectId,
    mockParserExportToIrDocument,
    mockParserSetIrMode,
    mockParserSetExistingNodes,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Capture registered handlers for BOTH registration patterns
// ─────────────────────────────────────────────────────────────────────────────
const registeredTools = new Map<string, Function>();
const mockServer = {
  registerTool: vi.fn((name: string, _meta: any, handler: Function) => {
    registeredTools.set(name, handler);
  }),
  tool: vi.fn((name: string, _desc: any, _schema: any, handler: Function) => {
    registeredTools.set(name, handler);
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — paths relative to THIS test file at src/mcp/tools/__tests__/
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.close = mockClose;
  }),
  QUERIES: {
    CLEAR_PROJECT: 'MATCH (n {projectId: $projectId}) DETACH DELETE n',
    RECREATE_CROSS_FILE_EDGES: 'UNWIND $edges AS e MERGE ...',
  },
}));

// utils.js mock — spread actual + override debugLog (same pattern as batch 1-4)
vi.mock('../utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    debugLog: vi.fn(),
    resolveProjectIdOrError: vi.fn(async (projectId: string) => ({
      success: true,
      projectId,
    })),
  };
});

// fs/promises — include appendFile so debugLog's underlying impl doesn't throw
vi.mock('fs/promises', () => ({
  access: mockAccess,
  stat: mockStat,
  realpath: mockRealpath,
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

// fs — writeFileSync used in non-streaming path
vi.mock('fs', () => ({
  constants: { R_OK: 4 },
  writeFileSync: mockWriteFileSync,
}));

// core utils — NOTE: ../../.. needed to reach src/core from src/mcp/tools/__tests__/
vi.mock('../../../core/utils/project-id.js', () => ({
  resolveProjectId: mockResolveProjectId,
  getProjectName: mockGetProjectName,
  UPSERT_PROJECT_QUERY: 'MERGE (p:Project {projectId: $projectId})',
  UPDATE_PROJECT_STATUS_QUERY: 'MATCH (p:Project {projectId: $projectId}) SET p.status = $status',
}));

// services — from __tests__/ : ../../services/ = src/mcp/services/ ✓
vi.mock('../../services/watch-manager.js', () => ({
  watchManager: {
    startWatching: mockStartWatching,
    stopWatching: vi.fn().mockResolvedValue(true),
    listWatchers: vi.fn().mockReturnValue([]),
    getWatcherInfo: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock('../../services/job-manager.js', () => ({
  jobManager: {
    createJob: mockCreateJob,
    startJob: mockStartJob,
    getJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    updateProgress: vi.fn(),
  },
}));

// Worker mock — prevent real thread spawning in async-mode tests
vi.mock('worker_threads', () => ({
  Worker: vi.fn(function (this: any, _path: string, _opts: any) {
    this.on = vi.fn();
    this.terminate = vi.fn().mockResolvedValue(undefined);
  }),
}));

// core parsers — NOTE: ../../../core/ = src/core/ ✓
vi.mock('../../../core/parsers/parser-factory.js', () => ({
  ParserFactory: {
    createParserWithAutoDetection: mockCreateParserAuto,
    createParser: mockCreateParser,
  },
}));

// core embeddings — NOTE: ../../../core/ = src/core/ ✓
vi.mock('../../../core/embeddings/embeddings.service.js', () => ({
  EmbeddingsService: vi.fn(function (this: any) {
    this.embedText = mockEmbedText;
  }),
}));

// handlers — ../../handlers/ = src/mcp/handlers/ ✓
vi.mock('../../handlers/graph-generator.handler.js', () => ({
  GraphGeneratorHandler: vi.fn(function (this: any) {
    this.generateGraph = mockGenerateGraph;
    this.setProjectId = mockSetProjectId;
  }),
}));

vi.mock('../../handlers/streaming-import.handler.js', () => ({
  StreamingImportHandler: vi.fn(function (this: any) {
    this.importProjectStreaming = mockImportProjectStreaming;
  }),
}));

// core file-change-detection — ../../../core/ = src/core/ ✓
vi.mock('../../../core/utils/file-change-detection.js', () => ({
  detectChangedFiles: mockDetectChangedFiles,
}));

// cross-file-edge helpers — ../../handlers/ = src/mcp/handlers/ ✓
vi.mock('../../handlers/cross-file-edge.helpers.js', () => ({
  getCrossFileEdges: mockGetCrossFileEdges,
  deleteSourceFileSubgraphs: mockDeleteSourceFileSubgraphs,
  loadExistingNodesForEdgeDetection: mockLoadExistingNodesForEdgeDetection,
}));

// core IR — ../../../core/ = src/core/ ✓
vi.mock('../../../core/ir/index.js', () => ({
  materializeIrDocument: mockMaterializeIrDocument,
}));

vi.mock('../../../core/ir/ir-v1.schema.js', () => ({}));

// core schema
vi.mock('../../../core/config/schema.js', () => ({
  CORE_TYPESCRIPT_SCHEMA: { name: 'typescript-core-v1' },
}));

// MCP constants — ../constants.js from __tests__/ matches batch 1-4 pattern
vi.mock('../constants.js', () => ({
  TOOL_NAMES: {
    startWatchProject: 'start_watch_project',
    parseTypescriptProject: 'parse_typescript_project',
  },
  TOOL_METADATA: {
    start_watch_project: {
      title: 'Start Watch Project',
      description: 'Watch project for .ts file changes and auto-update graph.',
    },
    parse_typescript_project: {
      title: 'Parse TypeScript Project',
      description: 'Parse a TypeScript/NestJS project and build a code graph in Neo4j.',
    },
  },
  DEFAULTS: {
    traversalDepth: 3,
    skipOffset: 0,
    batchSize: 500,
    maxResultsDisplayed: 30,
    codeSnippetLength: 500,
  },
  FILE_PATHS: {
    debugLog: 'debug-search.log',
    graphOutput: 'graph.json',
  },
  LOG_CONFIG: {
    jsonIndentation: 2,
  },
  PARSING: {
    streamingThreshold: 100,
    workerTimeoutMs: 30 * 60 * 1000,
    defaultChunkSize: 50,
  },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { createStartWatchProjectTool } from '../start-watch-project.tool.js';
import { createParseTypescriptProjectTool } from '../parse-typescript-project.tool.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function textOf(result: any): string {
  return result?.content?.[0]?.text ?? '';
}

/** Build a minimal mock parser with all required methods */
function makeParserMock(overrides: Partial<Record<string, any>> = {}) {
  return {
    discoverSourceFiles: mockParserDiscoverSourceFiles,
    parseWorkspace: mockParserParseWorkspace,
    exportToJson: mockParserExportToJson,
    getProjectId: mockParserGetProjectId,
    exportToIrDocument: mockParserExportToIrDocument,
    setIrMode: mockParserSetIrMode,
    setExistingNodes: mockParserSetExistingNodes,
    frameworkSchemas: [{ name: 'nestjs' }],
    ...overrides,
  };
}

/** Reset mockStat to path-based smart defaults */
function setupStatDefaults() {
  mockStat.mockImplementation((p: string) => {
    // tsconfig paths are files; everything else is a directory
    const isFile = p.endsWith('.json') || p.includes('tsconfig');
    return Promise.resolve({
      isDirectory: () => !isFile,
      isFile: () => isFile,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 1 — start-watch-project
// ═══════════════════════════════════════════════════════════════════════════
describe('[aud-tc-02] Batch 5a — start-watch-project tool', () => {
  beforeEach(() => {
    registeredTools.clear();
    vi.resetAllMocks(); // clears queues + implementations — re-setup below

    // Default fs/promises
    mockAccess.mockResolvedValue(undefined);
    setupStatDefaults();
    mockClose.mockResolvedValue(undefined);

    // Default: project IS indexed
    mockRun.mockResolvedValue([{ projectId: 'proj_test123' }]);

    // Default watcher info
    mockStartWatching.mockResolvedValue({
      projectPath: '/app',
      projectId: 'proj_test123',
      status: 'watching',
      debounceMs: 1000,
    });
  });

  // ── Registration ─────────────────────────────────────────────────────────
  it('registers via registerTool with correct name', () => {
    createStartWatchProjectTool(mockServer as any);
    expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
    expect(registeredTools.has('start_watch_project')).toBe(true);
  });

  // ── Success path ──────────────────────────────────────────────────────────
  it('returns success response when watcher starts successfully', async () => {
    createStartWatchProjectTool(mockServer as any);
    const result = await registeredTools.get('start_watch_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
      debounceMs: 1000,
    });
    const text = textOf(result);
    expect(text).toContain('File watcher started successfully');
    expect(text).toContain('watching');
  });

  it('success output contains project ID, path, and debounce', async () => {
    mockStartWatching.mockResolvedValue({
      projectPath: '/my-app',
      projectId: 'proj_abc',
      status: 'watching',
      debounceMs: 500,
    });
    createStartWatchProjectTool(mockServer as any);
    const result = await registeredTools.get('start_watch_project')!({
      projectPath: '/my-app',
      tsconfigPath: '/my-app/tsconfig.json',
      debounceMs: 500,
    });
    const text = textOf(result);
    expect(text).toContain('/my-app');
    expect(text).toContain('proj_abc');
    expect(text).toContain('500ms');
  });

  // ── Error: project path doesn't exist ─────────────────────────────────────
  it('returns error when project path does not exist (ENOENT)', async () => {
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockAccess.mockRejectedValueOnce(enoentError);

    createStartWatchProjectTool(mockServer as any);
    const result = await registeredTools.get('start_watch_project')!({
      projectPath: '/nonexistent',
      tsconfigPath: '/nonexistent/tsconfig.json',
    });
    const text = textOf(result);
    expect(text).toContain('ERROR');
    expect(text).toContain('does not exist');
  });

  // ── Error: project path is a file, not directory ───────────────────────────
  it('returns error when project path is a file, not a directory', async () => {
    // Override stat so the projectPath returns isDirectory:false
    mockStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true });

    createStartWatchProjectTool(mockServer as any);
    const result = await registeredTools.get('start_watch_project')!({
      projectPath: '/app/some-file.ts',
      tsconfigPath: '/app/tsconfig.json',
    });
    const text = textOf(result);
    expect(text).toContain('ERROR');
    expect(text).toContain('not a directory');
  });

  // ── Error: tsconfig not found ──────────────────────────────────────────────
  it('returns error when tsconfig does not exist', async () => {
    // First access (projectPath) succeeds, second (tsconfig) throws ENOENT
    mockAccess
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    createStartWatchProjectTool(mockServer as any);
    const result = await registeredTools.get('start_watch_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
    });
    const text = textOf(result);
    expect(text).toContain('ERROR');
    expect(text).toContain('tsconfig.json not found');
  });

  // ── Error: project not yet indexed ────────────────────────────────────────
  it('returns error when project has not been indexed yet', async () => {
    mockRun.mockResolvedValue([]); // no Project node found

    createStartWatchProjectTool(mockServer as any);
    const result = await registeredTools.get('start_watch_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
    });
    const text = textOf(result);
    expect(text).toContain('ERROR');
    expect(text).toContain('not been indexed');
    expect(text).toContain('parse_typescript_project');
  });

  // ── Neo4j cleanup in finally ───────────────────────────────────────────────
  it('closes Neo4jService in finally even when project not found', async () => {
    mockRun.mockResolvedValue([]);

    createStartWatchProjectTool(mockServer as any);
    await registeredTools.get('start_watch_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
    });
    expect(mockClose).toHaveBeenCalled();
  });

  // ── Calls watchManager.startWatching with correct args ────────────────────
  it('calls watchManager.startWatching with debounceMs from args', async () => {
    createStartWatchProjectTool(mockServer as any);
    await registeredTools.get('start_watch_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
      debounceMs: 2000,
    });
    expect(mockStartWatching).toHaveBeenCalledWith(
      expect.objectContaining({ debounceMs: 2000 }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 2 — parse-typescript-project
// ═══════════════════════════════════════════════════════════════════════════
describe('[aud-tc-02] Batch 5a — parse-typescript-project tool', () => {
  beforeEach(() => {
    registeredTools.clear();
    vi.resetAllMocks();

    // Default fs mocks
    mockAccess.mockResolvedValue(undefined);
    setupStatDefaults();
    mockRealpath.mockImplementation((p: string) => Promise.resolve(p));
    mockClose.mockResolvedValue(undefined);

    // Default Neo4j
    mockRun.mockResolvedValue([]);

    // Default project utilities
    mockResolveProjectId.mockImplementation((_path: string, id?: string) => id ?? 'proj_resolved123');
    mockGetProjectName.mockResolvedValue('test-project');

    // Default parser
    mockParserDiscoverSourceFiles.mockResolvedValue([]);
    mockParserParseWorkspace.mockResolvedValue(undefined);
    mockParserExportToJson.mockReturnValue({ nodes: [], edges: [] });
    mockParserGetProjectId.mockReturnValue('proj_resolved123');
    mockParserExportToIrDocument.mockReturnValue({ nodes: [], edges: [], metadata: {} });
    mockParserSetIrMode.mockImplementation(() => {});
    mockParserSetExistingNodes.mockImplementation(() => {});

    const parser = makeParserMock();
    mockCreateParserAuto.mockResolvedValue(parser);
    mockCreateParser.mockReturnValue(parser);

    // Default materialize
    mockMaterializeIrDocument.mockResolvedValue({ nodesCreated: 50, edgesCreated: 80 });

    // Default embeddings
    mockEmbedText.mockResolvedValue([0.1, 0.2, 0.3]);

    // Default streaming
    mockImportProjectStreaming.mockResolvedValue({
      filesProcessed: 5,
      nodesImported: 20,
      edgesImported: 30,
      chunksProcessed: 1,
      elapsedMs: 500,
    });

    // Default incremental helpers
    mockDetectChangedFiles.mockResolvedValue({ filesToReparse: [], filesToDelete: [] });
    mockGetCrossFileEdges.mockResolvedValue([]);
    mockDeleteSourceFileSubgraphs.mockResolvedValue(undefined);
    mockLoadExistingNodesForEdgeDetection.mockResolvedValue([]);

    // Default watch
    mockStartWatching.mockResolvedValue({
      projectPath: '/app',
      projectId: 'proj_resolved123',
      status: 'watching',
      debounceMs: 1000,
    });

    // Default job manager
    mockCreateJob.mockReturnValue('job_abc123');
    mockStartJob.mockImplementation(() => {});
  });

  // ── Registration ─────────────────────────────────────────────────────────
  it('registers via registerTool with correct name', () => {
    createParseTypescriptProjectTool(mockServer as any);
    expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
    expect(registeredTools.has('parse_typescript_project')).toBe(true);
  });

  // ── Async mode: returns job ID immediately ────────────────────────────────
  it('returns job ID immediately when async=true', async () => {
    mockCreateJob.mockReturnValue('job_xyz999');

    createParseTypescriptProjectTool(mockServer as any);
    const result = await registeredTools.get('parse_typescript_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
      async: true,
    });
    const text = textOf(result);
    expect(text).toContain('job_xyz999');
    expect(text).toContain('Background parsing started');
    expect(mockCreateJob).toHaveBeenCalled();
    expect(mockStartJob).toHaveBeenCalledWith('job_xyz999');
  });

  // ── Async+watch conflict ───────────────────────────────────────────────────
  it('returns error for async=true with watch=true (invalid combination)', async () => {
    createParseTypescriptProjectTool(mockServer as any);
    const result = await registeredTools.get('parse_typescript_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
      async: true,
      watch: true,
    });
    const text = textOf(result);
    expect(text).toContain('ERROR');
    expect(text).toContain('watch=true');
    expect(text).toContain('async=true');
  });

  // ── Sync non-streaming: success path ─────────────────────────────────────
  it('returns success with node/edge counts for sync non-streaming parse', async () => {
    mockParserDiscoverSourceFiles.mockResolvedValue(new Array(5).fill('/app/src/file.ts'));
    mockParserExportToJson.mockReturnValue({
      nodes: new Array(30).fill({}),
      edges: new Array(50).fill({}),
    });
    mockParserGetProjectId.mockReturnValue('proj_resolved123');
    mockMaterializeIrDocument.mockResolvedValue({ nodesCreated: 30, edgesCreated: 50 });

    createParseTypescriptProjectTool(mockServer as any);
    const result = await registeredTools.get('parse_typescript_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
      async: false,
      useStreaming: 'never',
    });
    const text = textOf(result);
    expect(text).not.toContain('ERROR');
    expect(text).toContain('30');
    expect(text).toContain('50');
  });

  // ── Streaming path ────────────────────────────────────────────────────────
  it('uses streaming import and returns stats when file count exceeds threshold', async () => {
    // 150 files > threshold of 100 → streaming mode
    mockParserDiscoverSourceFiles.mockResolvedValue(new Array(150).fill('/app/src/file.ts'));
    mockImportProjectStreaming.mockResolvedValue({
      filesProcessed: 150,
      nodesImported: 400,
      edgesImported: 600,
      chunksProcessed: 3,
      elapsedMs: 5000,
    });

    createParseTypescriptProjectTool(mockServer as any);
    const result = await registeredTools.get('parse_typescript_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
      async: false,
      useStreaming: 'auto',
      chunkSize: 50,
    });
    const text = textOf(result);
    expect(text).not.toContain('ERROR');
    expect(text).toContain('streaming mode');
    expect(text).toContain('400');
    expect(text).toContain('600');
  });

  // ── Path validation: project path not found ───────────────────────────────
  it('returns error when project path does not exist', async () => {
    const enoentError = Object.assign(new Error('Path does not exist: /bad'), { code: 'ENOENT' });
    mockAccess.mockRejectedValueOnce(enoentError);

    createParseTypescriptProjectTool(mockServer as any);
    const result = await registeredTools.get('parse_typescript_project')!({
      projectPath: '/bad',
      tsconfigPath: '/bad/tsconfig.json',
      async: false,
    });
    expect(textOf(result)).toContain('ERROR');
  });

  // ── Parser factory: non-auto projectType ─────────────────────────────────
  it('calls ParserFactory.createParser when projectType is not auto', async () => {
    const parser = makeParserMock();
    mockCreateParser.mockReturnValue(parser);

    createParseTypescriptProjectTool(mockServer as any);
    await registeredTools.get('parse_typescript_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
      async: false,
      projectType: 'nestjs',
      useStreaming: 'never',
    });
    expect(mockCreateParser).toHaveBeenCalledWith(
      expect.objectContaining({ projectType: 'nestjs' }),
    );
  });

  // ── Streaming failure: status set to failed ───────────────────────────────
  it('updates project status to failed when streaming import throws', async () => {
    mockParserDiscoverSourceFiles.mockResolvedValue(new Array(150).fill('/app/src/file.ts'));
    mockImportProjectStreaming.mockRejectedValue(new Error('OOM during streaming'));

    createParseTypescriptProjectTool(mockServer as any);
    const result = await registeredTools.get('parse_typescript_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
      async: false,
      useStreaming: 'always',
    });
    const text = textOf(result);
    expect(text).toContain('ERROR');

    // Verify a Neo4j run call was made with status: 'failed'
    const failedCall = mockRun.mock.calls.find(
      (args: any[]) => typeof args[1] === 'object' && args[1]?.status === 'failed',
    );
    expect(failedCall).toBeDefined();
  });

  // ── Watch flag starts watcher in sync mode ────────────────────────────────
  it('starts file watcher after sync parse when watch=true', async () => {
    createParseTypescriptProjectTool(mockServer as any);
    await registeredTools.get('parse_typescript_project')!({
      projectPath: '/app',
      tsconfigPath: '/app/tsconfig.json',
      async: false,
      watch: true,
      useStreaming: 'never',
    });
    expect(mockStartWatching).toHaveBeenCalled();
  });
});
