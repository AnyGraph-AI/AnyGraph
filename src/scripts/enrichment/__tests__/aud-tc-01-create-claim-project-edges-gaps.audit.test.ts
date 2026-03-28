/**
 * AUD-TC-01 Gap-Fill: create-claim-project-edges.ts — Integration Tests
 *
 * These tests verify ACTUAL graph mutations, not just export contracts.
 * Missing from gap-closure-gc3.test.ts:
 *   (1) SPANS_PROJECT edge is actually created in Neo4j
 *   (2) MERGE idempotency — running twice creates exactly 1 edge, not 2
 *   (3) Cross-project: claim with evidence from 2 projects → 2 SPANS_PROJECT edges
 *   (4) Claim with no evidence → 0 SPANS_PROJECT edges (no spurious edges)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralGraph, type EphemeralGraphRuntime } from '../../../core/test-harness/ephemeral-graph.js';
import { enrichClaimProjects } from '../create-claim-project-edges.js';

describe('[aud-tc-01-gaps] create-claim-project-edges.ts — Integration', () => {
  let rt: EphemeralGraphRuntime;

  beforeAll(async () => {
    rt = await createEphemeralGraph({ setupSchema: false });
  }, 60_000);

  afterAll(async () => {
    await rt.teardown();
  }, 60_000);

  function toNum(val: unknown): number {
    const v = val as { toNumber?: () => number };
    return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
  }

  it('(1) SPANS_PROJECT edge is actually created in Neo4j after enrichment', async () => {
    // Setup: Create Project, Claim, Evidence with proper structure
    await rt.run(`
      CREATE (p:Project {projectId: $projectId, name: 'TestProject'})
      CREATE (c:Claim {id: $claimId, projectId: $projectId, domain: 'code', status: 'supported'})
      CREATE (e:Evidence {id: $evidenceId, projectId: $projectId, grade: 'A1'})
      CREATE (c)-[:SUPPORTED_BY]->(e)
    `, {
      projectId: rt.projectId,
      claimId: `${rt.projectId}:claim:test1`,
      evidenceId: `${rt.projectId}:evidence:test1`,
    });

    // Verify no edge exists before enrichment
    const beforeResult = await rt.run(`
      MATCH (c:Claim {projectId: $projectId})-[r:SPANS_PROJECT]->(p:Project)
      RETURN count(r) AS cnt
    `, { projectId: rt.projectId });
    expect(toNum(beforeResult.records[0]?.get('cnt'))).toBe(0);

    // Run enrichment
    await enrichClaimProjects(rt.driver, rt.projectId);

    // Verify edge exists after enrichment
    const afterResult = await rt.run(`
      MATCH (c:Claim {projectId: $projectId})-[r:SPANS_PROJECT]->(p:Project)
      RETURN count(r) AS cnt, r.derived AS derived, r.source AS source
    `, { projectId: rt.projectId });

    expect(toNum(afterResult.records[0]?.get('cnt'))).toBe(1);
    expect(afterResult.records[0]?.get('derived')).toBe(true);
    expect(afterResult.records[0]?.get('source')).toBe('claim-project');
  }, 60_000);

  it('(2) MERGE idempotency — running twice creates exactly 1 edge, not 2', async () => {
    // Setup: Create fresh data for this test
    const claimId2 = `${rt.projectId}:claim:idempotency`;
    const evidenceId2 = `${rt.projectId}:evidence:idempotency`;

    await rt.run(`
      CREATE (p:Project {projectId: $projectId2, name: 'IdempotencyProject'})
      CREATE (c:Claim {id: $claimId, projectId: $projectId2, domain: 'code'})
      CREATE (e:Evidence {id: $evidenceId, projectId: $projectId2, grade: 'A2'})
      CREATE (c)-[:SUPPORTED_BY]->(e)
    `, {
      projectId2: `${rt.projectId}_idem`,
      claimId: claimId2,
      evidenceId: evidenceId2,
    });

    // Run enrichment TWICE
    await enrichClaimProjects(rt.driver, `${rt.projectId}_idem`);
    await enrichClaimProjects(rt.driver, `${rt.projectId}_idem`);

    // Verify only 1 edge exists (MERGE prevents duplicates)
    const result = await rt.run(`
      MATCH (c:Claim {id: $claimId})-[r:SPANS_PROJECT]->(p:Project)
      RETURN count(r) AS cnt
    `, { claimId: claimId2 });

    expect(toNum(result.records[0]?.get('cnt'))).toBe(1);
  }, 60_000);

  it('(3) Cross-project: claim with evidence from 2 projects → 2 SPANS_PROJECT edges', async () => {
    // Setup: Create claim with evidence touching TWO different projects
    const baseId = `${rt.projectId}_cross`;
    const proj1 = `${baseId}_A`;
    const proj2 = `${baseId}_B`;

    await rt.run(`
      CREATE (p1:Project {projectId: $proj1, name: 'ProjectA'})
      CREATE (p2:Project {projectId: $proj2, name: 'ProjectB'})
      CREATE (c:Claim {id: $claimId, projectId: $proj1, domain: 'cross'})
      CREATE (e1:Evidence {id: $ev1, projectId: $proj1, grade: 'A1'})
      CREATE (e2:Evidence {id: $ev2, projectId: $proj2, grade: 'A1'})
      CREATE (c)-[:SUPPORTED_BY]->(e1)
      CREATE (c)-[:SUPPORTED_BY]->(e2)
    `, {
      proj1,
      proj2,
      claimId: `${baseId}:claim:multi`,
      ev1: `${baseId}:evidence:1`,
      ev2: `${baseId}:evidence:2`,
    });

    // Run enrichment for both projects (or with no filter)
    await enrichClaimProjects(rt.driver, proj1);
    await enrichClaimProjects(rt.driver, proj2);

    // Verify claim has edges to BOTH projects
    const result = await rt.run(`
      MATCH (c:Claim {id: $claimId})-[r:SPANS_PROJECT]->(p:Project)
      RETURN count(r) AS cnt, collect(p.projectId) AS projects
    `, { claimId: `${baseId}:claim:multi` });

    expect(toNum(result.records[0]?.get('cnt'))).toBe(2);
    const projects = result.records[0]?.get('projects') as string[];
    expect(projects).toContain(proj1);
    expect(projects).toContain(proj2);
  }, 60_000);

  it('(4) Claim with no evidence → 0 SPANS_PROJECT edges (no spurious edges)', async () => {
    // Setup: Create claim with NO supporting evidence
    const orphanProjectId = `${rt.projectId}_orphan`;

    await rt.run(`
      CREATE (p:Project {projectId: $projectId, name: 'OrphanProject'})
      CREATE (c:Claim {id: $claimId, projectId: $projectId, domain: 'code', status: 'unsupported'})
    `, {
      projectId: orphanProjectId,
      claimId: `${orphanProjectId}:claim:orphan`,
    });

    // Run enrichment
    await enrichClaimProjects(rt.driver, orphanProjectId);

    // Verify no spurious edges created
    const result = await rt.run(`
      MATCH (c:Claim {id: $claimId})-[r:SPANS_PROJECT]->(p:Project)
      RETURN count(r) AS cnt
    `, { claimId: `${orphanProjectId}:claim:orphan` });

    expect(toNum(result.records[0]?.get('cnt'))).toBe(0);
  }, 60_000);
});
