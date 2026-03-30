/**
 * AUD-TC-02 Batch 1 — Direct behavioral tests for 8 simple MCP tools.
 * Tests captured handler functions, not registration metadata.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// vi.hoisted — all mock fns created here survive hoisting
// ────────────────────────────────────────────────────────────────────────────
const {
  mockRun, mockClose, mockSessionRun, mockSessionClose,
  mockDriverClose, mockGetDriver,
  mockListWatchers, mockGetWatcherInfo, mockStopWatching,
  mockGetJob,
} = vi.hoisted(() => {
  const mockSessionRun = vi.fn();
  const mockSessionClose = vi.fn().mockResolvedValue(undefined);
  const mockDriverClose = vi.fn().mockResolvedValue(undefined);
  const mockGetDriver = vi.fn(() => ({
    session: () => ({ run: mockSessionRun, close: mockSessionClose }),
    close: mockDriverClose,
  }));
  return {
    mockRun: vi.fn(),
    mockClose: vi.fn().mockResolvedValue(undefined),
    mockSessionRun,
    mockSessionClose,
    mockDriverClose,
    mockGetDriver,
    mockListWatchers: vi.fn(),
    mockGetWatcherInfo: vi.fn(),
    mockStopWatching: vi.fn(),
    mockGetJob: vi.fn(),
  };
});

// ────────────────────────────────────────────────────────────────────────────
// Mocks (hoisted to top by Vitest)
// ────────────────────────────────────────────────────────────────────────────

// Capture registered handlers for BOTH registration patterns
const registeredTools = new Map<string, Function>();
const mockServer = {
  registerTool: vi.fn((name: string, _meta: any, handler: Function) => {
    registeredTools.set(name, handler);
  }),
  tool: vi.fn((name: string, _desc: any, _schema: any, handler: Function) => {
    registeredTools.set(name, handler);
  }),
};

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.close = mockClose;
    this.getDriver = mockGetDriver;
  }),
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
  };
});

vi.mock('../index.js', () => ({
  logToolCallStart: vi.fn().mockResolvedValue(1),
  logToolCallEnd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/watch-manager.js', () => ({
  watchManager: {
    listWatchers: mockListWatchers,
    getWatcherInfo: mockGetWatcherInfo,
    stopWatching: mockStopWatching,
  },
}));

vi.mock('../../services/job-manager.js', () => ({
  jobManager: { getJob: mockGetJob },
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

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { createHelloTool } from '../hello.tool.js';
import { createTestNeo4jConnectionTool } from '../test-neo4j-connection.tool.js';
import { createListProjectsTool } from '../list-projects.tool.js';
import { createListWatchersTool } from '../list-watchers.tool.js';
import { createStopWatchProjectTool } from '../stop-watch-project.tool.js';
import { createCheckParseStatusTool } from '../check-parse-status.tool.js';
import { createStateImpactTool } from '../state-impact.tool.js';
import { createRegistrationMapTool } from '../registration-map.tool.js';
import { logToolCallStart, logToolCallEnd } from '../index.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function textOf(result: any): string {
  return result?.content?.[0]?.text ?? '';
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════════════════
describe('[aud-tc-02] Batch 1 — simple MCP tools', () => {
  beforeEach(() => {
    registeredTools.clear();
    vi.clearAllMocks();
    // Restore default mockGetDriver behavior after per-test overrides
    mockGetDriver.mockImplementation(() => ({
      session: () => ({ run: mockSessionRun, close: mockSessionClose }),
      close: mockDriverClose,
    }));
  });

  // ── 1. hello ────────────────────────────────────────────────────────────
  describe('hello tool', () => {
    it('registers via registerTool', () => {
      createHelloTool(mockServer as any);
      expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('hello')).toBe(true);
    });

    it('handler returns a text content block', async () => {
      createHelloTool(mockServer as any);
      const result = await registeredTools.get('hello')!({});
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    it('response text contains the hello message', async () => {
      createHelloTool(mockServer as any);
      const result = await registeredTools.get('hello')!({});
      expect(textOf(result)).toContain('Hello from codebase MCP');
    });

    it('calls logToolCallStart and logToolCallEnd', async () => {
      createHelloTool(mockServer as any);
      await registeredTools.get('hello')!({});
      expect(logToolCallStart).toHaveBeenCalledWith('hello');
      expect(logToolCallEnd).toHaveBeenCalled();
    });

    it('logToolCallEnd receives success=true on success', async () => {
      createHelloTool(mockServer as any);
      await registeredTools.get('hello')!({});
      expect(logToolCallEnd).toHaveBeenCalledWith(
        'hello',
        expect.any(Number),
        true,
        expect.any(Number),
      );
    });
  });

  // ── 2. test-neo4j-connection ───────────────────────────────────────────
  describe('test-neo4j-connection tool', () => {
    it('registers via registerTool with correct name', () => {
      createTestNeo4jConnectionTool(mockServer as any);
      expect(registeredTools.has('test_neo4j_connection')).toBe(true);
    });

    it('returns success when Neo4j is reachable', async () => {
      mockSessionRun
        .mockResolvedValueOnce({
          records: [{
            get: (key: string) => key === 'message' ? 'Connected!' : '2026-01-01T00:00:00Z',
          }],
        })
        .mockResolvedValueOnce({
          records: [{ get: () => ({ toNumber: () => 42 }) }],
        })
        .mockResolvedValueOnce({
          records: [{
            get: (key: string) => key === 'nodes'
              ? { toNumber: () => 100 }
              : { toNumber: () => 200 },
          }],
        });

      createTestNeo4jConnectionTool(mockServer as any);
      const result = await registeredTools.get('test_neo4j_connection')!({});
      const text = textOf(result);
      expect(text).toContain('Neo4j connected');
      expect(text).toContain('100 nodes');
      expect(text).toContain('200 edges');
    });

    it('returns error response when connection fails', async () => {
      mockGetDriver.mockReturnValueOnce({
        session: () => ({
          run: vi.fn().mockRejectedValue(new Error('Connection refused')),
          close: mockSessionClose,
        }),
        close: mockDriverClose,
      });

      createTestNeo4jConnectionTool(mockServer as any);
      const result = await registeredTools.get('test_neo4j_connection')!({});
      const text = textOf(result);
      expect(text).toContain('Connection test failed');
      expect(text).toContain('Connection refused');
    });

    it('closes driver in finally block even on error', async () => {
      const localDriverClose = vi.fn().mockResolvedValue(undefined);
      mockGetDriver.mockReturnValueOnce({
        session: () => ({
          run: vi.fn().mockRejectedValue(new Error('fail')),
          close: mockSessionClose,
        }),
        close: localDriverClose,
      });

      createTestNeo4jConnectionTool(mockServer as any);
      await registeredTools.get('test_neo4j_connection')!({});
      expect(localDriverClose).toHaveBeenCalled();
    });

    it('handles APOC not installed gracefully', async () => {
      mockSessionRun
        .mockResolvedValueOnce({
          records: [{
            get: (key: string) => key === 'message' ? 'Connected!' : '2026-01-01',
          }],
        })
        .mockRejectedValueOnce(new Error('APOC not found'))
        .mockResolvedValueOnce({
          records: [{
            get: (key: string) => key === 'nodes'
              ? { toNumber: () => 10 }
              : { toNumber: () => 20 },
          }],
        });

      createTestNeo4jConnectionTool(mockServer as any);
      const result = await registeredTools.get('test_neo4j_connection')!({});
      const text = textOf(result);
      expect(text).toContain('APOC not installed');
      expect(text).not.toContain('ERROR');
    });
  });

  // ── 3. list-projects ──────────────────────────────────────────────────
  describe('list-projects tool', () => {
    it('registers via registerTool with correct name', () => {
      createListProjectsTool(mockServer as any);
      expect(registeredTools.has('list_projects')).toBe(true);
    });

    it('returns "No projects found" when graph is empty', async () => {
      mockRun.mockResolvedValueOnce([]);
      createListProjectsTool(mockServer as any);
      const result = await registeredTools.get('list_projects')!({});
      expect(textOf(result)).toContain('No projects found');
    });

    it('formats project list with name, ID, path', async () => {
      mockRun.mockResolvedValueOnce([{
        projectId: 'proj_abc123',
        name: 'my-app',
        path: '/home/user/my-app',
        status: 'complete',
        nodeCount: 50,
        edgeCount: 100,
        updatedAt: '2026-01-01',
      }]);

      createListProjectsTool(mockServer as any);
      const result = await registeredTools.get('list_projects')!({});
      const text = textOf(result);
      expect(text).toContain('1 project(s)');
      expect(text).toContain('my-app');
      expect(text).toContain('proj_abc123');
      expect(text).toContain('/home/user/my-app');
    });

    it('includes stats for complete projects', async () => {
      mockRun.mockResolvedValueOnce([{
        projectId: 'proj_1',
        name: 'app',
        path: '/app',
        status: 'complete',
        nodeCount: 42,
        edgeCount: 99,
        updatedAt: '2026-03-28',
      }]);

      createListProjectsTool(mockServer as any);
      const result = await registeredTools.get('list_projects')!({});
      const text = textOf(result);
      expect(text).toContain('42 nodes');
      expect(text).toContain('99 edges');
    });

    it('closes Neo4jService in finally block', async () => {
      mockRun.mockResolvedValueOnce([]);
      createListProjectsTool(mockServer as any);
      await registeredTools.get('list_projects')!({});
      expect(mockClose).toHaveBeenCalled();
    });

    it('closes Neo4jService even on error', async () => {
      mockRun.mockRejectedValueOnce(new Error('DB gone'));
      createListProjectsTool(mockServer as any);
      const result = await registeredTools.get('list_projects')!({});
      expect(textOf(result)).toContain('ERROR');
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 4. list-watchers ──────────────────────────────────────────────────
  describe('list-watchers tool', () => {
    it('registers via registerTool with correct name', () => {
      createListWatchersTool(mockServer as any);
      expect(registeredTools.has('list_watchers')).toBe(true);
    });

    it('returns "No active file watchers" when empty', async () => {
      mockListWatchers.mockReturnValue([]);
      createListWatchersTool(mockServer as any);
      const result = await registeredTools.get('list_watchers')!({});
      expect(textOf(result)).toContain('No active file watchers');
    });

    it('lists active watchers with details', async () => {
      mockListWatchers.mockReturnValue([{
        projectId: 'proj_xyz',
        projectPath: '/home/user/project',
        status: 'watching',
        debounceMs: 1000,
        pendingChanges: 3,
        lastUpdateTime: '2026-03-28T12:00:00Z',
        errorMessage: null,
      }]);

      createListWatchersTool(mockServer as any);
      const result = await registeredTools.get('list_watchers')!({});
      const text = textOf(result);
      expect(text).toContain('1 active watcher');
      expect(text).toContain('proj_xyz');
      expect(text).toContain('/home/user/project');
      expect(text).toContain('watching');
    });

    it('shows error message when watcher has one', async () => {
      mockListWatchers.mockReturnValue([{
        projectId: 'proj_err',
        projectPath: '/broken',
        status: 'error',
        debounceMs: 1000,
        pendingChanges: 0,
        lastUpdateTime: null,
        errorMessage: 'Permission denied',
      }]);

      createListWatchersTool(mockServer as any);
      const result = await registeredTools.get('list_watchers')!({});
      expect(textOf(result)).toContain('Permission denied');
    });

    it('returns error response when watchManager throws', async () => {
      mockListWatchers.mockImplementation(() => {
        throw new Error('Internal watch error');
      });

      createListWatchersTool(mockServer as any);
      const result = await registeredTools.get('list_watchers')!({});
      expect(textOf(result)).toContain('ERROR');
    });
  });

  // ── 5. stop-watch-project ─────────────────────────────────────────────
  describe('stop-watch-project tool', () => {
    it('registers via registerTool with correct name', () => {
      createStopWatchProjectTool(mockServer as any);
      expect(registeredTools.has('stop_watch_project')).toBe(true);
    });

    it('returns error when no watcher found for projectId', async () => {
      mockGetWatcherInfo.mockReturnValue(undefined);
      createStopWatchProjectTool(mockServer as any);
      const result = await registeredTools.get('stop_watch_project')!({
        projectId: 'proj_missing',
      });
      expect(textOf(result)).toContain('No active watcher found');
      expect(textOf(result)).toContain('proj_missing');
    });

    it('stops watcher and returns success', async () => {
      mockGetWatcherInfo.mockReturnValue({
        projectId: 'proj_abc',
        projectPath: '/home/user/app',
      });
      mockStopWatching.mockResolvedValue(true);

      createStopWatchProjectTool(mockServer as any);
      const result = await registeredTools.get('stop_watch_project')!({
        projectId: 'proj_abc',
      });
      const text = textOf(result);
      expect(text).toContain('stopped successfully');
      expect(text).toContain('proj_abc');
      expect(mockStopWatching).toHaveBeenCalledWith('proj_abc');
    });

    it('returns error when stopWatching returns false', async () => {
      mockGetWatcherInfo.mockReturnValue({
        projectId: 'proj_x',
        projectPath: '/x',
      });
      mockStopWatching.mockResolvedValue(false);

      createStopWatchProjectTool(mockServer as any);
      const result = await registeredTools.get('stop_watch_project')!({
        projectId: 'proj_x',
      });
      expect(textOf(result)).toContain('Failed to stop watcher');
    });

    it('returns error when stopWatching throws', async () => {
      mockGetWatcherInfo.mockReturnValue({
        projectId: 'proj_y',
        projectPath: '/y',
      });
      mockStopWatching.mockRejectedValue(new Error('OS error'));

      createStopWatchProjectTool(mockServer as any);
      const result = await registeredTools.get('stop_watch_project')!({
        projectId: 'proj_y',
      });
      expect(textOf(result)).toContain('ERROR');
    });
  });

  // ── 6. check-parse-status ─────────────────────────────────────────────
  describe('check-parse-status tool', () => {
    it('registers via registerTool with correct name', () => {
      createCheckParseStatusTool(mockServer as any);
      expect(registeredTools.has('check_parse_status')).toBe(true);
    });

    it('returns "Job not found" for unknown jobId', async () => {
      mockGetJob.mockReturnValue(undefined);
      createCheckParseStatusTool(mockServer as any);
      const result = await registeredTools.get('check_parse_status')!({
        jobId: 'job_nonexistent',
      });
      const text = textOf(result);
      expect(text).toContain('Job not found');
      expect(text).toContain('job_nonexistent');
    });

    it('returns progress for running job', async () => {
      mockGetJob.mockReturnValue({
        id: 'job_running',
        status: 'running',
        projectId: 'proj_1',
        progress: {
          phase: 'parsing',
          filesTotal: 100,
          filesProcessed: 50,
          nodesImported: 200,
          edgesImported: 80,
          currentChunk: 2,
          totalChunks: 5,
        },
      });

      createCheckParseStatusTool(mockServer as any);
      const result = await registeredTools.get('check_parse_status')!({
        jobId: 'job_running',
      });
      const text = textOf(result);
      expect(text).toContain('running');
      expect(text).toContain('50%');
      expect(text).toContain('parsing');
    });

    it('returns completion details for completed job', async () => {
      mockGetJob.mockReturnValue({
        id: 'job_done',
        status: 'completed',
        projectId: 'proj_1',
        progress: {
          phase: 'complete',
          filesTotal: 100,
          filesProcessed: 100,
          nodesImported: 500,
          edgesImported: 300,
          currentChunk: 5,
          totalChunks: 5,
        },
        result: {
          nodesImported: 500,
          edgesImported: 300,
          elapsedMs: 12345,
        },
      });

      createCheckParseStatusTool(mockServer as any);
      const result = await registeredTools.get('check_parse_status')!({
        jobId: 'job_done',
      });
      const text = textOf(result);
      expect(text).toContain('completed');
      expect(text).toContain('500');
      expect(text).toContain('300');
    });

    it('returns error message for failed job', async () => {
      mockGetJob.mockReturnValue({
        id: 'job_fail',
        status: 'failed',
        projectId: 'proj_1',
        progress: {
          phase: 'parsing',
          filesTotal: 10,
          filesProcessed: 3,
          nodesImported: 0,
          edgesImported: 0,
          currentChunk: 0,
          totalChunks: 0,
        },
        error: 'OOM: out of memory',
      });

      createCheckParseStatusTool(mockServer as any);
      const result = await registeredTools.get('check_parse_status')!({
        jobId: 'job_fail',
      });
      expect(textOf(result)).toContain('OOM: out of memory');
    });

    it('handles pending status', async () => {
      mockGetJob.mockReturnValue({
        id: 'job_pend',
        status: 'pending',
        projectId: 'proj_1',
        progress: {
          phase: 'pending',
          filesTotal: 0,
          filesProcessed: 0,
          nodesImported: 0,
          edgesImported: 0,
          currentChunk: 0,
          totalChunks: 0,
        },
      });

      createCheckParseStatusTool(mockServer as any);
      const result = await registeredTools.get('check_parse_status')!({
        jobId: 'job_pend',
      });
      expect(textOf(result)).toContain('pending');
    });
  });

  // ── 7. state-impact ───────────────────────────────────────────────────
  describe('state-impact tool', () => {
    it('registers via server.tool (not registerTool)', () => {
      createStateImpactTool(mockServer as any);
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('state_impact')).toBe(true);
    });

    it('lists all fields when fieldName is omitted', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'counter', role: 'state', readers: 3, writers: 1, raceRisk: false },
        { name: 'balance', role: 'state', readers: 2, writers: 2, raceRisk: true },
      ]);

      createStateImpactTool(mockServer as any);
      const result = await registeredTools.get('state_impact')!({
        projectId: 'proj_1',
      });
      const text = textOf(result);
      expect(text).toContain('State Fields');
      expect(text).toContain('counter');
      expect(text).toContain('balance');
    });

    it('shows race risk warning for multi-writer fields', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'shared', role: 'state', readers: 1, writers: 3, raceRisk: true },
      ]);

      createStateImpactTool(mockServer as any);
      const result = await registeredTools.get('state_impact')!({
        projectId: 'proj_1',
      });
      const text = textOf(result);
      expect(text).toContain('⚠️');
      expect(text).toContain('multiple writers');
    });

    it('returns "No state fields found" for empty graph', async () => {
      mockRun.mockResolvedValueOnce([]);

      createStateImpactTool(mockServer as any);
      const result = await registeredTools.get('state_impact')!({
        projectId: 'proj_1',
      });
      expect(textOf(result)).toContain('No state fields found');
    });

    it('shows readers and writers for specific field', async () => {
      // readers query
      mockRun.mockResolvedValueOnce([
        { name: 'handleBuy', file: 'src/handlers/buy.ts', tier: 'high', regKind: 'command', trigger: '/buy' },
      ]);
      // writers query
      mockRun.mockResolvedValueOnce([
        { name: 'processSell', file: 'src/handlers/sell.ts', tier: 'medium', regKind: 'callback', trigger: 'sell_confirm' },
      ]);

      createStateImpactTool(mockServer as any);
      const result = await registeredTools.get('state_impact')!({
        projectId: 'proj_1',
        fieldName: 'balance',
      });
      const text = textOf(result);
      expect(text).toContain('balance');
      expect(text).toContain('handleBuy');
      expect(text).toContain('processSell');
      expect(text).toContain('Readers');
      expect(text).toContain('Writers');
    });

    it('returns error response on Neo4j failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('Neo4j timeout'));

      createStateImpactTool(mockServer as any);
      const result = await registeredTools.get('state_impact')!({
        projectId: 'proj_1',
      });
      expect(textOf(result)).toContain('State impact query failed');
    });
  });

  // ── 8. registration-map ───────────────────────────────────────────────
  describe('registration-map tool', () => {
    it('registers via server.tool (not registerTool)', () => {
      createRegistrationMapTool(mockServer as any);
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('registration_map')).toBe(true);
    });

    it('lists all entrypoints when trigger is omitted', async () => {
      mockRun.mockResolvedValueOnce([{
        kind: 'command',
        trigger: '/start',
        framework: 'telegraf',
        handler: 'handleStart',
        file: 'src/bot/start.ts',
        tier: 'medium',
        callCount: 5,
        writesFields: ['sessionState'],
      }]);

      createRegistrationMapTool(mockServer as any);
      const result = await registeredTools.get('registration_map')!({
        projectId: 'proj_1',
      });
      const text = textOf(result);
      expect(text).toContain('Registration Map');
      expect(text).toContain('/start');
      expect(text).toContain('handleStart');
    });

    it('returns "No entrypoints found" for empty project', async () => {
      mockRun.mockResolvedValueOnce([]);

      createRegistrationMapTool(mockServer as any);
      const result = await registeredTools.get('registration_map')!({
        projectId: 'proj_1',
      });
      expect(textOf(result)).toContain('No entrypoints found');
    });

    it('shows detailed view for specific trigger', async () => {
      mockRun.mockResolvedValueOnce([{
        kind: 'command',
        trigger: 'buy',
        framework: 'telegraf',
        handlerName: 'handleBuy',
        handlerFile: 'src/bot/buy.ts',
        tier: 'high',
        lines: 45,
        callees: [{ name: 'executeTrade', file: 'src/trade.ts', tier: 'critical' }],
        reads: ['price'],
        writes: ['balance'],
      }]);

      createRegistrationMapTool(mockServer as any);
      const result = await registeredTools.get('registration_map')!({
        projectId: 'proj_1',
        trigger: '/buy',
      });
      const text = textOf(result);
      expect(text).toContain('handleBuy');
      expect(text).toContain('executeTrade');
      expect(text).toContain('Reads state');
      expect(text).toContain('Writes state');
    });

    it('returns "No entrypoint found matching" for unknown trigger', async () => {
      mockRun.mockResolvedValueOnce([]);

      createRegistrationMapTool(mockServer as any);
      const result = await registeredTools.get('registration_map')!({
        projectId: 'proj_1',
        trigger: '/nonexistent',
      });
      expect(textOf(result)).toContain('No entrypoint found matching');
    });

    it('returns error response on Neo4j failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('DB timeout'));

      createRegistrationMapTool(mockServer as any);
      const result = await registeredTools.get('registration_map')!({
        projectId: 'proj_1',
      });
      expect(textOf(result)).toContain('Registration map query failed');
    });
  });
});
