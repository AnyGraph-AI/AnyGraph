/**
 * AUD-TC-03-L1b-06: verification-invariant-proof-records.ts audit tests
 *
 * Spec: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §VG-6
 *       "Add explicit invariant proof records"
 *
 * Behaviors:
 *   (1) reads threshold artifact JSON and validation artifact JSON from known paths
 *   (2) maps 5 invariants to task names
 *   (3) MERGEs InvariantProof nodes with invariantId/criterionId/result/provedAt/artifactHash/decisionHash
 *   (4) MERGEs PROVES edges from InvariantProof to matching Task
 *   (5) SETs proof metadata on Task nodes
 *   (6) fetches latest GateDecision.decisionHash for cross-linking
 *   (7) proof result is pass/fail based on validation.checks lookup per invariant
 *   (8) outputs JSON summary with proofsUpserted/edgesUpserted counts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ──

const { mockRun, mockClose, mockReadFileSync } = vi.hoisted(() => ({
  mockRun: vi.fn().mockResolvedValue([]),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockReadFileSync: vi.fn().mockReturnValue('{}'),
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4jService {
    run = mockRun;
    close = mockClose;
  },
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

const THRESHOLD_ARTIFACT_DATA = {
  generatedAt: '2026-03-24T10:00:00Z',
  falsePositive: { consecutiveRunsPass: true },
  scopeCompleteness: { pass: true },
  waiverHygiene: { pass: true },
};

const VALIDATION_ARTIFACT_DATA = {
  generatedAt: '2026-03-24T10:00:00Z',
  checks: {
    materializationIdempotency: true,
    projectScopeIntegrity: true,
    originalEdgeTypeFidelity: false,
    deterministicRebuildTotals: true,
    noOrphanRelationshipWrites: true,
  },
};

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  mockRun.mockReset().mockResolvedValue([]);
  mockClose.mockReset().mockResolvedValue(undefined);

  mockReadFileSync.mockReset().mockImplementation((p: string) => {
    if (String(p).includes('vg5-thresholds')) return JSON.stringify(THRESHOLD_ARTIFACT_DATA);
    if (String(p).includes('vg5-ir-module')) return JSON.stringify(VALIDATION_ARTIFACT_DATA);
    return '{}';
  });

  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mockExit.mockRestore();
  mockConsoleLog.mockRestore();
  mockConsoleError.mockRestore();
});

async function runModule(): Promise<void> {
  await import('../../../utils/verification-invariant-proof-records.js');
  await new Promise((r) => setTimeout(r, 50));
}

describe('AUD-TC-03-L1b-06 | verification-invariant-proof-records.ts', () => {

  // ─── Behavior 1: reads threshold + validation artifacts ───
  describe('B1: reads threshold and validation artifact JSONs', () => {
    it('reads threshold artifact from known path', async () => {
      await runModule();
      const paths = mockReadFileSync.mock.calls.map((c: any) => String(c[0]));
      expect(paths.some((p: string) => p.includes('vg5-thresholds-latest.json'))).toBe(true);
    });

    it('reads validation artifact from known path', async () => {
      await runModule();
      const paths = mockReadFileSync.mock.calls.map((c: any) => String(c[0]));
      expect(paths.some((p: string) => p.includes('vg5-ir-module-latest.json'))).toBe(true);
    });
  });

  // ─── Behavior 2: maps 5 invariants to task names ───
  describe('B2: maps 5 invariants to task names', () => {
    it('processes exactly 5 invariants (15 neo4j calls: 3 per invariant + 1 for decisionHash)', async () => {
      // 1 call for decisionHash, then 3 calls per invariant (MERGE proof, MERGE edge, SET task)
      mockRun.mockResolvedValue([]);
      await runModule();
      // Total: 1 (decisionHash) + 5*3 (invariants) = 16 calls
      expect(mockRun).toHaveBeenCalledTimes(16);
    });

    it('MERGE queries reference all 5 invariant IDs', async () => {
      await runModule();
      const allParams = mockRun.mock.calls.map((c: any) => c[1]).filter(Boolean);
      const invariantIds = allParams
        .filter((p: any) => p.invariantId)
        .map((p: any) => p.invariantId);
      expect(invariantIds).toContain('vg5.materialization_idempotency');
      expect(invariantIds).toContain('vg5.project_scope_integrity');
      expect(invariantIds).toContain('vg5.original_edge_type_fidelity');
      expect(invariantIds).toContain('vg5.deterministic_rebuild_totals');
      expect(invariantIds).toContain('vg5.no_orphan_relationship_writes');
    });
  });

  // ─── Behavior 3: MERGEs InvariantProof nodes ───
  describe('B3: MERGEs InvariantProof nodes with required properties', () => {
    it('MERGE query includes InvariantProof label with correct properties', async () => {
      await runModule();
      const mergeCalls = mockRun.mock.calls.filter((c: any) =>
        String(c[0]).includes('MERGE') && String(c[0]).includes('InvariantProof'),
      );
      expect(mergeCalls.length).toBeGreaterThanOrEqual(5);

      const params = mergeCalls[0][1];
      expect(params).toHaveProperty('invariantId');
      expect(params).toHaveProperty('criterionId');
      expect(params).toHaveProperty('result');
      expect(params).toHaveProperty('provedAt');
      expect(params).toHaveProperty('artifactHash');
    });
  });

  // ─── Behavior 4: MERGEs PROVES edges ───
  describe('B4: MERGEs PROVES edges from InvariantProof to Task', () => {
    it('creates PROVES relationship for each invariant', async () => {
      await runModule();
      const provesCalls = mockRun.mock.calls.filter((c: any) =>
        String(c[0]).includes('PROVES'),
      );
      expect(provesCalls.length).toBe(5);
    });

    it('PROVES edge query matches Task by name and roadmapFile', async () => {
      await runModule();
      const provesCall = mockRun.mock.calls.find((c: any) =>
        String(c[0]).includes('PROVES'),
      );
      expect(provesCall).toBeDefined();
      const params = provesCall![1];
      expect(params).toHaveProperty('taskName');
      expect(params).toHaveProperty('roadmapFile', 'VERIFICATION_GRAPH_ROADMAP.md');
    });
  });

  // ─── Behavior 5: SETs proof metadata on Task nodes ───
  describe('B5: SETs proof metadata on Task nodes', () => {
    it('sets proofInvariantId, proofCriterionId, proofRunId, proofResult on tasks', async () => {
      await runModule();
      const taskSetCalls = mockRun.mock.calls.filter((c: any) => {
        const q = String(c[0]);
        return q.includes('SET t.proofInvariantId') && q.includes('MATCH (t:Task');
      });
      expect(taskSetCalls.length).toBe(5);

      const params = taskSetCalls[0][1];
      expect(params).toHaveProperty('invariantId');
      expect(params).toHaveProperty('criterionId');
      expect(params).toHaveProperty('runId');
      expect(params).toHaveProperty('result');
    });
  });

  // ─── Behavior 6: fetches latest GateDecision.decisionHash ───
  describe('B6: fetches latest GateDecision.decisionHash', () => {
    it('queries GateDecision for decisionHash', async () => {
      mockRun.mockResolvedValueOnce([{ decisionHash: 'sha256:abc123' }]);
      mockRun.mockResolvedValue([]);

      await runModule();
      const firstCall = mockRun.mock.calls[0];
      expect(String(firstCall[0])).toContain('GateDecision');
      expect(String(firstCall[0])).toContain('decisionHash');
    });

    it('passes null decisionHash when no GateDecision exists', async () => {
      mockRun.mockResolvedValueOnce([]); // No decision found
      mockRun.mockResolvedValue([]);

      await runModule();
      // Proof MERGE params should have decisionHash: null
      const proofMerge = mockRun.mock.calls.find((c: any) =>
        String(c[0]).includes('InvariantProof') && String(c[0]).includes('MERGE'),
      );
      expect(proofMerge![1].decisionHash).toBeNull();
    });
  });

  // ─── Behavior 7: proof result pass/fail from validation.checks ───
  describe('B7: result is pass/fail per validation.checks lookup', () => {
    it('sets result=pass when validation check is true', async () => {
      await runModule();
      const proofMerges = mockRun.mock.calls.filter((c: any) =>
        String(c[0]).includes('InvariantProof') && String(c[0]).includes('MERGE'),
      );
      const idempotencyProof = proofMerges.find((c: any) =>
        c[1].invariantId === 'vg5.materialization_idempotency',
      );
      expect(idempotencyProof![1].result).toBe('pass');
    });

    it('sets result=fail when validation check is false', async () => {
      await runModule();
      const proofMerges = mockRun.mock.calls.filter((c: any) =>
        String(c[0]).includes('InvariantProof') && String(c[0]).includes('MERGE'),
      );
      const edgeFidelityProof = proofMerges.find((c: any) =>
        c[1].invariantId === 'vg5.original_edge_type_fidelity',
      );
      expect(edgeFidelityProof![1].result).toBe('fail');
    });
  });

  // ─── Behavior 8: outputs JSON summary ───
  describe('B8: outputs JSON with proofsUpserted/edgesUpserted', () => {
    it('logs JSON with ok, proofsUpserted=5, edgesUpserted=5', async () => {
      await runModule();
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.proofsUpserted).toBe(5);
      expect(output.edgesUpserted).toBe(5);
    });

    it('includes artifactHash, validationHash, provedAt in output', async () => {
      await runModule();
      const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(output.artifactHash).toMatch(/^sha256:/);
      expect(output.validationHash).toMatch(/^sha256:/);
      expect(output.provedAt).toBe('2026-03-24T10:00:00Z');
    });

    it('closes Neo4jService in finally block even on success', async () => {
      await runModule();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Error handling ───
  describe('Error handling', () => {
    it('exits with code 1 and JSON error when artifact read fails', async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });

      await runModule();
      expect(mockExit).toHaveBeenCalledWith(1);
      const errOutput = mockConsoleError.mock.calls[0]?.[0];
      const parsed = JSON.parse(errOutput);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain('ENOENT');
    });
  });

  // ─── SPEC-GAPs ───
  // SPEC-GAP: §VG-6 does not specify behavior when validation artifact has missing checks keys
  // SPEC-GAP: Spec does not define retention policy for InvariantProof nodes (accumulate forever?)
  // SPEC-GAP: No spec for what happens when Task matching by name fails (silent skip vs error)
});
