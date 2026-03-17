/**
 * Scope Resolver (VG-3) — Spec Tests
 *
 * Tests the scope-aware resolver pipeline in scope-resolver.ts.
 * Each function has a specific verification responsibility:
 *   - recomputeScopeCompleteness: classify AnalysisScope as complete/partial/unknown
 *   - downgradeCleanRunsWithIncompleteScope: don't trust "no findings" if scope was partial
 *   - enforceUnknownForUncoveredCritical: flag critical code outside analyzed scope
 *   - capGradeForSuppressedErrors: uncorroborated runs with suppressed errors get A3 max
 *   - detectContradictions: same fingerprint with satisfies AND violates = contradiction
 *   - runScopeResolver: full pipeline orchestration
 *
 * These tests create ephemeral test data in Neo4j, verify behavior, and clean up.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';
import { runScopeResolver } from '../../../../core/verification/scope-resolver.js';

const TEST_PROJECT = '__test_scope_resolver__';

describe('Scope Resolver (VG-3)', () => {
  let neo4j: Neo4jService;

  beforeAll(() => {
    neo4j = new Neo4jService();
  });

  afterAll(async () => {
    await neo4j.close();
  });

  afterEach(async () => {
    // Clean up all test data
    await neo4j.run(
      `MATCH (n) WHERE n.projectId = $pid DETACH DELETE n`,
      { pid: TEST_PROJECT },
    );
  });

  describe('recomputeScopeCompleteness', () => {
    it('marks scope with errors as partial', async () => {
      // Create an AnalysisScope with errors but currently marked 'complete'
      await neo4j.run(`
        CREATE (:AnalysisScope {
          projectId: $pid,
          scopeCompleteness: 'complete',
          analysisErrorCount: 3,
          targetFileCount: 10,
          analyzedFileCount: 10,
          skippedFileCount: 0
        })
      `, { pid: TEST_PROJECT });

      const result = await runScopeResolver(TEST_PROJECT);

      // Should have recomputed at least one scope
      expect(result.scopeRecomputed).toBeGreaterThanOrEqual(1);

      // Verify scope was downgraded to partial
      const rows = await neo4j.run(
        `MATCH (s:AnalysisScope {projectId: $pid}) RETURN s.scopeCompleteness AS status`,
        { pid: TEST_PROJECT },
      );
      expect(rows[0]?.status).toBe('partial');
    });

    it('marks fully analyzed scope with no errors as complete', async () => {
      await neo4j.run(`
        CREATE (:AnalysisScope {
          projectId: $pid,
          scopeCompleteness: 'unknown',
          analysisErrorCount: 0,
          targetFileCount: 10,
          analyzedFileCount: 10,
          skippedFileCount: 0
        })
      `, { pid: TEST_PROJECT });

      await runScopeResolver(TEST_PROJECT);

      const rows = await neo4j.run(
        `MATCH (s:AnalysisScope {projectId: $pid}) RETURN s.scopeCompleteness AS status`,
        { pid: TEST_PROJECT },
      );
      expect(rows[0]?.status).toBe('complete');
    });

    it('marks scope with zero analyzed files as unknown', async () => {
      await neo4j.run(`
        CREATE (:AnalysisScope {
          projectId: $pid,
          scopeCompleteness: 'complete',
          analysisErrorCount: 0,
          targetFileCount: 10,
          analyzedFileCount: 0,
          skippedFileCount: 0
        })
      `, { pid: TEST_PROJECT });

      await runScopeResolver(TEST_PROJECT);

      const rows = await neo4j.run(
        `MATCH (s:AnalysisScope {projectId: $pid}) RETURN s.scopeCompleteness AS status`,
        { pid: TEST_PROJECT },
      );
      expect(rows[0]?.status).toBe('unknown');
    });

    it('marks partially analyzed scope as partial', async () => {
      await neo4j.run(`
        CREATE (:AnalysisScope {
          projectId: $pid,
          scopeCompleteness: 'complete',
          analysisErrorCount: 0,
          targetFileCount: 10,
          analyzedFileCount: 7,
          skippedFileCount: 0
        })
      `, { pid: TEST_PROJECT });

      await runScopeResolver(TEST_PROJECT);

      const rows = await neo4j.run(
        `MATCH (s:AnalysisScope {projectId: $pid}) RETURN s.scopeCompleteness AS status`,
        { pid: TEST_PROJECT },
      );
      expect(rows[0]?.status).toBe('partial');
    });
  });

  describe('downgradeCleanRunsWithIncompleteScope', () => {
    it('downgrades clean run confidence when scope is partial', async () => {
      // Create an AnalysisScope that is partial
      await neo4j.run(`
        CREATE (s:AnalysisScope {
          projectId: $pid,
          scopeCompleteness: 'partial',
          targetFileCount: 10,
          analyzedFileCount: 5
        })
        CREATE (r:VerificationRun {
          projectId: $pid,
          id: 'vr_test_clean_1',
          ruleId: '__clean_run__',
          status: 'satisfies',
          confidence: 0.9,
          lifecycleState: 'active'
        })
        CREATE (r)-[:HAS_SCOPE]->(s)
      `, { pid: TEST_PROJECT });

      const result = await runScopeResolver(TEST_PROJECT);
      expect(result.cleanRunsDowngraded).toBeGreaterThanOrEqual(1);

      // Verify downgrade
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {id: 'vr_test_clean_1'})
         RETURN r.status AS status, r.confidence AS conf, r.lifecycleState AS state`,
      );
      expect(rows[0]?.status).toBe('unknown');
      expect(Number(rows[0]?.conf)).toBe(0.3);
      expect(rows[0]?.state).toBe('scope_downgraded');
    });

    it('does NOT downgrade clean runs with complete scope', async () => {
      await neo4j.run(`
        CREATE (s:AnalysisScope {
          projectId: $pid,
          scopeCompleteness: 'complete',
          targetFileCount: 10,
          analyzedFileCount: 10
        })
        CREATE (r:VerificationRun {
          projectId: $pid,
          id: 'vr_test_clean_2',
          ruleId: '__clean_run__',
          status: 'satisfies',
          confidence: 0.9,
          lifecycleState: 'active'
        })
        CREATE (r)-[:HAS_SCOPE]->(s)
      `, { pid: TEST_PROJECT });

      const result = await runScopeResolver(TEST_PROJECT);
      // Clean runs with complete scope should NOT be downgraded
      expect(result.cleanRunsDowngraded).toBe(0);

      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {id: 'vr_test_clean_2'})
         RETURN r.status AS status, r.confidence AS conf`,
      );
      expect(rows[0]?.status).toBe('satisfies');
      expect(Number(rows[0]?.conf)).toBe(0.9);
    });
  });

  describe('capGradeForSuppressedErrors', () => {
    it('caps A1/A2 grade to A3 when scope has suppressed errors and no corroboration', async () => {
      await neo4j.run(`
        CREATE (s:AnalysisScope {
          projectId: $pid,
          suppressedErrors: true,
          scopeCompleteness: 'complete'
        })
        CREATE (r:VerificationRun {
          projectId: $pid,
          id: 'vr_test_suppress_1',
          tool: 'semgrep',
          evidenceGrade: 'A1',
          resultFingerprint: 'fp_unique_no_corroboration',
          status: 'violates'
        })
        CREATE (r)-[:HAS_SCOPE]->(s)
      `, { pid: TEST_PROJECT });

      const result = await runScopeResolver(TEST_PROJECT);
      expect(result.evidenceGradeCapped).toBeGreaterThanOrEqual(1);

      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {id: 'vr_test_suppress_1'})
         RETURN r.evidenceGrade AS grade`,
      );
      expect(rows[0]?.grade).toBe('A3');
    });

    it('does NOT cap grade when another tool corroborates the finding', async () => {
      await neo4j.run(`
        CREATE (s:AnalysisScope {
          projectId: $pid,
          suppressedErrors: true,
          scopeCompleteness: 'complete'
        })
        CREATE (r1:VerificationRun {
          projectId: $pid,
          id: 'vr_test_suppress_2a',
          tool: 'semgrep',
          evidenceGrade: 'A1',
          resultFingerprint: 'fp_corroborated',
          status: 'violates'
        })
        CREATE (r2:VerificationRun {
          projectId: $pid,
          id: 'vr_test_suppress_2b',
          tool: 'eslint',
          evidenceGrade: 'A2',
          resultFingerprint: 'fp_corroborated',
          status: 'violates'
        })
        CREATE (r1)-[:HAS_SCOPE]->(s)
      `, { pid: TEST_PROJECT });

      const result = await runScopeResolver(TEST_PROJECT);
      // Should NOT cap because eslint corroborates
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun {id: 'vr_test_suppress_2a'})
         RETURN r.evidenceGrade AS grade`,
      );
      expect(rows[0]?.grade).toBe('A1');
    });
  });

  describe('detectContradictions', () => {
    it('flags VRs with same fingerprint but opposite status', async () => {
      await neo4j.run(`
        CREATE (r1:VerificationRun {
          projectId: $pid,
          id: 'vr_test_contra_sat',
          status: 'satisfies',
          resultFingerprint: 'fp_contradiction_test'
        })
        CREATE (r2:VerificationRun {
          projectId: $pid,
          id: 'vr_test_contra_vio',
          status: 'violates',
          resultFingerprint: 'fp_contradiction_test'
        })
      `, { pid: TEST_PROJECT });

      const result = await runScopeResolver(TEST_PROJECT);
      expect(result.contradictionsDetected).toBeGreaterThanOrEqual(1);

      // Both should be flagged
      const rows = await neo4j.run(
        `MATCH (r:VerificationRun)
         WHERE r.id IN ['vr_test_contra_sat', 'vr_test_contra_vio']
         RETURN r.id AS id, r.hasContradiction AS flagged`,
      );
      for (const row of rows) {
        expect(row.flagged).toBe(true);
      }
    });

    it('does NOT flag VRs with different fingerprints', async () => {
      await neo4j.run(`
        CREATE (r1:VerificationRun {
          projectId: $pid,
          id: 'vr_test_nocontra_1',
          status: 'satisfies',
          resultFingerprint: 'fp_different_a'
        })
        CREATE (r2:VerificationRun {
          projectId: $pid,
          id: 'vr_test_nocontra_2',
          status: 'violates',
          resultFingerprint: 'fp_different_b'
        })
      `, { pid: TEST_PROJECT });

      const result = await runScopeResolver(TEST_PROJECT);
      expect(result.contradictionsDetected).toBe(0);
    });
  });

  describe('runScopeResolver (full pipeline)', () => {
    it('returns all five metrics from a single pass', async () => {
      // Create minimal data for each metric to exercise
      await neo4j.run(`
        CREATE (:AnalysisScope {
          projectId: $pid,
          scopeCompleteness: 'unknown',
          analysisErrorCount: 0,
          targetFileCount: 5,
          analyzedFileCount: 5,
          skippedFileCount: 0
        })
      `, { pid: TEST_PROJECT });

      const result = await runScopeResolver(TEST_PROJECT);

      expect(result).toHaveProperty('scopeRecomputed');
      expect(result).toHaveProperty('cleanRunsDowngraded');
      expect(result).toHaveProperty('unknownForEdgesCreated');
      expect(result).toHaveProperty('evidenceGradeCapped');
      expect(result).toHaveProperty('contradictionsDetected');

      // All metrics should be numbers
      for (const key of Object.keys(result) as (keyof typeof result)[]) {
        expect(typeof result[key]).toBe('number');
      }
    });

    it('scope recomputation happens before clean run downgrade (ordering)', async () => {
      // Create a scope that LOOKS complete but has errors (should become partial)
      // AND a clean run linked to it. If ordering is wrong, downgrade won't trigger.
      await neo4j.run(`
        CREATE (s:AnalysisScope {
          projectId: $pid,
          scopeCompleteness: 'complete',
          analysisErrorCount: 2,
          targetFileCount: 10,
          analyzedFileCount: 10,
          skippedFileCount: 0
        })
        CREATE (r:VerificationRun {
          projectId: $pid,
          id: 'vr_test_ordering',
          ruleId: '__clean_run__',
          status: 'satisfies',
          confidence: 0.9,
          lifecycleState: 'active'
        })
        CREATE (r)-[:HAS_SCOPE]->(s)
      `, { pid: TEST_PROJECT });

      const result = await runScopeResolver(TEST_PROJECT);

      // Scope should have been recomputed to 'partial' FIRST
      expect(result.scopeRecomputed).toBeGreaterThanOrEqual(1);
      // THEN clean run should have been downgraded because scope became partial
      expect(result.cleanRunsDowngraded).toBeGreaterThanOrEqual(1);

      // Verify end state
      const vr = await neo4j.run(
        `MATCH (r:VerificationRun {id: 'vr_test_ordering'})
         RETURN r.status AS status, r.confidence AS conf`,
      );
      expect(vr[0]?.status).toBe('unknown');
      expect(Number(vr[0]?.conf)).toBe(0.3);
    });
  });
});
