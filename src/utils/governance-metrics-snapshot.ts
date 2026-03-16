import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

interface RunRow {
  runId: string;
  ranAt: string;
  result: 'pass' | 'fail' | 'warn';
  headSha: string;
  isDirty: boolean;
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toBool(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  return String(value).toLowerCase() === 'true';
}

function toStr(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableJson(input: Record<string, unknown>): string {
  const keys = Object.keys(input).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = input[key];
  return JSON.stringify(out);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? 'proj_c0d3e9a1f200';
  const planProjectId = process.argv[3] ?? 'plan_codegraph';
  const snapshotWindow = process.argv[4] ?? 'all';
  const schemaVersion = 'gms.v1';
  const computedAt = new Date().toISOString();

  const neo4j = new Neo4jService();

  try {
    const runRowsRaw = await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $projectId})-[:EMITS_GATE_DECISION]->(g:GateDecision {projectId: $projectId})
       MATCH (r)-[:CAPTURED_COMMIT]->(c:CommitSnapshot {projectId: $projectId})
       OPTIONAL MATCH (r)-[:CAPTURED_WORKTREE]->(w:WorkingTreeSnapshot {projectId: $projectId})
       RETURN r.id AS runId,
              r.ranAt AS ranAt,
              g.result AS result,
              c.headSha AS headSha,
              coalesce(w.isDirty, true) AS isDirty
       ORDER BY r.ranAt ASC`,
      { projectId },
    );

    const runs: RunRow[] = (runRowsRaw as Array<Record<string, unknown>>).map((row) => ({
      runId: toStr(row.runId),
      ranAt: toStr(row.ranAt),
      result: (toStr(row.result) || 'warn') as RunRow['result'],
      headSha: toStr(row.headSha),
      isDirty: toBool(row.isDirty),
    }));

    const verificationRuns = runs.length;
    const gateFailures = runs.filter((r) => r.result === 'fail').length;

    let failuresResolvedBeforeCommit = 0;
    let recoveryRunDistanceTotal = 0;
    let recoveryCount = 0;

    for (let i = 0; i < runs.length; i += 1) {
      const failRun = runs[i];
      if (failRun.result !== 'fail' || !failRun.headSha) continue;

      for (let j = i + 1; j < runs.length; j += 1) {
        const candidate = runs[j];
        if (candidate.headSha === failRun.headSha && candidate.result === 'pass') {
          failuresResolvedBeforeCommit += 1;
          recoveryRunDistanceTotal += j - i;
          recoveryCount += 1;
          break;
        }
      }
    }

    const regressionsAfterMerge = runs.filter((r) => r.result === 'fail' && !r.isDirty).length;

    const invariantRow = (await neo4j.run(
      `MATCH (s:IntegritySnapshot {projectId: $projectId})
       RETURN coalesce(s.invariantViolationCount, 0) AS invariantViolationCount
       ORDER BY s.timestamp DESC
       LIMIT 1`,
      { projectId },
    )) as Array<Record<string, unknown>>;
    const invariantViolations = toNum(invariantRow[0]?.invariantViolationCount ?? 0);

    const falseCompletionRow = (await neo4j.run(
      `MATCH (t:Task {projectId: $planProjectId, status: 'done'})
       OPTIONAL MATCH (t)-[:HAS_CODE_EVIDENCE]->(:CodeNode)
       WITH t, count(*) AS evidenceCount
       WHERE evidenceCount = 0
       RETURN count(t) AS falseCompletionEvents`,
      { planProjectId },
    )) as Array<Record<string, unknown>>;
    const falseCompletionEvents = toNum(falseCompletionRow[0]?.falseCompletionEvents ?? 0);

    const operationalRows = (await neo4j.run(
      `OPTIONAL MATCH (re:RegressionEvent {projectId: $projectId})
       WITH collect(DISTINCT re) AS regressions
       OPTIONAL MATCH (pr:VerificationRun {projectId: $projectId})-[pe:PREVENTED]->(:RegressionEvent {projectId: $projectId})
       RETURN size(regressions) AS totalRegressionEvents,
              count(DISTINCT pr) AS preventedRuns,
              count(DISTINCT pe) AS preventedEdgesDiagnostic`,
      { projectId },
    )) as Array<Record<string, unknown>>;

    const totalRegressionEvents = toNum(operationalRows[0]?.totalRegressionEvents ?? 0);
    const preventedRuns = toNum(operationalRows[0]?.preventedRuns ?? 0);
    const preventedEdgesDiagnostic = toNum(operationalRows[0]?.preventedEdgesDiagnostic ?? 0);

    const interceptionRate = gateFailures > 0 ? failuresResolvedBeforeCommit / gateFailures : 1;
    const operationalInterceptionRate =
      totalRegressionEvents > 0 ? preventedRuns / totalRegressionEvents : 1;
    const meanRecoveryRuns = recoveryCount > 0 ? recoveryRunDistanceTotal / recoveryCount : 0;

    const metricSeed = {
      projectId,
      planProjectId,
      snapshotWindow,
      schemaVersion,
      verificationRuns,
      gateFailures,
      failuresResolvedBeforeCommit,
      regressionsAfterMerge,
      preventedRuns,
      preventedEdgesDiagnostic,
      totalRegressionEvents,
      interceptionRate: round(interceptionRate, 6),
      operationalInterceptionRate: round(operationalInterceptionRate, 6),
      invariantViolations,
      falseCompletionEvents,
      meanRecoveryRuns: round(meanRecoveryRuns, 4),
    };
    const metricHash = `sha256:${sha256(stableJson(metricSeed))}`;

    const snapshotId = `gms:${projectId}:${Date.now()}`;

    await neo4j.run(
      `MERGE (m:CodeNode:GovernanceMetricSnapshot {id: $snapshotId})
       SET m.projectId = $projectId,
           m.coreType = 'GovernanceMetricSnapshot',
           m.timestamp = $timestamp,
           m.computedAt = $computedAt,
           m.snapshotWindow = $snapshotWindow,
           m.schemaVersion = $schemaVersion,
           m.planProjectId = $planProjectId,
           m.verificationRuns = $verificationRuns,
           m.gateFailures = $gateFailures,
           m.failuresResolvedBeforeCommit = $failuresResolvedBeforeCommit,
           m.regressionsAfterMerge = $regressionsAfterMerge,
           m.preventedRuns = $preventedRuns,
           m.preventedEdgesDiagnostic = $preventedEdgesDiagnostic,
           m.totalRegressionEvents = $totalRegressionEvents,
           m.interceptionRate = $interceptionRate,
           m.operationalInterceptionRate = $operationalInterceptionRate,
           m.invariantViolations = $invariantViolations,
           m.falseCompletionEvents = $falseCompletionEvents,
           m.meanRecoveryRuns = $meanRecoveryRuns,
           m.metricHash = $metricHash,
           m.updatedAt = toString(datetime())`,
      {
        snapshotId,
        projectId,
        timestamp: computedAt,
        computedAt,
        snapshotWindow,
        schemaVersion,
        planProjectId,
        verificationRuns,
        gateFailures,
        failuresResolvedBeforeCommit,
        regressionsAfterMerge,
        preventedRuns,
        preventedEdgesDiagnostic,
        totalRegressionEvents,
        interceptionRate,
        operationalInterceptionRate,
        invariantViolations,
        falseCompletionEvents,
        meanRecoveryRuns,
        metricHash,
      },
    );

    await neo4j.run(
      `MATCH (m:GovernanceMetricSnapshot {id: $snapshotId, projectId: $projectId})
       MATCH (r:VerificationRun {projectId: $projectId})
       WHERE r.ranAt IS NOT NULL
       MERGE (m)-[e:DERIVED_FROM_RUN]->(r)
       SET e.projectId = $projectId,
           e.snapshotWindow = $snapshotWindow,
           e.updatedAt = toString(datetime()),
           e.sourceKind = 'governance-metrics'
       WITH m, r
       MATCH (r)-[:CAPTURED_COMMIT]->(c:CommitSnapshot {projectId: $projectId})
       MERGE (m)-[ec:DERIVED_FROM_COMMIT]->(c)
       SET ec.projectId = $projectId,
           ec.snapshotWindow = $snapshotWindow,
           ec.updatedAt = toString(datetime()),
           ec.sourceKind = 'governance-metrics'`,
      { snapshotId, projectId, snapshotWindow },
    );

    await neo4j.run(
      `MATCH (m:GovernanceMetricSnapshot {id: $snapshotId, projectId: $projectId})
       OPTIONAL MATCH (g:GateDecision {projectId: $projectId})
       WITH m, collect(g) AS gates
       FOREACH (g IN gates |
         MERGE (m)-[eg:DERIVED_FROM_GATE]->(g)
         SET eg.projectId = $projectId, eg.updatedAt = toString(datetime()), eg.sourceKind = 'governance-metrics'
       )
       WITH m
       OPTIONAL MATCH (p:InvariantProof {projectId: $planProjectId})
       WITH m, collect(p) AS proofs
       FOREACH (p IN proofs |
         MERGE (m)-[ep:DERIVED_FROM_PROOF]->(p)
         SET ep.projectId = $projectId, ep.updatedAt = toString(datetime()), ep.sourceKind = 'governance-metrics'
       )`,
      { snapshotId, projectId, planProjectId },
    );

    const payload = {
      ok: true,
      snapshotId,
      projectId,
      planProjectId,
      timestamp: computedAt,
      snapshotWindow,
      schemaVersion,
      verificationRuns,
      gateFailures,
      failuresResolvedBeforeCommit,
      regressionsAfterMerge,
      preventedRuns,
      preventedEdgesDiagnostic,
      totalRegressionEvents,
      interceptionRate: round(interceptionRate, 6),
      operationalInterceptionRate: round(operationalInterceptionRate, 6),
      invariantViolations,
      falseCompletionEvents,
      meanRecoveryRuns: round(meanRecoveryRuns, 4),
      metricHash,
    };

    const dir = join(process.cwd(), 'artifacts', 'governance-metrics');
    mkdirSync(dir, { recursive: true });
    const ts = computedAt.replace(/[:.]/g, '-');
    const outPath = join(dir, `${ts}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(payload, null, 2));

    console.log(JSON.stringify({ ...payload, outPath }));
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
