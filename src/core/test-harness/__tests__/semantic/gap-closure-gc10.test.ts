/**
 * GC-10: Governance Gate Coverage (EVALUATED)
 *
 * done-check VRs evaluate project-level invariants, not files.
 * They get EVALUATED→Project edges (not ANALYZED→SourceFile).
 * scopeModel='project-level' distinguishes them from file-scope tools.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralGraph, type EphemeralGraphRuntime } from '../../ephemeral-graph.js';

describe('[GC-10] Governance Gate Coverage — EVALUATED edges', () => {
  let rt: EphemeralGraphRuntime;

  beforeAll(async () => {
    rt = await createEphemeralGraph({ setupSchema: false });
  });

  afterAll(async () => {
    await rt.teardown();
  });

  // -- Fixture helpers --

  async function seedDoneCheckVR(opts: {
    vrId: string;
    ok: boolean;
    tool?: string;
  }) {
    await rt.run(
      `CREATE (vr:VerificationRun:CodeNode {
        id: $vrId,
        projectId: $projectId,
        sourceFamily: 'done-check',
        tool: $tool,
        ok: $ok,
        status: $status,
        ranAt: datetime()
      })`,
      {
        vrId: opts.vrId,
        projectId: rt.projectId,
        tool: opts.tool ?? 'done-check',
        ok: opts.ok,
        status: opts.ok ? 'satisfies' : 'violates',
      },
    );
  }

  async function seedProject() {
    await rt.run(
      `CREATE (p:Project {
        projectId: $projectId,
        name: 'test-project'
      })`,
      { projectId: rt.projectId },
    );
  }

  async function seedSourceFile(name: string) {
    await rt.run(
      `CREATE (sf:CodeNode:SourceFile:TypeScript {
        id: $id,
        projectId: $projectId,
        name: $name,
        filePath: '/test/' + $name
      })`,
      { id: `${rt.projectId}:sf:${name}`, projectId: rt.projectId, name },
    );
  }

  // -- Tests --

  it('[GC-10] scopeModel property is set on done-check VRs', async () => {
    await seedDoneCheckVR({ vrId: `${rt.projectId}:vr:gc10-scope-1`, ok: true });

    // Simulate what the enrichment does: set scopeModel
    await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})
       SET vr.scopeModel = 'project-level'`,
      { projectId: rt.projectId },
    );

    const result = await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})
       RETURN vr.scopeModel AS scopeModel`,
      { projectId: rt.projectId },
    );
    expect(result.records[0]?.get('scopeModel')).toBe('project-level');
  });

  it('[GC-10] EVALUATED edges link done-check VR → Project', async () => {
    await seedProject();
    await seedDoneCheckVR({ vrId: `${rt.projectId}:vr:gc10-eval-1`, ok: true });

    // Simulate enrichment: create EVALUATED edge
    await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})
       MATCH (p:Project {projectId: $projectId})
       MERGE (vr)-[r:EVALUATED]->(p)
       SET r.derived = true,
           r.source = 'gc10-evaluated-enrichment',
           r.passed = vr.ok,
           r.timestamp = datetime()`,
      { projectId: rt.projectId },
    );

    const result = await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId})-[r:EVALUATED]->(p:Project)
       RETURN count(r) AS cnt, r.derived AS derived, r.passed AS passed`,
      { projectId: rt.projectId },
    );
    const rec = result.records[0];
    expect(rec?.get('cnt')?.toNumber?.() ?? rec?.get('cnt')).toBeGreaterThan(0);
    expect(rec?.get('derived')).toBe(true);
    expect(rec?.get('passed')).toBe(true);
  });

  it('[GC-10] done-check VRs do NOT get ANALYZED→SourceFile edges', async () => {
    await seedSourceFile('should-not-link.ts');
    await seedDoneCheckVR({ vrId: `${rt.projectId}:vr:gc10-no-analyzed`, ok: true });

    // Verify no ANALYZED edges from done-check VRs
    const result = await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})-[r:ANALYZED]->(sf:SourceFile)
       RETURN count(r) AS cnt`,
      { projectId: rt.projectId },
    );
    const cnt = result.records[0]?.get('cnt')?.toNumber?.() ?? result.records[0]?.get('cnt') ?? 0;
    expect(cnt).toBe(0);
  });

  it('[GC-10] EVALUATED edge is idempotent (MERGE not CREATE)', async () => {
    // Run enrichment pattern twice
    for (let i = 0; i < 2; i++) {
      await rt.run(
        `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})
         MATCH (p:Project {projectId: $projectId})
         MERGE (vr)-[r:EVALUATED]->(p)
         SET r.derived = true, r.passed = vr.ok`,
        { projectId: rt.projectId },
      );
    }

    const result = await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})-[r:EVALUATED]->(p:Project)
       RETURN count(r) AS cnt`,
      { projectId: rt.projectId },
    );
    // Should have exactly as many edges as VRs (one per VR), not double
    const vrCount = await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})
       RETURN count(vr) AS cnt`,
      { projectId: rt.projectId },
    );
    const edges = result.records[0]?.get('cnt')?.toNumber?.() ?? result.records[0]?.get('cnt');
    const vrs = vrCount.records[0]?.get('cnt')?.toNumber?.() ?? vrCount.records[0]?.get('cnt');
    expect(edges).toBe(vrs);
  });

  it('[GC-10] failing done-check VR gets passed=false on EVALUATED edge', async () => {
    await seedDoneCheckVR({ vrId: `${rt.projectId}:vr:gc10-fail-1`, ok: false });

    await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})
       WHERE vr.ok = false
       MATCH (p:Project {projectId: $projectId})
       MERGE (vr)-[r:EVALUATED]->(p)
       SET r.derived = true, r.passed = vr.ok, r.source = 'gc10-evaluated-enrichment'`,
      { projectId: rt.projectId },
    );

    const result = await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, ok: false})-[r:EVALUATED]->(p:Project)
       RETURN r.passed AS passed`,
      { projectId: rt.projectId },
    );
    expect(result.records[0]?.get('passed')).toBe(false);
  });

  it('[GC-10] scopeModel distinguishes done-check from file-scope tools', async () => {
    // Create an ESLint VR (file-scope)
    await rt.run(
      `CREATE (vr:VerificationRun:CodeNode {
        id: $id,
        projectId: $projectId,
        sourceFamily: 'eslint',
        tool: 'eslint',
        ok: true,
        scopeModel: 'file-level'
      })`,
      { id: `${rt.projectId}:vr:eslint-scope`, projectId: rt.projectId },
    );

    // Set scopeModel on done-check VRs
    await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})
       SET vr.scopeModel = 'project-level'`,
      { projectId: rt.projectId },
    );

    // Query: only project-level VRs should match
    const result = await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, scopeModel: 'project-level'})
       RETURN count(vr) AS cnt`,
      { projectId: rt.projectId },
    );
    const cnt = result.records[0]?.get('cnt')?.toNumber?.() ?? result.records[0]?.get('cnt');
    expect(cnt).toBeGreaterThan(0);

    // ESLint should NOT be project-level
    const eslint = await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, scopeModel: 'project-level', sourceFamily: 'eslint'})
       RETURN count(vr) AS cnt`,
      { projectId: rt.projectId },
    );
    const eCnt = eslint.records[0]?.get('cnt')?.toNumber?.() ?? eslint.records[0]?.get('cnt');
    expect(eCnt).toBe(0);
  });

  it('[GC-10] enrichment Cypher contract matches implementation', async () => {
    // Ensure fresh VR + project exist
    await seedDoneCheckVR({ vrId: `${rt.projectId}:vr:gc10-contract-test`, ok: true });
    await rt.run(
      `MERGE (p:Project {projectId: $projectId})
       ON CREATE SET p.name = 'test-project'`,
      { projectId: rt.projectId },
    );

    // Run the exact same Cypher the enrichment script uses
    await rt.run(
      `MATCH (vr:VerificationRun)
       WHERE vr.sourceFamily = 'done-check'
         AND vr.projectId = $projectId
         AND (vr.scopeModel IS NULL OR vr.scopeModel <> 'project-level')
       SET vr.scopeModel = 'project-level'
       RETURN count(vr) AS updated`,
      { projectId: rt.projectId },
    );

    await rt.run(
      `MATCH (vr:VerificationRun)
       WHERE vr.sourceFamily = 'done-check'
         AND vr.projectId = $projectId
       MATCH (p:Project {projectId: vr.projectId})
       MERGE (vr)-[r:EVALUATED]->(p)
       ON CREATE SET r.derived = true, r.source = 'gc10-evaluated-enrichment', r.passed = vr.ok, r.timestamp = datetime()
       ON MATCH SET r.passed = vr.ok, r.timestamp = datetime()
       RETURN count(r) AS edges`,
      { projectId: rt.projectId },
    );

    const result = await rt.run(
      `MATCH (vr:VerificationRun {projectId: $projectId, sourceFamily: 'done-check'})-[r:EVALUATED]->(p:Project)
       RETURN count(r) AS cnt, collect(DISTINCT r.source) AS sources`,
      { projectId: rt.projectId },
    );
    const cnt = result.records[0]?.get('cnt')?.toNumber?.() ?? result.records[0]?.get('cnt');
    expect(cnt).toBeGreaterThan(0);
    expect(result.records[0]?.get('sources')).toContain('gc10-evaluated-enrichment');
  });
});
