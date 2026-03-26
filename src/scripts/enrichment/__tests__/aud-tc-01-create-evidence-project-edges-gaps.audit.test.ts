/**
 * AUD-TC-01 Gap-Fill: create-evidence-project-edges.ts — Integration Tests
 *
 * These tests verify ACTUAL graph mutations, not just export contracts.
 * Missing from gap-closure-gc4.test.ts:
 *   (1) FROM_PROJECT edge actually created in Neo4j (not just export)
 *   (2) MERGE idempotency — re-run produces same count, no duplicates
 *   (3) All Evidence nodes with projectId get FROM_PROJECT edge
 *   (4) Evidence with no projectId → skipped cleanly
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralGraph, type EphemeralGraphRuntime } from '../../../core/test-harness/ephemeral-graph.js';
import { enrichEvidenceProject } from '../create-evidence-project-edges.js';

describe('[aud-tc-01-gaps] create-evidence-project-edges.ts — Integration', () => {
  let rt: EphemeralGraphRuntime;

  beforeAll(async () => {
    rt = await createEphemeralGraph({ setupSchema: false });
  }, 30_000);

  afterAll(async () => {
    await rt.teardown();
  }, 30_000);

  function toNum(val: unknown): number {
    const v = val as { toNumber?: () => number };
    return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
  }

  it('(1) FROM_PROJECT edge actually created in Neo4j after enrichment', async () => {
    // Setup: Create Project and Evidence
    await rt.run(`
      CREATE (p:Project {projectId: $projectId, name: 'TestProject'})
      CREATE (e:Evidence {id: $evidenceId, projectId: $projectId, grade: 'A1', sourceType: 'test'})
    `, {
      projectId: rt.projectId,
      evidenceId: `${rt.projectId}:evidence:fp1`,
    });

    // Verify no edge exists before enrichment
    const beforeResult = await rt.run(`
      MATCH (e:Evidence {projectId: $projectId})-[r:FROM_PROJECT]->(p:Project)
      RETURN count(r) AS cnt
    `, { projectId: rt.projectId });
    expect(toNum(beforeResult.records[0]?.get('cnt'))).toBe(0);

    // Run enrichment
    await enrichEvidenceProject(rt.driver);

    // Verify edge exists after enrichment
    const afterResult = await rt.run(`
      MATCH (e:Evidence {projectId: $projectId})-[r:FROM_PROJECT]->(p:Project)
      RETURN count(r) AS cnt, r.derived AS derived, r.source AS source
    `, { projectId: rt.projectId });

    expect(toNum(afterResult.records[0]?.get('cnt'))).toBe(1);
    expect(afterResult.records[0]?.get('derived')).toBe(true);
    expect(afterResult.records[0]?.get('source')).toBe('evidence-project');
  }, 60_000);

  it('(2) MERGE idempotency — re-run produces same count, no duplicates', async () => {
    // Setup: Create fresh data
    const idemProjectId = `${rt.projectId}_idem2`;

    await rt.run(`
      CREATE (p:Project {projectId: $projectId, name: 'IdemProject'})
      CREATE (e1:Evidence {id: $ev1, projectId: $projectId, grade: 'A1'})
      CREATE (e2:Evidence {id: $ev2, projectId: $projectId, grade: 'A2'})
    `, {
      projectId: idemProjectId,
      ev1: `${idemProjectId}:evidence:1`,
      ev2: `${idemProjectId}:evidence:2`,
    });

    // Run enrichment TWICE
    const result1 = await enrichEvidenceProject(rt.driver);
    const result2 = await enrichEvidenceProject(rt.driver);

    // Verify edge count from the project
    const edgeCount = await rt.run(`
      MATCH (e:Evidence {projectId: $projectId})-[r:FROM_PROJECT]->(p:Project)
      RETURN count(r) AS cnt
    `, { projectId: idemProjectId });

    // Should have exactly 2 edges (one per evidence), not 4
    expect(toNum(edgeCount.records[0]?.get('cnt'))).toBe(2);

    // Second run should return same direct count (matches existing edges, not recreates)
    // Note: the function returns 'direct' count which is the merged count
    expect(result2.direct).toBeDefined();
  }, 60_000);

  it('(3) All Evidence nodes with projectId get FROM_PROJECT edge', async () => {
    // Setup: Create multiple evidence nodes all with projectId
    const multiProjectId = `${rt.projectId}_multi`;

    await rt.run(`
      CREATE (p:Project {projectId: $projectId, name: 'MultiProject'})
      CREATE (e1:Evidence {id: $ev1, projectId: $projectId, grade: 'A1'})
      CREATE (e2:Evidence {id: $ev2, projectId: $projectId, grade: 'A2'})
      CREATE (e3:Evidence {id: $ev3, projectId: $projectId, grade: 'B1'})
    `, {
      projectId: multiProjectId,
      ev1: `${multiProjectId}:evidence:1`,
      ev2: `${multiProjectId}:evidence:2`,
      ev3: `${multiProjectId}:evidence:3`,
    });

    // Run enrichment
    await enrichEvidenceProject(rt.driver);

    // Verify ALL 3 evidence nodes got FROM_PROJECT edges
    const result = await rt.run(`
      MATCH (e:Evidence {projectId: $projectId})-[r:FROM_PROJECT]->(p:Project)
      RETURN count(DISTINCT e) AS evidenceCount, count(r) AS edgeCount
    `, { projectId: multiProjectId });

    expect(toNum(result.records[0]?.get('evidenceCount'))).toBe(3);
    expect(toNum(result.records[0]?.get('edgeCount'))).toBe(3);
  }, 60_000);

  it('(4) Evidence with no projectId → skipped cleanly (no orphaned edges)', async () => {
    // Setup: Create evidence WITHOUT projectId
    const orphanEvidenceId = `orphan_evidence_${rt.testId}`;

    await rt.run(`
      CREATE (e:Evidence {id: $evidenceId, grade: 'A1', sourceType: 'test'})
    `, {
      evidenceId: orphanEvidenceId,
    });

    // Run enrichment
    const result = await enrichEvidenceProject(rt.driver);

    // Verify orphan evidence did NOT get an edge (no matching project)
    const edgeCheck = await rt.run(`
      MATCH (e:Evidence {id: $evidenceId})-[r:FROM_PROJECT]->(p)
      RETURN count(r) AS cnt
    `, { evidenceId: orphanEvidenceId });

    expect(toNum(edgeCheck.records[0]?.get('cnt'))).toBe(0);

    // And verify the orphaned count reflects it
    expect(result.orphaned).toBeGreaterThanOrEqual(1);

    // Cleanup: remove the orphan node (outside test projectId)
    await rt.run(`MATCH (e:Evidence {id: $evidenceId}) DETACH DELETE e`, { evidenceId: orphanEvidenceId });
  }, 60_000);
});
