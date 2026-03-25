/**
 * AUD-TC-11c-L2-05: Supplementary audit tests for integrity-hypothesis-generator.ts
 *
 * Covers gaps identified in B6 verification:
 * - Deduplication: same discrepancy doesn't produce duplicate hypotheses
 * - Severity inheritance from finding to hypothesis
 * - refreshExistingHypotheses behavior
 * - resolveStaleHypotheses behavior
 * - No Direct Remediation Rule (hypothesis names contain no prescriptions)
 * - projectId scoping (multi-project safety)
 * - Config defaults (threshold=5, severityFilter=['critical','warning'])
 *
 * Source: src/core/ground-truth/integrity-hypothesis-generator.ts (210 lines)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegrityHypothesisGenerator } from '../../ground-truth/integrity-hypothesis-generator.js';

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('AUD-TC-11c-L2-05: integrity-hypothesis-generator supplementary audit', () => {
  let neo4j: ReturnType<typeof createMockNeo4j>;
  let generator: IntegrityHypothesisGenerator;

  beforeEach(() => {
    neo4j = createMockNeo4j();
    generator = new IntegrityHypothesisGenerator(neo4j);
  });

  // ─── Deduplication (Behavior 6) ─────────────────────────────────

  describe('deduplication via MERGE', () => {
    it('uses MERGE (not CREATE) for hypothesis nodes to prevent duplicates', async () => {
      neo4j.run
        .mockResolvedValueOnce([{
          discId: 'disc_1',
          discType: 'StructuralViolation',
          description: 'Test',
          runs: 7,
          currentValue: 5,
          severity: 'warning',
        }])
        .mockResolvedValueOnce([]) // refreshExistingHypotheses
        .mockResolvedValueOnce([]) // resolveStaleHypotheses
        .mockResolvedValueOnce([]); // batched MERGE

      await generator.generateFromDiscrepancies('proj_test');

      // The batched write call should use MERGE
      const mergeCalls = neo4j.run.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('MERGE') && c[0].includes('Hypothesis')
      );
      expect(mergeCalls.length).toBeGreaterThan(0);

      // Should NOT use CREATE for hypotheses
      const createCalls = neo4j.run.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && /\bCREATE\b.*Hypothesis/.test(c[0])
      );
      expect(createCalls.length).toBe(0);
    });

    it('hypothesis ID is deterministic (projectId + discrepancyId)', async () => {
      neo4j.run
        .mockResolvedValueOnce([{
          discId: 'disc_abc',
          discType: 'StructuralViolation',
          description: 'Test',
          runs: 7,
          currentValue: 5,
          severity: 'warning',
        }])
        .mockResolvedValueOnce([]) // refresh
        .mockResolvedValueOnce([]) // resolve
        .mockResolvedValueOnce([]); // merge

      const results = await generator.generateFromDiscrepancies('proj_test');
      expect(results[0].id).toBe('hyp_integrity_proj_test_disc_abc');
    });

    it('uses "global" prefix when projectId is omitted', async () => {
      neo4j.run
        .mockResolvedValueOnce([{
          discId: 'disc_xyz',
          discType: 'EvidenceGap',
          description: 'Test',
          runs: 10,
          currentValue: 3,
          severity: 'critical',
        }])
        .mockResolvedValueOnce([]) // refresh
        .mockResolvedValueOnce([]) // resolve
        .mockResolvedValueOnce([]); // merge

      const results = await generator.generateFromDiscrepancies(); // no projectId
      expect(results[0].id).toBe('hyp_integrity_global_disc_xyz');
    });
  });

  // ─── Severity Inheritance (Behavior 4) ──────────────────────────

  describe('severity inheritance from finding to hypothesis', () => {
    it('passes severity into the MERGE Cypher for hypothesis creation', async () => {
      neo4j.run
        .mockResolvedValueOnce([{
          discId: 'disc_1',
          discType: 'StructuralViolation',
          description: 'Test severity',
          runs: 5,
          currentValue: 10,
          severity: 'critical',
        }])
        .mockResolvedValueOnce([]) // refresh
        .mockResolvedValueOnce([]) // resolve
        .mockResolvedValueOnce([]); // merge

      await generator.generateFromDiscrepancies('proj_test');

      // Find the MERGE call with hypotheses array
      const mergeCall = neo4j.run.mock.calls.find(
        (c: any[]) => c[1]?.hypotheses !== undefined
      );
      expect(mergeCall).toBeDefined();
      const hyps = mergeCall![1].hypotheses;
      expect(hyps[0].severity).toBe('critical');
    });
  });

  // ─── refreshExistingHypotheses ──────────────────────────────────

  describe('refreshExistingHypotheses', () => {
    it('updates stale hypothesis names from current discrepancy data', async () => {
      neo4j.run.mockResolvedValueOnce([{ refreshed: 3 }]);

      const count = await generator.refreshExistingHypotheses('proj_test');
      expect(count).toBe(3);

      // Should query for open hypotheses linked to open discrepancies
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('Discrepancy');
      expect(cypher).toContain('Hypothesis');
      expect(cypher).toContain("status: 'open'");
    });

    it('passes projectId for scoping', async () => {
      neo4j.run.mockResolvedValueOnce([{ refreshed: 0 }]);

      await generator.refreshExistingHypotheses('proj_specific');
      const params = neo4j.run.mock.calls[0][1];
      expect(params.projectId).toBe('proj_specific');
    });

    it('handles null projectId for global scan', async () => {
      neo4j.run.mockResolvedValueOnce([{ refreshed: 0 }]);

      await generator.refreshExistingHypotheses();
      const params = neo4j.run.mock.calls[0][1];
      expect(params.projectId).toBeNull();
    });
  });

  // ─── resolveStaleHypotheses ─────────────────────────────────────

  describe('resolveStaleHypotheses', () => {
    it('closes hypotheses for resolved discrepancies', async () => {
      neo4j.run.mockResolvedValueOnce([{ resolved: 2 }]);

      const count = await generator.resolveStaleHypotheses('proj_test');
      expect(count).toBe(2);

      const cypher = neo4j.run.mock.calls[0][0] as string;
      // Should set status to resolved
      expect(cypher).toContain("'resolved'");
      // Should check disc.status = 'resolved'
      expect(cypher).toContain("disc.status = 'resolved'");
    });

    it('sets resolvedAt and resolvedReason on closed hypotheses', async () => {
      neo4j.run.mockResolvedValueOnce([{ resolved: 1 }]);

      await generator.resolveStaleHypotheses('proj_test');
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('resolvedAt');
      expect(cypher).toContain('resolvedReason');
    });
  });

  // ─── No Direct Remediation Rule (Behavior 3) ───────────────────

  describe('No Direct Remediation Rule', () => {
    it('hypothesis names are observational, not prescriptive', async () => {
      neo4j.run
        .mockResolvedValueOnce([{
          discId: 'disc_1',
          discType: 'StructuralViolation',
          description: 'Nodes missing CodeNode label',
          runs: 7,
          currentValue: 226,
          severity: 'warning',
        }])
        .mockResolvedValueOnce([]) // refresh
        .mockResolvedValueOnce([]) // resolve
        .mockResolvedValueOnce([]); // merge

      const results = await generator.generateFromDiscrepancies('proj_test');

      // Name should start with "Graph integrity:" (observation prefix)
      expect(results[0].name).toMatch(/^Graph integrity:/);
      // Should contain the failure count and current value (facts)
      expect(results[0].name).toContain('consecutive failures');
      expect(results[0].name).toContain('current=');
      // Should NOT contain action verbs
      const actionVerbs = ['fix', 'run', 'execute', 'should', 'must', 'update', 'please', 'add', 'remove'];
      for (const verb of actionVerbs) {
        expect(results[0].name.toLowerCase()).not.toContain(verb);
      }
    });
  });

  // ─── Config Defaults ────────────────────────────────────────────

  describe('config defaults', () => {
    it('uses threshold=5 by default', async () => {
      // Call generateFromDiscrepancies — the query should use threshold=5
      await generator.generateFromDiscrepancies();

      const params = neo4j.run.mock.calls[0][1];
      expect(params.threshold).toBe(5);
    });

    it('uses severityFilter=[critical, warning] by default', async () => {
      await generator.generateFromDiscrepancies();

      const params = neo4j.run.mock.calls[0][1];
      expect(params.severities).toEqual(['critical', 'warning']);
    });

    it('respects custom config overrides', async () => {
      const custom = new IntegrityHypothesisGenerator(neo4j, {
        threshold: 3,
        severityFilter: ['critical'],
      });

      await custom.generateFromDiscrepancies();

      const params = neo4j.run.mock.calls[0][1];
      expect(params.threshold).toBe(3);
      expect(params.severities).toEqual(['critical']);
    });
  });

  // ─── generateFromDiscrepancies calls refresh + resolve ──────────

  describe('generateFromDiscrepancies lifecycle', () => {
    it('calls refreshExistingHypotheses and resolveStaleHypotheses even when no new discrepancies', async () => {
      // First call: find discrepancies (none found)
      neo4j.run
        .mockResolvedValueOnce([])  // no qualifying discrepancies
        .mockResolvedValueOnce([{ refreshed: 0 }])  // refresh
        .mockResolvedValueOnce([{ resolved: 0 }]);   // resolve

      const results = await generator.generateFromDiscrepancies('proj_test');
      expect(results).toHaveLength(0);

      // Should still have called refresh and resolve
      expect(neo4j.run).toHaveBeenCalledTimes(3);
    });
  });

  // ─── GENERATED_HYPOTHESIS edge (Behavior 5) ────────────────────

  describe('GENERATED_HYPOTHESIS edge creation', () => {
    it('creates GENERATED_HYPOTHESIS edge from Discrepancy to Hypothesis', async () => {
      neo4j.run
        .mockResolvedValueOnce([{
          discId: 'disc_1',
          discType: 'StructuralViolation',
          description: 'Test',
          runs: 7,
          currentValue: 5,
          severity: 'warning',
        }])
        .mockResolvedValueOnce([]) // refresh
        .mockResolvedValueOnce([]) // resolve
        .mockResolvedValueOnce([]); // merge

      await generator.generateFromDiscrepancies('proj_test');

      // Find the batched MERGE call that creates hypotheses and edges
      const mergeCalls = neo4j.run.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('MERGE') && c[0].includes('Hypothesis')
      );
      expect(mergeCalls.length).toBeGreaterThan(0);
      const cypher = mergeCalls[0][0] as string;
      // Edge goes from disc to hyp via MERGE
      expect(cypher).toContain('GENERATED_HYPOTHESIS');
      expect(cypher).toContain('disc');
      expect(cypher).toContain('hyp');
    });
  });
});
