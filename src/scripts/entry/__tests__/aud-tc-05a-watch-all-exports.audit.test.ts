/**
 * AUD-TC-05a Task 02 — watch-all.ts Exported Functions Tests
 *
 * Tests for newly exported functions from watch-all.ts:
 *   - inferProjectKind:         code/document classification
 *   - discoverProjects:         queries Neo4j, returns ProjectInfo[]
 *   - waitForNeo4j:             retry logic, success/failure
 *   - reParsePlans:             calls plan parser with correct args
 *   - runPostParseEnrichment:   enrichment guard + script execution
 *   - watchPlansDir:            sets up fs watcher with debounce
 *   - startWatchingCode:        MCP client watch, dedup guard
 *   - startWatchingDocument:    fs watch + initial ingest, dedup guard
 *
 * NOTE: vi.mock paths in this test file use '../../../../' (4 levels up) to
 * reach the project root, because this test file is in __tests__/ which is
 * one level deeper than watch-all.ts itself (which uses '../../../').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock objects (before any vi.mock calls) ─────────────────────────
const {
  mockSession,
  mockDriver,
  mockFsWatch,
  mockExistsSync,
  mockParsePlanDir,
  mockIngestToNeo4j,
  mockEnrichCrossDomain,
  mockEmitContracts,
  mockExecFileAsync,
  mockParseDocumentCollection,
  mockDocumentSchemaToIr,
  mockMaterializeIrDocument,
  mockValidateProjectWrite,
  mockIncrementalRecompute,
  mockNeo4jServiceClose,
} = vi.hoisted(() => {
  const s = {
    run: vi.fn().mockResolvedValue({ records: [] }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const d = {
    session: vi.fn(() => s),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockSession: s,
    mockDriver: d,
    mockFsWatch: vi.fn(),
    mockExistsSync: vi.fn(),
    mockParsePlanDir: vi.fn(),
    mockIngestToNeo4j: vi.fn(),
    mockEnrichCrossDomain: vi.fn(),
    mockEmitContracts: vi.fn(),
    mockExecFileAsync: vi.fn(),
    mockParseDocumentCollection: vi.fn(),
    mockDocumentSchemaToIr: vi.fn(),
    mockMaterializeIrDocument: vi.fn(),
    mockValidateProjectWrite: vi.fn(),
    mockIncrementalRecompute: vi.fn(),
    mockNeo4jServiceClose: vi.fn().mockResolvedValue(undefined),
  };
});

// ─── Mocks (resolved relative to THIS test file; note ../../../../ = project root) ─
vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => mockDriver),
    auth: {
      basic: vi.fn((u: string, p: string) => ({ scheme: 'basic', principal: u, credentials: p })),
    },
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: mockExistsSync,
    watch: mockFsWatch,
  };
});

vi.mock('../../../../src/core/parsers/plan-parser.js', () => ({
  parsePlanDirectory: mockParsePlanDir,
  ingestToNeo4j: mockIngestToNeo4j,
  enrichCrossDomain: mockEnrichCrossDomain,
}));

vi.mock('../../../../src/core/parsers/meta/parser-contract-emitter.js', () => ({
  emitPlanParserContracts: mockEmitContracts,
}));

vi.mock('../../../../src/core/adapters/document/document-parser.js', () => ({
  parseDocumentCollection: mockParseDocumentCollection,
  documentSchemaToIr: mockDocumentSchemaToIr,
}));

vi.mock('../../../../src/core/guards/project-write-guard.js', () => ({
  validateProjectWrite: mockValidateProjectWrite,
}));

vi.mock('../../../../src/core/ir/ir-materializer.js', () => ({
  materializeIrDocument: mockMaterializeIrDocument,
}));

vi.mock('../../../../src/core/verification/incremental-recompute.js', () => ({
  incrementalRecompute: mockIncrementalRecompute,
}));

vi.mock('../../../../src/storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(() => ({ close: mockNeo4jServiceClose })),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn(() => mockExecFileAsync),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(),
}));

// ─── Module under test ────────────────────────────────────────────────────────
import {
  inferProjectKind,
  discoverProjects,
  waitForNeo4j,
  reParsePlans,
  runPostParseEnrichment,
  watchPlansDir,
  startWatchingCode,
  startWatchingDocument,
} from '../watch-all.js';

import * as watchAllModule from '../watch-all.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const makeRecord = (data: Record<string, unknown>) => ({
  get: (key: string) => data[key],
  keys: Object.keys(data),
});

// ─── Global beforeEach: restore safe defaults ─────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  // Restore safe return values after clearAllMocks
  mockSession.run.mockResolvedValue({ records: [] });
  mockSession.close.mockResolvedValue(undefined);
  mockDriver.close.mockResolvedValue(undefined);
  mockDriver.session.mockReturnValue(mockSession);
  mockNeo4jServiceClose.mockResolvedValue(undefined);
  // Reset mutable module state
  (watchAllModule as any)._state.enrichmentRunning = false;
  (watchAllModule as any)._state.planParsing = false;
  (watchAllModule as any)._state.planPendingReparse = false;
  (watchAllModule as any)._state.planParseTimer = null;
});

// ─── inferProjectKind ─────────────────────────────────────────────────────────
describe('[AUD-TC-05a-02] inferProjectKind — classification', () => {
  it('returns "code" when projectType is "code"', () => {
    expect(inferProjectKind('code', null, '/some/path')).toBe('code');
  });

  it('returns "code" when sourceKind is "code" (case-insensitive)', () => {
    expect(inferProjectKind(null, 'CODE', '/some/path')).toBe('code');
  });

  it('returns "document" when projectType is "document"', () => {
    expect(inferProjectKind('document', null, '/some/path')).toBe('document');
  });

  it('returns "document" when sourceKind is "document"', () => {
    expect(inferProjectKind(null, 'document', '/some/path')).toBe('document');
  });

  it('returns "code" when tsconfig file exists (and no explicit type set)', () => {
    mockExistsSync.mockReturnValue(true);
    expect(inferProjectKind(null, null, '/some/path', '/some/path/tsconfig.json')).toBe('code');
  });

  it('returns "document" when tsconfig does not exist and no explicit type', () => {
    mockExistsSync.mockReturnValue(false);
    expect(inferProjectKind(null, null, '/some/path', '/some/path/tsconfig.json')).toBe('document');
  });

  it('returns "document" (strongest signal) when sampleSourcePath is set, even if projectType is "code"', () => {
    expect(inferProjectKind('code', null, '/some/path', undefined, '/some/doc.md')).toBe('document');
  });

  it('returns "document" as default fallback when all signals are absent', () => {
    mockExistsSync.mockReturnValue(false);
    expect(inferProjectKind(null, null, '/some/path')).toBe('document');
  });
});

// ─── discoverProjects ─────────────────────────────────────────────────────────
describe('[AUD-TC-05a-02] discoverProjects — Neo4j query', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(true);
  });

  it('returns a ProjectInfo array from Neo4j records', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [
        makeRecord({
          pid: 'proj_abc123',
          name: 'Test Project',
          path: '/projects/test',
          projectType: 'code',
          sourceKind: null,
          sampleSourcePath: null,
        }),
      ],
    });

    const projects = await discoverProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].projectId).toBe('proj_abc123');
    expect(projects[0].name).toBe('Test Project');
    expect(projects[0].kind).toBe('code');
  });

  it('returns empty array when no records match', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });
    const projects = await discoverProjects();
    expect(projects).toEqual([]);
  });

  it('skips projects whose path does not exist on disk', async () => {
    mockExistsSync.mockReturnValue(false);
    mockSession.run.mockResolvedValueOnce({
      records: [
        makeRecord({
          pid: 'proj_missing',
          name: 'Missing',
          path: '/does/not/exist',
          projectType: null,
          sourceKind: null,
          sampleSourcePath: null,
        }),
      ],
    });
    const projects = await discoverProjects();
    expect(projects).toHaveLength(0);
  });

  it('skips plan projects (pid starts with plan_)', async () => {
    mockSession.run.mockResolvedValueOnce({
      records: [
        makeRecord({
          pid: 'plan_abc',
          name: 'A Plan',
          path: '/plans/abc',
          projectType: null,
          sourceKind: null,
          sampleSourcePath: null,
        }),
      ],
    });
    const projects = await discoverProjects();
    expect(projects).toHaveLength(0);
  });

  it('closes session and driver in finally block', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });
    await discoverProjects();
    expect(mockSession.close).toHaveBeenCalledOnce();
    expect(mockDriver.close).toHaveBeenCalledOnce();
  });

  it('passes MATCH query with knownIds parameter', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });
    await discoverProjects();
    const [query, params] = mockSession.run.mock.calls[0];
    expect(query).toContain('MATCH (p:Project)');
    expect(Array.isArray(params.knownIds)).toBe(true);
    expect(params.knownIds).toContain('proj_c0d3e9a1f200');
  });
});

// ─── waitForNeo4j ─────────────────────────────────────────────────────────────
describe('[AUD-TC-05a-02] waitForNeo4j — retry logic', () => {
  it('resolves immediately when Neo4j is available on first attempt', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });
    await expect(
      waitForNeo4j('bolt://localhost:7687', 'neo4j', 'test', 5, 0),
    ).resolves.toBeUndefined();
    expect(mockSession.run).toHaveBeenCalledOnce();
  });

  it('retries and succeeds after N failed attempts (with 0ms delay)', async () => {
    mockSession.run
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce({ records: [] });

    await expect(
      waitForNeo4j('bolt://localhost:7687', 'neo4j', 'test', 5, 0),
    ).resolves.toBeUndefined();
    expect(mockSession.run).toHaveBeenCalledTimes(3);
  });

  it('throws after maxRetries exhausted', async () => {
    mockSession.run.mockRejectedValue(new Error('Connection refused'));
    await expect(
      waitForNeo4j('bolt://localhost:7687', 'neo4j', 'test', 3, 0),
    ).rejects.toThrow('Neo4j did not become available');
    expect(mockSession.run).toHaveBeenCalledTimes(3);
  });

  it('uses the url, user, and password params passed in', async () => {
    mockSession.run.mockResolvedValueOnce({ records: [] });
    const neo4jModule = await import('neo4j-driver');
    await waitForNeo4j('bolt://custom-host:7687', 'admin', 'secret', 1, 0);
    expect(neo4jModule.default.driver).toHaveBeenCalledWith(
      'bolt://custom-host:7687',
      expect.objectContaining({ principal: 'admin', credentials: 'secret' }),
    );
  });
});

// ─── reParsePlans ─────────────────────────────────────────────────────────────
describe('[AUD-TC-05a-02] reParsePlans — plan parser invocation', () => {
  beforeEach(() => {
    mockParsePlanDir.mockResolvedValue([
      { projectId: 'plan_test', tasks: [], milestones: [] },
    ]);
    mockIngestToNeo4j.mockResolvedValue({ nodesUpserted: 5, staleRemoved: 1 });
    mockEnrichCrossDomain.mockResolvedValue({ evidenceEdges: 3, driftDetected: [] });
    mockEmitContracts.mockResolvedValue({ nodesUpserted: 2, edgesUpserted: 4 });
    mockIncrementalRecompute.mockResolvedValue({ updatedCount: 0 });
  });

  it('calls parsePlanDirectory with PLANS_ROOT', async () => {
    await reParsePlans();
    expect(mockParsePlanDir).toHaveBeenCalledOnce();
    const [calledPath] = mockParsePlanDir.mock.calls[0];
    expect(calledPath).toMatch(/plans$/);
  });

  it('calls ingestToNeo4j for each parsed result', async () => {
    mockParsePlanDir.mockResolvedValue([
      { projectId: 'plan_a', tasks: [] },
      { projectId: 'plan_b', tasks: [] },
    ]);
    await reParsePlans();
    expect(mockIngestToNeo4j).toHaveBeenCalledTimes(2);
  });

  it('calls enrichCrossDomain with parsed results', async () => {
    await reParsePlans();
    expect(mockEnrichCrossDomain).toHaveBeenCalledOnce();
    const [results] = mockEnrichCrossDomain.mock.calls[0];
    expect(Array.isArray(results)).toBe(true);
  });

  it('calls emitPlanParserContracts', async () => {
    await reParsePlans();
    expect(mockEmitContracts).toHaveBeenCalledOnce();
  });

  it('sets _planParsing=false after completion (state reset)', async () => {
    await reParsePlans();
    expect((watchAllModule as any)._state.planParsing).toBe(false);
  });

  it('queues a re-parse if called while already running', async () => {
    (watchAllModule as any)._state.planParsing = true;
    await reParsePlans();
    expect(mockParsePlanDir).not.toHaveBeenCalled();
    expect((watchAllModule as any)._state.planPendingReparse).toBe(true);
  });

  it('resets _planParsing to false even when parsePlanDirectory throws', async () => {
    mockParsePlanDir.mockRejectedValueOnce(new Error('parse failure'));
    await reParsePlans();
    expect((watchAllModule as any)._state.planParsing).toBe(false);
  });
});

// ─── runPostParseEnrichment ───────────────────────────────────────────────────
describe('[AUD-TC-05a-02] runPostParseEnrichment — enrichment guard', () => {
  it('skips execution if already running (_enrichmentRunning=true)', async () => {
    (watchAllModule as any)._state.enrichmentRunning = true;
    await runPostParseEnrichment('proj_test');
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it('resets _enrichmentRunning to false after completion', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });
    await runPostParseEnrichment('proj_test');
    expect((watchAllModule as any)._state.enrichmentRunning).toBe(false);
  });

  it('resets _enrichmentRunning to false even when a script fails', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('script failed'));
    await runPostParseEnrichment('proj_test');
    expect((watchAllModule as any)._state.enrichmentRunning).toBe(false);
  });
});

// ─── watchPlansDir ────────────────────────────────────────────────────────────
describe('[AUD-TC-05a-02] watchPlansDir — fs watcher setup', () => {
  it('calls fsWatch with recursive:true and pushes watcher to array', () => {
    const fakeWatcher = { close: vi.fn() };
    mockFsWatch.mockReturnValue(fakeWatcher);

    const watchers: any[] = [];
    watchPlansDir('/plans/dir', watchers, 1000);

    expect(mockFsWatch).toHaveBeenCalledWith('/plans/dir', { recursive: true }, expect.any(Function));
    expect(watchers).toHaveLength(1);
    expect(watchers[0]).toBe(fakeWatcher);
  });

  it('does not set a debounce timer for non-.md file changes', () => {
    let capturedCallback: Function | null = null;
    mockFsWatch.mockImplementation((_dir: string, _opts: any, cb: Function) => {
      capturedCallback = cb;
      return { close: vi.fn() };
    });

    const watchers: any[] = [];
    watchPlansDir('/plans/dir', watchers, 500);

    capturedCallback!('change', 'somefile.ts');
    // Timer should NOT be set for a non-.md change
    expect((watchAllModule as any)._state.planParseTimer).toBeNull();
  });

  it('sets debounce timer for .md file changes', () => {
    let capturedCallback: Function | null = null;
    mockFsWatch.mockImplementation((_dir: string, _opts: any, cb: Function) => {
      capturedCallback = cb;
      return { close: vi.fn() };
    });

    const watchers: any[] = [];
    watchPlansDir('/plans/dir', watchers, 60000); // long debounce so timer doesn't fire

    capturedCallback!('change', 'PLAN.md');
    expect((watchAllModule as any)._state.planParseTimer).not.toBeNull();

    // Cleanup
    clearTimeout((watchAllModule as any)._state.planParseTimer);
    (watchAllModule as any)._state.planParseTimer = null;
  });
});

// ─── startWatchingCode ────────────────────────────────────────────────────────
describe('[AUD-TC-05a-02] startWatchingCode — MCP client watch', () => {
  it('skips if projectId already in watchedCodeIds', async () => {
    const mockClient = { callTool: vi.fn() } as any;
    const watchedIds = new Set(['proj_already']);
    await startWatchingCode(
      { projectId: 'proj_already', name: 'X', path: '/x', kind: 'code' },
      mockClient,
      watchedIds,
    );
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  it('skips if tsconfigPath is missing or does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const mockClient = { callTool: vi.fn() } as any;
    const watchedIds = new Set<string>();
    await startWatchingCode(
      { projectId: 'proj_notsc', name: 'X', path: '/x', kind: 'code' },
      mockClient,
      watchedIds,
    );
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  it('calls start_watch_project and adds projectId to set on success', async () => {
    mockExistsSync.mockReturnValue(true);
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Watching' }] }),
    } as any;
    const watchedIds = new Set<string>();

    await startWatchingCode(
      {
        projectId: 'proj_new',
        name: 'New',
        path: '/new',
        tsconfigPath: '/new/tsconfig.json',
        kind: 'code',
      },
      mockClient,
      watchedIds,
    );

    expect(mockClient.callTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'start_watch_project' }),
    );
    expect(watchedIds.has('proj_new')).toBe(true);
  });
});

// ─── startWatchingDocument ────────────────────────────────────────────────────
describe('[AUD-TC-05a-02] startWatchingDocument — fs watcher + ingest', () => {
  beforeEach(() => {
    mockParseDocumentCollection.mockResolvedValue({
      documents: [],
      paragraphs: [],
      entities: [],
    });
    mockDocumentSchemaToIr.mockReturnValue({});
    mockMaterializeIrDocument.mockResolvedValue({ nodesCreated: 10, edgesCreated: 5 });
    mockValidateProjectWrite.mockResolvedValue(undefined);
    mockSession.run.mockResolvedValue({ records: [] });
    mockExistsSync.mockReturnValue(true);
  });

  it('skips if projectId already in documentWatchers', async () => {
    const docWatchers = new Map([['proj_already', {} as any]]);
    const docTimers = new Map<string, NodeJS.Timeout>();

    await startWatchingDocument(
      { projectId: 'proj_already', name: 'X', path: '/x', kind: 'document' },
      docWatchers,
      docTimers,
    );
    expect(mockParseDocumentCollection).not.toHaveBeenCalled();
  });

  it('calls parseDocumentCollection (initial ingest) on first watch', async () => {
    const fakeWatcher = { close: vi.fn() };
    mockFsWatch.mockReturnValue(fakeWatcher);

    const docWatchers = new Map<string, any>();
    const docTimers = new Map<string, NodeJS.Timeout>();

    await startWatchingDocument(
      { projectId: 'proj_doc', name: 'Doc', path: '/doc', kind: 'document' },
      docWatchers,
      docTimers,
    );

    expect(mockParseDocumentCollection).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj_doc' }),
    );
    expect(docWatchers.has('proj_doc')).toBe(true);
  });
});
