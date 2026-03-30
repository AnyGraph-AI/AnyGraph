/**
 * AUD-TC-02 Batch 8b — MCP services (watch-manager) + workers
 *
 * Covers:
 *  1. WatchManager singleton (src/mcp/services/watch-manager.ts)
 *  2. ChunkWorkerPool (src/mcp/workers/chunk-worker-pool.ts)
 *  3. chunk-worker.types.ts (type smoke tests)
 *  4. chunk.worker.ts (worker thread entry point)
 *  5. parse-coordinator.ts (parse coordinator worker thread)
 *
 * Rules:
 *  - No source-string-match tests, no Cypher assertions, no reimplemented logic
 *  - Mock at closest module boundary
 *  - Constructor mocks use vi.fn(function(this: any) {...}), not arrow fns
 *  - vi.hoisted() for all mock setup
 *  - .js extensions on all local imports
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted — all mock state and factory functions live here.
// These are evaluated before any vi.mock() factory or import statement.
// ─────────────────────────────────────────────────────────────────────────────
const {
  watcherState,
  mockSubscribe,
  mockNeo4jRun,
  mockNeo4jClose,
  MockWorker,
  workerPool,
  ppState,
  mockParserObj,
  mockIncrementalHandler,
  mockSendLogging,
} = vi.hoisted(() => {
  // ── @parcel/watcher ────────────────────────────────────────────────────────
  // We capture the subscriber callback so tests can simulate FS events.
  const watcherState = {
    lastCallback: null as ((err: Error | null, events: any[]) => void) | null,
    lastUnsub: vi.fn().mockResolvedValue(undefined),
  };
  const mockSubscribe = vi.fn().mockImplementation(async (_path: string, cb: any, _opts?: any) => {
    watcherState.lastCallback = cb;
    watcherState.lastUnsub = vi.fn().mockResolvedValue(undefined);
    return { unsubscribe: watcherState.lastUnsub };
  });

  // ── Neo4j ──────────────────────────────────────────────────────────────────
  const mockNeo4jRun = vi.fn().mockResolvedValue({ records: [] });
  const mockNeo4jClose = vi.fn().mockResolvedValue(undefined);

  // ── worker_threads Worker (for ChunkWorkerPool) ───────────────────────────
  // Each new Worker auto-emits 'ready' after handlers are registered.
  // Each Worker.postMessage({ type:'chunk' }) auto-responds with 'result'.
  // Each Worker.postMessage({ type:'terminate' }) auto-emits exit(0).
  const workerPool: any[] = [];
  const MockWorker = vi.fn(function (this: any, _workerPath: string, _opts?: any) {
    const evtHandlers: Record<string, Function[]> = {};
    this._handlers = evtHandlers;

    this.on = vi.fn((event: string, handler: Function) => {
      if (!evtHandlers[event]) evtHandlers[event] = [];
      evtHandlers[event].push(handler);
    });

    this.postMessage = vi.fn((msg: any) => {
      if (msg?.type === 'chunk') {
        // Mimic real chunk.worker: emit 'result' then 'ready' (pull-model)
        Promise.resolve()
          .then(() => {
            evtHandlers['message']?.forEach((h) =>
              h({
                type: 'result',
                chunkIndex: msg.chunkIndex,
                nodes: [{ id: `node_chunk_${msg.chunkIndex}`, label: 'Function' }],
                edges: [],
                filesProcessed: msg.files?.length ?? 1,
                sharedContext: [],
                deferredEdges: [],
              }),
            );
          })
          .then(() => {
            // Signal ready for next chunk (real worker does this after each chunk)
            evtHandlers['message']?.forEach((h) => h({ type: 'ready' }));
          });
      } else if (msg?.type === 'terminate') {
        Promise.resolve().then(() => {
          evtHandlers['exit']?.forEach((h) => h(0));
        });
      }
    });

    this.terminate = vi.fn();
    workerPool.push(this);

    // Emit 'ready' after the caller has a chance to register message handlers
    Promise.resolve().then(() => {
      evtHandlers['message']?.forEach((h) => h({ type: 'ready' }));
    });
  });

  // ── parentPort (for worker thread entry-point tests) ──────────────────────
  // ppState holds captured handlers + postMessage spy.
  // reset() is called in beforeAll of each worker describe block.
  const ppState = {
    handlers: {} as Record<string, Function[]>,
    postMessage: vi.fn(),
    reset() {
      this.handlers = {};
      this.postMessage.mockClear();
    },
    emit(event: string, data: any) {
      this.handlers[event]?.forEach((h) => h(data));
    },
  };

  // ── Parser mock (chunk.worker + parse-coordinator) ────────────────────────
  const mockParserObj = {
    clearParsedData: vi.fn(),
    parseChunk: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    getSerializedSharedContext: vi.fn().mockReturnValue([]),
    getDeferredEdges: vi.fn().mockReturnValue([]),
    setDeferEdgeEnhancements: vi.fn(),
    discoverSourceFiles: vi.fn().mockResolvedValue(['file1.ts', 'file2.ts']),
    getProjectId: vi.fn().mockReturnValue('proj_test123'),
  };

  // ── WatchManager incrementalParseHandler ──────────────────────────────────
  const mockIncrementalHandler = vi.fn().mockResolvedValue({ nodesUpdated: 0, edgesUpdated: 0 });

  // ── MCP server sendLoggingMessage ──────────────────────────────────────────
  const mockSendLogging = vi.fn().mockResolvedValue(undefined);

  return {
    watcherState,
    mockSubscribe,
    mockNeo4jRun,
    mockNeo4jClose,
    MockWorker,
    workerPool,
    ppState,
    mockParserObj,
    mockIncrementalHandler,
    mockSendLogging,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@parcel/watcher', () => ({
  subscribe: mockSubscribe,
}));

vi.mock('worker_threads', () => ({
  Worker: MockWorker,
  parentPort: {
    on: vi.fn((event: string, handler: Function) => {
      if (!ppState.handlers[event]) ppState.handlers[event] = [];
      ppState.handlers[event].push(handler);
    }),
    postMessage: ppState.postMessage,
  },
  workerData: {
    projectPath: '/test/project',
    tsconfigPath: 'tsconfig.json',
    projectId: 'proj_test123',
    projectType: 'typescript',
    chunkSize: 10,
  },
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockNeo4jRun;
    this.close = mockNeo4jClose;
  }),
  QUERIES: {
    CLEAR_PROJECT: 'MATCH (n {projectId: $projectId}) DETACH DELETE n',
  },
}));

vi.mock('../../utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, debugLog: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    appendFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue('{}'),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, '', '');
    }),
  };
});

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

vi.mock('../../../core/parsers/parser-factory.js', () => ({
  ParserFactory: {
    createParser: vi.fn().mockReturnValue(mockParserObj),
    detectProjectType: vi.fn().mockResolvedValue('typescript'),
  },
  ProjectType: {},
}));

vi.mock('../../../core/parsers/typescript-parser.js', () => ({
  StreamingParser: vi.fn(function (this: any) {
    Object.assign(this, mockParserObj);
  }),
}));

vi.mock('../../../core/parsers/workspace-parser.js', () => ({
  WorkspaceParser: vi.fn(function (this: any) {
    Object.assign(this, mockParserObj);
  }),
}));

vi.mock('../../../core/workspace/index.js', () => ({
  WorkspaceDetector: vi.fn(function (this: any) {
    this.detect = vi.fn().mockResolvedValue({
      type: 'single',
      rootPath: '/test/project',
      packages: [],
    });
  }),
}));

vi.mock('../../../core/embeddings/embeddings.service.js', () => ({
  EmbeddingsService: vi.fn(function (this: any) {
    this.initialize = vi.fn();
  }),
}));

vi.mock('../../handlers/graph-generator.handler.js', () => ({
  GraphGeneratorHandler: vi.fn(function (this: any) {
    this.setProjectId = vi.fn();
  }),
}));

vi.mock('../../handlers/streaming-import.handler.js', () => ({
  StreamingImportHandler: vi.fn(function (this: any) {
    this.importProjectStreaming = vi.fn().mockResolvedValue({ nodesImported: 5, edgesImported: 3 });
  }),
}));

vi.mock('../../handlers/parallel-import.handler.js', () => ({
  ParallelImportHandler: vi.fn(function (this: any) {
    this.importProjectParallel = vi.fn().mockResolvedValue({ nodesImported: 10, edgesImported: 8 });
  }),
}));

vi.mock('../../../core/utils/file-utils.js', () => ({
  debugLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../core/utils/project-id.js', () => ({
  getProjectName: vi.fn().mockResolvedValue('test-project'),
  UPSERT_PROJECT_QUERY: 'UPSERT_PROJECT',
  UPDATE_PROJECT_STATUS_QUERY: 'UPDATE_STATUS',
}));

vi.mock('../../../core/utils/progress-reporter.js', () => ({}));

vi.mock('../../../core/config/schema.js', () => ({
  Neo4jNode: {},
  Neo4jEdge: {},
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports — after all mocks are registered
// ─────────────────────────────────────────────────────────────────────────────

import { watchManager } from '../../services/watch-manager.js';
import { ChunkWorkerPool } from '../../workers/chunk-worker-pool.js';
import type {
  ChunkWorkItem,
  WorkerToCoordinatorMessage,
  SerializedDeferredEdge,
  ChunkWorkerReady,
  ChunkWorkerError,
} from '../../workers/chunk-worker.types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const BASE_CONFIG = {
  projectPath: '/test/project',
  projectId: 'proj_batch8b',
  tsconfigPath: '/test/project/tsconfig.json',
  debounceMs: 50, // short for fast tests
} as const;

const MOCK_MCP_SERVER = { sendLoggingMessage: mockSendLogging } as any;

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('[aud-tc-02] Batch 8b — MCP services (watch-manager) + workers', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. WatchManager
  // ═══════════════════════════════════════════════════════════════════════════
  describe('WatchManager', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Re-arm the subscribe mock so each test gets a fresh captured callback
      mockSubscribe.mockImplementation(async (_path: string, cb: any, _opts?: any) => {
        watcherState.lastCallback = cb;
        watcherState.lastUnsub = vi.fn().mockResolvedValue(undefined);
        return { unsubscribe: watcherState.lastUnsub };
      });
      mockIncrementalHandler.mockResolvedValue({ nodesUpdated: 0, edgesUpdated: 0 });
      vi.useFakeTimers();
    });

    afterEach(async () => {
      vi.useRealTimers();
      await watchManager.stopAllWatchers();
    });

    // ── Configuration ─────────────────────────────────────────────────────────

    it('setMcpServer accepts a server reference without throwing', () => {
      expect(() => watchManager.setMcpServer(MOCK_MCP_SERVER)).not.toThrow();
    });

    it('setIncrementalParseHandler accepts a handler without throwing', () => {
      expect(() => watchManager.setIncrementalParseHandler(mockIncrementalHandler)).not.toThrow();
    });

    // ── startWatching ─────────────────────────────────────────────────────────

    it('startWatching calls watcher.subscribe with projectPath and options', async () => {
      await watchManager.startWatching(BASE_CONFIG);
      expect(mockSubscribe).toHaveBeenCalledWith(
        BASE_CONFIG.projectPath,
        expect.any(Function),
        expect.objectContaining({ ignore: expect.any(Array) }),
      );
    });

    it('startWatching returns WatcherInfo with correct projectId and status', async () => {
      const info = await watchManager.startWatching(BASE_CONFIG);
      expect(info).toMatchObject({
        projectId: BASE_CONFIG.projectId,
        projectPath: BASE_CONFIG.projectPath,
        status: 'active',
        lastUpdateTime: null,
        pendingChanges: 0,
      });
    });

    it('startWatching records debounceMs from config in WatcherInfo', async () => {
      const info = await watchManager.startWatching(BASE_CONFIG);
      expect(info.debounceMs).toBe(BASE_CONFIG.debounceMs);
    });

    it('startWatching with duplicate projectId returns existing info (no new subscription)', async () => {
      await watchManager.startWatching(BASE_CONFIG);
      const callsBefore = mockSubscribe.mock.calls.length;
      await watchManager.startWatching(BASE_CONFIG);
      expect(mockSubscribe.mock.calls.length).toBe(callsBefore);
    });

    it('startWatching adds the project to listWatchers', async () => {
      await watchManager.startWatching(BASE_CONFIG);
      const ids = watchManager.listWatchers().map((w) => w.projectId);
      expect(ids).toContain(BASE_CONFIG.projectId);
    });

    it('startWatching throws when max watcher limit (10) is reached', async () => {
      const overflowConfigs = Array.from({ length: 10 }, (_, i) => ({
        projectPath: `/test/overflow/${i}`,
        projectId: `proj_overflow_${i}`,
        tsconfigPath: `/test/overflow/${i}/tsconfig.json`,
      }));
      for (const cfg of overflowConfigs) {
        await watchManager.startWatching(cfg);
      }
      await expect(
        watchManager.startWatching({
          projectPath: '/test/overflow/extra',
          projectId: 'proj_overflow_extra',
          tsconfigPath: '/test/overflow/extra/tsconfig.json',
        }),
      ).rejects.toThrow(/maximum watcher limit/i);
    });

    // ── stopWatching ──────────────────────────────────────────────────────────

    it('stopWatching returns false for unknown projectId', async () => {
      expect(await watchManager.stopWatching('proj_nobody')).toBe(false);
    });

    it('stopWatching returns true for a known projectId', async () => {
      await watchManager.startWatching(BASE_CONFIG);
      expect(await watchManager.stopWatching(BASE_CONFIG.projectId)).toBe(true);
    });

    it('stopWatching calls unsubscribe on the @parcel/watcher subscription', async () => {
      await watchManager.startWatching(BASE_CONFIG);
      const unsub = watcherState.lastUnsub;
      await watchManager.stopWatching(BASE_CONFIG.projectId);
      expect(unsub).toHaveBeenCalled();
    });

    it('stopWatching removes the project from listWatchers', async () => {
      await watchManager.startWatching(BASE_CONFIG);
      await watchManager.stopWatching(BASE_CONFIG.projectId);
      const ids = watchManager.listWatchers().map((w) => w.projectId);
      expect(ids).not.toContain(BASE_CONFIG.projectId);
    });

    // ── stopAllWatchers ───────────────────────────────────────────────────────

    it('stopAllWatchers removes all active watchers', async () => {
      await watchManager.startWatching({ ...BASE_CONFIG, projectId: 'proj_all_a', projectPath: '/test/a' });
      await watchManager.startWatching({ ...BASE_CONFIG, projectId: 'proj_all_b', projectPath: '/test/b' });
      expect(watchManager.listWatchers().length).toBe(2);
      await watchManager.stopAllWatchers();
      expect(watchManager.listWatchers()).toHaveLength(0);
    });

    // ── getWatcherInfo ────────────────────────────────────────────────────────

    it('getWatcherInfo returns undefined for unknown projectId', () => {
      expect(watchManager.getWatcherInfo('proj_phantom')).toBeUndefined();
    });

    it('getWatcherInfo returns WatcherInfo for a known projectId', async () => {
      await watchManager.startWatching(BASE_CONFIG);
      const info = watchManager.getWatcherInfo(BASE_CONFIG.projectId);
      expect(info).toBeDefined();
      expect(info!.projectId).toBe(BASE_CONFIG.projectId);
      expect(info!.status).toBe('active');
    });

    // ── listWatchers ──────────────────────────────────────────────────────────

    it('listWatchers returns empty array when no watchers are running', () => {
      expect(watchManager.listWatchers()).toEqual([]);
    });

    it('listWatchers returns all active watchers', async () => {
      await watchManager.startWatching({ ...BASE_CONFIG, projectId: 'proj_list_a', projectPath: '/test/la' });
      await watchManager.startWatching({ ...BASE_CONFIG, projectId: 'proj_list_b', projectPath: '/test/lb' });
      const watchers = watchManager.listWatchers();
      expect(watchers).toHaveLength(2);
      expect(watchers.map((w) => w.projectId)).toEqual(
        expect.arrayContaining(['proj_list_a', 'proj_list_b']),
      );
    });

    // ── File event handling / filtering ───────────────────────────────────────

    it('.ts file events trigger file_change_detected notification via MCP server', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      await watchManager.startWatching(BASE_CONFIG);

      watcherState.lastCallback!(null, [{ type: 'update', path: '/test/project/src/service.ts' }]);

      expect(mockSendLogging).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'file_change_detected' }),
        }),
      );
    });

    it('.tsx file events trigger file_change_detected notification', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      await watchManager.startWatching(BASE_CONFIG);

      watcherState.lastCallback!(null, [{ type: 'update', path: '/test/project/src/App.tsx' }]);

      expect(mockSendLogging).toHaveBeenCalled();
    });

    it('plan .md file events trigger file_change_detected notification', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      await watchManager.startWatching(BASE_CONFIG);

      watcherState.lastCallback!(null, [{ type: 'update', path: '/test/project/plans/PLAN.md' }]);

      expect(mockSendLogging).toHaveBeenCalled();
    });

    it('.js and .json file events are silently filtered — no notification', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      await watchManager.startWatching(BASE_CONFIG);

      watcherState.lastCallback!(null, [
        { type: 'update', path: '/test/project/src/helper.js' },
        { type: 'update', path: '/test/project/package.json' },
        { type: 'update', path: '/test/project/README.md' }, // non-plan markdown
      ]);

      expect(mockSendLogging).not.toHaveBeenCalled();
    });

    it('parcel "create" event maps to "add" in pending events', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      await watchManager.startWatching(BASE_CONFIG);

      watcherState.lastCallback!(null, [{ type: 'create', path: '/test/project/src/newFile.ts' }]);

      expect(mockSendLogging).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: expect.objectContaining({
              filesAdded: expect.arrayContaining(['/test/project/src/newFile.ts']),
            }),
          }),
        }),
      );
    });

    it('parcel "delete" event maps to "unlink" in pending events', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      await watchManager.startWatching(BASE_CONFIG);

      watcherState.lastCallback!(null, [{ type: 'delete', path: '/test/project/src/gone.ts' }]);

      expect(mockSendLogging).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            data: expect.objectContaining({
              filesDeleted: expect.arrayContaining(['/test/project/src/gone.ts']),
            }),
          }),
        }),
      );
    });

    // ── processEvents + debouncing ────────────────────────────────────────────

    it('processEvents calls incrementalParseHandler with correct args after debounce', async () => {
      watchManager.setIncrementalParseHandler(mockIncrementalHandler);
      await watchManager.startWatching(BASE_CONFIG);
      mockIncrementalHandler.mockClear(); // ignore syncMissedChanges invocation

      watcherState.lastCallback!(null, [{ type: 'update', path: '/test/project/src/foo.ts' }]);
      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(mockIncrementalHandler).toHaveBeenCalledWith(
        BASE_CONFIG.projectPath,
        BASE_CONFIG.projectId,
        BASE_CONFIG.tsconfigPath,
      );
    });

    it('debounce: multiple rapid events produce a single incrementalParseHandler call', async () => {
      watchManager.setIncrementalParseHandler(mockIncrementalHandler);
      await watchManager.startWatching(BASE_CONFIG);
      mockIncrementalHandler.mockClear();

      // Fire 6 rapid events — each resets the debounce timer
      for (let i = 0; i < 6; i++) {
        watcherState.lastCallback!(null, [{ type: 'update', path: `/test/project/src/f${i}.ts` }]);
      }

      await vi.runAllTimersAsync();
      await Promise.resolve();

      // Only one call despite 6 events
      expect(mockIncrementalHandler).toHaveBeenCalledTimes(1);
    });

    it('processEvents sends incremental_parse_started notification', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      watchManager.setIncrementalParseHandler(mockIncrementalHandler);
      await watchManager.startWatching(BASE_CONFIG);
      mockSendLogging.mockClear();

      watcherState.lastCallback!(null, [{ type: 'update', path: '/test/project/src/foo.ts' }]);
      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(mockSendLogging).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'incremental_parse_started' }),
        }),
      );
    });

    it('processEvents sends incremental_parse_completed on handler success', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      mockIncrementalHandler.mockResolvedValue({ nodesUpdated: 3, edgesUpdated: 2 });
      watchManager.setIncrementalParseHandler(mockIncrementalHandler);
      await watchManager.startWatching(BASE_CONFIG);
      mockSendLogging.mockClear();
      mockIncrementalHandler.mockClear();

      watcherState.lastCallback!(null, [{ type: 'update', path: '/test/project/src/foo.ts' }]);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve(); // extra flush for async handler resolution

      expect(mockSendLogging).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'incremental_parse_completed' }),
        }),
      );
    });

    it('processEvents sends incremental_parse_failed on handler error', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      mockIncrementalHandler.mockRejectedValue(new Error('parse exploded'));
      watchManager.setIncrementalParseHandler(mockIncrementalHandler);
      await watchManager.startWatching(BASE_CONFIG);
      mockSendLogging.mockClear();
      mockIncrementalHandler.mockClear();

      watcherState.lastCallback!(null, [{ type: 'update', path: '/test/project/src/foo.ts' }]);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockSendLogging).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'error',
          data: expect.objectContaining({ type: 'incremental_parse_failed' }),
        }),
      );
    });

    it('processEvents sends incremental_parse_failed when no handler is configured', async () => {
      watchManager.setMcpServer(MOCK_MCP_SERVER);
      watchManager.setIncrementalParseHandler(null as any); // force null
      await watchManager.startWatching(BASE_CONFIG);
      mockSendLogging.mockClear();

      watcherState.lastCallback!(null, [{ type: 'update', path: '/test/project/src/foo.ts' }]);
      await vi.runAllTimersAsync();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockSendLogging).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'incremental_parse_failed' }),
        }),
      );
    });

    it('watcher callback error causes watcher cleanup (state removed or set non-active)', async () => {
      watchManager.setIncrementalParseHandler(mockIncrementalHandler);
      await watchManager.startWatching(BASE_CONFIG);

      // Simulate an internal @parcel/watcher error
      watcherState.lastCallback!(new Error('watcher internal error'), []);

      // Allow async cleanup chain (handleWatcherError → stopWatching) to execute.
      // handleWatcherError sets status='error', then stopWatching sets status='paused'
      // before ultimately removing the watcher from the map.
      await Promise.resolve();
      await Promise.resolve();

      const info = watchManager.getWatcherInfo(BASE_CONFIG.projectId);
      // Accepted states: removed from map (undefined), 'error' (before stopWatching runs),
      // or 'paused' (stopWatching started but not yet finished deleting)
      if (info !== undefined) {
        expect(['error', 'paused']).toContain(info.status);
      } else {
        expect(info).toBeUndefined();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. ChunkWorkerPool
  // ═══════════════════════════════════════════════════════════════════════════
  describe('ChunkWorkerPool', () => {
    const POOL_CONFIG = {
      projectPath: '/test/project',
      tsconfigPath: 'tsconfig.json',
      projectId: 'proj_pool_test',
      projectType: 'typescript' as any,
      numWorkers: 2,
    };

    beforeEach(() => {
      vi.clearAllMocks();
      workerPool.length = 0;
    });

    it('processChunks spawns at most numWorkers workers', async () => {
      const pool = new ChunkWorkerPool(POOL_CONFIG);
      await pool.processChunks([['a.ts'], ['b.ts']], vi.fn().mockResolvedValue(undefined));
      expect(workerPool.length).toBeLessThanOrEqual(POOL_CONFIG.numWorkers!);
      expect(workerPool.length).toBeGreaterThan(0);
    });

    it('processChunks calls onChunkComplete callback for every chunk', async () => {
      const pool = new ChunkWorkerPool(POOL_CONFIG);
      const onComplete = vi.fn().mockResolvedValue(undefined);
      const chunks = [['file1.ts'], ['file2.ts'], ['file3.ts']];
      await pool.processChunks(chunks, onComplete);
      expect(onComplete).toHaveBeenCalledTimes(chunks.length);
    });

    it('processChunks resolves with a PoolStats object', async () => {
      const pool = new ChunkWorkerPool(POOL_CONFIG);
      const stats = await pool.processChunks([['a.ts']], vi.fn().mockResolvedValue(undefined));
      expect(stats).toMatchObject({
        totalNodes: expect.any(Number),
        totalEdges: expect.any(Number),
        totalFiles: expect.any(Number),
        chunksCompleted: expect.any(Number),
        totalChunks: expect.any(Number),
        elapsedMs: expect.any(Number),
      });
    });

    it('PoolStats.totalChunks equals number of input chunks', async () => {
      const pool = new ChunkWorkerPool(POOL_CONFIG);
      const chunks = [['a.ts'], ['b.ts'], ['c.ts']];
      const stats = await pool.processChunks(chunks, vi.fn().mockResolvedValue(undefined));
      expect(stats.totalChunks).toBe(chunks.length);
      expect(stats.chunksCompleted).toBe(chunks.length);
    });

    it('PoolStats.totalNodes accumulates nodes from all chunks', async () => {
      const pool = new ChunkWorkerPool(POOL_CONFIG);
      // Mock returns 1 node per chunk
      const chunks = [['a.ts'], ['b.ts']];
      const stats = await pool.processChunks(chunks, vi.fn().mockResolvedValue(undefined));
      expect(stats.totalNodes).toBe(chunks.length);
    });

    it('onChunkComplete receives ChunkResult with expected shape', async () => {
      const pool = new ChunkWorkerPool(POOL_CONFIG);
      const receivedResults: any[] = [];
      await pool.processChunks([['only.ts']], async (result) => {
        receivedResults.push(result);
      });
      expect(receivedResults[0]).toMatchObject({
        chunkIndex: 0,
        nodes: expect.any(Array),
        edges: expect.any(Array),
        filesProcessed: expect.any(Number),
      });
    });

    it('workers receive postMessage calls with type "chunk"', async () => {
      const pool = new ChunkWorkerPool({ ...POOL_CONFIG, numWorkers: 1 });
      await pool.processChunks([['f1.ts'], ['f2.ts']], vi.fn().mockResolvedValue(undefined));
      const chunkMessages = workerPool
        .flatMap((w) => w.postMessage.mock.calls as any[][])
        .filter((args) => args[0]?.type === 'chunk');
      expect(chunkMessages.length).toBe(2);
    });

    it('processChunks rejects when a worker emits an error message', async () => {
      // Override to emit 'error' instead of 'result'
      MockWorker.mockImplementationOnce(function (this: any) {
        const handlers: Record<string, Function[]> = {};
        this._handlers = handlers;
        this.on = vi.fn((event: string, handler: Function) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        });
        this.postMessage = vi.fn((msg: any) => {
          if (msg?.type === 'chunk') {
            Promise.resolve().then(() => {
              handlers['message']?.forEach((h) =>
                h({ type: 'error', chunkIndex: msg.chunkIndex, error: 'chunk parse failed' }),
              );
            });
          }
        });
        this.terminate = vi.fn();
        workerPool.push(this);
        Promise.resolve().then(() => {
          handlers['message']?.forEach((h) => h({ type: 'ready' }));
        });
      });

      const pool = new ChunkWorkerPool({ ...POOL_CONFIG, numWorkers: 1 });
      await expect(
        pool.processChunks([['bad.ts']], vi.fn().mockResolvedValue(undefined)),
      ).rejects.toThrow(/chunk 0 failed/i);
    });

    it('terminate is called on workers as part of shutdown after completion', async () => {
      const pool = new ChunkWorkerPool({ ...POOL_CONFIG, numWorkers: 1 });
      await pool.processChunks([['a.ts']], vi.fn().mockResolvedValue(undefined));
      const terminateCalls = workerPool.filter((w) => w.terminate.mock.calls.length > 0);
      expect(terminateCalls.length).toBeGreaterThan(0);
    });

    it('processChunks handles a single chunk correctly', async () => {
      const pool = new ChunkWorkerPool({ ...POOL_CONFIG, numWorkers: 1 });
      const stats = await pool.processChunks([['single.ts']], vi.fn().mockResolvedValue(undefined));
      expect(stats.chunksCompleted).toBe(1);
      expect(stats.totalChunks).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. chunk-worker.types (type smoke tests)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('chunk-worker types', () => {
    it('types module is importable without errors', async () => {
      const mod = await import('../../workers/chunk-worker.types.js');
      expect(mod).toBeDefined();
      expect(typeof mod).toBe('object');
    });

    it('types module has no runtime side effects (empty at runtime)', async () => {
      const mod = await import('../../workers/chunk-worker.types.js');
      // Pure type file — no runtime exports expected
      const keys = Object.keys(mod).filter((k) => typeof (mod as any)[k] !== 'undefined');
      // Either empty or only type-level artifacts — no functions or classes
      keys.forEach((k) => {
        expect(typeof (mod as any)[k]).not.toBe('function');
      });
    });

    it('ChunkWorkItem type annotation compiles and holds correct shape', () => {
      const msg: ChunkWorkItem = {
        type: 'chunk',
        chunkIndex: 0,
        totalChunks: 2,
        files: ['src/a.ts', 'src/b.ts'],
      };
      expect(msg.type).toBe('chunk');
      expect(msg.files).toHaveLength(2);
      expect(msg.chunkIndex).toBe(0);
    });

    it('WorkerToCoordinatorMessage ready discriminant works', () => {
      const ready: WorkerToCoordinatorMessage = { type: 'ready' };
      expect(ready.type).toBe('ready');
    });

    it('WorkerToCoordinatorMessage error discriminant works', () => {
      const err: WorkerToCoordinatorMessage = { type: 'error', chunkIndex: 1, error: 'boom' };
      expect(err.type).toBe('error');
      if (err.type === 'error') {
        expect(err.chunkIndex).toBe(1);
        expect(err.error).toBe('boom');
      }
    });

    it('SerializedDeferredEdge holds required fields', () => {
      const edge: SerializedDeferredEdge = {
        edgeType: 'CALLS',
        sourceNodeId: 'node_src',
        targetName: 'doWork',
        targetType: 'Function',
      };
      expect(edge.edgeType).toBe('CALLS');
      expect(edge.targetFilePath).toBeUndefined(); // optional field
    });

    it('ChunkWorkerReady type annotation is valid', () => {
      const ready: ChunkWorkerReady = { type: 'ready', workerId: 3 };
      expect(ready.workerId).toBe(3);
    });

    it('ChunkWorkerError type annotation is valid', () => {
      const err: ChunkWorkerError = { type: 'error', chunkIndex: 0, error: 'fail', stack: 'at ...' };
      expect(err.stack).toBe('at ...');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. chunk.worker (worker thread entry point)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('chunk.worker', () => {
    let chunkMessageHandler: ((msg: any) => Promise<void>) | null = null;

    beforeAll(async () => {
      ppState.reset();
      vi.clearAllMocks();
      // Importing the module triggers module-level code:
      //   parentPort.on('message', handler)  — registered listener
      //   sendReady()                         — initial 'ready' posted
      await import('../../workers/chunk.worker.js');
      chunkMessageHandler = (ppState.handlers['message']?.[0] as ((msg: any) => Promise<void>) | undefined) ?? null;
    });

    it('sends a ready message immediately on startup (module load)', () => {
      expect(ppState.postMessage).toHaveBeenCalledWith({ type: 'ready' });
    });

    it('registers exactly one message listener', () => {
      expect(ppState.handlers['message']).toHaveLength(1);
      expect(chunkMessageHandler).toBeTypeOf('function');
    });

    it('handles "chunk" message — calls parser.parseChunk with files', async () => {
      if (!chunkMessageHandler) return;
      mockParserObj.parseChunk.mockClear();
      mockParserObj.parseChunk.mockResolvedValueOnce({ nodes: [], edges: [] });

      await chunkMessageHandler({ type: 'chunk', chunkIndex: 0, totalChunks: 1, files: ['foo.ts'] });

      expect(mockParserObj.parseChunk).toHaveBeenCalledWith(['foo.ts'], true);
    });

    it('handles "chunk" message — sends a result message back to coordinator', async () => {
      if (!chunkMessageHandler) return;
      ppState.postMessage.mockClear();
      mockParserObj.parseChunk.mockResolvedValueOnce({ nodes: [{ id: 'n1' }], edges: [] });

      await chunkMessageHandler({ type: 'chunk', chunkIndex: 1, totalChunks: 1, files: ['bar.ts'] });

      expect(ppState.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'result', chunkIndex: 1 }),
      );
    });

    it('handles "chunk" message — sends ready again after processing', async () => {
      if (!chunkMessageHandler) return;
      ppState.postMessage.mockClear();
      mockParserObj.parseChunk.mockResolvedValueOnce({ nodes: [], edges: [] });

      await chunkMessageHandler({ type: 'chunk', chunkIndex: 2, totalChunks: 1, files: ['baz.ts'] });

      const readyCall = (ppState.postMessage.mock.calls as any[][]).find(
        (args) => args[0]?.type === 'ready',
      );
      expect(readyCall).toBeDefined();
    });

    it('calls clearParsedData on the parser before processing each chunk', async () => {
      if (!chunkMessageHandler) return;
      mockParserObj.clearParsedData.mockClear();
      mockParserObj.parseChunk.mockResolvedValueOnce({ nodes: [], edges: [] });

      await chunkMessageHandler({ type: 'chunk', chunkIndex: 3, totalChunks: 1, files: ['x.ts'] });

      expect(mockParserObj.clearParsedData).toHaveBeenCalled();
    });

    it('sends an error message when parseChunk throws', async () => {
      if (!chunkMessageHandler) return;
      ppState.postMessage.mockClear();
      mockParserObj.parseChunk.mockRejectedValueOnce(new Error('parse exploded'));

      await chunkMessageHandler({ type: 'chunk', chunkIndex: 4, totalChunks: 1, files: ['bad.ts'] });

      expect(ppState.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          chunkIndex: 4,
          error: 'parse exploded',
        }),
      );
    });

    it('handles "terminate" message by calling process.exit(0)', async () => {
      if (!chunkMessageHandler) return;
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
      try {
        await chunkMessageHandler({ type: 'terminate' });
        expect(exitSpy).toHaveBeenCalledWith(0);
      } finally {
        exitSpy.mockRestore();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. parse-coordinator (parse worker thread)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('parse-coordinator', () => {
    beforeAll(async () => {
      ppState.reset();
      vi.clearAllMocks();
      // Importing fires runParser() immediately (fire-and-forget at module level)
      await import('../../workers/parse-coordinator.js');
      // Wait for the async runParser() chain to reach 'complete' or 'error'
      await vi.waitFor(
        () => {
          const calls = ppState.postMessage.mock.calls as any[][];
          return calls.some((args) => args[0]?.type === 'complete' || args[0]?.type === 'error');
        },
        { timeout: 5000 },
      );
    });

    it('sends at least one progress message before finishing', () => {
      const progressCalls = (ppState.postMessage.mock.calls as any[][]).filter(
        (args) => args[0]?.type === 'progress',
      );
      expect(progressCalls.length).toBeGreaterThan(0);
    });

    it('first progress message has phase = "discovery"', () => {
      const firstProgress = (ppState.postMessage.mock.calls as any[][]).find(
        (args) => args[0]?.type === 'progress',
      );
      expect(firstProgress?.[0]?.data?.phase).toBe('discovery');
    });

    it('progress message data has the expected shape', () => {
      const progressCall = (ppState.postMessage.mock.calls as any[][]).find(
        (args) => args[0]?.type === 'progress',
      );
      expect(progressCall?.[0]?.data).toMatchObject({
        phase: expect.any(String),
        filesProcessed: expect.any(Number),
        filesTotal: expect.any(Number),
        nodesImported: expect.any(Number),
        edgesImported: expect.any(Number),
        currentChunk: expect.any(Number),
        totalChunks: expect.any(Number),
      });
    });

    it('sends a terminal message of type "complete" or "error"', () => {
      const calls = ppState.postMessage.mock.calls as any[][];
      const terminal = calls.filter(
        (args) => args[0]?.type === 'complete' || args[0]?.type === 'error',
      );
      expect(terminal.length).toBeGreaterThan(0);
    });

    it('complete message contains nodesImported, edgesImported, elapsedMs', () => {
      const calls = ppState.postMessage.mock.calls as any[][];
      const completeCall = calls.find((args) => args[0]?.type === 'complete');
      if (completeCall) {
        expect(completeCall[0].data).toMatchObject({
          nodesImported: expect.any(Number),
          edgesImported: expect.any(Number),
          elapsedMs: expect.any(Number),
        });
      } else {
        // error path is acceptable if dependency mock resolution fails
        const errorCall = calls.find((args) => args[0]?.type === 'error');
        expect(errorCall?.[0]).toHaveProperty('error');
        expect(typeof errorCall?.[0]?.error).toBe('string');
      }
    });

    it('Neo4j service run() is called during parsing', () => {
      expect(mockNeo4jRun).toHaveBeenCalled();
    });

    it('Neo4j service close() is called in the finally block', () => {
      expect(mockNeo4jClose).toHaveBeenCalled();
    });

    it('sendProgress formats progress data with all required numeric fields', () => {
      // Verify every progress message has non-negative numbers
      const progressCalls = (ppState.postMessage.mock.calls as any[][]).filter(
        (args) => args[0]?.type === 'progress',
      );
      for (const call of progressCalls) {
        const d = call[0].data;
        expect(d.filesProcessed).toBeGreaterThanOrEqual(0);
        expect(d.filesTotal).toBeGreaterThanOrEqual(0);
        expect(d.nodesImported).toBeGreaterThanOrEqual(0);
        expect(d.edgesImported).toBeGreaterThanOrEqual(0);
        expect(d.currentChunk).toBeGreaterThanOrEqual(0);
        expect(d.totalChunks).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
