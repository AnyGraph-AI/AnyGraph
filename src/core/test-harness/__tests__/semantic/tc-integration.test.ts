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

    // Verify shadow fields
    const rows = await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $pid})
       WHERE r.shadowEffectiveConfidence IS NOT NULL
       RETURN count(r) AS cnt`,
      { pid: projectId },
    );
    expect(Number(rows[0].cnt)).toBe(5);
  });

  it('shadow isolation holds', async () => {
    const result = await verifyShadowIsolation(neo4j, projectId);
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
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
