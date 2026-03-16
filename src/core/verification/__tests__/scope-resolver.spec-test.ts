/**
 * Scope Resolver Tests — Spec Contract + Implementation Edge Cases
 *
 * This file is organized in TWO PHASES per TDD methodology:
 *
 * PHASE A: Spec-Only Tests (derived from VERIFICATION_GRAPH_ROADMAP.md)
 *   - Section 4: Schema Extension (AnalysisScope, UNSCANNED_FOR, scopeCompleteness)
 *   - Section 17.1 item 10: Analysis scope/completeness modeling
 *   - Section 9 Week 3: Status Engine
 *   - verification-schema.ts: Zod type definitions
 *
 * PHASE B: Implementation Edge Cases (derived from scope-resolver.ts + audit)
 *   - Cross-referenced against audits/vg_audit_agent2_scope_view.md
 *
 * @see plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md
 * @see codegraph/src/core/verification/scope-resolver.ts
 * @see audits/vg_audit_agent2_scope_view.md
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createEphemeralGraph, type EphemeralGraphRuntime } from '../../test-harness/ephemeral-graph.js';
import { runScopeResolver } from '../index.js';
import { Neo4jService } from '../../../storage/neo4j/neo4j.service.js';
import {
  AnalysisScopeSchema,
  VerificationRunSchema,
  type AnalysisScope,
  type VerificationRun,
} from '../verification-schema.js';

// ============================================================================
// TEST INFRASTRUCTURE
// ============================================================================

let eph: EphemeralGraphRuntime;
let neo4j: Neo4jService;
let projectId: string;

beforeAll(async () => {
  eph = await createEphemeralGraph({ testId: `scope-res-${randomUUID().slice(0, 8)}` });
  projectId = eph.projectId;
  neo4j = new Neo4jService();

  // Clean up any leftover test data from prior failed runs
  await neo4j.run(
    `MATCH (n {projectId: $pid}) DETACH DELETE n`,
    { pid: projectId },
  );
}, 30000);

afterAll(async () => {
  if (eph) await eph.teardown();
  if (neo4j) await neo4j.close();
}, 10000);

beforeEach(async () => {
  // Clean slate before each test
  await neo4j.run(
    `MATCH (n {projectId: $pid}) DETACH DELETE n`,
    { pid: projectId },
  );
});

// ============================================================================
// PHASE A: SPEC CONTRACT TESTS
// ============================================================================

describe('Scope Resolver — Spec Contract Tests', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // SPEC: Section 4 — AnalysisScope schema requirements
  // ────────────────────────────────────────────────────────────────────────────

  describe('AnalysisScope Schema (SPEC: Section 4)', () => {
    it('must have required fields: id, verificationRunId, projectId, scopeCompleteness', () => {
      // SPEC: Section 4
      // AnalysisScope must have: id, verificationRunId, scopeCompleteness, targetNodeIds (or equivalent)

      const validScope: AnalysisScope = {
        id: 'scope_001',
        projectId: 'test_project',
        verificationRunId: 'vr_001',
        scopeCompleteness: 'complete',
        scanRoots: [],
        includedPaths: [],
        excludedPaths: [],
        supportedLanguages: [],
        analyzedLanguages: [],
        unscannedTargetNodeIds: [],
      };

      // Zod should accept this
      const result = AnalysisScopeSchema.safeParse(validScope);
      expect(result.success).toBe(true);
    });

    it('scopeCompleteness enum must be: complete | partial | unknown', () => {
      // SPEC: Section 4
      // scopeCompleteness enum: complete | partial | unknown

      const validValues = ['complete', 'partial', 'unknown'];
      for (const value of validValues) {
        const scope = {
          id: 'scope_test',
          projectId: 'test_project',
          verificationRunId: 'vr_001',
          scopeCompleteness: value,
        };
        const result = AnalysisScopeSchema.safeParse(scope);
        expect(result.success, `scopeCompleteness='${value}' should be valid`).toBe(true);
      }

      // Invalid value should fail
      const invalidScope = {
        id: 'scope_test',
        projectId: 'test_project',
        verificationRunId: 'vr_001',
        scopeCompleteness: 'invalid_value',
      };
      const result = AnalysisScopeSchema.safeParse(invalidScope);
      expect(result.success).toBe(false);
    });

    it('must have unscannedTargetNodeIds for explicit coverage gaps', () => {
      // SPEC: Section 4
      // unscannedTargetNodeIds for explicit coverage gaps

      const scope: AnalysisScope = {
        id: 'scope_with_gaps',
        projectId: 'test_project',
        verificationRunId: 'vr_001',
        scopeCompleteness: 'partial',
        scanRoots: ['/src'],
        includedPaths: ['/src/main.ts'],
        excludedPaths: ['/src/tests'],
        supportedLanguages: ['typescript'],
        analyzedLanguages: ['typescript'],
        unscannedTargetNodeIds: ['func_critical_001', 'func_critical_002'],
      };

      const result = AnalysisScopeSchema.safeParse(scope);
      expect(result.success).toBe(true);
      expect(result.data?.unscannedTargetNodeIds).toEqual(['func_critical_001', 'func_critical_002']);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SPEC: Section 17.1 item 10 — "UNKNOWN is not zero" rule
  // ────────────────────────────────────────────────────────────────────────────

  describe('UNKNOWN is not zero (SPEC: Section 17.1.10)', () => {
    it('scopeCompleteness=complete + clean scan → status=satisfies (correct)', async () => {
      // SPEC: Section 17.1 item 10
      // A clean scan with scopeCompleteness: 'complete' should result in status: 'satisfies'

      // Seed: VerificationRun with clean status + complete scope
      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_clean_complete',
          projectId: $pid,
          tool: 'test-scanner',
          ruleId: '__clean_run__',
          status: 'satisfies',
          confidence: 0.9
        })
        CREATE (s:AnalysisScope {
          id: 'scope_complete',
          projectId: $pid,
          verificationRunId: 'vr_clean_complete',
          scopeCompleteness: 'complete',
          targetFileCount: 10,
          analyzedFileCount: 10,
          skippedFileCount: 0,
          analysisErrorCount: 0
        })
        CREATE (vr)-[:HAS_SCOPE]->(s)
      `, { pid: projectId });

      // Run scope resolver
      const result = await runScopeResolver(projectId);

      // Check that the clean run was NOT downgraded
      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_clean_complete', projectId: $pid})
        RETURN vr.status AS status, vr.confidence AS confidence, vr.lifecycleState AS lifecycle
      `, { pid: projectId });

      expect(runs[0].status).toBe('satisfies');
      expect(Number(runs[0].confidence)).toBeGreaterThanOrEqual(0.9);
      expect(runs[0].lifecycle).not.toBe('scope_downgraded');
    });

    it('scopeCompleteness=partial + clean scan → status=unknown, confidence=0.3, lifecycleState=scope_downgraded', async () => {
      // SPEC: Section 17.1 item 10
      // "UNKNOWN is not zero": A clean scan with scopeCompleteness: 'partial' must NOT result in status: 'satisfies'
      // It must produce status: 'unknown' with reduced confidence

      // Seed: VerificationRun with clean status + partial scope
      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_clean_partial',
          projectId: $pid,
          tool: 'test-scanner',
          ruleId: '__clean_run__',
          status: 'satisfies',
          confidence: 0.9
        })
        CREATE (s:AnalysisScope {
          id: 'scope_partial',
          projectId: $pid,
          verificationRunId: 'vr_clean_partial',
          scopeCompleteness: 'partial',
          targetFileCount: 10,
          analyzedFileCount: 5,
          skippedFileCount: 0,
          analysisErrorCount: 0
        })
        CREATE (vr)-[:HAS_SCOPE]->(s)
      `, { pid: projectId });

      // Run scope resolver
      await runScopeResolver(projectId);

      // Verify the clean run was downgraded
      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_clean_partial', projectId: $pid})
        RETURN vr.status AS status, vr.confidence AS confidence, vr.lifecycleState AS lifecycle
      `, { pid: projectId });

      expect(runs[0].status).toBe('unknown');
      expect(Number(runs[0].confidence)).toBe(0.3);
      expect(runs[0].lifecycle).toBe('scope_downgraded');
    });

    it('scopeCompleteness=unknown + clean scan → status=unknown', async () => {
      // SPEC: Section 17.1 item 10
      // A clean scan with scopeCompleteness: 'unknown' must result in status: 'unknown'

      // Seed: VerificationRun with clean status + unknown scope
      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_clean_unknown',
          projectId: $pid,
          tool: 'test-scanner',
          ruleId: '__clean_run__',
          status: 'satisfies',
          confidence: 0.9
        })
        CREATE (s:AnalysisScope {
          id: 'scope_unknown',
          projectId: $pid,
          verificationRunId: 'vr_clean_unknown',
          scopeCompleteness: 'unknown',
          targetFileCount: 0,
          analyzedFileCount: 0
        })
        CREATE (vr)-[:HAS_SCOPE]->(s)
      `, { pid: projectId });

      // Run scope resolver
      await runScopeResolver(projectId);

      // Verify the clean run was downgraded
      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_clean_unknown', projectId: $pid})
        RETURN vr.status AS status, vr.confidence AS confidence
      `, { pid: projectId });

      expect(runs[0].status).toBe('unknown');
      expect(Number(runs[0].confidence)).toBe(0.3);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SPEC: Section 4 — UNSCANNED_FOR edges for critical targets
  // ────────────────────────────────────────────────────────────────────────────

  describe('UNSCANNED_FOR edges (SPEC: Section 4)', () => {
    it('critical targets (Spec/Invariant nodes) outside analyzed scope → UNSCANNED_FOR edges created', async () => {
      // SPEC: Section 4
      // Critical mappings outside analyzed scope -> UNKNOWN_FOR (using UNSCANNED_FOR edge type)

      // Seed: A critical Spec with APPLIES_TO a target Function,
      // but the AnalysisScope does NOT include that target
      await neo4j.run(`
        CREATE (spec:Spec {
          id: 'spec_critical_001',
          projectId: $pid,
          name: 'Critical Security Invariant',
          criticality: 'safety_critical'
        })
        CREATE (target:Function {
          id: 'func_target_001',
          projectId: $pid,
          name: 'processPayment',
          filePath: '/src/payment.ts'
        })
        CREATE (spec)-[:APPLIES_TO]->(target)
        CREATE (vr:VerificationRun {
          id: 'vr_limited_scope',
          projectId: $pid,
          tool: 'test-scanner'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_limited',
          projectId: $pid,
          verificationRunId: 'vr_limited_scope',
          scopeCompleteness: 'complete',
          includedPaths: ['/src/utils.ts']
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      // Run scope resolver
      const result = await runScopeResolver(projectId);

      // Verify UNSCANNED_FOR edge was created
      const edges = await neo4j.run(`
        MATCH (target:Function {id: 'func_target_001', projectId: $pid})-[u:UNKNOWN_FOR]->(spec:Spec)
        RETURN u.reason AS reason, u.projectId AS projectId
      `, { pid: projectId });

      expect(edges.length).toBe(1);
      expect(edges[0].reason).toBe('critical_target_outside_complete_scope');
      expect(result.unknownForEdgesCreated).toBeGreaterThanOrEqual(1);
    });

    it('if NO Spec/Invariant nodes exist, NO orphan UNSCANNED_FOR edges should be created', async () => {
      // SPEC: Section 4 + Implementation safety guard
      // If no Spec/Invariant nodes exist yet (pre-VG-5), this should be a no-op

      // Seed: AnalysisScope but NO Spec/Invariant nodes
      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_no_specs',
          projectId: $pid,
          tool: 'test-scanner'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_no_specs',
          projectId: $pid,
          verificationRunId: 'vr_no_specs',
          scopeCompleteness: 'partial',
          includedPaths: ['/src/']
        })
        CREATE (target:Function {
          id: 'func_orphan',
          projectId: $pid,
          name: 'someFunction',
          filePath: '/src/some.ts'
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      // Run scope resolver
      const result = await runScopeResolver(projectId);

      // Verify NO UNSCANNED_FOR edges were created
      const edges = await neo4j.run(`
        MATCH ()-[u:UNKNOWN_FOR]->()
        WHERE u.projectId = $pid
        RETURN count(u) AS count
      `, { pid: projectId });

      expect(Number(edges[0].count)).toBe(0);
      expect(result.unknownForEdgesCreated).toBe(0);
    });

    it('targets with high criticality trigger UNSCANNED_FOR; low criticality does not', async () => {
      // SPEC: Section 4
      // Only high/safety_critical Spec nodes trigger UNSCANNED_FOR

      await neo4j.run(`
        CREATE (specHigh:Spec {
          id: 'spec_high',
          projectId: $pid,
          name: 'High Criticality Spec',
          criticality: 'high'
        })
        CREATE (specLow:Spec {
          id: 'spec_low',
          projectId: $pid,
          name: 'Low Criticality Spec',
          criticality: 'low'
        })
        CREATE (targetHigh:Function {
          id: 'func_high',
          projectId: $pid,
          name: 'criticalFunc',
          filePath: '/src/critical.ts'
        })
        CREATE (targetLow:Function {
          id: 'func_low',
          projectId: $pid,
          name: 'trivialFunc',
          filePath: '/src/trivial.ts'
        })
        CREATE (specHigh)-[:APPLIES_TO]->(targetHigh)
        CREATE (specLow)-[:APPLIES_TO]->(targetLow)
        CREATE (vr:VerificationRun {
          id: 'vr_criticality_test',
          projectId: $pid,
          tool: 'test-scanner'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_criticality_test',
          projectId: $pid,
          verificationRunId: 'vr_criticality_test',
          scopeCompleteness: 'complete',
          includedPaths: ['/src/other.ts']
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      await runScopeResolver(projectId);

      // Check UNSCANNED_FOR edges
      const edges = await neo4j.run(`
        MATCH (f)-[u:UNKNOWN_FOR]->(s:Spec)
        WHERE s.projectId = $pid
        RETURN f.id AS targetId, s.criticality AS criticality
      `, { pid: projectId });

      // Should have edge for high criticality, not for low
      const targetIds = edges.map(e => e.targetId);
      expect(targetIds).toContain('func_high');
      expect(targetIds).not.toContain('func_low');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SPEC: Section 4 + 6 — Evidence grade capping for suppressed errors
  // ────────────────────────────────────────────────────────────────────────────

  describe('Evidence Grade Capping (SPEC: Section 4, 6)', () => {
    it('suppressed errors cap A1/A2 grades → A3 unless independently corroborated', async () => {
      // SPEC: Section 4, 6
      // "Cap evidence grade for runs with suppressed internal errors unless corroborated"

      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_suppressed',
          projectId: $pid,
          tool: 'scanner-a',
          evidenceGrade: 'A1',
          resultFingerprint: 'fp_suppressed_001'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_suppressed',
          projectId: $pid,
          verificationRunId: 'vr_suppressed',
          scopeCompleteness: 'partial',
          suppressedErrors: true
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      // Run scope resolver
      const result = await runScopeResolver(projectId);

      // Verify evidence grade was capped to A3
      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_suppressed', projectId: $pid})
        RETURN vr.evidenceGrade AS grade
      `, { pid: projectId });

      expect(runs[0].grade).toBe('A3');
      expect(result.evidenceGradeCapped).toBeGreaterThanOrEqual(1);
    });

    it('suppressed errors with corroboration from different tool → grade NOT capped', async () => {
      // SPEC: Section 4, 6
      // If another run (different tool) corroborates the same finding, don't cap

      const sharedFingerprint = `fp_corroborated_${randomUUID().slice(0, 8)}`;

      await neo4j.run(`
        // First run with suppressed errors
        CREATE (vr1:VerificationRun {
          id: 'vr_suppressed_corroborated',
          projectId: $pid,
          tool: 'scanner-a',
          evidenceGrade: 'A1',
          resultFingerprint: $fp
        })
        CREATE (scope1:AnalysisScope {
          id: 'scope_corroborated_1',
          projectId: $pid,
          verificationRunId: 'vr_suppressed_corroborated',
          scopeCompleteness: 'partial',
          suppressedErrors: true
        })
        CREATE (vr1)-[:HAS_SCOPE]->(scope1)
        
        // Second run from different tool with same fingerprint (corroboration)
        CREATE (vr2:VerificationRun {
          id: 'vr_corroborator',
          projectId: $pid,
          tool: 'scanner-b',
          evidenceGrade: 'A2',
          resultFingerprint: $fp
        })
      `, { pid: projectId, fp: sharedFingerprint });

      // Run scope resolver
      await runScopeResolver(projectId);

      // Verify evidence grade was NOT capped (corroboration present)
      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_suppressed_corroborated', projectId: $pid})
        RETURN vr.evidenceGrade AS grade
      `, { pid: projectId });

      // Grade should remain A1 because corroborated
      expect(runs[0].grade).toBe('A1');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SPEC: Section 4 — Contradiction detection
  // ────────────────────────────────────────────────────────────────────────────

  describe('Contradiction Detection (SPEC: Section 4)', () => {
    it('same target with both satisfies and violates from different tools → edge or flag', async () => {
      // SPEC: Section 4
      // Contradiction detection: same target with both satisfies and violates from different tools

      const sharedFingerprint = `fp_contradiction_${randomUUID().slice(0, 8)}`;

      await neo4j.run(`
        CREATE (vr1:VerificationRun {
          id: 'vr_satisfies',
          projectId: $pid,
          tool: 'tool-a',
          status: 'satisfies',
          resultFingerprint: $fp
        })
        CREATE (vr2:VerificationRun {
          id: 'vr_violates',
          projectId: $pid,
          tool: 'tool-b',
          status: 'violates',
          resultFingerprint: $fp
        })
      `, { pid: projectId, fp: sharedFingerprint });

      // Run scope resolver
      const result = await runScopeResolver(projectId);

      // Verify both runs are flagged as contradictions
      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {projectId: $pid})
        WHERE vr.resultFingerprint = $fp
        RETURN vr.id AS id, vr.hasContradiction AS hasContradiction
      `, { pid: projectId, fp: sharedFingerprint });

      expect(runs.length).toBe(2);
      for (const run of runs) {
        expect(run.hasContradiction).toBe(true);
      }
      expect(result.contradictionsDetected).toBeGreaterThanOrEqual(2);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SPEC: Section 4 — Scope completeness computation
  // ────────────────────────────────────────────────────────────────────────────

  describe('Scope Completeness Computation (SPEC: Section 4)', () => {
    it('analysisErrorCount > 0 → scopeCompleteness=partial', async () => {
      // SPEC: Section 4
      // Scopes with errors should be marked as partial

      await neo4j.run(`
        CREATE (scope:AnalysisScope {
          id: 'scope_with_errors',
          projectId: $pid,
          verificationRunId: 'vr_scope_errors',
          scopeCompleteness: 'complete',
          targetFileCount: 10,
          analyzedFileCount: 10,
          skippedFileCount: 0,
          analysisErrorCount: 5
        })
      `, { pid: projectId });

      // Run scope resolver
      await runScopeResolver(projectId);

      // Verify scope was recomputed to partial
      const scopes = await neo4j.run(`
        MATCH (s:AnalysisScope {id: 'scope_with_errors', projectId: $pid})
        RETURN s.scopeCompleteness AS completeness
      `, { pid: projectId });

      expect(scopes[0].completeness).toBe('partial');
    });

    it('analyzedFileCount >= targetFileCount, no errors, no skips → scopeCompleteness=complete', async () => {
      // SPEC: Section 4

      await neo4j.run(`
        CREATE (scope:AnalysisScope {
          id: 'scope_full_coverage',
          projectId: $pid,
          verificationRunId: 'vr_full_coverage',
          scopeCompleteness: 'partial',
          targetFileCount: 10,
          analyzedFileCount: 10,
          skippedFileCount: 0,
          analysisErrorCount: 0
        })
      `, { pid: projectId });

      await runScopeResolver(projectId);

      const scopes = await neo4j.run(`
        MATCH (s:AnalysisScope {id: 'scope_full_coverage', projectId: $pid})
        RETURN s.scopeCompleteness AS completeness
      `, { pid: projectId });

      expect(scopes[0].completeness).toBe('complete');
    });

    it('analyzedFileCount = 0 AND analysisErrorCount = 0 → scopeCompleteness=unknown', async () => {
      // SPEC: Section 4
      // Zero analyzed files and zero errors = unknown (not complete!)

      await neo4j.run(`
        CREATE (scope:AnalysisScope {
          id: 'scope_zero_analyzed',
          projectId: $pid,
          verificationRunId: 'vr_zero_analyzed',
          scopeCompleteness: 'complete',
          targetFileCount: 10,
          analyzedFileCount: 0,
          skippedFileCount: 0,
          analysisErrorCount: 0
        })
      `, { pid: projectId });

      await runScopeResolver(projectId);

      const scopes = await neo4j.run(`
        MATCH (s:AnalysisScope {id: 'scope_zero_analyzed', projectId: $pid})
        RETURN s.scopeCompleteness AS completeness
      `, { pid: projectId });

      expect(scopes[0].completeness).toBe('unknown');
    });

    it('0 < analyzedFileCount < targetFileCount → scopeCompleteness=partial', async () => {
      // SPEC: Section 4

      await neo4j.run(`
        CREATE (scope:AnalysisScope {
          id: 'scope_partial_analyzed',
          projectId: $pid,
          verificationRunId: 'vr_partial_analyzed',
          scopeCompleteness: 'complete',
          targetFileCount: 10,
          analyzedFileCount: 5,
          skippedFileCount: 0,
          analysisErrorCount: 0
        })
      `, { pid: projectId });

      await runScopeResolver(projectId);

      const scopes = await neo4j.run(`
        MATCH (s:AnalysisScope {id: 'scope_partial_analyzed', projectId: $pid})
        RETURN s.scopeCompleteness AS completeness
      `, { pid: projectId });

      expect(scopes[0].completeness).toBe('partial');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SPEC: Section 4 — HAS_SCOPE edge from VerificationRun to AnalysisScope
  // ────────────────────────────────────────────────────────────────────────────

  describe('HAS_SCOPE Edge Relationship (SPEC: Section 4)', () => {
    it('VerificationRun must link to AnalysisScope via HAS_SCOPE edge', async () => {
      // SPEC: Section 4
      // AnalysisScope must link to VerificationRun via HAS_SCOPE edge

      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_has_scope_test',
          projectId: $pid,
          tool: 'test-scanner'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_linked',
          projectId: $pid,
          verificationRunId: 'vr_has_scope_test',
          scopeCompleteness: 'complete'
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      // Verify the edge exists and is queryable
      const edges = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_has_scope_test', projectId: $pid})-[:HAS_SCOPE]->(s:AnalysisScope)
        RETURN s.id AS scopeId, s.scopeCompleteness AS completeness
      `, { pid: projectId });

      expect(edges.length).toBe(1);
      expect(edges[0].scopeId).toBe('scope_linked');
      expect(edges[0].completeness).toBe('complete');
    });
  });
});

// ============================================================================
// PHASE B: IMPLEMENTATION EDGE CASES
// ============================================================================

describe('Scope Resolver — Implementation Edge Cases', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: recomputeScopeCompleteness()
  // ────────────────────────────────────────────────────────────────────────────

  describe('recomputeScopeCompleteness() edge cases', () => {
    it('IMPL-EDGE-CASE: AnalysisScope with no targetNodeIds field', async () => {
      // What happens when AnalysisScope has no targetFileCount?
      // Should default to unknown (the safest assumption)

      await neo4j.run(`
        CREATE (scope:AnalysisScope {
          id: 'scope_no_target_count',
          projectId: $pid,
          verificationRunId: 'vr_no_target_count',
          scopeCompleteness: 'complete'
        })
      `, { pid: projectId });

      await runScopeResolver(projectId);

      const scopes = await neo4j.run(`
        MATCH (s:AnalysisScope {id: 'scope_no_target_count', projectId: $pid})
        RETURN s.scopeCompleteness AS completeness
      `, { pid: projectId });

      // With no targetFileCount and no analyzedFileCount, 
      // coalesce should treat them as 0, resulting in 'unknown'
      expect(scopes[0].completeness).toBe('unknown');
    });

    it('IMPL-EDGE-CASE: Multiple AnalysisScope nodes for same project', async () => {
      // When multiple scopes exist, all should be recomputed

      await neo4j.run(`
        CREATE (s1:AnalysisScope {
          id: 'scope_multi_1',
          projectId: $pid,
          verificationRunId: 'vr_multi_1',
          scopeCompleteness: 'complete',
          targetFileCount: 10,
          analyzedFileCount: 10,
          analysisErrorCount: 0,
          skippedFileCount: 0
        })
        CREATE (s2:AnalysisScope {
          id: 'scope_multi_2',
          projectId: $pid,
          verificationRunId: 'vr_multi_2',
          scopeCompleteness: 'complete',
          targetFileCount: 10,
          analyzedFileCount: 5,
          analysisErrorCount: 0,
          skippedFileCount: 0
        })
        CREATE (s3:AnalysisScope {
          id: 'scope_multi_3',
          projectId: $pid,
          verificationRunId: 'vr_multi_3',
          scopeCompleteness: 'complete',
          targetFileCount: 10,
          analyzedFileCount: 10,
          analysisErrorCount: 2,
          skippedFileCount: 0
        })
      `, { pid: projectId });

      const result = await runScopeResolver(projectId);

      const scopes = await neo4j.run(`
        MATCH (s:AnalysisScope {projectId: $pid})
        RETURN s.id AS id, s.scopeCompleteness AS completeness
        ORDER BY s.id
      `, { pid: projectId });

      // scope_multi_1: complete (all files, no errors)
      // scope_multi_2: partial (only 5 of 10 analyzed)
      // scope_multi_3: partial (has errors)
      expect(scopes.find(s => s.id === 'scope_multi_1')?.completeness).toBe('complete');
      expect(scopes.find(s => s.id === 'scope_multi_2')?.completeness).toBe('partial');
      expect(scopes.find(s => s.id === 'scope_multi_3')?.completeness).toBe('partial');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: downgradeCleanRunsWithIncompleteScope()
  // ────────────────────────────────────────────────────────────────────────────

  describe('downgradeCleanRunsWithIncompleteScope() edge cases', () => {
    it('IMPL-EDGE-CASE: only downgrades runs with ruleId=__clean_run__', async () => {
      // Non-clean-run statuses should not be affected

      await neo4j.run(`
        CREATE (vr_clean:VerificationRun {
          id: 'vr_clean_run_type',
          projectId: $pid,
          tool: 'scanner',
          ruleId: '__clean_run__',
          status: 'satisfies',
          confidence: 0.9
        })
        CREATE (vr_other:VerificationRun {
          id: 'vr_other_rule',
          projectId: $pid,
          tool: 'scanner',
          ruleId: 'sql_injection_check',
          status: 'satisfies',
          confidence: 0.9
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_clean_test',
          projectId: $pid,
          verificationRunId: 'vr_clean_run_type',
          scopeCompleteness: 'partial'
        })
        CREATE (scope2:AnalysisScope {
          id: 'scope_other_test',
          projectId: $pid,
          verificationRunId: 'vr_other_rule',
          scopeCompleteness: 'partial'
        })
        CREATE (vr_clean)-[:HAS_SCOPE]->(scope)
        CREATE (vr_other)-[:HAS_SCOPE]->(scope2)
      `, { pid: projectId });

      await runScopeResolver(projectId);

      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {projectId: $pid})
        RETURN vr.id AS id, vr.status AS status, vr.confidence AS confidence
      `, { pid: projectId });

      // Clean run should be downgraded
      const cleanRun = runs.find(r => r.id === 'vr_clean_run_type');
      expect(cleanRun?.status).toBe('unknown');
      expect(Number(cleanRun?.confidence)).toBe(0.3);

      // Other rule should NOT be downgraded
      const otherRun = runs.find(r => r.id === 'vr_other_rule');
      expect(otherRun?.status).toBe('satisfies');
      expect(Number(otherRun?.confidence)).toBe(0.9);
    });

    it('IMPL-EDGE-CASE: does not downgrade runs already at status=unknown', async () => {
      // If a run is already unknown, don't re-downgrade

      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_already_unknown',
          projectId: $pid,
          tool: 'scanner',
          ruleId: '__clean_run__',
          status: 'unknown',
          confidence: 0.5
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_already_unknown',
          projectId: $pid,
          verificationRunId: 'vr_already_unknown',
          scopeCompleteness: 'partial'
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      const result = await runScopeResolver(projectId);

      // Should report 0 downgrades since it's already unknown
      // (Implementation only downgrades status='satisfies')
      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_already_unknown', projectId: $pid})
        RETURN vr.status AS status, vr.confidence AS confidence, vr.lifecycleState AS lifecycle
      `, { pid: projectId });

      // Status should remain unchanged (already unknown)
      expect(runs[0].status).toBe('unknown');
      // The implementation only matches status='satisfies', so this won't be touched
    });

    it('IMPL-EDGE-CASE: runs without HAS_SCOPE edge are not affected', async () => {
      // If a VerificationRun has no HAS_SCOPE edge, it shouldn't be downgraded

      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_no_scope_edge',
          projectId: $pid,
          tool: 'scanner',
          ruleId: '__clean_run__',
          status: 'satisfies',
          confidence: 0.9
        })
      `, { pid: projectId });

      await runScopeResolver(projectId);

      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_no_scope_edge', projectId: $pid})
        RETURN vr.status AS status, vr.confidence AS confidence
      `, { pid: projectId });

      // Should remain satisfies (no HAS_SCOPE edge to match)
      expect(runs[0].status).toBe('satisfies');
      expect(Number(runs[0].confidence)).toBe(0.9);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: enforceUnknownForUncoveredCritical()
  // ────────────────────────────────────────────────────────────────────────────

  describe('enforceUnknownForUncoveredCritical() edge cases', () => {
    it('IMPL-EDGE-CASE: with 0 Spec nodes, returns 0 (no-op)', async () => {
      // Current state: no Spec/Invariant nodes exist
      // Should return 0 without creating any edges

      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_no_specs_exist',
          projectId: $pid,
          tool: 'scanner'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_no_specs',
          projectId: $pid,
          verificationRunId: 'vr_no_specs_exist',
          scopeCompleteness: 'partial',
          includedPaths: ['/src/']
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      const result = await runScopeResolver(projectId);

      expect(result.unknownForEdgesCreated).toBe(0);
    });

    it('IMPL-EDGE-CASE: Invariant nodes also trigger UNSCANNED_FOR', async () => {
      // Both Spec AND Invariant should be handled

      await neo4j.run(`
        CREATE (inv:Invariant {
          id: 'invariant_critical',
          projectId: $pid,
          name: 'Balance Must Not Go Negative',
          criticality: 'safety_critical'
        })
        CREATE (target:Function {
          id: 'func_balance',
          projectId: $pid,
          name: 'updateBalance',
          filePath: '/src/balance.ts'
        })
        CREATE (inv)-[:APPLIES_TO]->(target)
        CREATE (vr:VerificationRun {
          id: 'vr_invariant_test',
          projectId: $pid,
          tool: 'scanner'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_invariant_test',
          projectId: $pid,
          verificationRunId: 'vr_invariant_test',
          scopeCompleteness: 'complete',
          includedPaths: ['/src/other.ts']
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      const result = await runScopeResolver(projectId);

      const edges = await neo4j.run(`
        MATCH (f:Function)-[u:UNKNOWN_FOR]->(inv:Invariant)
        WHERE inv.projectId = $pid
        RETURN f.id AS targetId, inv.id AS invId
      `, { pid: projectId });

      expect(edges.length).toBe(1);
      expect(edges[0].targetId).toBe('func_balance');
      expect(result.unknownForEdgesCreated).toBe(1);
    });

    it('IMPL-EDGE-CASE: target inside includedPaths is NOT marked UNSCANNED_FOR', async () => {
      // If the target's filePath IS in includedPaths, no UNSCANNED_FOR edge

      await neo4j.run(`
        CREATE (spec:Spec {
          id: 'spec_covered',
          projectId: $pid,
          name: 'Covered Spec',
          criticality: 'high'
        })
        CREATE (target:Function {
          id: 'func_covered',
          projectId: $pid,
          name: 'coveredFunc',
          filePath: '/src/covered.ts'
        })
        CREATE (spec)-[:APPLIES_TO]->(target)
        CREATE (vr:VerificationRun {
          id: 'vr_covered_test',
          projectId: $pid,
          tool: 'scanner'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_covered_test',
          projectId: $pid,
          verificationRunId: 'vr_covered_test',
          scopeCompleteness: 'complete',
          includedPaths: ['/src/covered.ts'],
          targetFileCount: 1,
          analyzedFileCount: 1
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      const result = await runScopeResolver(projectId);

      const edges = await neo4j.run(`
        MATCH (f:Function {id: 'func_covered'})-[u:UNKNOWN_FOR]->(s:Spec)
        WHERE s.projectId = $pid
        RETURN count(u) AS count
      `, { pid: projectId });

      // Should NOT have UNSCANNED_FOR edge since target is in includedPaths
      expect(Number(edges[0].count)).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: capGradeForSuppressedErrors()
  // ────────────────────────────────────────────────────────────────────────────

  describe('capGradeForSuppressedErrors() edge cases', () => {
    it('IMPL-EDGE-CASE: what counts as independently corroborated', async () => {
      // Corroboration requires: different tool, same resultFingerprint

      const fp = `fp_corroboration_${randomUUID().slice(0, 8)}`;

      await neo4j.run(`
        // Run with suppressed errors
        CREATE (vr1:VerificationRun {
          id: 'vr_suppressed_needs_corroboration',
          projectId: $pid,
          tool: 'tool-alpha',
          evidenceGrade: 'A2',
          resultFingerprint: $fp
        })
        CREATE (scope1:AnalysisScope {
          id: 'scope_needs_corroboration',
          projectId: $pid,
          verificationRunId: 'vr_suppressed_needs_corroboration',
          suppressedErrors: true
        })
        CREATE (vr1)-[:HAS_SCOPE]->(scope1)
        
        // Same tool, same fingerprint - NOT corroboration (same tool)
        CREATE (vr2:VerificationRun {
          id: 'vr_same_tool',
          projectId: $pid,
          tool: 'tool-alpha',
          evidenceGrade: 'A1',
          resultFingerprint: $fp
        })
      `, { pid: projectId, fp });

      await runScopeResolver(projectId);

      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_suppressed_needs_corroboration', projectId: $pid})
        RETURN vr.evidenceGrade AS grade
      `, { pid: projectId });

      // Should be capped because vr_same_tool is same tool (not corroboration)
      expect(runs[0].grade).toBe('A3');
    });

    it('IMPL-EDGE-CASE: A3 grade is not further capped', async () => {
      // A3 is already the minimum grade, shouldn't be changed

      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_already_a3',
          projectId: $pid,
          tool: 'scanner',
          evidenceGrade: 'A3',
          resultFingerprint: 'fp_a3_test'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_a3_test',
          projectId: $pid,
          verificationRunId: 'vr_already_a3',
          suppressedErrors: true
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      const result = await runScopeResolver(projectId);

      // Should report 0 capped (A3 not in ['A1', 'A2'])
      // Note: The implementation filters for evidenceGrade IN ['A1', 'A2']
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: detectContradictions()
  // ────────────────────────────────────────────────────────────────────────────

  describe('detectContradictions() edge cases', () => {
    it('IMPL-EDGE-CASE: minimum data needed to trigger contradiction', async () => {
      // Need: two VRs with same resultFingerprint, different id, one satisfies, one violates

      const fp = `fp_min_contradiction_${randomUUID().slice(0, 8)}`;

      await neo4j.run(`
        CREATE (vr1:VerificationRun {
          id: 'vr_min_sat',
          projectId: $pid,
          status: 'satisfies',
          resultFingerprint: $fp
        })
        CREATE (vr2:VerificationRun {
          id: 'vr_min_vio',
          projectId: $pid,
          status: 'violates',
          resultFingerprint: $fp
        })
      `, { pid: projectId, fp });

      const result = await runScopeResolver(projectId);

      expect(result.contradictionsDetected).toBeGreaterThanOrEqual(2);
    });

    it('IMPL-EDGE-CASE: same status (both satisfies) is NOT a contradiction', async () => {
      const fp = `fp_same_status_${randomUUID().slice(0, 8)}`;

      await neo4j.run(`
        CREATE (vr1:VerificationRun {
          id: 'vr_both_sat_1',
          projectId: $pid,
          status: 'satisfies',
          resultFingerprint: $fp
        })
        CREATE (vr2:VerificationRun {
          id: 'vr_both_sat_2',
          projectId: $pid,
          status: 'satisfies',
          resultFingerprint: $fp
        })
      `, { pid: projectId, fp });

      const result = await runScopeResolver(projectId);

      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {projectId: $pid})
        WHERE vr.resultFingerprint = $fp
        RETURN vr.hasContradiction AS hasContradiction
      `, { pid: projectId, fp });

      // Neither should be flagged (same status)
      for (const run of runs) {
        expect(run.hasContradiction).toBeFalsy();
      }
    });

    it('IMPL-EDGE-CASE: different fingerprints are NOT contradictions', async () => {
      await neo4j.run(`
        CREATE (vr1:VerificationRun {
          id: 'vr_diff_fp_1',
          projectId: $pid,
          status: 'satisfies',
          resultFingerprint: 'fp_alpha'
        })
        CREATE (vr2:VerificationRun {
          id: 'vr_diff_fp_2',
          projectId: $pid,
          status: 'violates',
          resultFingerprint: 'fp_beta'
        })
      `, { pid: projectId });

      await runScopeResolver(projectId);

      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {projectId: $pid})
        WHERE vr.id IN ['vr_diff_fp_1', 'vr_diff_fp_2']
        RETURN vr.hasContradiction AS hasContradiction
      `, { pid: projectId });

      for (const run of runs) {
        expect(run.hasContradiction).toBeFalsy();
      }
    });

    it('IMPL-EDGE-CASE: same run cannot contradict itself (r1.id <> r2.id guard)', async () => {
      const fp = `fp_self_${randomUUID().slice(0, 8)}`;

      // Create a single run (can't contradict itself)
      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_single_run',
          projectId: $pid,
          status: 'satisfies',
          resultFingerprint: $fp
        })
      `, { pid: projectId, fp });

      await runScopeResolver(projectId);

      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_single_run', projectId: $pid})
        RETURN vr.hasContradiction AS hasContradiction
      `, { pid: projectId });

      expect(runs[0].hasContradiction).toBeFalsy();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: Cypher queries with empty graph slices
  // ────────────────────────────────────────────────────────────────────────────

  describe('Empty graph slice handling', () => {
    it('IMPL-EDGE-CASE: runScopeResolver on project with no AnalysisScope nodes', async () => {
      // No AnalysisScope, no VerificationRun — should not error

      const result = await runScopeResolver(projectId);

      expect(result.scopeRecomputed).toBe(0);
      expect(result.cleanRunsDowngraded).toBe(0);
      expect(result.unknownForEdgesCreated).toBe(0);
      expect(result.evidenceGradeCapped).toBe(0);
      expect(result.contradictionsDetected).toBe(0);
    });

    it('IMPL-EDGE-CASE: project with VerificationRuns but no AnalysisScopes', async () => {
      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_orphan',
          projectId: $pid,
          tool: 'scanner',
          ruleId: '__clean_run__',
          status: 'satisfies'
        })
      `, { pid: projectId });

      const result = await runScopeResolver(projectId);

      // No AnalysisScope to recompute, no HAS_SCOPE edges to traverse
      expect(result.scopeRecomputed).toBe(0);
      expect(result.cleanRunsDowngraded).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: Idempotency
  // ────────────────────────────────────────────────────────────────────────────

  describe('Idempotency', () => {
    it('IMPL-EDGE-CASE: running scope resolver twice produces same result', async () => {
      await neo4j.run(`
        CREATE (vr:VerificationRun {
          id: 'vr_idempotent',
          projectId: $pid,
          tool: 'scanner',
          ruleId: '__clean_run__',
          status: 'satisfies',
          confidence: 0.9
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_idempotent',
          projectId: $pid,
          verificationRunId: 'vr_idempotent',
          scopeCompleteness: 'partial',
          targetFileCount: 10,
          analyzedFileCount: 5
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      // First run
      const result1 = await runScopeResolver(projectId);

      // Second run
      const result2 = await runScopeResolver(projectId);

      // First run should have downgraded
      expect(result1.cleanRunsDowngraded).toBe(1);

      // Second run should not downgrade again (already unknown)
      expect(result2.cleanRunsDowngraded).toBe(0);

      // Final state should be consistent
      const runs = await neo4j.run(`
        MATCH (vr:VerificationRun {id: 'vr_idempotent', projectId: $pid})
        RETURN vr.status AS status, vr.confidence AS confidence
      `, { pid: projectId });

      expect(runs[0].status).toBe('unknown');
      expect(Number(runs[0].confidence)).toBe(0.3);
    });

    it('IMPL-EDGE-CASE: UNSCANNED_FOR uses MERGE to prevent duplicates', async () => {
      await neo4j.run(`
        CREATE (spec:Spec {
          id: 'spec_merge_test',
          projectId: $pid,
          name: 'Merge Test Spec',
          criticality: 'safety_critical'
        })
        CREATE (target:Function {
          id: 'func_merge_test',
          projectId: $pid,
          name: 'mergeTestFunc',
          filePath: '/src/merge.ts'
        })
        CREATE (spec)-[:APPLIES_TO]->(target)
        CREATE (vr:VerificationRun {
          id: 'vr_merge_test',
          projectId: $pid,
          tool: 'scanner'
        })
        CREATE (scope:AnalysisScope {
          id: 'scope_merge_test',
          projectId: $pid,
          verificationRunId: 'vr_merge_test',
          scopeCompleteness: 'complete',
          includedPaths: ['/src/other.ts']
        })
        CREATE (vr)-[:HAS_SCOPE]->(scope)
      `, { pid: projectId });

      // Run twice
      await runScopeResolver(projectId);
      await runScopeResolver(projectId);

      // Should only have ONE UNSCANNED_FOR edge (MERGE prevents duplicates)
      const edges = await neo4j.run(`
        MATCH (f:Function {id: 'func_merge_test'})-[u:UNKNOWN_FOR]->(s:Spec)
        WHERE s.projectId = $pid
        RETURN count(u) AS count
      `, { pid: projectId });

      expect(Number(edges[0].count)).toBe(1);
    });
  });
});
