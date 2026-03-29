/**
 * AUD-TC-02 Batch 3 — Direct behavioral tests for edit/gate tools + multi-tool files.
 * Tests captured handler functions, not registration metadata.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// vi.hoisted — all mock fns created here survive hoisting
// ────────────────────────────────────────────────────────────────────────────
const {
  mockRun, mockClose,
  mockEmitTouched, mockCheckBookmarkWarnings,
  mockReadFileSync, mockWriteFileSync,
  mockParseChunk,
  mockResolveAffectedNodes, mockEvaluateEnforcementGate, mockResolveBlastRadius,
  mockGetAuditSummary, mockGenerateAgentPrompts, mockApplyVerdict, mockAuditEngineClose,
  mockEnsureSchema, mockGeneratePlanClaims, mockGenerateCodeClaims,
  mockGenerateCorpusClaims, mockRecomputeConfidence, mockClaimEngineClose,
} = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockEmitTouched: vi.fn().mockResolvedValue(undefined),
  mockCheckBookmarkWarnings: vi.fn().mockResolvedValue([]),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockParseChunk: vi.fn(),
  mockResolveAffectedNodes: vi.fn(),
  mockEvaluateEnforcementGate: vi.fn(),
  mockResolveBlastRadius: vi.fn(),
  mockGetAuditSummary: vi.fn(),
  mockGenerateAgentPrompts: vi.fn(),
  mockApplyVerdict: vi.fn(),
  mockAuditEngineClose: vi.fn().mockResolvedValue(undefined),
  mockEnsureSchema: vi.fn().mockResolvedValue(undefined),
  mockGeneratePlanClaims: vi.fn(),
  mockGenerateCodeClaims: vi.fn(),
  mockGenerateCorpusClaims: vi.fn(),
  mockRecomputeConfidence: vi.fn(),
  mockClaimEngineClose: vi.fn().mockResolvedValue(undefined),
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
}));

vi.mock('../../utils.js', async (importOriginal) => {
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

vi.mock('../../../core/ground-truth/warn-enforcement.js', () => ({
  checkBookmarkWarnings: mockCheckBookmarkWarnings,
}));

vi.mock('../../../core/ground-truth/observed-events.js', () => ({
  emitTouched: mockEmitTouched,
}));

vi.mock('../constants.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return actual;
});

// fs mock for simulate-edit
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
  };
});

// TypeScriptParser mock for simulate-edit
vi.mock('../../../core/parsers/typescript-parser.js', () => ({
  TypeScriptParser: vi.fn(function (this: any) {
    this.parseChunk = mockParseChunk;
  }),
}));

vi.mock('../../../core/config/schema.js', () => ({
  CORE_TYPESCRIPT_SCHEMA: { nodeTypes: [], edgeTypes: [] },
}));

// Enforcement gate mocks
vi.mock('../../../core/enforcement/enforcement-gate.js', () => ({
  evaluateEnforcementGate: mockEvaluateEnforcementGate,
  DEFAULT_CONFIG: { mode: 'enforced', blockOnCriticalUntested: true, requireApprovalOn: ['CRITICAL'] },
}));

vi.mock('../../../core/enforcement/graph-resolver.js', () => ({
  resolveAffectedNodes: mockResolveAffectedNodes,
  resolveBlastRadius: mockResolveBlastRadius,
}));

// Self-audit engine mock
vi.mock('../../../core/claims/self-audit.js', () => ({
  SelfAuditEngine: vi.fn(function (this: any) {
    this.getAuditSummary = mockGetAuditSummary;
    this.generateAgentPrompts = mockGenerateAgentPrompts;
    this.applyVerdict = mockApplyVerdict;
    this.close = mockAuditEngineClose;
  }),
  AuditVerdictRecord: {},
}));

// ClaimEngine mock
vi.mock('../../../core/claims/claim-engine.js', () => ({
  ClaimEngine: vi.fn(function (this: any) {
    this.ensureSchema = mockEnsureSchema;
    this.generatePlanClaims = mockGeneratePlanClaims;
    this.generateCodeClaims = mockGenerateCodeClaims;
    this.generateCorpusClaims = mockGenerateCorpusClaims;
    this.recomputeConfidence = mockRecomputeConfidence;
    this.close = mockClaimEngineClose;
  }),
}));

// neo4j-driver mock for neo4j.int()
vi.mock('neo4j-driver', () => ({
  default: {
    int: (v: number) => v,
  },
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { createPreEditCheckTool } from '../pre-edit-check.tool.js';
import { createSimulateEditTool } from '../simulate-edit.tool.js';
import { createEnforcementGateTool } from '../enforcement-gate.tool.js';
import { createSelfAuditTool } from '../self-audit.tool.js';
import { createPlanStatusTool } from '../plan-status.tool.js';
import { createPlanDriftTool } from '../plan-status.tool.js';
import { createPlanGapsTool } from '../plan-status.tool.js';
import { createPlanQueryTool } from '../plan-status.tool.js';
import { createPlanPriorityTool } from '../plan-status.tool.js';
import { createPlanNextTasksTool } from '../plan-status.tool.js';
import { createClaimStatusTool } from '../claim-tools.tool.js';
import { createEvidenceForTool } from '../claim-tools.tool.js';
import { createContradictionsTool } from '../claim-tools.tool.js';
import { createHypothesesTool } from '../claim-tools.tool.js';
import { createClaimChainPathTool } from '../claim-tools.tool.js';
import { createClaimGenerateTool } from '../claim-tools.tool.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function textOf(result: any): string {
  return result?.content?.[0]?.text ?? '';
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════════════════
describe('[aud-tc-02] Batch 3 — edit/gate tools + multi-tool files', () => {
  beforeEach(() => {
    registeredTools.clear();
    vi.clearAllMocks();
    mockCheckBookmarkWarnings.mockResolvedValue([]);
    mockEmitTouched.mockResolvedValue(undefined);
  });

  // ── 1. pre_edit_check ─────────────────────────────────────────────────
  describe('pre_edit_check tool', () => {
    it('registers via registerTool with correct name', () => {
      createPreEditCheckTool(mockServer as any);
      expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('pre_edit_check')).toBe(true);
    });

    it('returns SAFE verdict for low-risk function', async () => {
      // Function lookup
      mockRun.mockResolvedValueOnce([{
        name: 'simpleHelper',
        filePath: 'src/utils.ts',
        riskLevel: 5,
        riskTier: 'LOW',
        fanInCount: 1,
        fanOutCount: 2,
        lineCount: 10,
        isExported: false,
        isInnerFunction: false,
        labels: ['Function'],
      }]);
      // Callers
      mockRun.mockResolvedValueOnce([]);
      // State access
      mockRun.mockResolvedValueOnce([{ reads: [], writes: [] }]);
      // Co-changes
      mockRun.mockResolvedValueOnce([]);

      createPreEditCheckTool(mockServer as any);
      const result = await registeredTools.get('pre_edit_check')!({
        projectId: 'proj_1',
        functionName: 'simpleHelper',
      });
      const text = textOf(result);
      expect(text).toContain('SAFE');
      expect(text).toContain('simpleHelper');
      expect(text).toContain('LOW');
    });

    it('returns SIMULATE_FIRST verdict for CRITICAL risk function', async () => {
      mockRun.mockResolvedValueOnce([{
        name: 'processPayment',
        filePath: 'src/payment.ts',
        riskLevel: 95,
        riskTier: 'CRITICAL',
        fanInCount: 60,
        fanOutCount: 15,
        lineCount: 200,
        isExported: true,
        isInnerFunction: false,
        labels: ['Function'],
      }]);
      mockRun.mockResolvedValueOnce([
        { callerName: 'checkout', callerFile: 'src/checkout.ts' },
      ]);
      mockRun.mockResolvedValueOnce([{ reads: ['balance'], writes: ['balance', 'ledger'] }]);
      mockRun.mockResolvedValueOnce([]);

      createPreEditCheckTool(mockServer as any);
      const result = await registeredTools.get('pre_edit_check')!({
        projectId: 'proj_1',
        functionName: 'processPayment',
      });
      const text = textOf(result);
      expect(text).toContain('SIMULATE_FIRST');
      expect(text).toContain('CRITICAL');
      expect(text).toContain('simulate_edit');
    });

    it('emits TOUCHED edge on successful check', async () => {
      mockRun.mockResolvedValueOnce([{
        name: 'fn1',
        filePath: 'src/fn1.ts',
        riskLevel: 2,
        riskTier: 'LOW',
        fanInCount: 0,
        fanOutCount: 0,
        lineCount: 5,
        isExported: false,
        isInnerFunction: false,
        labels: ['Function'],
      }]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([{ reads: [], writes: [] }]);
      mockRun.mockResolvedValueOnce([]);

      createPreEditCheckTool(mockServer as any);
      await registeredTools.get('pre_edit_check')!({
        projectId: 'proj_1',
        functionName: 'fn1',
      });
      expect(mockEmitTouched).toHaveBeenCalledWith(
        expect.anything(),
        'src/fn1.ts',
        expect.objectContaining({ agentId: 'watson-main', projectId: 'proj_1' }),
      );
    });

    it('includes bookmark warnings when present', async () => {
      mockCheckBookmarkWarnings.mockResolvedValueOnce([
        { code: 'STALE_BOOKMARK', message: 'Bookmark is 2h old' },
      ]);
      mockRun.mockResolvedValueOnce([{
        name: 'fn2',
        filePath: 'src/fn2.ts',
        riskLevel: 3,
        riskTier: 'LOW',
        fanInCount: 0,
        fanOutCount: 0,
        lineCount: 5,
        isExported: false,
        isInnerFunction: false,
        labels: ['Function'],
      }]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([{ reads: [], writes: [] }]);
      mockRun.mockResolvedValueOnce([]);

      createPreEditCheckTool(mockServer as any);
      const result = await registeredTools.get('pre_edit_check')!({
        projectId: 'proj_1',
        functionName: 'fn2',
      });
      const text = textOf(result);
      expect(text).toContain('STALE_BOOKMARK');
      expect(text).toContain('Bookmark is 2h old');
    });

    it('returns error when function is not found', async () => {
      mockRun.mockResolvedValueOnce([]);

      createPreEditCheckTool(mockServer as any);
      const result = await registeredTools.get('pre_edit_check')!({
        projectId: 'proj_1',
        functionName: 'nonExistent',
      });
      const text = textOf(result);
      expect(text).toContain('not found');
      expect(text).toContain('nonExistent');
    });

    it('disambiguates when multiple functions match', async () => {
      mockRun.mockResolvedValueOnce([
        { name: 'init', filePath: 'src/a.ts', riskTier: 'LOW', labels: ['Function'] },
        { name: 'init', filePath: 'src/b.ts', riskTier: 'HIGH', labels: ['Function'] },
      ]);

      createPreEditCheckTool(mockServer as any);
      const result = await registeredTools.get('pre_edit_check')!({
        projectId: 'proj_1',
        functionName: 'init',
      });
      const text = textOf(result);
      expect(text).toContain('Multiple functions');
      expect(text).toContain('src/a.ts');
      expect(text).toContain('src/b.ts');
    });

    it('closes Neo4jService on error', async () => {
      mockRun.mockRejectedValueOnce(new Error('DB down'));

      createPreEditCheckTool(mockServer as any);
      await registeredTools.get('pre_edit_check')!({
        projectId: 'proj_1',
        functionName: 'fn',
      });
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 2. simulate_edit ──────────────────────────────────────────────────
  describe('simulate_edit tool', () => {
    it('registers via registerTool with correct name', () => {
      createSimulateEditTool(mockServer as any);
      expect(mockServer.registerTool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('simulate_edit')).toBe(true);
    });

    it('shows SAFE result when no external impact', async () => {
      // Project path
      mockRun.mockResolvedValueOnce([{ path: '/home/user/proj' }]);
      // Current nodes
      mockRun.mockResolvedValueOnce([
        { name: 'helperA', labels: ['Function', 'CodeNode'], isExported: false },
      ]);
      // Current calls
      mockRun.mockResolvedValueOnce([]);
      // External callers
      mockRun.mockResolvedValueOnce([]);

      mockReadFileSync.mockReturnValueOnce('const old = 1;');
      mockParseChunk.mockResolvedValueOnce({
        nodes: [
          { properties: { id: 'n1', name: 'helperA', filePath: 'utils.ts', isExported: false }, labels: ['Function', 'CodeNode'] },
          { properties: { id: 'n2', name: 'helperB', filePath: 'utils.ts', isExported: false }, labels: ['Function', 'CodeNode'] },
        ],
        edges: [],
      });

      createSimulateEditTool(mockServer as any);
      const result = await registeredTools.get('simulate_edit')!({
        projectId: 'proj_1',
        filePath: '/home/user/proj/src/utils.ts',
        modifiedContent: 'const newCode = 2;',
      });
      const text = textOf(result);
      expect(text).toContain('SAFE');
      expect(text).toContain('No external impact');
    });

    it('shows CRITICAL result when external callers will break', async () => {
      mockRun.mockResolvedValueOnce([{ path: '/home/user/proj' }]);
      // Current nodes: has exported fn
      mockRun.mockResolvedValueOnce([
        { name: 'publicApi', labels: ['Function', 'CodeNode'], isExported: true },
      ]);
      mockRun.mockResolvedValueOnce([]);
      // External callers depend on publicApi
      mockRun.mockResolvedValueOnce([
        { caller: 'consumer', callerFile: 'src/consumer.ts', target: 'publicApi' },
      ]);

      mockReadFileSync.mockReturnValueOnce('export function publicApi() {}');
      // Parse result: publicApi is removed
      mockParseChunk.mockResolvedValueOnce({ nodes: [], edges: [] });

      createSimulateEditTool(mockServer as any);
      const result = await registeredTools.get('simulate_edit')!({
        projectId: 'proj_1',
        filePath: '/home/user/proj/src/api.ts',
        modifiedContent: '// empty',
      });
      const text = textOf(result);
      expect(text).toContain('CRITICAL');
      expect(text).toContain('BROKEN CALLERS');
      expect(text).toContain('consumer');
    });

    it('returns error when file cannot be read', async () => {
      mockRun.mockResolvedValueOnce([{ path: '/home/user/proj' }]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([]);

      mockReadFileSync.mockImplementationOnce(() => {
        throw new Error('ENOENT: no such file');
      });

      createSimulateEditTool(mockServer as any);
      const result = await registeredTools.get('simulate_edit')!({
        projectId: 'proj_1',
        filePath: '/nonexistent/file.ts',
        modifiedContent: 'code',
      });
      const text = textOf(result);
      expect(text).toContain('ENOENT');
    });

    it('restores original file content after parsing', async () => {
      mockRun.mockResolvedValueOnce([{ path: '/home/user/proj' }]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([]);
      mockReadFileSync.mockReturnValueOnce('original content');
      mockParseChunk.mockResolvedValueOnce({ nodes: [], edges: [] });

      createSimulateEditTool(mockServer as any);
      await registeredTools.get('simulate_edit')!({
        projectId: 'proj_1',
        filePath: '/home/user/proj/src/file.ts',
        modifiedContent: 'modified content',
      });

      // First write: modified content; Second write: restore original
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      expect(mockWriteFileSync).toHaveBeenNthCalledWith(1,
        '/home/user/proj/src/file.ts', 'modified content');
      expect(mockWriteFileSync).toHaveBeenNthCalledWith(2,
        '/home/user/proj/src/file.ts', 'original content');
    });

    it('closes Neo4jService in finally block', async () => {
      mockRun.mockRejectedValueOnce(new Error('boom'));

      createSimulateEditTool(mockServer as any);
      await registeredTools.get('simulate_edit')!({
        projectId: 'proj_1',
        filePath: '/file.ts',
        modifiedContent: 'code',
      });
      expect(mockClose).toHaveBeenCalled();
    });

    it('shows added and removed nodes in diff', async () => {
      mockRun.mockResolvedValueOnce([{ path: '/proj' }]);
      mockRun.mockResolvedValueOnce([
        { name: 'oldFn', labels: ['Function', 'CodeNode'], isExported: false },
      ]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([]);

      mockReadFileSync.mockReturnValueOnce('function oldFn() {}');
      mockParseChunk.mockResolvedValueOnce({
        nodes: [
          { properties: { id: 'n1', name: 'newFn', filePath: 'app.ts', isExported: true }, labels: ['Function', 'CodeNode'] },
        ],
        edges: [],
      });

      createSimulateEditTool(mockServer as any);
      const result = await registeredTools.get('simulate_edit')!({
        projectId: 'proj_1',
        filePath: '/proj/src/app.ts',
        modifiedContent: 'function newFn() {}',
      });
      const text = textOf(result);
      expect(text).toContain('ADDED');
      expect(text).toContain('newFn');
      expect(text).toContain('REMOVED');
      expect(text).toContain('oldFn');
    });
  });

  // ── 3. enforceEdit ────────────────────────────────────────────────────
  describe('enforceEdit tool', () => {
    it('registers via server.tool with correct name', () => {
      createEnforcementGateTool(mockServer as any);
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('enforceEdit')).toBe(true);
    });

    it('returns ALLOW verdict for safe files', async () => {
      mockResolveAffectedNodes.mockResolvedValueOnce([
        { id: 'fn1', name: 'helper', riskTier: 'LOW', compositeRisk: 0.1, hasTests: true, filePath: 'src/util.ts' },
      ]);
      mockEvaluateEnforcementGate.mockReturnValueOnce({
        decision: 'ALLOW',
        reason: 'No critical functions affected',
        decisionHash: 'abc123',
        riskSummary: { totalAffected: 1, criticalCount: 0, highCount: 0, untestedCriticalCount: 0, maxCompositeRisk: 0.1 },
        approvalRequired: null,
      });

      createEnforcementGateTool(mockServer as any);
      const result = await registeredTools.get('enforceEdit')!({
        filePaths: ['src/util.ts'],
        projectId: 'proj_1',
      });
      const text = textOf(result);
      expect(text).toContain('ALLOW');
      expect(text).toContain('No critical functions');
    });

    it('returns REQUIRE_APPROVAL for critical functions', async () => {
      mockResolveAffectedNodes.mockResolvedValueOnce([
        { id: 'fn2', name: 'processPayment', riskTier: 'CRITICAL', compositeRisk: 0.95, hasTests: true, filePath: 'src/pay.ts' },
      ]);
      mockEvaluateEnforcementGate.mockReturnValueOnce({
        decision: 'REQUIRE_APPROVAL',
        reason: 'CRITICAL functions affected',
        decisionHash: 'def456',
        riskSummary: { totalAffected: 1, criticalCount: 1, highCount: 0, untestedCriticalCount: 0, maxCompositeRisk: 0.95 },
        approvalRequired: {
          requiredApprover: 'jonathan',
          affectedCriticalNodes: ['processPayment'],
          expiresAt: null,
        },
      });

      createEnforcementGateTool(mockServer as any);
      const result = await registeredTools.get('enforceEdit')!({
        filePaths: ['src/pay.ts'],
      });
      const text = textOf(result);
      expect(text).toContain('REQUIRE_APPROVAL');
      expect(text).toContain('processPayment');
      expect(text).toContain('jonathan');
    });

    it('returns BLOCK verdict for untested critical functions', async () => {
      mockResolveAffectedNodes.mockResolvedValueOnce([
        { id: 'fn3', name: 'deleteUser', riskTier: 'CRITICAL', compositeRisk: 0.99, hasTests: false, filePath: 'src/admin.ts' },
      ]);
      mockEvaluateEnforcementGate.mockReturnValueOnce({
        decision: 'BLOCK',
        reason: 'Untested CRITICAL function',
        decisionHash: 'ghi789',
        riskSummary: { totalAffected: 1, criticalCount: 1, highCount: 0, untestedCriticalCount: 1, maxCompositeRisk: 0.99 },
        approvalRequired: null,
      });

      createEnforcementGateTool(mockServer as any);
      const result = await registeredTools.get('enforceEdit')!({
        filePaths: ['src/admin.ts'],
      });
      const text = textOf(result);
      expect(text).toContain('BLOCK');
      expect(text).toContain('deleteUser');
    });

    it('includes blast radius when requested', async () => {
      mockResolveAffectedNodes.mockResolvedValueOnce([
        { id: 'fn4', name: 'coreLib', riskTier: 'HIGH', compositeRisk: 0.7, hasTests: true, filePath: 'src/core.ts' },
      ]);
      mockResolveBlastRadius.mockResolvedValueOnce([
        { name: 'downstream1', riskTier: 'MEDIUM', compositeRisk: 0.3 },
        { name: 'downstream2', riskTier: 'LOW', compositeRisk: 0.1 },
      ]);
      mockEvaluateEnforcementGate.mockReturnValueOnce({
        decision: 'ALLOW',
        reason: 'OK',
        decisionHash: 'xyz',
        riskSummary: { totalAffected: 1, criticalCount: 0, highCount: 1, untestedCriticalCount: 0, maxCompositeRisk: 0.7 },
        approvalRequired: null,
      });

      createEnforcementGateTool(mockServer as any);
      const result = await registeredTools.get('enforceEdit')!({
        filePaths: ['src/core.ts'],
        includeBlastRadius: true,
        maxBlastDepth: 2,
      });
      const text = textOf(result);
      expect(text).toContain('Blast Radius');
      expect(text).toContain('downstream1');
      expect(text).toContain('downstream2');
      expect(mockResolveBlastRadius).toHaveBeenCalledWith(
        expect.anything(), ['fn4'], expect.any(String), 2,
      );
    });

    it('passes affected nodes to evaluateEnforcementGate', async () => {
      const nodes = [
        { id: 'fn5', name: 'a', riskTier: 'LOW', compositeRisk: 0.1, hasTests: true, filePath: 'f.ts' },
      ];
      mockResolveAffectedNodes.mockResolvedValueOnce(nodes);
      mockEvaluateEnforcementGate.mockReturnValueOnce({
        decision: 'ALLOW',
        reason: 'ok',
        decisionHash: 'h',
        riskSummary: { totalAffected: 1, criticalCount: 0, highCount: 0, untestedCriticalCount: 0, maxCompositeRisk: 0.1 },
        approvalRequired: null,
      });

      createEnforcementGateTool(mockServer as any);
      await registeredTools.get('enforceEdit')!({ filePaths: ['f.ts'] });
      expect(mockEvaluateEnforcementGate).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'enforced' }),
        nodes,
      );
    });

    it('closes Neo4jService in finally block', async () => {
      mockResolveAffectedNodes.mockRejectedValueOnce(new Error('db error'));

      createEnforcementGateTool(mockServer as any);
      await expect(
        registeredTools.get('enforceEdit')!({ filePaths: ['x.ts'] }),
      ).rejects.toThrow();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  // ── 4. self_audit ─────────────────────────────────────────────────────
  describe('self_audit tool', () => {
    it('registers via server.tool with correct name', () => {
      createSelfAuditTool(mockServer as any);
      expect(mockServer.tool).toHaveBeenCalledTimes(1);
      expect(registeredTools.has('self_audit')).toBe(true);
    });

    it('summary action returns audit overview', async () => {
      mockGetAuditSummary.mockResolvedValueOnce({
        total: 10,
        byProject: {
          codegraph: { drift: 5, audited: 3, confirmed: 2, falsePositive: 1, partial: 0 },
          godspeed: { drift: 5, audited: 0, confirmed: 0, falsePositive: 0, partial: 0 },
        },
      });

      createSelfAuditTool(mockServer as any);
      const result = await registeredTools.get('self_audit')!({ action: 'summary' });
      const text = textOf(result);
      expect(text).toContain('10 drift items');
      expect(text).toContain('codegraph');
      expect(text).toContain('godspeed');
    });

    it('questions action returns audit questions', async () => {
      mockGenerateAgentPrompts.mockResolvedValueOnce({
        questions: [{
          driftItem: {
            taskName: 'Add logging',
            taskId: 'task-1',
            projectName: 'codegraph',
            matchedFunctions: [{ name: 'addLogger', refType: 'exact' }],
          },
          filesToRead: ['src/logger.ts'],
        }],
      });

      createSelfAuditTool(mockServer as any);
      const result = await registeredTools.get('self_audit')!({ action: 'questions' });
      const text = textOf(result);
      expect(text).toContain('1 audit questions');
      expect(text).toContain('Add logging');
      expect(text).toContain('src/logger.ts');
    });

    it('questions action returns empty message when no drift', async () => {
      mockGenerateAgentPrompts.mockResolvedValueOnce({ questions: [] });

      createSelfAuditTool(mockServer as any);
      const result = await registeredTools.get('self_audit')!({ action: 'questions' });
      expect(textOf(result)).toContain('No drift items');
    });

    it('verdict action applies verdict and returns confirmation', async () => {
      createSelfAuditTool(mockServer as any);
      const result = await registeredTools.get('self_audit')!({
        action: 'verdict',
        taskId: 'task-42',
        verdictType: 'CONFIRMED',
        confidence: 0.95,
        reasoning: 'Code matches task spec',
      });
      const text = textOf(result);
      expect(text).toContain('CONFIRMED');
      expect(text).toContain('task-42');
      expect(mockApplyVerdict).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-42',
          verdict: 'CONFIRMED',
          confidence: 0.95,
          reasoning: 'Code matches task spec',
        }),
      );
    });

    it('verdict action returns error when required fields missing', async () => {
      createSelfAuditTool(mockServer as any);
      const result = await registeredTools.get('self_audit')!({
        action: 'verdict',
        taskId: 'task-1',
        // Missing verdictType and reasoning
      });
      expect(textOf(result)).toContain('Error');
    });

    it('closes engine in finally block', async () => {
      mockGetAuditSummary.mockResolvedValueOnce({ total: 0, byProject: {} });

      createSelfAuditTool(mockServer as any);
      await registeredTools.get('self_audit')!({ action: 'summary' });
      expect(mockAuditEngineClose).toHaveBeenCalled();
    });
  });

  // ── 5. plan_status tools (6 tools) ────────────────────────────────────
  describe('plan_status tool', () => {
    it('registers via server.tool', () => {
      createPlanStatusTool(mockServer as any);
      expect(registeredTools.has('plan_status')).toBe(true);
    });

    it('returns formatted project status', async () => {
      mockRun.mockResolvedValueOnce([{
        project: 'codegraph',
        projectId: 'plan_codegraph',
        codeProject: 'proj_1',
        sourceFiles: 100,
        functions: 500,
        totalTasks: 50,
        doneTasks: 25,
        plannedTasks: 25,
        withEvidence: 20,
        milestoneCount: 5,
        doneMilestones: 2,
        decisionCount: 3,
        sprintCount: 4,
        completionPct: 50,
      }]);

      createPlanStatusTool(mockServer as any);
      const result = await registeredTools.get('plan_status')!({});
      const text = textOf(result);
      expect(text).toContain('codegraph');
      expect(text).toContain('50%');
      expect(text).toContain('25/50 done');
    });

    it('handles empty results', async () => {
      mockRun.mockResolvedValueOnce([]);

      createPlanStatusTool(mockServer as any);
      const result = await registeredTools.get('plan_status')!({});
      const text = textOf(result);
      expect(text).toContain('Plan Graph Status');
    });

    it('returns error on Neo4j failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('Neo4j down'));

      createPlanStatusTool(mockServer as any);
      const result = await registeredTools.get('plan_status')!({});
      expect(textOf(result)).toContain('Neo4j down');
    });

    it('filters by projectFilter', async () => {
      mockRun.mockResolvedValueOnce([{
        project: 'codegraph',
        projectId: 'plan_codegraph',
        codeProject: null,
        sourceFiles: 0,
        functions: 0,
        totalTasks: 10,
        doneTasks: 5,
        plannedTasks: 5,
        withEvidence: 3,
        milestoneCount: 0,
        doneMilestones: 0,
        decisionCount: 0,
        sprintCount: 0,
        completionPct: 50,
      }]);

      createPlanStatusTool(mockServer as any);
      await registeredTools.get('plan_status')!({ projectFilter: 'codegraph' });
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[1]).toEqual(expect.objectContaining({ ppid: 'plan_codegraph' }));
    });
  });

  describe('plan_drift tool', () => {
    it('registers via server.tool', () => {
      createPlanDriftTool(mockServer as any);
      expect(registeredTools.has('plan_drift')).toBe(true);
    });

    it('returns forgotten checkboxes', async () => {
      mockRun.mockResolvedValueOnce([{
        task: 'Add caching',
        project: 'plan_codegraph',
        file: 'plans/codegraph/PLAN.md',
        line: 42,
        codeFiles: ['src/cache.ts'],
      }]);
      mockRun.mockResolvedValueOnce([]);

      createPlanDriftTool(mockServer as any);
      const result = await registeredTools.get('plan_drift')!({});
      const text = textOf(result);
      expect(text).toContain('Likely Done');
      expect(text).toContain('Add caching');
    });

    it('returns phantom completions', async () => {
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([{
        task: 'Build API',
        project: 'plan_codegraph',
        file: 'plans/codegraph/PLAN.md',
        line: 10,
        refs: 'api.ts',
      }]);

      createPlanDriftTool(mockServer as any);
      const result = await registeredTools.get('plan_drift')!({});
      const text = textOf(result);
      expect(text).toContain('Possibly Reverted');
      expect(text).toContain('Build API');
    });

    it('reports no drift when clean', async () => {
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([]);

      createPlanDriftTool(mockServer as any);
      const result = await registeredTools.get('plan_drift')!({});
      expect(textOf(result)).toContain('No drift detected');
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('query failed'));

      createPlanDriftTool(mockServer as any);
      const result = await registeredTools.get('plan_drift')!({});
      expect(textOf(result)).toContain('query failed');
    });
  });

  describe('plan_gaps tool', () => {
    it('registers via server.tool', () => {
      createPlanGapsTool(mockServer as any);
      expect(registeredTools.has('plan_gaps')).toBe(true);
    });

    it('returns grouped gaps', async () => {
      mockRun.mockResolvedValueOnce([{
        task: 'Write docs',
        project: 'plan_codegraph',
        file: 'plans/codegraph/PLAN.md',
        section: 'sec1',
        line: 20,
        parentName: 'Documentation',
        loc: 100,
        risk: 'Low',
      }]);

      createPlanGapsTool(mockServer as any);
      const result = await registeredTools.get('plan_gaps')!({});
      const text = textOf(result);
      expect(text).toContain('Write docs');
      expect(text).toContain('Documentation');
      expect(text).toContain('~100 LOC');
    });

    it('reports no gaps when all tasks have evidence', async () => {
      mockRun.mockResolvedValueOnce([]);

      createPlanGapsTool(mockServer as any);
      const result = await registeredTools.get('plan_gaps')!({});
      expect(textOf(result)).toContain('No gaps');
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('timeout'));

      createPlanGapsTool(mockServer as any);
      const result = await registeredTools.get('plan_gaps')!({});
      expect(textOf(result)).toContain('timeout');
    });
  });

  describe('plan_query tool', () => {
    it('registers via server.tool', () => {
      createPlanQueryTool(mockServer as any);
      expect(registeredTools.has('plan_query')).toBe(true);
    });

    it('runs decisions preset', async () => {
      mockRun.mockResolvedValueOnce([{
        project: 'plan_codegraph',
        decision: 'Use TypeScript',
        choice: 'TypeScript',
        rationale: 'Type safety',
      }]);

      createPlanQueryTool(mockServer as any);
      const result = await registeredTools.get('plan_query')!({ preset: 'decisions' });
      const text = textOf(result);
      expect(text).toContain('Decisions');
      expect(text).toContain('Use TypeScript');
    });

    it('runs summary preset', async () => {
      mockRun.mockResolvedValueOnce([{
        project: 'codegraph',
        total: 50,
        done: 25,
        pct: 50,
      }]);

      createPlanQueryTool(mockServer as any);
      const result = await registeredTools.get('plan_query')!({ preset: 'summary' });
      const text = textOf(result);
      expect(text).toContain('Summary');
      expect(text).toContain('codegraph');
    });

    it('returns error when custom preset lacks cypher', async () => {
      createPlanQueryTool(mockServer as any);
      const result = await registeredTools.get('plan_query')!({ preset: 'custom' });
      expect(textOf(result)).toContain('requires a cypher parameter');
    });

    it('executes custom cypher query', async () => {
      mockRun.mockResolvedValueOnce([{ name: 'task1', status: 'done' }]);

      createPlanQueryTool(mockServer as any);
      const result = await registeredTools.get('plan_query')!({
        preset: 'custom',
        cypher: 'MATCH (t:Task) RETURN t.name AS name, t.status AS status LIMIT 1',
      });
      const text = textOf(result);
      expect(text).toContain('task1');
    });

    it('handles empty results', async () => {
      mockRun.mockResolvedValueOnce([]);

      createPlanQueryTool(mockServer as any);
      const result = await registeredTools.get('plan_query')!({ preset: 'milestones' });
      expect(textOf(result)).toContain('No results');
    });
  });

  describe('plan_priority tool', () => {
    it('registers via server.tool', () => {
      createPlanPriorityTool(mockServer as any);
      expect(registeredTools.has('plan_priority')).toBe(true);
    });

    it('returns priority-ranked tasks when fresh', async () => {
      // Freshness check
      mockRun.mockResolvedValueOnce([{
        projectId: 'plan_codegraph',
        lastParsed: new Date().toISOString(),
      }]);
      // Priority query
      mockRun.mockResolvedValueOnce([{
        task: 'Build parser',
        milestone: 'Core',
        project: 'plan_codegraph',
        priority: 30,
        unblocksMilestones: 3,
        unblocksDownstreamTasks: 10,
        hasEvidence: false,
      }]);

      createPlanPriorityTool(mockServer as any);
      const result = await registeredTools.get('plan_priority')!({ allowStale: false });
      const text = textOf(result);
      expect(text).toContain('Build parser');
      expect(text).toContain('Core');
      expect(text).toContain('30pts');
    });

    it('returns freshness error when plans are stale', async () => {
      mockRun.mockResolvedValueOnce([{
        projectId: 'plan_codegraph',
        lastParsed: '2020-01-01T00:00:00Z',
      }]);

      createPlanPriorityTool(mockServer as any);
      const result = await registeredTools.get('plan_priority')!({});
      expect(textOf(result)).toContain('PLAN_FRESHNESS_GUARD_FAILED');
    });

    it('bypasses freshness check with allowStale', async () => {
      mockRun.mockResolvedValueOnce([{
        task: 'Quick task',
        milestone: 'M1',
        project: 'plan_codegraph',
        priority: 5,
        unblocksMilestones: 0,
        unblocksDownstreamTasks: 0,
        hasEvidence: true,
      }]);

      createPlanPriorityTool(mockServer as any);
      const result = await registeredTools.get('plan_priority')!({ allowStale: true });
      const text = textOf(result);
      expect(text).toContain('Quick task');
    });

    it('returns error on query failure', async () => {
      mockRun.mockResolvedValueOnce([{
        projectId: 'plan_codegraph',
        lastParsed: new Date().toISOString(),
      }]);
      mockRun.mockRejectedValueOnce(new Error('Neo4j OOM'));

      createPlanPriorityTool(mockServer as any);
      const result = await registeredTools.get('plan_priority')!({});
      expect(textOf(result)).toContain('Neo4j OOM');
    });
  });

  describe('plan_next_tasks tool', () => {
    it('registers via server.tool', () => {
      createPlanNextTasksTool(mockServer as any);
      expect(registeredTools.has('plan_next_tasks')).toBe(true);
    });

    it('returns ready and blocked tasks', async () => {
      // Freshness check
      mockRun.mockResolvedValueOnce([{
        projectId: 'plan_codegraph',
        lastParsed: new Date().toISOString(),
      }]);
      // Next tasks
      mockRun.mockResolvedValueOnce([
        {
          project: 'plan_codegraph',
          parent: 'Core System',
          task: 'Add parser',
          line: 10,
          totalDeps: 0,
          openDeps: 0,
          depNames: [],
          blocksCount: 5,
          ready: true,
        },
        {
          project: 'plan_codegraph',
          parent: 'UI',
          task: 'Build dashboard',
          line: 20,
          totalDeps: 2,
          openDeps: 1,
          depNames: ['Add parser'],
          blocksCount: 0,
          ready: false,
        },
      ]);

      createPlanNextTasksTool(mockServer as any);
      const result = await registeredTools.get('plan_next_tasks')!({ allowStale: false });
      const text = textOf(result);
      expect(text).toContain('Add parser');
      expect(text).toContain('Build dashboard');
      expect(text).toContain('✅');
      expect(text).toContain('⛔');
    });

    it('returns freshness error when stale', async () => {
      mockRun.mockResolvedValueOnce([{
        projectId: 'plan_codegraph',
        lastParsed: '2020-01-01T00:00:00Z',
      }]);

      createPlanNextTasksTool(mockServer as any);
      const result = await registeredTools.get('plan_next_tasks')!({});
      expect(textOf(result)).toContain('PLAN_FRESHNESS_GUARD_FAILED');
    });

    it('returns no tasks message when empty', async () => {
      mockRun.mockResolvedValueOnce([{
        projectId: 'plan_codegraph',
        lastParsed: new Date().toISOString(),
      }]);
      mockRun.mockResolvedValueOnce([]);

      createPlanNextTasksTool(mockServer as any);
      const result = await registeredTools.get('plan_next_tasks')!({});
      expect(textOf(result)).toContain('No planned tasks');
    });

    it('returns error on query failure', async () => {
      mockRun.mockResolvedValueOnce([{
        projectId: 'plan_codegraph',
        lastParsed: new Date().toISOString(),
      }]);
      mockRun.mockRejectedValueOnce(new Error('db fail'));

      createPlanNextTasksTool(mockServer as any);
      const result = await registeredTools.get('plan_next_tasks')!({});
      expect(textOf(result)).toContain('db fail');
    });
  });

  // ── 6. claim tools (6 tools) ─────────────────────────────────────────
  describe('claim_status tool', () => {
    it('registers via server.tool', () => {
      createClaimStatusTool(mockServer as any);
      expect(registeredTools.has('claim_status')).toBe(true);
    });

    it('returns claim overview by domain', async () => {
      mockRun.mockResolvedValueOnce([{
        domain: 'code',
        total: 100,
        supported: 60,
        contested: 10,
        asserted: 25,
        refuted: 5,
        avgConf: 0.82,
      }]);
      mockRun.mockResolvedValueOnce([{
        type: 'function_risk',
        cnt: 80,
        avgConf: 0.85,
      }]);
      mockRun.mockResolvedValueOnce([{ evCount: 200, hypCount: 15 }]);

      createClaimStatusTool(mockServer as any);
      const result = await registeredTools.get('claim_status')!({});
      const text = textOf(result);
      expect(text).toContain('code');
      expect(text).toContain('100 claims');
      expect(text).toContain('Supported: 60');
      expect(text).toContain('Evidence nodes: 200');
      expect(text).toContain('Hypotheses: 15');
    });

    it('filters by domain', async () => {
      mockRun.mockResolvedValueOnce([{
        domain: 'plan',
        total: 20,
        supported: 10,
        contested: 5,
        asserted: 3,
        refuted: 2,
        avgConf: 0.7,
      }]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([{ evCount: 0, hypCount: 0 }]);

      createClaimStatusTool(mockServer as any);
      const result = await registeredTools.get('claim_status')!({ domain: 'plan' });
      const text = textOf(result);
      expect(text).toContain('plan');
    });

    it('handles empty claim graph', async () => {
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([{ evCount: 0, hypCount: 0 }]);

      createClaimStatusTool(mockServer as any);
      const result = await registeredTools.get('claim_status')!({});
      const text = textOf(result);
      expect(text).toContain('Claim Layer Status');
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('claim query failed'));

      createClaimStatusTool(mockServer as any);
      const result = await registeredTools.get('claim_status')!({});
      expect(textOf(result)).toContain('claim query failed');
    });
  });

  describe('evidence_for tool', () => {
    it('registers via server.tool', () => {
      createEvidenceForTool(mockServer as any);
      expect(registeredTools.has('evidence_for')).toBe(true);
    });

    it('returns evidence for matching claim', async () => {
      mockRun.mockResolvedValueOnce([{
        id: 'claim-1',
        statement: 'Parser handles all TS features',
        conf: 0.9,
        domain: 'code',
        status: 'supported',
      }]);
      // Supporting evidence
      mockRun.mockResolvedValueOnce([{
        source: 'test-suite',
        grade: 'A1',
        weight: 0.95,
        desc: 'Full coverage test',
      }]);
      // Contradicting evidence
      mockRun.mockResolvedValueOnce([]);

      createEvidenceForTool(mockServer as any);
      const result = await registeredTools.get('evidence_for')!({ query: 'parser' });
      const text = textOf(result);
      expect(text).toContain('Parser handles all TS features');
      expect(text).toContain('A1');
      expect(text).toContain('Supporting Evidence');
    });

    it('returns no claims found message', async () => {
      mockRun.mockResolvedValueOnce([]);

      createEvidenceForTool(mockServer as any);
      const result = await registeredTools.get('evidence_for')!({ query: 'nonexistent' });
      expect(textOf(result)).toContain('No claims found');
    });

    it('shows contradicting evidence', async () => {
      mockRun.mockResolvedValueOnce([{
        id: 'claim-2',
        statement: 'Feature X works',
        conf: 0.5,
        domain: 'code',
        status: 'contested',
      }]);
      mockRun.mockResolvedValueOnce([]);
      mockRun.mockResolvedValueOnce([{
        source: 'bug-report',
        grade: 'A2',
        weight: 0.8,
        desc: 'Fails on edge case',
        description: 'Fails on edge case',
      }]);

      createEvidenceForTool(mockServer as any);
      const result = await registeredTools.get('evidence_for')!({ query: 'Feature X' });
      const text = textOf(result);
      expect(text).toContain('Contradicting Evidence');
      expect(text).toContain('Fails on edge case');
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('evidence fail'));

      createEvidenceForTool(mockServer as any);
      const result = await registeredTools.get('evidence_for')!({ query: 'test' });
      expect(textOf(result)).toContain('evidence fail');
    });
  });

  describe('contradictions tool', () => {
    it('registers via server.tool', () => {
      createContradictionsTool(mockServer as any);
      expect(registeredTools.has('contradictions')).toBe(true);
    });

    it('returns contested claims sorted by weight', async () => {
      mockRun.mockResolvedValueOnce([{
        statement: 'Data model is consistent',
        conf: 0.4,
        domain: 'code',
        status: 'contested',
        contradictWeight: 3.5,
        contradictCount: 5,
        supportWeight: 1.2,
        supportCount: 2,
      }]);

      createContradictionsTool(mockServer as any);
      const result = await registeredTools.get('contradictions')!({});
      const text = textOf(result);
      expect(text).toContain('Data model is consistent');
      expect(text).toContain('3.50');
      expect(text).toContain('1.20');
    });

    it('returns no contradictions message when clean', async () => {
      mockRun.mockResolvedValueOnce([]);

      createContradictionsTool(mockServer as any);
      const result = await registeredTools.get('contradictions')!({});
      expect(textOf(result)).toContain('No contested claims');
    });

    it('filters by domain', async () => {
      mockRun.mockResolvedValueOnce([]);

      createContradictionsTool(mockServer as any);
      await registeredTools.get('contradictions')!({ domain: 'plan' });
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[1]).toEqual(expect.objectContaining({ domain: 'plan' }));
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('contradiction error'));

      createContradictionsTool(mockServer as any);
      const result = await registeredTools.get('contradictions')!({});
      expect(textOf(result)).toContain('contradiction error');
    });
  });

  describe('hypotheses tool', () => {
    it('registers via server.tool', () => {
      createHypothesesTool(mockServer as any);
      expect(registeredTools.has('hypotheses')).toBe(true);
    });

    it('returns grouped hypotheses', async () => {
      mockRun.mockResolvedValueOnce([{
        name: 'Missing test coverage for parser',
        domain: 'code',
        status: 'open',
        source: 'risk-analysis',
        project: 'proj_c0d3e9a1f200',
        section: 'Core',
      }]);

      createHypothesesTool(mockServer as any);
      const result = await registeredTools.get('hypotheses')!({});
      const text = textOf(result);
      expect(text).toContain('Missing test coverage');
      expect(text).toContain('code');
    });

    it('returns no hypotheses message when empty', async () => {
      mockRun.mockResolvedValueOnce([]);

      createHypothesesTool(mockServer as any);
      const result = await registeredTools.get('hypotheses')!({});
      expect(textOf(result)).toContain('No open hypotheses');
    });

    it('filters by domain and status', async () => {
      mockRun.mockResolvedValueOnce([]);

      createHypothesesTool(mockServer as any);
      await registeredTools.get('hypotheses')!({ domain: 'plan', status: 'supported' });
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[1]).toEqual(expect.objectContaining({ domain: 'plan', status: 'supported' }));
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('hyp error'));

      createHypothesesTool(mockServer as any);
      const result = await registeredTools.get('hypotheses')!({});
      expect(textOf(result)).toContain('hyp error');
    });
  });

  describe('claim_chain_path tool', () => {
    it('registers via server.tool', () => {
      createClaimChainPathTool(mockServer as any);
      expect(registeredTools.has('claim_chain_path')).toBe(true);
    });

    it('returns chain paths', async () => {
      mockRun.mockResolvedValueOnce([{
        codeId: 'c1',
        codeType: 'function_risk',
        codeStatement: 'processPayment is critical',
        planId: 'p1',
        planType: 'task_completion',
        planStatement: 'Payment flow implemented',
        docId: 'd1',
        docType: 'document_ref',
        docStatement: 'PCI compliance doc',
        projectId: 'plan_codegraph',
      }]);

      createClaimChainPathTool(mockServer as any);
      const result = await registeredTools.get('claim_chain_path')!({});
      const text = textOf(result);
      expect(text).toContain('processPayment is critical');
      expect(text).toContain('Payment flow implemented');
      expect(text).toContain('PCI compliance doc');
    });

    it('returns no chains message when empty', async () => {
      mockRun.mockResolvedValueOnce([]);

      createClaimChainPathTool(mockServer as any);
      const result = await registeredTools.get('claim_chain_path')!({});
      expect(textOf(result)).toContain('No code → plan → document claim chains');
    });

    it('filters by projectId', async () => {
      mockRun.mockResolvedValueOnce([]);

      createClaimChainPathTool(mockServer as any);
      await registeredTools.get('claim_chain_path')!({ projectId: 'plan_codegraph' });
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[1]).toEqual(expect.objectContaining({ projectId: 'plan_codegraph' }));
    });

    it('returns error on failure', async () => {
      mockRun.mockRejectedValueOnce(new Error('chain error'));

      createClaimChainPathTool(mockServer as any);
      const result = await registeredTools.get('claim_chain_path')!({});
      expect(textOf(result)).toContain('chain error');
    });
  });

  describe('claim_generate tool', () => {
    it('registers via server.tool', () => {
      createClaimGenerateTool(mockServer as any);
      expect(registeredTools.has('claim_generate')).toBe(true);
    });

    it('runs full pipeline for all domains', async () => {
      mockGeneratePlanClaims.mockResolvedValueOnce({ claims: 10, evidence: 20, hypotheses: 5 });
      // Code project lookup
      mockRun.mockResolvedValueOnce([{ projectId: 'proj_c0d3e9a1f200' }]);
      mockGenerateCodeClaims.mockResolvedValueOnce({ claims: 15, evidence: 30, hypotheses: 8 });
      mockGenerateCorpusClaims.mockResolvedValueOnce({ claims: 5, evidence: 10 });
      mockRecomputeConfidence.mockResolvedValueOnce(30);

      createClaimGenerateTool(mockServer as any);
      const result = await registeredTools.get('claim_generate')!({});
      const text = textOf(result);
      expect(text).toContain('Plan: 10 claims');
      expect(text).toContain('Code: 15 claims');
      expect(text).toContain('Corpus: 5 claims');
      expect(text).toContain('recomputed on 30 claims');
      expect(mockEnsureSchema).toHaveBeenCalled();
    });

    it('runs only plan domain when specified', async () => {
      mockGeneratePlanClaims.mockResolvedValueOnce({ claims: 5, evidence: 10, hypotheses: 2 });
      mockRecomputeConfidence.mockResolvedValueOnce(5);

      createClaimGenerateTool(mockServer as any);
      const result = await registeredTools.get('claim_generate')!({ domain: 'plan' });
      const text = textOf(result);
      expect(text).toContain('Plan: 5 claims');
      expect(mockGenerateCodeClaims).not.toHaveBeenCalled();
      expect(mockGenerateCorpusClaims).not.toHaveBeenCalled();
    });

    it('closes engine in finally block', async () => {
      mockGeneratePlanClaims.mockRejectedValueOnce(new Error('fail'));

      createClaimGenerateTool(mockServer as any);
      await registeredTools.get('claim_generate')!({ domain: 'plan' });
      expect(mockClaimEngineClose).toHaveBeenCalled();
    });

    it('returns error on pipeline failure', async () => {
      mockGeneratePlanClaims.mockRejectedValueOnce(new Error('pipeline boom'));

      createClaimGenerateTool(mockServer as any);
      const result = await registeredTools.get('claim_generate')!({ domain: 'plan' });
      expect(textOf(result)).toContain('pipeline boom');
    });

    it('falls back to default project when code registry is empty', async () => {
      mockGeneratePlanClaims.mockResolvedValueOnce({ claims: 0, evidence: 0, hypotheses: 0 });
      // Empty code projects
      mockRun.mockResolvedValueOnce([]);
      mockGenerateCodeClaims.mockResolvedValueOnce({ claims: 3, evidence: 6, hypotheses: 1 });
      mockGenerateCorpusClaims.mockResolvedValueOnce({ claims: 0, evidence: 0 });
      mockRecomputeConfidence.mockResolvedValueOnce(3);

      createClaimGenerateTool(mockServer as any);
      await registeredTools.get('claim_generate')!({});
      expect(mockGenerateCodeClaims).toHaveBeenCalledWith('proj_c0d3e9a1f200');
    });
  });
});
