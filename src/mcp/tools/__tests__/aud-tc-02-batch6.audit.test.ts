/**
 * AUD-TC-02 Batch 6 — Behavioral tests for MCP infrastructure layer.
 * Covers: constants, utils, service-init, job-manager, cross-file-edge helpers.
 *
 * Rules:
 *  - No source-string-match tests, no Cypher string assertions (CORR-01)
 *  - No reimplemented logic
 *  - Mock at closest module boundary (CORR-06)
 *  - Constructor mocks use vi.fn(function(this: any) {...})
 *  - vi.hoisted() for all mock setup
 *  - ESM .js extensions on all imports
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted — mock fns survive factory hoisting
// ─────────────────────────────────────────────────────────────────────────────
const {
  mockNeo4jRun,
  mockNeo4jGetSchema,
  mockResolveProjectIdFromInput,
  mockInitializeNaturalLanguageService,
  mockFsWriteFile,
  mockDebugLog,
} = vi.hoisted(() => ({
  mockNeo4jRun: vi.fn(),
  mockNeo4jGetSchema: vi.fn(),
  mockResolveProjectIdFromInput: vi.fn(),
  mockInitializeNaturalLanguageService: vi.fn(),
  mockFsWriteFile: vi.fn(),
  mockDebugLog: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockNeo4jRun;
    this.getSchema = mockNeo4jGetSchema;
  }),
  QUERIES: {
    DELETE_SOURCE_FILE_SUBGRAPHS: 'mock_delete_subgraphs',
    GET_EXISTING_NODES_FOR_EDGE_DETECTION: 'mock_existing_nodes',
    GET_CROSS_FILE_EDGES: 'mock_cross_file_edges',
    DISCOVER_NODE_TYPES: 'mock_discover_nodes',
    DISCOVER_RELATIONSHIP_TYPES: 'mock_discover_rels',
    DISCOVER_SEMANTIC_TYPES: 'mock_discover_sem',
    DISCOVER_COMMON_PATTERNS: 'mock_discover_patterns',
  },
}));

vi.mock('../../../core/utils/project-id.js', () => ({
  resolveProjectIdFromInput: mockResolveProjectIdFromInput,
}));

vi.mock('../natural-language-to-cypher.tool.js', () => ({
  initializeNaturalLanguageService: mockInitializeNaturalLanguageService,
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: mockFsWriteFile,
    readFile: vi.fn(),
  },
}));

// Partial mock: preserve real util functions, override only debugLog.
vi.mock('../../utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    debugLog: mockDebugLog,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Imports under test
// ─────────────────────────────────────────────────────────────────────────────

import {
  MCP_SERVER_CONFIG,
  FILE_PATHS,
  TOOL_NAMES,
  MESSAGES,
  DEFAULTS,
  JOBS,
  WATCH,
  PARSING,
} from '../../constants.js';

import {
  resolveProjectIdOrError,
  createErrorResponse,
  createSuccessResponse,
} from '../../utils.js';

import { initializeServices } from '../../service-init.js';

import { jobManager } from '../../services/job-manager.js';

import {
  saveEnrichmentProperties,
  restoreEnrichmentProperties,
  deleteSourceFileSubgraphs,
  loadExistingNodesForEdgeDetection,
  getCrossFileEdges,
} from '../../handlers/cross-file-edge.helpers.js';

import type { Neo4jService } from '../../../storage/neo4j/neo4j.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create a minimal Neo4jService mock (for parameter-injection tests)
// ─────────────────────────────────────────────────────────────────────────────
const makeNeo4jMock = () =>
  ({ run: vi.fn() } as unknown as Neo4jService);

// ─────────────────────────────────────────────────────────────────────────────
// Main describe
// ─────────────────────────────────────────────────────────────────────────────

describe('[aud-tc-02] Batch 6 — MCP infrastructure (constants, utils, service-init, job-manager, cross-file-edge helpers)', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // 1. constants
  // ─────────────────────────────────────────────────────────────────────────
  describe('constants', () => {

    describe('MCP_SERVER_CONFIG', () => {
      it('has a non-empty name string', () => {
        expect(typeof MCP_SERVER_CONFIG.name).toBe('string');
        expect(MCP_SERVER_CONFIG.name.length).toBeGreaterThan(0);
      });

      it('has a non-empty version string', () => {
        expect(typeof MCP_SERVER_CONFIG.version).toBe('string');
        expect(MCP_SERVER_CONFIG.version.length).toBeGreaterThan(0);
      });
    });

    describe('FILE_PATHS', () => {
      it('has debugLog, schemaOutput, and graphOutput keys', () => {
        expect(FILE_PATHS).toHaveProperty('debugLog');
        expect(FILE_PATHS).toHaveProperty('schemaOutput');
        expect(FILE_PATHS).toHaveProperty('graphOutput');
      });

      it('all FILE_PATHS values are non-empty strings', () => {
        for (const v of Object.values(FILE_PATHS)) {
          expect(typeof v).toBe('string');
          expect((v as string).length).toBeGreaterThan(0);
        }
      });
    });

    describe('TOOL_NAMES', () => {
      const EXPECTED_TOOLS = [
        'hello',
        'searchCodebase',
        'naturalLanguageToCypher',
        'traverseFromNode',
        'parseTypescriptProject',
        'testNeo4jConnection',
        'impactAnalysis',
        'checkParseStatus',
        'listProjects',
        'startWatchProject',
        'stopWatchProject',
        'listWatchers',
        'detectDeadCode',
        'detectDuplicateCode',
        'swarmPheromone',
        'swarmSense',
        'swarmCleanup',
        'swarmPostTask',
        'swarmClaimTask',
        'swarmCompleteTask',
        'swarmGetTasks',
        'simulateEdit',
        'preEditCheck',
        'groundTruth',
        'planStatus',
        'planNextTasks',
        'selfAudit',
        'sessionContextSummary',
      ] as const;

      it('contains all expected tool keys', () => {
        for (const key of EXPECTED_TOOLS) {
          expect(TOOL_NAMES).toHaveProperty(key);
        }
      });

      it('all TOOL_NAMES values are non-empty strings', () => {
        for (const v of Object.values(TOOL_NAMES)) {
          expect(typeof v).toBe('string');
          expect((v as string).length).toBeGreaterThan(0);
        }
      });

      it('no TOOL_NAMES values are undefined', () => {
        for (const v of Object.values(TOOL_NAMES)) {
          expect(v).toBeDefined();
        }
      });
    });

    describe('MESSAGES', () => {
      it('errors section has expected keys with non-empty strings', () => {
        expect(typeof MESSAGES.errors.noRelevantCode).toBe('string');
        expect(MESSAGES.errors.noRelevantCode.length).toBeGreaterThan(0);
        expect(typeof MESSAGES.errors.serviceNotInitialized).toBe('string');
        expect(MESSAGES.errors.serviceNotInitialized.length).toBeGreaterThan(0);
        expect(typeof MESSAGES.errors.genericError).toBe('string');
        expect(MESSAGES.errors.genericError.length).toBeGreaterThan(0);
      });

      it('success section has expected keys with non-empty strings', () => {
        expect(typeof MESSAGES.success.hello).toBe('string');
        expect(MESSAGES.success.hello.length).toBeGreaterThan(0);
        expect(typeof MESSAGES.success.parseSuccess).toBe('string');
        expect(MESSAGES.success.parseSuccess.length).toBeGreaterThan(0);
      });

      it('server section has startup message strings', () => {
        expect(typeof MESSAGES.server.starting).toBe('string');
        expect(MESSAGES.server.starting.length).toBeGreaterThan(0);
        expect(typeof MESSAGES.server.connected).toBe('string');
        expect(MESSAGES.server.connected.length).toBeGreaterThan(0);
      });

      it('no MESSAGES leaf values are undefined', () => {
        const checkLeafs = (obj: any): void => {
          for (const v of Object.values(obj)) {
            if (typeof v === 'object' && v !== null) {
              checkLeafs(v);
            } else {
              expect(v).toBeDefined();
            }
          }
        };
        checkLeafs(MESSAGES);
      });
    });

    describe('DEFAULTS', () => {
      it('has non-negative numeric values for all fields', () => {
        for (const v of Object.values(DEFAULTS)) {
          expect(typeof v).toBe('number');
          expect(v as number).toBeGreaterThanOrEqual(0);
        }
      });

      it('traversalDepth is a reasonable depth (1-20)', () => {
        expect(DEFAULTS.traversalDepth).toBeGreaterThanOrEqual(1);
        expect(DEFAULTS.traversalDepth).toBeLessThanOrEqual(20);
      });

      it('batchSize is a positive number', () => {
        expect(DEFAULTS.batchSize).toBeGreaterThan(0);
      });
    });

    describe('JOBS', () => {
      it('cleanupIntervalMs is a positive number', () => {
        expect(typeof JOBS.cleanupIntervalMs).toBe('number');
        expect(JOBS.cleanupIntervalMs).toBeGreaterThan(0);
      });

      it('maxJobs is a positive number', () => {
        expect(typeof JOBS.maxJobs).toBe('number');
        expect(JOBS.maxJobs).toBeGreaterThan(0);
      });
    });

    describe('WATCH', () => {
      it('defaultDebounceMs is a positive number', () => {
        expect(typeof WATCH.defaultDebounceMs).toBe('number');
        expect(WATCH.defaultDebounceMs).toBeGreaterThan(0);
      });

      it('excludePatterns is a non-empty array of strings', () => {
        expect(Array.isArray(WATCH.excludePatterns)).toBe(true);
        expect(WATCH.excludePatterns.length).toBeGreaterThan(0);
        for (const p of WATCH.excludePatterns) {
          expect(typeof p).toBe('string');
        }
      });
    });

    describe('PARSING', () => {
      it('parallelThreshold is a positive number', () => {
        expect(typeof PARSING.parallelThreshold).toBe('number');
        expect(PARSING.parallelThreshold).toBeGreaterThan(0);
      });

      it('defaultChunkSize is a positive number', () => {
        expect(typeof PARSING.defaultChunkSize).toBe('number');
        expect(PARSING.defaultChunkSize).toBeGreaterThan(0);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. utils
  // ─────────────────────────────────────────────────────────────────────────
  describe('utils', () => {

    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe('resolveProjectIdOrError', () => {
      it('returns {success: true, projectId} when resolver succeeds', async () => {
        mockResolveProjectIdFromInput.mockResolvedValue('proj_abc123');
        const neo4jMock = makeNeo4jMock();
        const result = await resolveProjectIdOrError('my-project', neo4jMock);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.projectId).toBe('proj_abc123');
        }
      });

      it('passes projectId and neo4jService to the resolver', async () => {
        mockResolveProjectIdFromInput.mockResolvedValue('proj_xyz');
        const neo4jMock = makeNeo4jMock();
        await resolveProjectIdOrError('input-id', neo4jMock);
        expect(mockResolveProjectIdFromInput).toHaveBeenCalledWith('input-id', neo4jMock);
      });

      it('returns {success: false, error} when resolver throws', async () => {
        mockResolveProjectIdFromInput.mockRejectedValue(new Error('project not found'));
        const neo4jMock = makeNeo4jMock();
        const result = await resolveProjectIdOrError('bad-project', neo4jMock);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBeDefined();
        }
      });

      it('failure result error is an MCP content array response', async () => {
        mockResolveProjectIdFromInput.mockRejectedValue(new Error('not found'));
        const neo4jMock = makeNeo4jMock();
        const result = await resolveProjectIdOrError('missing', neo4jMock);
        if (!result.success) {
          expect(Array.isArray(result.error.content)).toBe(true);
          expect(result.error.content.length).toBeGreaterThan(0);
          expect(result.error.content[0]).toHaveProperty('type', 'text');
          expect(typeof result.error.content[0].text).toBe('string');
        }
      });

      it('failure error text contains the original error message', async () => {
        mockResolveProjectIdFromInput.mockRejectedValue(new Error('project missing'));
        const neo4jMock = makeNeo4jMock();
        const result = await resolveProjectIdOrError('x', neo4jMock);
        if (!result.success) {
          expect(result.error.content[0].text).toContain('project missing');
        }
      });
    });

    describe('createErrorResponse', () => {
      it('wraps a string error into content array', () => {
        const resp = createErrorResponse('something went wrong');
        expect(Array.isArray(resp.content)).toBe(true);
        expect(resp.content[0].type).toBe('text');
        expect(resp.content[0].text).toContain('something went wrong');
      });

      it('wraps an Error object using its message', () => {
        const resp = createErrorResponse(new Error('disk full'));
        expect(resp.content[0].text).toContain('disk full');
      });

      it('response has exactly one content item', () => {
        const resp = createErrorResponse('err');
        expect(resp.content).toHaveLength(1);
      });

      it('content item type is always "text"', () => {
        const resp = createErrorResponse(new Error('test'));
        expect(resp.content[0].type).toBe('text');
      });
    });

    describe('createSuccessResponse', () => {
      it('wraps text into a content array', () => {
        const resp = createSuccessResponse('operation completed');
        expect(Array.isArray(resp.content)).toBe(true);
        expect(resp.content[0].text).toBe('operation completed');
      });

      it('content item type is "text"', () => {
        const resp = createSuccessResponse('ok');
        expect(resp.content[0].type).toBe('text');
      });

      it('response has exactly one content item', () => {
        const resp = createSuccessResponse('done');
        expect(resp.content).toHaveLength(1);
      });

      it('preserves the full text unchanged', () => {
        const text = 'Multi\nline\ntext with special chars: <>&"';
        const resp = createSuccessResponse(text);
        expect(resp.content[0].text).toBe(text);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. service-init
  // ─────────────────────────────────────────────────────────────────────────
  describe('service-init', () => {

    beforeEach(() => {
      vi.clearAllMocks();
      // Default mocks for happy path
      mockNeo4jRun.mockResolvedValue([{ ok: 1, pid: 'proj_test' }]);
      mockNeo4jGetSchema.mockResolvedValue({ labels: [], relationships: [] });
      mockInitializeNaturalLanguageService.mockResolvedValue(undefined);
      mockFsWriteFile.mockResolvedValue(undefined);
      mockDebugLog.mockResolvedValue(undefined);
    });

    it('calls Neo4j run() to verify connectivity', async () => {
      await initializeServices();
      expect(mockNeo4jRun).toHaveBeenCalled();
    });

    it('calls initializeNaturalLanguageService', async () => {
      await initializeServices();
      expect(mockInitializeNaturalLanguageService).toHaveBeenCalledTimes(1);
    });

    it('writes the schema file to disk', async () => {
      await initializeServices();
      expect(mockFsWriteFile).toHaveBeenCalled();
      const [filePath, content] = mockFsWriteFile.mock.calls[0];
      expect(typeof filePath).toBe('string');
      expect(filePath.length).toBeGreaterThan(0);
      expect(typeof content).toBe('string');
    });

    it('schema file content is valid JSON', async () => {
      await initializeServices();
      const content = mockFsWriteFile.mock.calls[0][1] as string;
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('calls getSchema on the Neo4jService instance', async () => {
      await initializeServices();
      expect(mockNeo4jGetSchema).toHaveBeenCalled();
    });

    it('logs a warning when OPENAI_API_KEY is absent', async () => {
      const prevKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await initializeServices();
        const calls = consoleSpy.mock.calls.map((c) => JSON.stringify(c));
        const warned = calls.some((c) => c.includes('OPENAI_API_KEY'));
        expect(warned).toBe(true);
      } finally {
        if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
        consoleSpy.mockRestore();
      }
    });

    it('does not throw when OPENAI_API_KEY is absent', async () => {
      const prevKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(initializeServices()).resolves.not.toThrow();
      } finally {
        if (prevKey !== undefined) process.env.OPENAI_API_KEY = prevKey;
        vi.restoreAllMocks();
      }
    });

    it('completes successfully even when schema discovery returns no project', async () => {
      // No project found in graph — discover returns empty
      mockNeo4jRun
        .mockResolvedValueOnce([{ ok: 1 }])           // ensureNeo4j
        .mockResolvedValueOnce([])                     // MATCH (p:Project) — no project
        .mockResolvedValue([]);                        // all discovery queries
      await expect(initializeServices()).resolves.toBeUndefined();
    });

    it('does not throw if schema write fails', async () => {
      mockFsWriteFile.mockRejectedValue(new Error('disk full'));
      await expect(initializeServices()).resolves.toBeUndefined();
    });

    it('throws if Neo4j is unreachable', async () => {
      mockNeo4jRun.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(initializeServices()).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. job-manager
  // ─────────────────────────────────────────────────────────────────────────
  describe('job-manager', () => {

    // Collected IDs for cleanup after each test
    let testJobIds: string[] = [];

    beforeEach(() => {
      testJobIds = [];
      jobManager.stopCleanupScheduler();
    });

    afterEach(() => {
      // Drain created jobs: fail any still-active ones, then force-clean
      for (const id of testJobIds) {
        const job = jobManager.getJob(id);
        if (job && (job.status === 'pending' || job.status === 'running')) {
          jobManager.failJob(id, 'test teardown');
        }
      }
      // maxAgeMs = -1 → age > -1 is always true → removes all completed/failed
      jobManager.cleanupOldJobs(-1);
    });

    // ── createJob ──────────────────────────────────────────────────────────

    it('createJob returns a non-empty string ID', () => {
      const id = jobManager.createJob('/some/path', 'proj_test');
      testJobIds.push(id);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('createJob IDs are unique across calls', () => {
      const id1 = jobManager.createJob('/path/a', 'proj_1');
      const id2 = jobManager.createJob('/path/b', 'proj_2');
      testJobIds.push(id1, id2);
      expect(id1).not.toBe(id2);
    });

    it('created job starts in pending status', () => {
      const id = jobManager.createJob('/path', 'proj_x');
      testJobIds.push(id);
      expect(jobManager.getJob(id)?.status).toBe('pending');
    });

    it('created job stores projectId and projectPath', () => {
      const id = jobManager.createJob('/my/project', 'proj_stored');
      testJobIds.push(id);
      const job = jobManager.getJob(id)!;
      expect(job.projectId).toBe('proj_stored');
      expect(job.projectPath).toBe('/my/project');
    });

    // ── startJob ───────────────────────────────────────────────────────────

    it('startJob transitions status to running', () => {
      const id = jobManager.createJob('/path', 'proj_s');
      testJobIds.push(id);
      jobManager.startJob(id);
      expect(jobManager.getJob(id)?.status).toBe('running');
    });

    // ── updateProgress ─────────────────────────────────────────────────────

    it('updateProgress merges partial progress fields', () => {
      const id = jobManager.createJob('/path', 'proj_p');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.updateProgress(id, { filesTotal: 42, filesProcessed: 10 });
      const job = jobManager.getJob(id)!;
      expect(job.progress.filesTotal).toBe(42);
      expect(job.progress.filesProcessed).toBe(10);
    });

    it('updateProgress does not overwrite unspecified fields', () => {
      const id = jobManager.createJob('/path', 'proj_q');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.updateProgress(id, { filesTotal: 99 });
      const job = jobManager.getJob(id)!;
      // other fields remain at their initial 0 values
      expect(job.progress.filesProcessed).toBe(0);
    });

    // ── completeJob ────────────────────────────────────────────────────────

    it('completeJob transitions status to completed', () => {
      const id = jobManager.createJob('/path', 'proj_c');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.completeJob(id, { nodesImported: 100, edgesImported: 50, elapsedMs: 1000 });
      expect(jobManager.getJob(id)?.status).toBe('completed');
    });

    it('completeJob stores the result', () => {
      const id = jobManager.createJob('/path', 'proj_r');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.completeJob(id, { nodesImported: 7, edgesImported: 3, elapsedMs: 500 });
      const job = jobManager.getJob(id)!;
      expect(job.result).toBeDefined();
      expect(job.result!.nodesImported).toBe(7);
      expect(job.result!.edgesImported).toBe(3);
    });

    it('completeJob sets progress phase to complete', () => {
      const id = jobManager.createJob('/path', 'proj_phase');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.completeJob(id, { nodesImported: 0, edgesImported: 0, elapsedMs: 0 });
      expect(jobManager.getJob(id)?.progress.phase).toBe('complete');
    });

    // ── failJob ────────────────────────────────────────────────────────────

    it('failJob transitions status to failed', () => {
      const id = jobManager.createJob('/path', 'proj_f');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.failJob(id, 'parse error');
      expect(jobManager.getJob(id)?.status).toBe('failed');
    });

    it('failJob stores the error message', () => {
      const id = jobManager.createJob('/path', 'proj_e');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.failJob(id, 'timeout exceeded');
      expect(jobManager.getJob(id)?.error).toBe('timeout exceeded');
    });

    // ── getJob ─────────────────────────────────────────────────────────────

    it('getJob returns undefined for an unknown ID', () => {
      expect(jobManager.getJob('job_nonexistent_zzz999')).toBeUndefined();
    });

    it('getJob returns the job after creation', () => {
      const id = jobManager.createJob('/path', 'proj_g');
      testJobIds.push(id);
      expect(jobManager.getJob(id)).toBeDefined();
      expect(jobManager.getJob(id)!.id).toBe(id);
    });

    // ── listJobs ───────────────────────────────────────────────────────────

    it('listJobs with no filter includes created jobs', () => {
      const id1 = jobManager.createJob('/path/a', 'proj_l1');
      const id2 = jobManager.createJob('/path/b', 'proj_l2');
      testJobIds.push(id1, id2);
      const all = jobManager.listJobs();
      const ids = all.map((j) => j.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });

    it('listJobs filters to running jobs only', () => {
      const pending = jobManager.createJob('/path/p', 'proj_pending');
      const running = jobManager.createJob('/path/r', 'proj_running');
      testJobIds.push(pending, running);
      jobManager.startJob(running);
      const runningJobs = jobManager.listJobs('running');
      expect(runningJobs.some((j) => j.id === running)).toBe(true);
      expect(runningJobs.some((j) => j.id === pending)).toBe(false);
    });

    it('listJobs filters to completed jobs only', () => {
      const id = jobManager.createJob('/path', 'proj_comp');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.completeJob(id, { nodesImported: 0, edgesImported: 0, elapsedMs: 0 });
      const completed = jobManager.listJobs('completed');
      expect(completed.some((j) => j.id === id)).toBe(true);
    });

    it('listJobs filters to failed jobs only', () => {
      const id = jobManager.createJob('/path', 'proj_fail_list');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.failJob(id, 'broken');
      const failed = jobManager.listJobs('failed');
      expect(failed.some((j) => j.id === id)).toBe(true);
    });

    // ── cleanupOldJobs ─────────────────────────────────────────────────────

    it('cleanupOldJobs removes old completed jobs (maxAgeMs=-1 forces removal)', () => {
      const id = jobManager.createJob('/path', 'proj_cleanup1');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.completeJob(id, { nodesImported: 0, edgesImported: 0, elapsedMs: 0 });
      const cleaned = jobManager.cleanupOldJobs(-1);
      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(jobManager.getJob(id)).toBeUndefined();
    });

    it('cleanupOldJobs removes old failed jobs', () => {
      const id = jobManager.createJob('/path', 'proj_cleanup2');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.failJob(id, 'err');
      const cleaned = jobManager.cleanupOldJobs(-1);
      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(jobManager.getJob(id)).toBeUndefined();
    });

    it('cleanupOldJobs does not remove running jobs', () => {
      const id = jobManager.createJob('/path', 'proj_cleanup3');
      testJobIds.push(id);
      jobManager.startJob(id);
      jobManager.cleanupOldJobs(-1);
      // Running job survives cleanup
      expect(jobManager.getJob(id)).toBeDefined();
    });

    it('cleanupOldJobs does not remove pending jobs', () => {
      const id = jobManager.createJob('/path', 'proj_cleanup4');
      testJobIds.push(id);
      jobManager.cleanupOldJobs(-1);
      expect(jobManager.getJob(id)).toBeDefined();
    });

    it('cleanupOldJobs returns count of removed jobs', () => {
      const ids = Array.from({ length: 3 }, (_, i) =>
        jobManager.createJob(`/path/${i}`, `proj_count_${i}`),
      );
      testJobIds.push(...ids);
      for (const id of ids) {
        jobManager.startJob(id);
        jobManager.completeJob(id, { nodesImported: 0, edgesImported: 0, elapsedMs: 0 });
      }
      const cleaned = jobManager.cleanupOldJobs(-1);
      expect(cleaned).toBeGreaterThanOrEqual(3);
    });

    // ── scheduler ─────────────────────────────────────────────────────────

    it('stopCleanupScheduler is idempotent — calling twice does not throw', () => {
      expect(() => {
        jobManager.stopCleanupScheduler();
        jobManager.stopCleanupScheduler();
      }).not.toThrow();
    });

    it('cleanupOldJobs respects maxAgeMs threshold with fake timers', () => {
      vi.useFakeTimers();
      try {
        const id = jobManager.createJob('/path', 'proj_timer');
        testJobIds.push(id);
        jobManager.startJob(id);
        jobManager.completeJob(id, { nodesImported: 0, edgesImported: 0, elapsedMs: 0 });
        // At t=0, age=0ms — not old enough for maxAgeMs=1000
        const beforeAdvance = jobManager.cleanupOldJobs(1000);
        expect(beforeAdvance).toBe(0);
        // Advance 2 seconds — now age > 1000ms
        vi.advanceTimersByTime(2000);
        const afterAdvance = jobManager.cleanupOldJobs(1000);
        expect(afterAdvance).toBeGreaterThanOrEqual(1);
        expect(jobManager.getJob(id)).toBeUndefined();
        testJobIds = testJobIds.filter((i) => i !== id);
      } finally {
        vi.useRealTimers();
      }
    });

    it('job manager state remains consistent after scheduler is stopped', () => {
      jobManager.stopCleanupScheduler();
      const id = jobManager.createJob('/path/post-stop', 'proj_poststop');
      testJobIds.push(id);
      jobManager.startJob(id);
      expect(jobManager.getJob(id)?.status).toBe('running');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. cross-file-edge helpers
  // ─────────────────────────────────────────────────────────────────────────
  describe('cross-file-edge helpers', () => {

    let neo4j: { run: ReturnType<typeof vi.fn> } & Neo4jService;

    beforeEach(() => {
      neo4j = makeNeo4jMock() as any;
    });

    // ── saveEnrichmentProperties ──────────────────────────────────────────

    it('saveEnrichmentProperties calls neo4jService.run() once', async () => {
      neo4j.run.mockResolvedValue([]);
      await saveEnrichmentProperties(neo4j, ['/a.ts'], 'proj_1');
      expect(neo4j.run).toHaveBeenCalledTimes(1);
    });

    it('saveEnrichmentProperties passes filePaths and projectId to run()', async () => {
      neo4j.run.mockResolvedValue([]);
      await saveEnrichmentProperties(neo4j, ['/a.ts', '/b.ts'], 'proj_x');
      const [, params] = neo4j.run.mock.calls[0];
      expect(params).toMatchObject({ filePaths: ['/a.ts', '/b.ts'], projectId: 'proj_x' });
    });

    it('saveEnrichmentProperties returns an array', async () => {
      neo4j.run.mockResolvedValue([]);
      const result = await saveEnrichmentProperties(neo4j, [], 'proj_empty');
      expect(Array.isArray(result)).toBe(true);
    });

    it('saveEnrichmentProperties maps result rows to SavedEnrichmentData shape', async () => {
      neo4j.run.mockResolvedValue([
        { nodeId: 'n1', props: { riskTier: 'high', compositeRisk: 0.9 } },
      ]);
      const result = await saveEnrichmentProperties(neo4j, ['/x.ts'], 'proj_2');
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('nodeId', 'n1');
      expect(result[0]).toHaveProperty('properties');
      expect(typeof result[0].properties).toBe('object');
    });

    it('saveEnrichmentProperties filters null/undefined property values', async () => {
      neo4j.run.mockResolvedValue([
        { nodeId: 'n2', props: { riskTier: 'low', compositeRisk: null, churnTotal: undefined } },
      ]);
      const result = await saveEnrichmentProperties(neo4j, ['/y.ts'], 'proj_3');
      expect(result[0].properties).not.toHaveProperty('compositeRisk');
      expect(result[0].properties).not.toHaveProperty('churnTotal');
      expect(result[0].properties).toHaveProperty('riskTier', 'low');
    });

    // ── restoreEnrichmentProperties ───────────────────────────────────────

    it('restoreEnrichmentProperties returns 0 for empty input without calling run()', async () => {
      const count = await restoreEnrichmentProperties(neo4j, [], 'proj_1');
      expect(count).toBe(0);
      expect(neo4j.run).not.toHaveBeenCalled();
    });

    it('restoreEnrichmentProperties calls run() once per item', async () => {
      neo4j.run.mockResolvedValue([{ cnt: 1 }]);
      const saved = [
        { nodeId: 'n1', properties: { riskTier: 'high' } },
        { nodeId: 'n2', properties: { riskTier: 'medium' } },
      ];
      await restoreEnrichmentProperties(neo4j, saved, 'proj_2');
      expect(neo4j.run).toHaveBeenCalledTimes(2);
    });

    it('restoreEnrichmentProperties returns accumulated restored count', async () => {
      neo4j.run.mockResolvedValue([{ cnt: 1 }]);
      const saved = [
        { nodeId: 'n1', properties: { riskTier: 'high' } },
        { nodeId: 'n2', properties: { compositeRisk: 0.5 } },
      ];
      const count = await restoreEnrichmentProperties(neo4j, saved, 'proj_3');
      expect(count).toBe(2);
    });

    it('restoreEnrichmentProperties skips items with no properties', async () => {
      neo4j.run.mockResolvedValue([{ cnt: 1 }]);
      const saved = [
        { nodeId: 'n1', properties: {} },            // empty — should be skipped
        { nodeId: 'n2', properties: { riskTier: 'low' } },
      ];
      await restoreEnrichmentProperties(neo4j, saved, 'proj_4');
      // Only one run() call — empty-property item is skipped
      expect(neo4j.run).toHaveBeenCalledTimes(1);
    });

    it('restoreEnrichmentProperties passes nodeId and projectId to run()', async () => {
      neo4j.run.mockResolvedValue([{ cnt: 1 }]);
      const saved = [{ nodeId: 'node_abc', properties: { riskTier: 'critical' } }];
      await restoreEnrichmentProperties(neo4j, saved, 'proj_param_test');
      const [, params] = neo4j.run.mock.calls[0];
      expect(params).toMatchObject({ nodeId: 'node_abc', projectId: 'proj_param_test' });
    });

    // ── deleteSourceFileSubgraphs ─────────────────────────────────────────

    it('deleteSourceFileSubgraphs calls run() once', async () => {
      neo4j.run.mockResolvedValue([]);
      await deleteSourceFileSubgraphs(neo4j, ['/a.ts'], 'proj_del');
      expect(neo4j.run).toHaveBeenCalledTimes(1);
    });

    it('deleteSourceFileSubgraphs passes filePaths and projectId to run()', async () => {
      neo4j.run.mockResolvedValue([]);
      await deleteSourceFileSubgraphs(neo4j, ['/src/a.ts', '/src/b.ts'], 'proj_del2');
      const [, params] = neo4j.run.mock.calls[0];
      expect(params).toMatchObject({
        filePaths: ['/src/a.ts', '/src/b.ts'],
        projectId: 'proj_del2',
      });
    });

    // ── loadExistingNodesForEdgeDetection ─────────────────────────────────

    it('loadExistingNodesForEdgeDetection calls run() once', async () => {
      neo4j.run.mockResolvedValue([]);
      await loadExistingNodesForEdgeDetection(neo4j, ['/exclude.ts'], 'proj_load');
      expect(neo4j.run).toHaveBeenCalledTimes(1);
    });

    it('loadExistingNodesForEdgeDetection passes excludeFilePaths and projectId to run()', async () => {
      neo4j.run.mockResolvedValue([]);
      await loadExistingNodesForEdgeDetection(neo4j, ['/excl/a.ts'], 'proj_excl');
      const [, params] = neo4j.run.mock.calls[0];
      expect(params).toMatchObject({
        excludeFilePaths: ['/excl/a.ts'],
        projectId: 'proj_excl',
      });
    });

    it('loadExistingNodesForEdgeDetection returns the run() result as-is', async () => {
      const fakeNodes = [
        { id: 'n1', name: 'myFunc', filePath: '/a.ts' },
        { id: 'n2', name: 'MyClass', filePath: '/b.ts' },
      ];
      neo4j.run.mockResolvedValue(fakeNodes);
      const result = await loadExistingNodesForEdgeDetection(neo4j, [], 'proj_ret');
      expect(result).toEqual(fakeNodes);
    });

    // ── getCrossFileEdges ─────────────────────────────────────────────────

    it('getCrossFileEdges calls run() once', async () => {
      neo4j.run.mockResolvedValue([]);
      await getCrossFileEdges(neo4j, ['/a.ts'], 'proj_edges');
      expect(neo4j.run).toHaveBeenCalledTimes(1);
    });

    it('getCrossFileEdges passes filePaths and projectId to run()', async () => {
      neo4j.run.mockResolvedValue([]);
      await getCrossFileEdges(neo4j, ['/src/main.ts'], 'proj_ef');
      const [, params] = neo4j.run.mock.calls[0];
      expect(params).toMatchObject({
        filePaths: ['/src/main.ts'],
        projectId: 'proj_ef',
      });
    });

    it('getCrossFileEdges returns typed CrossFileEdge results', async () => {
      const fakeEdges = [
        {
          startNodeId: 'n1',
          endNodeId: 'n2',
          edgeType: 'CALLS',
          edgeProperties: { line: 42 },
        },
      ];
      neo4j.run.mockResolvedValue(fakeEdges);
      const result = await getCrossFileEdges(neo4j, ['/a.ts'], 'proj_typed');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        startNodeId: 'n1',
        endNodeId: 'n2',
        edgeType: 'CALLS',
      });
      expect(typeof result[0].edgeProperties).toBe('object');
    });

    it('getCrossFileEdges returns empty array when run() returns nothing', async () => {
      neo4j.run.mockResolvedValue([]);
      const result = await getCrossFileEdges(neo4j, ['/a.ts'], 'proj_empty');
      expect(result).toEqual([]);
    });
  });
});
