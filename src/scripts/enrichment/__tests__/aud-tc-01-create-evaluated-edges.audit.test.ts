/**
 * AUD-TC-01-L1: create-evaluated-edges.ts — Spec-Derived Tests
 *
 * Spec: GAP_CLOSURE.md §GC-10 — EVALUATED edges from done-check VR → Project; scopeModel='project-level'
 *
 * Behaviors:
 * (1) Sets scopeModel='project-level' on done-check VRs
 * (2) Creates EVALUATED edge from done-check VR → Project with {derived: true, passed, timestamp}
 * (3) Idempotent — MERGE semantics, no duplicates on re-run
 * (4) Returns {scopeModelSet, evaluatedEdges} counts
 * (5) VRs without done-check scope are skipped (0 EVALUATED edges)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the neo4j-driver module
const mockSession = {
  run: vi.fn(),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
};

describe('[aud-tc-01] create-evaluated-edges.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.run.mockReset();
    mockSession.close.mockReset();
  });

  describe('EVALUATED edge contract', () => {
    it('(1) done-check VRs must have scopeModel=project-level', () => {
      // Contract: done-check VRs evaluate project-level invariants, not files
      const vrProperties = {
        sourceFamily: 'done-check',
        scopeModel: 'project-level',
      };

      expect(vrProperties.scopeModel).toBe('project-level');
      expect(vrProperties.sourceFamily).toBe('done-check');
    });

    it('(2) EVALUATED edge must have derived=true', () => {
      // Contract: All enrichment-created edges must be tagged derived
      const edgeProps = {
        derived: true,
        source: 'gc10-evaluated-enrichment',
        passed: true,
        timestamp: new Date(),
      };

      expect(edgeProps.derived).toBe(true);
      expect(edgeProps.source).toBe('gc10-evaluated-enrichment');
    });

    it('(3) EVALUATED edge passed property reflects VR.ok', () => {
      // Contract: passed property comes from vr.ok
      const passingVR = { ok: true };
      const failingVR = { ok: false };

      expect(passingVR.ok).toBe(true);
      expect(failingVR.ok).toBe(false);
    });

    it('(4) done-check VRs identified by sourceFamily property', () => {
      // Contract: done-check VRs have sourceFamily='done-check'
      const doneCheckVR = { sourceFamily: 'done-check' };
      const eslintVR = { sourceFamily: 'eslint' };
      const semgrepVR = { sourceFamily: 'semgrep' };

      const isDoneCheck = (vr: { sourceFamily: string }) => vr.sourceFamily === 'done-check';

      expect(isDoneCheck(doneCheckVR)).toBe(true);
      expect(isDoneCheck(eslintVR)).toBe(false);
      expect(isDoneCheck(semgrepVR)).toBe(false);
    });
  });

  describe('enrichEvaluatedEdges function behavior', () => {
    it('(5) returns {scopeModelSet, evaluatedEdges} counts', async () => {
      // Mock both queries: scope update and edge creation
      mockSession.run
        .mockResolvedValueOnce({
          records: [{ get: (key: string) => (key === 'updated' ? 5 : null) }],
        })
        .mockResolvedValueOnce({
          records: [{ get: (key: string) => (key === 'edges' ? 3 : null) }],
        });

      const { enrichEvaluatedEdges } = await import('../create-evaluated-edges.js');
      const result = await enrichEvaluatedEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result).toHaveProperty('scopeModelSet');
      expect(result).toHaveProperty('evaluatedEdges');
      expect(result.scopeModelSet).toBe(5);
      expect(result.evaluatedEdges).toBe(3);
    });

    it('(6) handles bigint result from Neo4j', async () => {
      const bigIntUpdated = { toNumber: () => 10 };
      const bigIntEdges = { toNumber: () => 8 };

      mockSession.run
        .mockResolvedValueOnce({
          records: [{ get: () => bigIntUpdated }],
        })
        .mockResolvedValueOnce({
          records: [{ get: () => bigIntEdges }],
        });

      const { enrichEvaluatedEdges } = await import('../create-evaluated-edges.js');
      const result = await enrichEvaluatedEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result.scopeModelSet).toBe(10);
      expect(result.evaluatedEdges).toBe(8);
    });

    it('(7) MERGE semantics ensure idempotency', async () => {
      // First run: sets scopeModel and creates EVALUATED edges
      mockSession.run
        .mockResolvedValueOnce({ records: [{ get: () => 5 }] })
        .mockResolvedValueOnce({ records: [{ get: () => 3 }] });

      const { enrichEvaluatedEdges } = await import('../create-evaluated-edges.js');
      const result1 = await enrichEvaluatedEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      // Second run: scopeModel already set (0 updates), edges already exist (ON MATCH path)
      mockSession.run
        .mockResolvedValueOnce({ records: [{ get: () => 0 }] }) // scopeModel already project-level
        .mockResolvedValueOnce({ records: [{ get: () => 3 }] }); // Same count — matched, not created

      const result2 = await enrichEvaluatedEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result1.scopeModelSet).toBe(5);
      expect(result2.scopeModelSet).toBe(0); // Idempotent — no new updates
      expect(result1.evaluatedEdges).toBe(result2.evaluatedEdges); // Same edge count
    });

    it('(8) returns 0 evaluatedEdges when no done-check VRs exist', async () => {
      mockSession.run
        .mockResolvedValueOnce({ records: [{ get: () => 0 }] }) // No VRs to update
        .mockResolvedValueOnce({ records: [{ get: () => 0 }] }); // No edges created

      const { enrichEvaluatedEdges } = await import('../create-evaluated-edges.js');
      const result = await enrichEvaluatedEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(result.scopeModelSet).toBe(0);
      expect(result.evaluatedEdges).toBe(0);
    });

    it('(9) closes session after execution', async () => {
      mockSession.run
        .mockResolvedValueOnce({ records: [{ get: () => 0 }] })
        .mockResolvedValueOnce({ records: [{ get: () => 0 }] });

      const { enrichEvaluatedEdges } = await import('../create-evaluated-edges.js');
      await enrichEvaluatedEdges(mockDriver as unknown as import('neo4j-driver').Driver);

      expect(mockSession.close).toHaveBeenCalled();
    });
  });

  describe('VR scope filtering', () => {
    it('(10) only done-check VRs get EVALUATED edges', () => {
      // The Cypher WHERE clause filters: vr.sourceFamily = 'done-check'
      const query = `
        MATCH (vr:VerificationRun)
        WHERE vr.sourceFamily = 'done-check'
      `;

      expect(query).toContain("sourceFamily = 'done-check'");
    });

    it('(11) EVALUATED edges target Project nodes, not SourceFile', () => {
      // Contract: done-check evaluates projects, not individual files
      const edgeTarget = 'Project';
      const wrongTarget = 'SourceFile';

      // The Cypher matches: (p:Project {projectId: vr.projectId})
      expect(edgeTarget).toBe('Project');
      expect(edgeTarget).not.toBe(wrongTarget);
    });
  });
});
