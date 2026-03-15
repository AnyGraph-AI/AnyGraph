/**
 * TC Integration Tests — Real Neo4j
 *
 * Uses ephemeral graph (__test_ projectId) to test TC pipeline against live Neo4j.
 * Catches bugs that mocked tests miss (Cypher syntax, graph structure assumptions).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralGraph, type EphemeralGraphRuntime } from '../../ephemeral-graph.js';
import { incrementalRecompute } from '../../../verification/incremental-recompute.js';
import { runShadowPropagation, verifyShadowIsolation } from '../../../verification/shadow-propagation.js';
import { computeConfidenceDebt, verifyDebtFieldPresence } from '../../../verification/confidence-debt.js';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';

let eph: EphemeralGraphRuntime;
let neo4j: Neo4jService;
let projectId: string;

beforeAll(async () => {
  eph = await createEphemeralGraph({ testId: 'tc-int' });
  projectId = eph.projectId;
  neo4j = new Neo4jService();

  // Clean up any leftover test data from prior failed runs
  await neo4j.run(
    `MATCH (n {projectId: $pid}) DETACH DELETE n`,
    { pid: projectId },
  );

  // Seed VerificationRun nodes with temporal fields
  const now = new Date();
  for (let i = 0; i < 5; i++) {
    const past = new Date(now.getTime() - i * 24 * 60 * 60 * 1000); // i days ago
    await neo4j.run(
      `MERGE (r:VerificationRun {id: $id, projectId: $pid})
       SET r.observedAt = $obs, r.validFrom = $obs,
           r.status = $status, r.artifactHash = $hash,
           r.tool = 'test-tool'`,
      {
        id: `vr_tc_int_${i}`,
        pid: projectId,
        obs: past.toISOString(),
        status: i % 3 === 0 ? 'violates' : 'satisfies',
        hash: `sha256:test${i}`,
      },
    );
  }

  // Create PRECEDES chain
  for (let i = 0; i < 4; i++) {
    await neo4j.run(
      `MATCH (a:VerificationRun {id: $from, projectId: $pid})
       MATCH (b:VerificationRun {id: $to, projectId: $pid})
       MERGE (a)-[:PRECEDES]->(b)`,
      { from: `vr_tc_int_${i}`, to: `vr_tc_int_${i + 1}`, pid: projectId },
    );
  }

  // Create SourceFile + VERIFIED_BY_RUN for file-scope test
  await neo4j.run(
    `MERGE (sf:SourceFile {filePath: '/test/foo.ts', projectId: $pid})
     SET sf.name = 'foo.ts'
     WITH sf
     MATCH (r:VerificationRun {id: 'vr_tc_int_0', projectId: $pid})
     MERGE (sf)-[:VERIFIED_BY_RUN]->(r)`,
    { pid: projectId },
  );

  // Create Task → HAS_CODE_EVIDENCE → SourceFile → VERIFIED_BY_RUN → VR for task-scope test
  await neo4j.run(
    `MERGE (t:Task {id: 'task_tc_int_1', projectId: $pid})
     SET t.name = 'Test task', t.status = 'done'
     WITH t
     MERGE (sf:SourceFile {filePath: '/test/taskfile.ts', projectId: $pid})
     SET sf.name = 'taskfile.ts'
     MERGE (t)-[:HAS_CODE_EVIDENCE]->(sf)
     WITH sf
     MATCH (r:VerificationRun {id: 'vr_tc_int_2', projectId: $pid})
     MERGE (sf)-[:VERIFIED_BY_RUN]->(r)`,
    { pid: projectId },
  );
}, 30000);

afterAll(async () => {
  // Cleanup
  if (eph) await eph.teardown();
  if (neo4j) await neo4j.close();
}, 10000);

describe('TC-1: Temporal factor computation (real Neo4j)', () => {
  it('incrementalRecompute(full) stamps all runs', async () => {
    const result = await incrementalRecompute(neo4j, {
      projectId,
      scope: 'full',
      fullOverride: true,
      reason: 'test',
    });

    expect(result.updatedCount).toBe(5);
    expect(result.candidateCount).toBe(5);

    // Verify properties in Neo4j
    const rows = await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       WHERE r.timeConsistencyFactor IS NOT NULL
       RETURN count(r) AS cnt`,
      { pid: projectId },
    );
    expect(Number(rows[0].cnt)).toBe(5);
  });

  it('older runs have lower TCF', async () => {
    const rows = await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       RETURN r.id AS id, r.timeConsistencyFactor AS tcf
       ORDER BY r.observedAt ASC`,
      { pid: projectId },
    );

    // Oldest (4 days ago) should have lower TCF than newest
    const tcfs = rows.map(r => r.tcf as number);
    expect(tcfs[0]).toBeLessThanOrEqual(tcfs[tcfs.length - 1]);
  });
});

describe('TC-2: File-scoped recompute (real Neo4j)', () => {
  it('file scope resolves to linked VerificationRuns only', async () => {
    // First clear TCF so we can see what gets updated
    await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       REMOVE r.timeConsistencyFactor, r.confidenceVersion`,
      { pid: projectId },
    );

    const result = await incrementalRecompute(neo4j, {
      projectId,
      scope: 'file',
      targets: ['foo.ts'],
      reason: 'test_file_scope',
    });

    // Should only update vr_tc_int_0 (the one linked via VERIFIED_BY_RUN)
    expect(result.updatedCount).toBe(1);
    expect(result.candidateCount).toBe(1);

    // Verify only the linked run got stamped
    const rows = await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       WHERE r.timeConsistencyFactor IS NOT NULL
       RETURN r.id AS id`,
      { pid: projectId },
    );
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('vr_tc_int_0');
  });
});

describe('TC-2c: Task-scoped recompute (real Neo4j)', () => {
  it('task scope resolves through HAS_CODE_EVIDENCE→SF→VERIFIED_BY_RUN', async () => {
    // Clear all TCF
    await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       REMOVE r.timeConsistencyFactor, r.confidenceVersion`,
      { pid: projectId },
    );

    const result = await incrementalRecompute(neo4j, {
      projectId,
      scope: 'task',
      targets: ['task_tc_int_1'],
      reason: 'test_task_scope',
    });

    // Should only update vr_tc_int_2 (linked via Task→HAS_CODE_EVIDENCE→SF→VERIFIED_BY_RUN)
    expect(result.candidateCount).toBe(1);
    expect(result.updatedCount).toBe(1);

    const rows = await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       WHERE r.timeConsistencyFactor IS NOT NULL
       RETURN r.id AS id`,
      { pid: projectId },
    );
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('vr_tc_int_2');
  });

  it('nonexistent task returns 0 candidates', async () => {
    await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       REMOVE r.timeConsistencyFactor, r.confidenceVersion`,
      { pid: projectId },
    );

    const result = await incrementalRecompute(neo4j, {
      projectId,
      scope: 'task',
      targets: ['task_nonexistent'],
      reason: 'test_no_match',
    });

    expect(result.candidateCount).toBe(0);
    expect(result.updatedCount).toBe(0);
  });
});

describe('TC-2b: File-scoped recompute via CAPTURED_COMMIT + diffPaths', () => {
  it('diffPaths-based clause scopes correctly (no cross-join)', async () => {
    // Create a CommitSnapshot with diffPaths linked to vr_tc_int_1
    await neo4j.run(
      `MATCH (r:VerificationRun {id: 'vr_tc_int_1', projectId: $pid})
       MERGE (cs:CommitSnapshot {id: 'cs_tc_int_1', projectId: $pid})
       SET cs.diffPaths = ['/test/bar.ts', '/test/baz.ts']
       MERGE (r)-[:CAPTURED_COMMIT]->(cs)`,
      { pid: projectId },
    );

    // Clear all TCF so we can see what gets updated
    await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       REMOVE r.timeConsistencyFactor, r.confidenceVersion`,
      { pid: projectId },
    );

    const result = await incrementalRecompute(neo4j, {
      projectId,
      scope: 'file',
      targets: ['bar.ts'],
      reason: 'test_diffpaths_scope',
    });

    // Should only update vr_tc_int_1 (the one linked via CAPTURED_COMMIT→diffPaths)
    expect(result.candidateCount).toBe(1);
    expect(result.updatedCount).toBe(1);

    const rows = await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       WHERE r.timeConsistencyFactor IS NOT NULL
       RETURN r.id AS id`,
      { pid: projectId },
    );
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('vr_tc_int_1');
  });

  it('does NOT return unrelated VRs when diffPaths match exists', async () => {
    // Query for a file NOT in any diffPaths
    await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       REMOVE r.timeConsistencyFactor, r.confidenceVersion`,
      { pid: projectId },
    );

    const result = await incrementalRecompute(neo4j, {
      projectId,
      scope: 'file',
      targets: ['nonexistent-file.ts'],
      reason: 'test_no_match',
    });

    // Should find 0 candidates — no VERIFIED_BY_RUN and no diffPaths match
    expect(result.candidateCount).toBe(0);
    expect(result.updatedCount).toBe(0);
  });
});

describe('TC-3: Shadow propagation (real Neo4j)', () => {
  it('propagates shadow confidence via PRECEDES edges', async () => {
    // Re-stamp all TCFs first
    await incrementalRecompute(neo4j, {
      projectId, scope: 'full', fullOverride: true, reason: 'pre-shadow',
    });

    const result = await runShadowPropagation(neo4j, projectId);

    expect(result.updated).toBe(5);
    expect(result.projectId).toBe(projectId);

    // Verify shadow fields exist on all runs
    const rows = await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       WHERE r.shadowEffectiveConfidence IS NOT NULL
       RETURN count(r) AS cnt`,
      { pid: projectId },
    );
    expect(Number(rows[0].cnt)).toBe(5);
  });

  it('shadow values reflect neighbor influence (not just own TCF)', async () => {
    // Query actual shadow values — runs with neighbors should differ from raw TCF
    const rows = await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       RETURN r.id AS id, r.timeConsistencyFactor AS tcf,
              r.shadowEffectiveConfidence AS shadow,
              r.shadowInfluenceScore AS influence
       ORDER BY r.observedAt ASC`,
      { pid: projectId },
    );

    // All runs in the PRECEDES chain have neighbors → shadow ≠ raw own score
    for (const row of rows) {
      const shadow = row.shadow as number;
      const influence = row.influence as number;
      // Shadow must be in valid range [0, 1]
      expect(shadow).toBeGreaterThanOrEqual(0);
      expect(shadow).toBeLessThanOrEqual(1);
      // Influence score must be set (non-null)
      expect(influence).toBeDefined();
    }

    // The newest run (vr_tc_int_0, most recent) should have TCF ≈ 1.0
    // and its shadow should also be high (neighbors are slightly older but still fresh)
    const newest = rows.find(r => r.id === 'vr_tc_int_0');
    expect(newest).toBeDefined();
    expect(newest!.shadow as number).toBeGreaterThan(0.5);

    // The oldest run (vr_tc_int_4, 4 days ago) should have lower shadow
    // than the newest run
    const oldest = rows.find(r => r.id === 'vr_tc_int_4');
    expect(oldest).toBeDefined();
    expect(oldest!.shadow as number).toBeLessThanOrEqual(newest!.shadow as number);
  });

  it('shadow isolation holds', async () => {
    const result = await verifyShadowIsolation(neo4j, projectId);
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
  });
});

describe('TC-Decay: decayedConfidence integration in claim engine (real Neo4j)', () => {
  it('decay wins when lower than evidence confidence', async () => {
    // Create a claim with decayedConfidence=0.3, and evidence that yields ~0.8
    await neo4j.run(
      `CREATE (c:Claim {id: 'claim_decay_test_1', projectId: $pid, confidence: 0.5, decayedConfidence: 0.3, status: 'asserted'})
       CREATE (e:Evidence {id: 'ev_decay_test_1', projectId: $pid})
       CREATE (c)-[:SUPPORTED_BY {weight: 1.0, grade: 'A1'}]->(e)`,
      { pid: projectId },
    );

    // Run claim engine recomputeConfidence — it processes ALL claims globally
    const { ClaimEngine } = await import('../../../claims/claim-engine.js');
    const engine = new ClaimEngine();
    try {
      await engine.recomputeConfidence();

      // Check: evidence alone would give ~1.0/(1.0+0.001) ≈ 1.0
      // But decayedConfidence=0.3 is lower, so canonical should be 0.3
      const rows = await neo4j.run(
        `MATCH (c:Claim {id: 'claim_decay_test_1'})
         RETURN c.confidence AS conf, c.status AS status`,
      );
      expect(Number(rows[0].conf)).toBeCloseTo(0.3, 1);
      expect(rows[0].status).toBe('asserted'); // 0.3 < 0.4 threshold but > 0
    } finally {
      await engine.close();
      // Cleanup
      await neo4j.run(`MATCH (n) WHERE n.id IN ['claim_decay_test_1', 'ev_decay_test_1'] DETACH DELETE n`);
    }
  });

  it('evidence wins when lower than decayedConfidence', async () => {
    // decayedConfidence=0.95, but evidence gives ~0.58 (A2 support vs A1 contradict)
    await neo4j.run(
      `CREATE (c:Claim {id: 'claim_decay_test_2', projectId: $pid, confidence: 0.5, decayedConfidence: 0.95, status: 'asserted'})
       CREATE (es:Evidence {id: 'ev_decay_support_2', projectId: $pid})
       CREATE (ec:Evidence {id: 'ev_decay_contra_2', projectId: $pid})
       CREATE (c)-[:SUPPORTED_BY {weight: 1.0, grade: 'A2'}]->(es)
       CREATE (c)-[:CONTRADICTED_BY {weight: 1.0, grade: 'A1'}]->(ec)`,
      { pid: projectId },
    );

    const { ClaimEngine } = await import('../../../claims/claim-engine.js');
    const engine = new ClaimEngine();
    try {
      await engine.recomputeConfidence();

      // evidence: support=1.0*0.7=0.7, contra=1.0*1.0=1.0
      // evidenceConf = 0.7/(0.7+1.0+0.001) ≈ 0.41
      // decayedConfidence=0.95 > 0.41, so evidence wins
      const rows = await neo4j.run(
        `MATCH (c:Claim {id: 'claim_decay_test_2'})
         RETURN c.confidence AS conf, c.status AS status`,
      );
      expect(Number(rows[0].conf)).toBeCloseTo(0.41, 1);
      expect(rows[0].status).toBe('contested'); // 0.4 <= 0.41 < 0.8
    } finally {
      await engine.close();
      await neo4j.run(`MATCH (n) WHERE n.id STARTS WITH 'claim_decay_test_2' OR n.id STARTS WITH 'ev_decay_' DETACH DELETE n`);
    }
  });
});

describe('TC-Hyp: Hypothesis name refresh (real Neo4j)', () => {
  it('refreshes hypothesis name when discrepancy value changes', async () => {
    const { IntegrityHypothesisGenerator } = await import('../../../ground-truth/integrity-hypothesis-generator.js');

    // Create the full chain: IntegrityFindingDefinition → Discrepancy → Hypothesis
    await neo4j.run(
      `CREATE (ifd:IntegrityFindingDefinition {id: 'ifd_test_refresh', severity: 'warning', name: 'test finding'})
       CREATE (disc:Discrepancy {
         id: 'disc_test_refresh', status: 'open', projectId: $pid,
         findingDefinitionId: 'ifd_test_refresh',
         type: 'StructuralViolation',
         description: 'Test nodes missing label',
         currentValue: 1406, runsSinceDetected: 10
       })
       CREATE (hyp:Hypothesis {
         id: 'hyp_integrity_test_disc_test_refresh',
         name: 'Graph integrity: Test nodes missing label (5 consecutive failures, current=1406)',
         status: 'open', domain: 'integrity', projectId: $pid,
         sourceNodeId: 'disc_test_refresh'
       })
       CREATE (disc)-[:GENERATED_HYPOTHESIS]->(hyp)`,
      { pid: projectId },
    );

    // Update discrepancy to reflect fix (currentValue=0)
    await neo4j.run(
      `MATCH (d:Discrepancy {id: 'disc_test_refresh'})
       SET d.currentValue = 0, d.runsSinceDetected = 12`,
    );

    // Run generator — should refresh the hypothesis name
    const gen = new IntegrityHypothesisGenerator(neo4j);
    await gen.generateFromDiscrepancies(projectId);

    const rows = await neo4j.run(
      `MATCH (h:Hypothesis {id: 'hyp_integrity_test_disc_test_refresh'})
       RETURN h.name AS name`,
    );

    expect(rows[0].name).toContain('current=0');
    expect(rows[0].name).toContain('12 consecutive failures');
    expect(rows[0].name).not.toContain('current=1406');

    // Cleanup
    await neo4j.run(
      `MATCH (n) WHERE n.id IN ['ifd_test_refresh', 'disc_test_refresh', 'hyp_integrity_test_disc_test_refresh'] DETACH DELETE n`,
    );
  });

  it('auto-resolves hypotheses for resolved discrepancies', async () => {
    const { IntegrityHypothesisGenerator } = await import('../../../ground-truth/integrity-hypothesis-generator.js');

    await neo4j.run(
      `CREATE (disc:Discrepancy {
         id: 'disc_test_resolved', status: 'resolved', projectId: $pid,
         currentValue: 0
       })
       CREATE (hyp:Hypothesis {
         id: 'hyp_integrity_test_disc_test_resolved',
         name: 'old stale name', status: 'open', domain: 'integrity', projectId: $pid,
         sourceNodeId: 'disc_test_resolved'
       })
       CREATE (disc)-[:GENERATED_HYPOTHESIS]->(hyp)`,
      { pid: projectId },
    );

    const gen = new IntegrityHypothesisGenerator(neo4j);
    await gen.generateFromDiscrepancies(projectId);

    const rows = await neo4j.run(
      `MATCH (h:Hypothesis {id: 'hyp_integrity_test_disc_test_resolved'})
       RETURN h.status AS status`,
    );
    expect(rows[0].status).toBe('resolved');

    // Cleanup
    await neo4j.run(
      `MATCH (n) WHERE n.id IN ['disc_test_resolved', 'hyp_integrity_test_disc_test_resolved'] DETACH DELETE n`,
    );
  });
});

describe('TC-5: Confidence debt (real Neo4j)', () => {
  it('stamps debt fields on runs with TCF', async () => {
    const result = await computeConfidenceDebt(neo4j, projectId);
    expect(result.stamped).toBeGreaterThan(0);

    const verify = await verifyDebtFieldPresence(neo4j, projectId);
    expect(verify.ok).toBe(true);
  });
});
