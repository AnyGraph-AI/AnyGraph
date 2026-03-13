import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

interface RunRow {
  runId: string;
  ranAt: string;
  result: 'pass' | 'fail' | 'warn';
  headSha: string;
  gateDecisionId: string;
  commitSnapshotId: string;
}

function toStr(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? 'proj_c0d3e9a1f200';
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $projectId})-[:EMITS_GATE_DECISION]->(g:GateDecision {projectId: $projectId})
       MATCH (r)-[:CAPTURED_COMMIT]->(c:CommitSnapshot {projectId: $projectId})
       RETURN r.id AS runId,
              r.ranAt AS ranAt,
              g.result AS result,
              g.id AS gateDecisionId,
              c.id AS commitSnapshotId,
              c.headSha AS headSha
       ORDER BY r.ranAt ASC`,
      { projectId },
    )) as Array<Record<string, unknown>>;

    const runs: RunRow[] = rows.map((r) => ({
      runId: toStr(r.runId),
      ranAt: toStr(r.ranAt),
      result: (toStr(r.result) || 'warn') as RunRow['result'],
      headSha: toStr(r.headSha),
      gateDecisionId: toStr(r.gateDecisionId),
      commitSnapshotId: toStr(r.commitSnapshotId),
    }));

    let affectsCommitEdges = 0;
    let regressionEventsUpserted = 0;
    let detectedEdges = 0;
    let preventedEdges = 0;

    for (const run of runs) {
      await neo4j.run(
        `MATCH (g:GateDecision {id: $gateDecisionId, projectId: $projectId})
         MATCH (c:CommitSnapshot {id: $commitSnapshotId, projectId: $projectId})
         MERGE (g)-[e:AFFECTS_COMMIT]->(c)
         ON CREATE SET e.projectId = $projectId, e.updatedAt = toString(datetime())`,
        {
          projectId,
          gateDecisionId: run.gateDecisionId,
          commitSnapshotId: run.commitSnapshotId,
        },
      );
      affectsCommitEdges += 1;
    }

    for (let i = 0; i < runs.length; i += 1) {
      const failRun = runs[i];
      if (failRun.result !== 'fail' || !failRun.headSha) continue;

      let resolvedBy: RunRow | undefined;
      for (let j = i + 1; j < runs.length; j += 1) {
        const candidate = runs[j];
        if (candidate.headSha === failRun.headSha && candidate.result === 'pass') {
          resolvedBy = candidate;
          break;
        }
      }

      const regressionEventId = `re:${failRun.runId}`;

      await neo4j.run(
        `MERGE (re:CodeNode:RegressionEvent {id: $regressionEventId})
         SET re.projectId = $projectId,
             re.coreType = 'RegressionEvent',
             re.headSha = $headSha,
             re.detectedRunId = $detectedRunId,
             re.detectedAt = $detectedAt,
             re.resolvedRunId = $resolvedRunId,
             re.resolvedAt = $resolvedAt,
             re.status = $status,
             re.updatedAt = toString(datetime())`,
        {
          regressionEventId,
          projectId,
          headSha: failRun.headSha,
          detectedRunId: failRun.runId,
          detectedAt: failRun.ranAt,
          resolvedRunId: resolvedBy?.runId ?? null,
          resolvedAt: resolvedBy?.ranAt ?? null,
          status: resolvedBy ? 'prevented_before_commit' : 'unresolved',
        },
      );
      regressionEventsUpserted += 1;

      await neo4j.run(
        `MATCH (r:VerificationRun {id: $runId, projectId: $projectId})
         MATCH (re:RegressionEvent {id: $regressionEventId, projectId: $projectId})
         MERGE (r)-[e:DETECTED]->(re)
         ON CREATE SET e.projectId = $projectId, e.updatedAt = toString(datetime())`,
        {
          projectId,
          runId: failRun.runId,
          regressionEventId,
        },
      );
      detectedEdges += 1;

      if (resolvedBy) {
        await neo4j.run(
          `MATCH (r:VerificationRun {id: $runId, projectId: $projectId})
           MATCH (re:RegressionEvent {id: $regressionEventId, projectId: $projectId})
           MERGE (r)-[e:PREVENTED]->(re)
           ON CREATE SET e.projectId = $projectId, e.updatedAt = toString(datetime())`,
          {
            projectId,
            runId: resolvedBy.runId,
            regressionEventId,
          },
        );
        preventedEdges += 1;
      }
    }

    console.log(
      JSON.stringify({
        ok: true,
        projectId,
        runsSeen: runs.length,
        affectsCommitEdges,
        regressionEventsUpserted,
        detectedEdges,
        preventedEdges,
      }),
    );
  } finally {
    await neo4j.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
