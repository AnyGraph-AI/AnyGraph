/**
 * AUD-TC-02 Batch 4 — Direct behavioral tests for 10 session/governance/context MCP tools.
 * Tests captured handler functions, not registration metadata.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// vi.hoisted — all mock fns created here survive hoisting
// ────────────────────────────────────────────────────────────────────────────
const {
  mockRun, mockClose,
  mockEmbedText,
  mockGTRuntimeRun,
  mockGenerateRecoveryAppendix,
  mockExistsSync,
  mockReadFileSync,
  mockResolveProjectIdOrError,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockEmbedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  mockGTRuntimeRun: vi.fn(),
  mockGenerateRecoveryAppendix: vi.fn().mockReturnValue([]),
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockResolveProjectIdOrError: vi.fn(async (projectId: string) => ({
    success: true,
    projectId,
  })),
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
    CREATE_SESSION_NOTES_VECTOR_INDEX: 'CREATE VECTOR INDEX IF NOT EXISTS ...',
  },
}));

vi.mock('../utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    debugLog: vi.fn(),
    resolveProjectIdOrError: mockResolveProjectIdOrError,
  };
});

vi.mock('../index.js', () => ({
  logToolCallStart: vi.fn().mockResolvedValue(1),
  logToolCallEnd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../constants.js', () => ({
  TOOL_NAMES: {
    saveSessionBookmark: 'save_session_bookmark',
    restoreSessionBookmark: 'restore_session_bookmark',
    saveSessionNote: 'save_session_note',
    recallSessionNotes: 'recall_session_notes',
    cleanupSession: 'cleanup_session',
    groundTruth: 'ground_truth',
  },
  TOOL_METADATA: new Proxy({}, {
    get: () => ({ title: 'Mock Title', description: 'Mock Description' }),
  }),
}));

vi.mock('../../../core/embeddings/embeddings.service.js', () => ({
  EmbeddingsService: vi.fn(function (this: any) {
    this.embedText = mockEmbedText;
  }),
}));

vi.mock('../../../core/ground-truth/runtime.js', () => ({
  GroundTruthRuntime: vi.fn(function (this: any) {
    this.run = mockGTRuntimeRun;
  }),
}));

vi.mock('../../../core/ground-truth/packs/software.js', () => ({
  SoftwareGovernancePack: vi.fn(function (this: any) {}),
}));

vi.mock('../../../core/ground-truth/delta.js', () => ({
  generateRecoveryAppendix: mockGenerateRecoveryAppendix,
}));

vi.mock('../../../core/ground-truth/types.js', () => ({}));

vi.mock('../../../utils/query-contract.js', () => ({
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST: 'MATCH (m:GovernanceMetricSnapshot) ...',
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND: 'MATCH (m:GovernanceMetricSnapshot) ...',
}));

// Mock fs for commit-audit-status
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  };
});

vi.mock('../../../core/utils/project-id.js', () => ({
  LIST_PROJECTS_QUERY: 'MATCH (p:Project) RETURN p',
  resolveProjectIdFromInput: vi.fn(async (id: string) => id),
}));

vi.mock('neo4j-driver', () => ({
  default: { int: (v: number) => v },
}));

vi.mock('../../../core/verification/sarif-importer.js', () => ({
  importSarifToVerificationBundle: vi.fn().mockResolvedValue({
    verificationRuns: [{ id: 'vr1' }],
    analysisScopes: [{ id: 'as1' }],
    adjudications: [],
  }),
}));

vi.mock('../../../core/verification/verification-ingest.js', () => ({
  ingestVerificationFoundation: vi.fn().mockResolvedValue({ nodesCreated: 5, edgesCreated: 3 }),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { createVerificationDashboardTools } from '../verification-dashboard.tool.js';
import { createSaveSessionBookmarkTool, createRestoreSessionBookmarkTool } from '../session-bookmark.tool.js';
import { createSaveSessionNoteTool, createRecallSessionNotesTool } from '../session-note.tool.js';
import { createCleanupSessionTool } from '../session-cleanup.tool.js';
import { createSessionContextSummaryTool } from '../session-context-summary.tool.js';
import { createGovernanceMetricsStatusTool } from '../governance-metrics.tool.js';
import { createCommitAuditStatusTool } from '../commit-audit-status.tool.js';
import { createParserContractStatusTool } from '../parser-contract.tool.js';
import { createRecommendationProofStatusTool } from '../recommendation-proof-status.tool.js';
import { createGroundTruthTool } from '../ground-truth.tool.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function textOf(result: any): string {
  return result?.content?.[0]?.text ?? '';
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════════════════
describe('[aud-tc-02] Batch 4 — session/governance/context MCP tools', () => {
  beforeEach(() => {
    registeredTools.clear();
    vi.clearAllMocks();
    // Reset mockRun's queued implementations to prevent bleed between tests
    mockRun.mockReset();
    mockClose.mockResolvedValue(undefined);
    mockEmbedText.mockResolvedValue([0.1, 0.2, 0.3]);
    mockGTRuntimeRun.mockReset();
    mockGenerateRecoveryAppendix.mockReturnValue([]);
  });

  // ── 1. verification_dashboard ─────────────────────────────────────────
  describe('verification_dashboard', () => {
    it('registers via server.tool', () => {
      createVerificationDashboardTools(mockServer as any);
      expect(registeredTools.has('verification_dashboard')).toBe(true);
    });

    it('returns dashboard with gate decisions and source families', async () => {
      mockRun
        .mockResolvedValueOnce([{ outcome: 'pass', cnt: 10 }, { outcome: 'fail', cnt: 2 }]) // gate
        .mockResolvedValueOnce([{ tool: 'eslint', status: 'pass', cnt: 5, avgConf: 0.85 }]) // families
        .mockResolvedValueOnce([{ capped: true, cnt: 1 }]) // anti-gaming
        .mockResolvedValueOnce([{ metric: 'brierScore', value: 0.12 }]) // calibration
        .mockResolvedValueOnce([{ withDebt: 3, avgDebt: 0.05, maxDebt: 0.1 }]) // debt
        .mockResolvedValueOnce([{ total: 20, withTCF: 15 }]); // TC

      createVerificationDashboardTools(mockServer as any);
      const result = await registeredTools.get('verification_dashboard')!({ projectId: 'proj_test' });
      const text = textOf(result);
      expect(text).toContain('Verification Dashboard');
      expect(text).toContain('pass: 10');
      expect(text).toContain('eslint');
      expect(text).toContain('Confidence Debt');
    });

    it('handles empty graph gracefully', async () => {
      mockRun
        .mockResolvedValueOnce([]) // gate
        .mockResolvedValueOnce([]) // families
        .mockResolvedValueOnce([]) // anti-gaming
        .mockResolvedValueOnce([]) // calibration
        .mockResolvedValueOnce([]) // debt
        .mockResolvedValueOnce([]); // TC

      createVerificationDashboardTools(mockServer as any);
      const result = await registeredTools.get('verification_dashboard')!({});
      const text = textOf(result);
      expect(text).toContain('No gate decisions found');
      expect(text).toContain('No verification runs found');
      expect(text).toContain('No confidence debt detected');
    });

    it('returns error response on Neo4j failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('DB gone'));

      createVerificationDashboardTools(mockServer as any);
      const result = await registeredTools.get('verification_dashboard')!({});
      const text = textOf(result);
      expect(text).toContain('Verification dashboard error');
    });
  });

  // ── 2. explainability_paths ───────────────────────────────────────────
  describe('explainability_paths', () => {
    it('registers via server.tool', () => {
      createVerificationDashboardTools(mockServer as any);
      expect(registeredTools.has('explainability_paths')).toBe(true);
    });

    it('returns paths for specific target', async () => {
      createVerificationDashboardTools(mockServer as any);
      // Stub all calls from verification_dashboard first (6), then explainability call
      mockRun.mockResolvedValue([{ hash: 'h1', weight: 0.9, rank: 1, source: 's1', target: 't1', type: 'support' }]);

      const result = await registeredTools.get('explainability_paths')!({
        targetId: 'vr_123',
      });
      const text = textOf(result);
      expect(text).toContain('Explainability Paths');
      expect(text).toContain('vr_123');
    });

    it('returns summary when no targetId', async () => {
      createVerificationDashboardTools(mockServer as any);
      mockRun.mockResolvedValueOnce([{ total: 42, avgWeight: 0.75, types: ['support', 'contradict'] }]);

      const result = await registeredTools.get('explainability_paths')!({});
      const text = textOf(result);
      expect(text).toContain('Total paths: 42');
    });

    it('handles empty paths', async () => {
      createVerificationDashboardTools(mockServer as any);
      mockRun.mockResolvedValueOnce([]);

      const result = await registeredTools.get('explainability_paths')!({});
      const text = textOf(result);
      expect(text).toContain('No influence paths found');
    });

    it('returns error on failure', async () => {
      createVerificationDashboardTools(mockServer as any);
      mockRun.mockRejectedValueOnce(new Error('timeout'));

      const result = await registeredTools.get('explainability_paths')!({});
      const text = textOf(result);
      expect(text).toContain('Explainability paths error');
    });
  });

  // ── 3. confidence_debt_dashboard ──────────────────────────────────────
  describe('confidence_debt_dashboard', () => {
    it('registers via server.tool', () => {
      createVerificationDashboardTools(mockServer as any);
      expect(registeredTools.has('confidence_debt_dashboard')).toBe(true);
    });

    it('returns debt breakdown by tool', async () => {
      createVerificationDashboardTools(mockServer as any);
      mockRun.mockResolvedValueOnce([
        { tool: 'eslint', status: 'pass', avgEC: 0.8, minEC: 0.3, maxEC: 1.0, cnt: 10, lowConf: 2 },
      ]);

      const result = await registeredTools.get('confidence_debt_dashboard')!({});
      const text = textOf(result);
      expect(text).toContain('Confidence Debt Dashboard');
      expect(text).toContain('eslint');
      expect(text).toContain('Low confidence');
    });

    it('handles no confidence data', async () => {
      createVerificationDashboardTools(mockServer as any);
      mockRun.mockResolvedValueOnce([]);

      const result = await registeredTools.get('confidence_debt_dashboard')!({});
      const text = textOf(result);
      expect(text).toContain('No confidence data found');
    });

    it('returns error on failure', async () => {
      createVerificationDashboardTools(mockServer as any);
      mockRun.mockRejectedValueOnce(new Error('fail'));

      const result = await registeredTools.get('confidence_debt_dashboard')!({});
      expect(textOf(result)).toContain('Confidence debt dashboard error');
    });
  });

  // ── 4. import_sarif ───────────────────────────────────────────────────
  describe('import_sarif', () => {
    it('registers via server.tool', () => {
      createVerificationDashboardTools(mockServer as any);
      expect(registeredTools.has('import_sarif')).toBe(true);
    });

    it('imports SARIF and returns counts', async () => {
      createVerificationDashboardTools(mockServer as any);
      const result = await registeredTools.get('import_sarif')!({
        filePath: '/tmp/test.sarif',
        projectId: 'proj_test',
      });
      const text = textOf(result);
      expect(text).toContain('SARIF Import Complete');
      expect(text).toContain('Verification Runs: 1');
      expect(text).toContain('Analysis Scopes: 1');
    });

    it('returns error when import fails', async () => {
      const { importSarifToVerificationBundle } = await import('../../../core/verification/sarif-importer.js');
      (importSarifToVerificationBundle as any).mockRejectedValueOnce(new Error('bad SARIF'));

      createVerificationDashboardTools(mockServer as any);
      const result = await registeredTools.get('import_sarif')!({
        filePath: '/tmp/bad.sarif',
      });
      expect(textOf(result)).toContain('SARIF import error');
    });
  });

  // ── 5. save_session_bookmark ──────────────────────────────────────────
  describe('save_session_bookmark', () => {
    it('registers via registerTool', () => {
      createSaveSessionBookmarkTool(mockServer as any);
      expect(registeredTools.has('save_session_bookmark')).toBe(true);
    });

    it('saves bookmark and returns success with linked nodes', async () => {
      mockRun.mockResolvedValueOnce([{
        id: 'bookmark_abc',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        summary: 'Working on auth',
        taskContext: 'Auth refactor',
        createdAt: 1234567890,
        linkedNodes: 3,
      }]);

      createSaveSessionBookmarkTool(mockServer as any);
      const result = await registeredTools.get('save_session_bookmark')!({
        projectId: 'proj_1',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        summary: 'Working on auth module',
        workingSetNodeIds: ['node1', 'node2', 'node3'],
        taskContext: 'Auth refactor',
      });
      const text = textOf(result);
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(true);
      expect(parsed.linkedNodes).toBe(3);
      expect(mockRun).toHaveBeenCalled();
    });

    it('returns error when graph write fails', async () => {
      mockRun.mockRejectedValueOnce(new Error('write failed'));

      createSaveSessionBookmarkTool(mockServer as any);
      const result = await registeredTools.get('save_session_bookmark')!({
        projectId: 'proj_1',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        summary: 'Some summary text',
        workingSetNodeIds: [],
        taskContext: 'task',
      });
      expect(textOf(result)).toContain('write failed');
    });

    it('returns error when no rows returned from create', async () => {
      mockRun.mockResolvedValueOnce([]);

      createSaveSessionBookmarkTool(mockServer as any);
      const result = await registeredTools.get('save_session_bookmark')!({
        projectId: 'proj_1',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        summary: 'Some summary text',
        workingSetNodeIds: [],
        taskContext: 'task',
      });
      expect(textOf(result)).toContain('Failed to create session bookmark');
    });

    it('closes Neo4jService in finally block', async () => {
      mockRun.mockResolvedValueOnce([{
        id: 'bm1', sessionId: 's', agentId: 'a', summary: 's',
        taskContext: 'tc', createdAt: 1, linkedNodes: 0,
      }]);

      createSaveSessionBookmarkTool(mockServer as any);
      await registeredTools.get('save_session_bookmark')!({
        projectId: 'proj_1',
        sessionId: 's',
        agentId: 'a',
        summary: 'Some summary text',
        workingSetNodeIds: [],
        taskContext: 'tc',
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 6. restore_session_bookmark ───────────────────────────────────────
  describe('restore_session_bookmark', () => {
    it('registers via registerTool', () => {
      createRestoreSessionBookmarkTool(mockServer as any);
      expect(registeredTools.has('restore_session_bookmark')).toBe(true);
    });

    it('restores bookmark with working set and notes', async () => {
      mockRun
        .mockResolvedValueOnce([{  // bookmark
          id: 'bm1', projectId: 'proj_1', sessionId: 's1', agentId: 'a1',
          summary: 'test', taskContext: 'ctx', findings: '', nextSteps: '',
          metadata: null, workingSetNodeIds: ['n1'],
          createdAt: 1000, updatedAt: 2000,
        }])
        .mockResolvedValueOnce([{  // working set
          id: 'n1', type: 'Function', name: 'foo', filePath: 'src/foo.ts',
          coreType: 'function', semanticType: null, startLine: 1, endLine: 10,
          sourceCode: 'function foo() {}',
        }])
        .mockResolvedValueOnce([]); // notes

      createRestoreSessionBookmarkTool(mockServer as any);
      const result = await registeredTools.get('restore_session_bookmark')!({
        projectId: 'proj_1',
        sessionId: 's1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.success).toBe(true);
      expect(parsed.workingSet).toHaveLength(1);
      expect(parsed.bookmark.id).toBe('bm1');
    });

    it('returns not-found message when no bookmark exists', async () => {
      mockRun.mockResolvedValueOnce([]); // no bookmark

      createRestoreSessionBookmarkTool(mockServer as any);
      const result = await registeredTools.get('restore_session_bookmark')!({
        projectId: 'proj_1',
        sessionId: 'nonexistent',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.success).toBe(false);
      expect(parsed.message).toContain('No bookmark found');
    });

    it('identifies stale node IDs', async () => {
      mockRun
        .mockResolvedValueOnce([{
          id: 'bm1', projectId: 'proj_1', sessionId: 's1', agentId: 'a1',
          summary: 'test', taskContext: 'ctx', findings: '', nextSteps: '',
          metadata: null, workingSetNodeIds: ['n1', 'n2_gone'],
          createdAt: 1000, updatedAt: 2000,
        }])
        .mockResolvedValueOnce([{  // only n1 found
          id: 'n1', type: 'Function', name: 'foo', filePath: 'src/foo.ts',
          coreType: 'function', semanticType: null, startLine: 1, endLine: 10,
        }])
        .mockResolvedValueOnce([]); // notes

      createRestoreSessionBookmarkTool(mockServer as any);
      const result = await registeredTools.get('restore_session_bookmark')!({
        projectId: 'proj_1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.staleNodeIds).toContain('n2_gone');
      expect(parsed.stats.workingSetStale).toBe(1);
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('DB error'));

      createRestoreSessionBookmarkTool(mockServer as any);
      const result = await registeredTools.get('restore_session_bookmark')!({
        projectId: 'proj_1',
      });
      expect(textOf(result)).toContain('DB error');
    });

    it('closes Neo4jService in finally block', async () => {
      mockRun.mockResolvedValueOnce([]); // no bookmark

      createRestoreSessionBookmarkTool(mockServer as any);
      await registeredTools.get('restore_session_bookmark')!({ projectId: 'proj_1' });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 7. save_session_note ──────────────────────────────────────────────
  describe('save_session_note', () => {
    it('registers via registerTool', () => {
      createSaveSessionNoteTool(mockServer as any);
      expect(registeredTools.has('save_session_note')).toBe(true);
    });

    it('saves note with embedding', async () => {
      mockRun
        .mockResolvedValueOnce([{ noteId: 'note_abc' }]) // create note
        .mockResolvedValueOnce([]) // vector index
        .mockResolvedValueOnce([{ noteId: 'note_abc' }]); // set embedding

      createSaveSessionNoteTool(mockServer as any);
      const result = await registeredTools.get('save_session_note')!({
        projectId: 'proj_1',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        topic: 'Auth bug',
        content: 'Found a race condition in token refresh',
        category: 'bug',
        severity: 'warning',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.success).toBe(true);
      expect(parsed.hasEmbedding).toBe(true);
      expect(parsed.category).toBe('bug');
      expect(mockEmbedText).toHaveBeenCalled();
    });

    it('saves note even if embedding fails (non-fatal)', async () => {
      mockRun
        .mockResolvedValueOnce([{ noteId: 'note_abc' }]) // create note
        .mockRejectedValueOnce(new Error('vector index fail')); // vector index fails
      mockEmbedText.mockRejectedValueOnce(new Error('embed fail'));

      createSaveSessionNoteTool(mockServer as any);
      const result = await registeredTools.get('save_session_note')!({
        projectId: 'proj_1',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        topic: 'Some topic here',
        content: 'Some content that is long enough',
        category: 'insight',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.success).toBe(true);
      expect(parsed.hasEmbedding).toBe(false);
    });

    it('returns error when create fails', async () => {
      mockRun.mockRejectedValueOnce(new Error('create failed'));

      createSaveSessionNoteTool(mockServer as any);
      const result = await registeredTools.get('save_session_note')!({
        projectId: 'proj_1',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        topic: 'Topic here',
        content: 'Content that is long enough',
        category: 'decision',
      });
      expect(textOf(result)).toContain('create failed');
    });

    it('returns error when no rows from create query', async () => {
      mockRun.mockResolvedValueOnce([]); // empty result

      createSaveSessionNoteTool(mockServer as any);
      const result = await registeredTools.get('save_session_note')!({
        projectId: 'proj_1',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        topic: 'Topic here',
        content: 'Content that is long enough',
        category: 'risk',
      });
      expect(textOf(result)).toContain('Failed to create session note');
    });

    it('closes Neo4jService in finally block', async () => {
      mockRun.mockResolvedValueOnce([{ noteId: 'n1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ noteId: 'n1' }]);

      createSaveSessionNoteTool(mockServer as any);
      await registeredTools.get('save_session_note')!({
        projectId: 'proj_1',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        topic: 'Topic here',
        content: 'Content that is long enough',
        category: 'todo',
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 8. recall_session_notes ───────────────────────────────────────────
  describe('recall_session_notes', () => {
    it('registers via registerTool', () => {
      createRecallSessionNotesTool(mockServer as any);
      expect(registeredTools.has('recall_session_notes')).toBe(true);
    });

    it('returns notes with filter-based search', async () => {
      mockRun.mockResolvedValueOnce([{
        id: 'note_1', topic: 'Auth bug', content: 'Race condition',
        category: 'bug', severity: 'warning', agentId: 'a1',
        sessionId: 's1', createdAt: 1000, expiresAt: null,
        relevance: null, aboutNodes: [],
      }]);

      createRecallSessionNotesTool(mockServer as any);
      const result = await registeredTools.get('recall_session_notes')!({
        projectId: 'proj_1',
        category: 'bug',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.searchMode).toBe('filter');
      expect(parsed.notes).toHaveLength(1);
      expect(parsed.notes[0].topic).toBe('Auth bug');
    });

    it('returns notes with semantic search when query provided', async () => {
      mockRun.mockResolvedValueOnce([{
        id: 'note_2', topic: 'Performance', content: 'Slow query',
        category: 'insight', severity: 'info', agentId: 'a1',
        sessionId: 's1', createdAt: 1000, expiresAt: null,
        relevance: 0.85, aboutNodes: [],
      }]);

      createRecallSessionNotesTool(mockServer as any);
      const result = await registeredTools.get('recall_session_notes')!({
        projectId: 'proj_1',
        query: 'slow performance',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.searchMode).toBe('semantic');
      expect(mockEmbedText).toHaveBeenCalledWith('slow performance');
    });

    it('returns empty notes array when none found', async () => {
      mockRun.mockResolvedValueOnce([]);

      createRecallSessionNotesTool(mockServer as any);
      const result = await registeredTools.get('recall_session_notes')!({
        projectId: 'proj_1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.count).toBe(0);
      expect(parsed.notes).toHaveLength(0);
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('query failed'));

      createRecallSessionNotesTool(mockServer as any);
      const result = await registeredTools.get('recall_session_notes')!({
        projectId: 'proj_1',
      });
      expect(textOf(result)).toContain('query failed');
    });

    it('closes Neo4jService in finally block', async () => {
      mockRun.mockResolvedValueOnce([]);

      createRecallSessionNotesTool(mockServer as any);
      await registeredTools.get('recall_session_notes')!({ projectId: 'proj_1' });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 9. cleanup_session ────────────────────────────────────────────────
  describe('cleanup_session', () => {
    it('registers via registerTool', () => {
      createCleanupSessionTool(mockServer as any);
      expect(registeredTools.has('cleanup_session')).toBe(true);
    });

    it('dry run reports counts without deleting', async () => {
      mockRun
        .mockResolvedValueOnce([{ count: 5 }])  // expired notes count
        .mockResolvedValueOnce([{ count: 2 }]); // old bookmarks count

      createCleanupSessionTool(mockServer as any);
      const result = await registeredTools.get('cleanup_session')!({
        projectId: 'proj_1',
        dryRun: true,
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.dryRun).toBe(true);
      expect(parsed.wouldDelete.expiredNotes).toBe(5);
      expect(parsed.wouldDelete.oldBookmarks).toBe(2);
    });

    it('actual cleanup deletes and reports', async () => {
      mockRun
        .mockResolvedValueOnce([{ deleted: 3 }])  // deleted notes
        .mockResolvedValueOnce([{ deleted: 1 }]); // deleted bookmarks

      createCleanupSessionTool(mockServer as any);
      const result = await registeredTools.get('cleanup_session')!({
        projectId: 'proj_1',
        dryRun: false,
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.success).toBe(true);
      expect(parsed.deleted.expiredNotes).toBe(3);
      expect(parsed.deleted.oldBookmarks).toBe(1);
    });

    it('reports nothing to clean', async () => {
      mockRun
        .mockResolvedValueOnce([{ deleted: 0 }])
        .mockResolvedValueOnce([{ deleted: 0 }]);

      createCleanupSessionTool(mockServer as any);
      const result = await registeredTools.get('cleanup_session')!({
        projectId: 'proj_1',
      });
      const parsed = JSON.parse(textOf(result));
      expect(parsed.message).toContain('Nothing to clean up');
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('delete failed'));

      createCleanupSessionTool(mockServer as any);
      const result = await registeredTools.get('cleanup_session')!({
        projectId: 'proj_1',
      });
      expect(textOf(result)).toContain('delete failed');
    });

    it('closes Neo4jService in finally block', async () => {
      mockRun
        .mockResolvedValueOnce([{ deleted: 0 }])
        .mockResolvedValueOnce([{ deleted: 0 }]);

      createCleanupSessionTool(mockServer as any);
      await registeredTools.get('cleanup_session')!({ projectId: 'proj_1' });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 10. session_context_summary ───────────────────────────────────────
  describe('session_context_summary', () => {
    it('registers via server.tool', () => {
      createSessionContextSummaryTool(mockServer as any);
      expect(registeredTools.has('session_context_summary')).toBe(true);
    });

    it('returns full summary with status counts and tasks', async () => {
      mockRun
        .mockResolvedValueOnce([{ inProgress: 3, blocked: 1, planned: 10, done: 5 }]) // status
        .mockResolvedValueOnce([{ projectId: 'plan_codegraph', task: 'Fix bug', line: 42, openDeps: 0 }]) // next
        .mockResolvedValueOnce([{ projectId: 'proj_1', runId: 'run1', finishedAt: '2026-03-28', headSha: 'abc123def456' }]); // recent

      createSessionContextSummaryTool(mockServer as any);
      const result = await registeredTools.get('session_context_summary')!({});
      const text = textOf(result);
      expect(text).toContain('Session Context Summary');
      expect(text).toContain('In progress: **3**');
      expect(text).toContain('Blocked: **1**');
      expect(text).toContain('Fix bug');
    });

    it('handles project filter', async () => {
      mockRun
        .mockResolvedValueOnce([{ inProgress: 1, blocked: 0, planned: 2, done: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      createSessionContextSummaryTool(mockServer as any);
      const result = await registeredTools.get('session_context_summary')!({
        projectFilter: 'codegraph',
      });
      const text = textOf(result);
      expect(text).toContain('Session Context Summary');
      expect(text).toContain('In progress: **1**');
    });

    it('handles empty graph', async () => {
      mockRun
        .mockResolvedValueOnce([{}]) // empty status (all undefined)
        .mockResolvedValueOnce([])    // no tasks
        .mockResolvedValueOnce([]);   // no runs

      createSessionContextSummaryTool(mockServer as any);
      const result = await registeredTools.get('session_context_summary')!({});
      const text = textOf(result);
      expect(text).toContain('In progress: **0**');
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('Neo4j down'));

      createSessionContextSummaryTool(mockServer as any);
      const result = await registeredTools.get('session_context_summary')!({});
      expect(textOf(result)).toContain('Neo4j down');
    });
  });

  // ── 11. governance_metrics_status ─────────────────────────────────────
  describe('governance_metrics_status', () => {
    it('registers via server.tool', () => {
      createGovernanceMetricsStatusTool(mockServer as any);
      expect(registeredTools.has('governance_metrics_status')).toBe(true);
    });

    it('returns latest snapshot', async () => {
      mockRun.mockResolvedValueOnce([{
        id: 'snap_1', timestamp: '2026-03-28T10:00:00Z', snapshotWindow: '7d',
        schemaVersion: '1.0', verificationRuns: 100, gateFailures: 5,
        failuresResolvedBeforeCommit: 3, preventedRuns: 2,
        preventedEdgesDiagnostic: 1, totalRegressionEvents: 4,
        regressionsAfterMerge: 1, interceptionRate: 0.95,
        operationalInterceptionRate: 0.92, invariantViolations: 0,
        falseCompletionEvents: 0, meanRecoveryRuns: 1.5,
      }]);

      createGovernanceMetricsStatusTool(mockServer as any);
      const result = await registeredTools.get('governance_metrics_status')!({});
      const text = textOf(result);
      expect(text).toContain('Governance Metrics (Latest)');
      expect(text).toContain('interceptionRate: 0.950000');
    });

    it('returns trend series', async () => {
      mockRun.mockResolvedValueOnce([
        { timestamp: 't1', interceptionRate: 0.9, gateFailures: 2, failuresResolvedBeforeCommit: 1, preventedRuns: 1, regressionsAfterMerge: 0, meanRecoveryRuns: 1.0 },
        { timestamp: 't2', interceptionRate: 0.95, gateFailures: 1, failuresResolvedBeforeCommit: 1, preventedRuns: 0, regressionsAfterMerge: 0, meanRecoveryRuns: 0.5 },
      ]);

      createGovernanceMetricsStatusTool(mockServer as any);
      const result = await registeredTools.get('governance_metrics_status')!({
        mode: 'trend',
        limit: 10,
      });
      const text = textOf(result);
      expect(text).toContain('Governance Metrics Trend');
      expect(text).toContain('Points returned: 2/2');
    });

    it('returns error when no snapshot found', async () => {
      mockRun.mockResolvedValueOnce([]);

      createGovernanceMetricsStatusTool(mockServer as any);
      const result = await registeredTools.get('governance_metrics_status')!({});
      expect(textOf(result)).toContain('No GovernanceMetricSnapshot found');
    });

    it('handles trend with no data', async () => {
      mockRun.mockResolvedValueOnce([]);

      createGovernanceMetricsStatusTool(mockServer as any);
      const result = await registeredTools.get('governance_metrics_status')!({
        mode: 'trend',
      });
      const text = textOf(result);
      expect(text).toContain('No metric snapshots found');
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('query fail'));

      createGovernanceMetricsStatusTool(mockServer as any);
      const result = await registeredTools.get('governance_metrics_status')!({});
      expect(textOf(result)).toContain('query fail');
    });
  });

  // ── 12. commit_audit_status ───────────────────────────────────────────
  describe('commit_audit_status', () => {
    it('registers via server.tool', () => {
      createCommitAuditStatusTool(mockServer as any);
      expect(registeredTools.has('commit_audit_status')).toBe(true);
    });

    it('returns all invariants from artifact', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        ok: true,
        generatedAt: '2026-03-28T10:00:00Z',
        baseRef: 'abc123',
        headRef: 'def456',
        commitCount: 5,
        changedFiles: ['src/foo.ts'],
        invariants: [
          { key: 'D1', ok: true, summary: 'Node count stable' },
          { key: 'D2', ok: false, summary: 'Edge count dropped' },
        ],
        failingInvariantKeys: ['D2'],
        confidence: 0.95,
        anomalyDeltas: [{ projectId: 'proj_1', nodeCountDelta: 10, edgeCountDelta: -5, unresolvedLocalDelta: 0, invariantViolationDelta: 0, duplicateSourceSuspicionDelta: 0 }],
        roadmapTaskLinks: [{ invariant: 'D2', task: 'Fix edges', line: 42 }],
      }));

      createCommitAuditStatusTool(mockServer as any);
      const result = await registeredTools.get('commit_audit_status')!({});
      const text = textOf(result);
      expect(text).toContain('Commit Audit Status');
      expect(text).toContain('✅ PASS');
      expect(text).toContain('D1');
      expect(text).toContain('D2');
      expect(text).toContain('Confidence: 0.95');
    });

    it('filters to failing only', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        ok: false,
        generatedAt: '2026-03-28',
        baseRef: 'a',
        headRef: 'b',
        commitCount: 1,
        changedFiles: [],
        invariants: [
          { key: 'D1', ok: true, summary: 'OK' },
          { key: 'D2', ok: false, summary: 'Fail' },
        ],
        failingInvariantKeys: ['D2'],
        confidence: 0.5,
        anomalyDeltas: [],
        roadmapTaskLinks: [],
      }));

      createCommitAuditStatusTool(mockServer as any);
      const result = await registeredTools.get('commit_audit_status')!({
        failingOnly: true,
      });
      const text = textOf(result);
      expect(text).toContain('❌ FAIL');
      expect(text).toContain('D2');
      expect(text).not.toContain('✅ D1');
    });

    it('returns error when artifact not found', async () => {
      mockExistsSync.mockReturnValue(false);

      createCommitAuditStatusTool(mockServer as any);
      const result = await registeredTools.get('commit_audit_status')!({});
      expect(textOf(result)).toContain('No commit audit artifact found');
    });

    it('includes changed files when requested', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({
        ok: true, generatedAt: 't', baseRef: 'a', headRef: 'b', commitCount: 1,
        changedFiles: ['src/foo.ts', 'src/bar.ts'],
        invariants: [], failingInvariantKeys: [], confidence: 1,
        anomalyDeltas: [], roadmapTaskLinks: [],
      }));

      createCommitAuditStatusTool(mockServer as any);
      const result = await registeredTools.get('commit_audit_status')!({
        includeChangedFiles: true,
      });
      const text = textOf(result);
      expect(text).toContain('Changed Files');
      expect(text).toContain('src/foo.ts');
      expect(text).toContain('src/bar.ts');
    });

    it('returns error on parse failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not json');

      createCommitAuditStatusTool(mockServer as any);
      const result = await registeredTools.get('commit_audit_status')!({});
      expect(textOf(result)).toBeTruthy(); // error response
    });
  });

  // ── 13. parser_contract_status ────────────────────────────────────────
  describe('parser_contract_status', () => {
    it('registers via server.tool', () => {
      createParserContractStatusTool(mockServer as any);
      expect(registeredTools.has('parser_contract_status')).toBe(true);
    });

    it('returns contract summary', async () => {
      mockRun
        .mockResolvedValueOnce([{ contractNodes: 10, outgoingEdges: 25 }]) // summary
        .mockResolvedValueOnce([{ stage: 'parse', count: 5 }, { stage: 'enrich', count: 5 }]); // by stage

      createParserContractStatusTool(mockServer as any);
      const result = await registeredTools.get('parser_contract_status')!({});
      const text = textOf(result);
      expect(text).toContain('Parser Contract Status');
      expect(text).toContain('Contract nodes: 10');
      expect(text).toContain('parse: 5');
    });

    it('returns blast radius for specific function', async () => {
      mockRun
        .mockResolvedValueOnce([{ contractNodes: 5, outgoingEdges: 10 }]) // summary
        .mockResolvedValueOnce([{ stage: 'parse', count: 5 }]) // by stage
        .mockResolvedValueOnce([ // blast radius
          { contract: 'parseTS', edgeType: 'PRODUCES', target: 'Function' },
          { contract: 'parseTS', edgeType: 'PRODUCES', target: 'Class' },
        ]);

      createParserContractStatusTool(mockServer as any);
      const result = await registeredTools.get('parser_contract_status')!({
        functionName: 'parseTS',
      });
      const text = textOf(result);
      expect(text).toContain('Blast radius');
      expect(text).toContain('PRODUCES');
      expect(text).toContain('Function');
    });

    it('handles empty blast radius', async () => {
      mockRun
        .mockResolvedValueOnce([{ contractNodes: 0, outgoingEdges: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      createParserContractStatusTool(mockServer as any);
      const result = await registeredTools.get('parser_contract_status')!({
        functionName: 'nonexistent',
      });
      const text = textOf(result);
      expect(text).toContain('No contract edges found');
    });

    it('handles empty graph', async () => {
      mockRun
        .mockResolvedValueOnce([{ contractNodes: 0, outgoingEdges: 0 }])
        .mockResolvedValueOnce([]);

      createParserContractStatusTool(mockServer as any);
      const result = await registeredTools.get('parser_contract_status')!({});
      const text = textOf(result);
      expect(text).toContain('Contract nodes: 0');
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('query error'));

      createParserContractStatusTool(mockServer as any);
      const result = await registeredTools.get('parser_contract_status')!({});
      expect(textOf(result)).toContain('Failed to query parser contract status');
    });
  });

  // ── 14. recommendation_proof_status ───────────────────────────────────
  describe('recommendation_proof_status', () => {
    it('registers via server.tool', () => {
      createRecommendationProofStatusTool(mockServer as any);
      expect(registeredTools.has('recommendation_proof_status')).toBe(true);
    });

    it('returns healthy status when all checks pass', async () => {
      const now = new Date().toISOString();
      mockRun
        .mockResolvedValueOnce([{ lastParsed: now }]) // freshness
        .mockResolvedValueOnce([{ totalInvariantTasks: 10, doneTasks: 5, doneWithoutProof: 0, proofWithoutDone: 0 }])
        .mockResolvedValueOnce([{ recommendedTasks: 5, doneRecommendedTasks: 0 }]);

      createRecommendationProofStatusTool(mockServer as any);
      const result = await registeredTools.get('recommendation_proof_status')!({});
      const text = textOf(result);
      expect(text).toContain('Recommendation-Proof Health');
      expect(text).toContain('✅ fresh');
      expect(text).toContain('✅ consistent');
    });

    it('detects stale freshness', async () => {
      const old = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 60 min ago
      mockRun
        .mockResolvedValueOnce([{ lastParsed: old }])
        .mockResolvedValueOnce([{ totalInvariantTasks: 0, doneTasks: 0, doneWithoutProof: 0, proofWithoutDone: 0 }])
        .mockResolvedValueOnce([{ recommendedTasks: 0, doneRecommendedTasks: 0 }]);

      createRecommendationProofStatusTool(mockServer as any);
      const result = await registeredTools.get('recommendation_proof_status')!({
        freshnessMaxMinutes: 30,
      });
      expect(textOf(result)).toContain('❌ stale');
    });

    it('detects done without proof mismatch', async () => {
      const now = new Date().toISOString();
      mockRun
        .mockResolvedValueOnce([{ lastParsed: now }])
        .mockResolvedValueOnce([{ totalInvariantTasks: 10, doneTasks: 3, doneWithoutProof: 2, proofWithoutDone: 0 }])
        .mockResolvedValueOnce([{ recommendedTasks: 5, doneRecommendedTasks: 0 }]);

      createRecommendationProofStatusTool(mockServer as any);
      const result = await registeredTools.get('recommendation_proof_status')!({});
      expect(textOf(result)).toContain('❌ mismatch');
      expect(textOf(result)).toContain('doneWithoutProof=2');
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('query error'));

      createRecommendationProofStatusTool(mockServer as any);
      const result = await registeredTools.get('recommendation_proof_status')!({});
      expect(textOf(result)).toContain('query error');
    });

    it('handles missing lastParsed', async () => {
      mockRun
        .mockResolvedValueOnce([{ lastParsed: null }])
        .mockResolvedValueOnce([{ totalInvariantTasks: 0, doneTasks: 0, doneWithoutProof: 0, proofWithoutDone: 0 }])
        .mockResolvedValueOnce([{ recommendedTasks: 0, doneRecommendedTasks: 0 }]);

      createRecommendationProofStatusTool(mockServer as any);
      const result = await registeredTools.get('recommendation_proof_status')!({});
      const text = textOf(result);
      expect(text).toContain('❌ stale');
      expect(text).toContain('missing');
    });
  });

  // ── 15. ground_truth ──────────────────────────────────────────────────
  describe('ground_truth', () => {
    const makeGTOutput = (overrides: any = {}) => ({
      panel1: {
        planStatus: [
          { source: 'Task', value: { done: 5, total: 10, pct: 50 }, tier: 'fast', freshnessState: 'fresh' },
          { source: 'Milestone', value: [{ name: 'M1', done: 3, total: 3 }, { name: 'M2', done: 1, total: 5 }], tier: 'fast', freshnessState: 'fresh' },
          { source: 'DEPENDS_ON', value: [{ task: 'Fix auth', milestone: 'M2' }], tier: 'fast', freshnessState: 'fresh' },
        ],
        governanceHealth: [
          { source: 'GovernanceMetricSnapshot', value: { verificationRuns: 100, gateFailures: 2 }, tier: 'fast', freshnessState: 'fresh' },
        ],
        evidenceCoverage: [
          { source: 'Evidence', value: { withEvidence: 4, total: 5, pct: 80 }, tier: 'fast', freshnessState: 'fresh' },
        ],
        contradictions: [],
        openHypotheses: [],
        integrity: {
          summary: { passed: 10, totalChecks: 10 },
          core: [],
          domain: [],
        },
      },
      panel2: {
        agentId: 'agent_1',
        status: 'active',
        currentTaskId: 'task_1',
        currentMilestone: 'M2',
      },
      panel3: {
        deltas: [],
      },
      meta: {
        projectId: 'proj_1',
        depth: 'fast',
        durationMs: 123,
        runAt: '2026-03-28T10:00:00Z',
      },
      ...overrides,
    });

    it('registers via registerTool', () => {
      createGroundTruthTool(mockServer as any);
      expect(registeredTools.has('ground_truth')).toBe(true);
    });

    it('returns three-panel output for fast depth', async () => {
      mockGTRuntimeRun.mockResolvedValueOnce(makeGTOutput());

      createGroundTruthTool(mockServer as any);
      const result = await registeredTools.get('ground_truth')!({
        projectId: 'proj_1',
      });
      const text = textOf(result);
      expect(text).toContain('GROUND TRUTH HOOK');
      expect(text).toContain('Panel 1A: Graph State');
      expect(text).toContain('Panel 2: Agent State');
      expect(text).toContain('Panel 3: Delta');
      expect(text).toContain('5/10 done');
    });

    it('maps full depth to heavy tier', async () => {
      mockGTRuntimeRun.mockResolvedValueOnce(makeGTOutput({
        meta: { projectId: 'proj_1', depth: 'heavy', durationMs: 500, runAt: '2026-03-28' },
      }));

      createGroundTruthTool(mockServer as any);
      await registeredTools.get('ground_truth')!({
        projectId: 'proj_1',
        depth: 'full',
      });
      expect(mockGTRuntimeRun).toHaveBeenCalledWith(expect.objectContaining({ depth: 'heavy' }));
    });

    it('shows recovery appendix when deltas exist', async () => {
      const output = makeGTOutput({
        panel3: {
          deltas: [{ tier: 'core', severity: 'warning', description: 'Edge count dropped' }],
        },
      });
      mockGTRuntimeRun.mockResolvedValueOnce(output);
      mockGenerateRecoveryAppendix.mockReturnValueOnce(['Run: npm run enrich:composite-risk']);

      createGroundTruthTool(mockServer as any);
      const result = await registeredTools.get('ground_truth')!({ projectId: 'proj_1' });
      const text = textOf(result);
      expect(text).toContain('Edge count dropped');
      expect(text).toContain('Recovery References');
      expect(text).toContain('npm run enrich:composite-risk');
    });

    it('shows contradictions and open hypotheses', async () => {
      const output = makeGTOutput();
      output.panel1.contradictions = [
        { source: 'c', value: { statement: 'A is true', contradiction: 'A is false' }, tier: 'medium', freshnessState: 'fresh' },
      ];
      output.panel1.openHypotheses = [
        { source: 'h', value: { name: 'H1', domain: 'code', severity: 'warning' }, tier: 'medium', freshnessState: 'fresh' },
      ];
      mockGTRuntimeRun.mockResolvedValueOnce(output);

      createGroundTruthTool(mockServer as any);
      const result = await registeredTools.get('ground_truth')!({ projectId: 'proj_1' });
      const text = textOf(result);
      expect(text).toContain('Contradictions');
      expect(text).toContain('A is true');
      expect(text).toContain('Open Hypotheses');
      expect(text).toContain('H1');
    });

    it('returns error on runtime failure', async () => {
      mockGTRuntimeRun.mockRejectedValueOnce(new Error('runtime crash'));

      createGroundTruthTool(mockServer as any);
      const result = await registeredTools.get('ground_truth')!({ projectId: 'proj_1' });
      expect(textOf(result)).toContain('runtime crash');
    });

    it('closes Neo4jService in finally block', async () => {
      mockGTRuntimeRun.mockResolvedValueOnce(makeGTOutput());

      createGroundTruthTool(mockServer as any);
      await registeredTools.get('ground_truth')!({ projectId: 'proj_1' });
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
