import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';
import {
  CONTRACT_QUERY_Q11_BLOCKED,
  CONTRACT_QUERY_Q11_MILESTONE_BUCKETS,
  CONTRACT_QUERY_Q11_NEXT_TASKS,
  CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE,
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST,
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND,
} from './query-contract.js';

dotenv.config();

const PLAN_PROJECT_ID = 'plan_codegraph';
const RUNTIME_PLAN_PROJECT_ID = 'plan_runtime_graph';
const GOVERNANCE_PROJECT_ID = 'proj_c0d3e9a1f200';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

async function main(): Promise<void> {
  const planProjectId = process.argv[2] ?? PLAN_PROJECT_ID;
  const runtimeProjectId = process.argv[3] ?? RUNTIME_PLAN_PROJECT_ID;
  const governanceProjectId = process.argv[4] ?? GOVERNANCE_PROJECT_ID;

  const neo4j = new Neo4jService();
  try {
    const milestoneRows = await neo4j.run(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS, { projectId: planProjectId });

    const nextTaskRows = await neo4j.run(CONTRACT_QUERY_Q11_NEXT_TASKS, { projectId: planProjectId });

    const blockedRows = await neo4j.run(CONTRACT_QUERY_Q11_BLOCKED, { projectId: planProjectId });

    const runtimeRows = await neo4j.run(CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE, { runtimeProjectId });

    const governanceLatestRows = await neo4j.run(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST, {
      projectId: governanceProjectId,
    });

    const governanceTrendRows = await neo4j.run(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND, {
      projectId: governanceProjectId,
    });

    const wordingRows = await neo4j.run(
      `MATCH (t:Task {projectId: $planProjectId})
       WHERE t.status = 'done'
         AND toLower(coalesce(t.name,'')) CONTAINS 'document'
         AND (toLower(coalesce(t.name,'')) CONTAINS 'materializ' OR toLower(coalesce(t.name,'')) CONTAINS 'witness')
       WITH count(t) AS doneMaterializationTasks
       OPTIONAL MATCH (p:Project {projectType:'document'})
       WITH doneMaterializationTasks, count(p) AS documentProjectCount
       OPTIONAL MATCH (w:DocumentWitness)
       WITH doneMaterializationTasks, documentProjectCount, count(w) AS witnessCount
       OPTIONAL MATCH (c:Claim {projectId: $planProjectId})
       WHERE toLower(coalesce(c.statement, '')) CONTAINS 'document layer complete'
       RETURN doneMaterializationTasks, documentProjectCount, witnessCount, count(c) AS forbiddenCount`,
      { planProjectId },
    );

    const wording = (wordingRows[0] as any) ?? {};
    const wordingInvariantRed =
      toNum(wording.doneMaterializationTasks) > 0 &&
      (toNum(wording.documentProjectCount) <= 0 || toNum(wording.witnessCount) <= 0);

    const summary = {
      ok: true,
      planProjectId,
      runtimeProjectId,
      governanceProjectId,
      milestoneBuckets: milestoneRows.map((row) => ({
        bucket: str(row.bucket),
        total: toNum(row.total),
        done: toNum(row.done),
        planned: toNum(row.planned),
        blocked: toNum(row.blocked),
        inProgress: toNum(row.inProgress),
      })),
      nextTasks: nextTaskRows.map((row) => ({
        id: str(row.id),
        line: toNum(row.line),
        task: str(row.task),
        status: str(row.status),
        openDeps: toNum(row.openDeps),
      })),
      blocked: blockedRows.map((row) => ({
        explicitBlocked: toNum(row.explicitBlocked),
        effectiveBlocked: toNum(row.effectiveBlocked),
        nullStatusCount: toNum(row.nullStatusCount),
      }))[0] ?? { explicitBlocked: 0, effectiveBlocked: 0, nullStatusCount: 0 },
      runtimeEvidence: runtimeRows.map((row) => ({
        totalTasks: toNum(row.totalTasks),
        withEvidence: toNum(row.withEvidence),
        doneWithoutEvidence: toNum(row.doneWithoutEvidence),
        evidenceEdgeCount: toNum(row.evidenceEdgeCount),
        evidenceArtifactCount: toNum(row.evidenceArtifactCount),
      }))[0] ?? {
        totalTasks: 0,
        withEvidence: 0,
        doneWithoutEvidence: 0,
        evidenceEdgeCount: 0,
        evidenceArtifactCount: 0,
      },
      governanceMetricsLatest:
        governanceLatestRows.length > 0
          ? {
              id: str((governanceLatestRows[0] as any).id),
              timestamp: str((governanceLatestRows[0] as any).timestamp),
              verificationRuns: toNum((governanceLatestRows[0] as any).verificationRuns),
              gateFailures: toNum((governanceLatestRows[0] as any).gateFailures),
              failuresResolvedBeforeCommit: toNum((governanceLatestRows[0] as any).failuresResolvedBeforeCommit),
              preventedRuns: toNum((governanceLatestRows[0] as any).preventedRuns),
              preventedEdgesDiagnostic: toNum((governanceLatestRows[0] as any).preventedEdgesDiagnostic),
              totalRegressionEvents: toNum((governanceLatestRows[0] as any).totalRegressionEvents),
              regressionsAfterMerge: toNum((governanceLatestRows[0] as any).regressionsAfterMerge),
              interceptionRate: toNum((governanceLatestRows[0] as any).interceptionRate),
              operationalInterceptionRate: toNum((governanceLatestRows[0] as any).operationalInterceptionRate),
              invariantViolations: toNum((governanceLatestRows[0] as any).invariantViolations),
              falseCompletionEvents: toNum((governanceLatestRows[0] as any).falseCompletionEvents),
              meanRecoveryRuns: toNum((governanceLatestRows[0] as any).meanRecoveryRuns),
            }
          : null,
      governanceMetricsTrend: governanceTrendRows.map((row) => ({
        timestamp: str((row as any).timestamp),
        interceptionRate: toNum((row as any).interceptionRate),
        gateFailures: toNum((row as any).gateFailures),
        failuresResolvedBeforeCommit: toNum((row as any).failuresResolvedBeforeCommit),
        preventedRuns: toNum((row as any).preventedRuns),
        preventedEdgesDiagnostic: toNum((row as any).preventedEdgesDiagnostic),
        totalRegressionEvents: toNum((row as any).totalRegressionEvents),
        regressionsAfterMerge: toNum((row as any).regressionsAfterMerge),
        invariantViolations: toNum((row as any).invariantViolations),
      })),
      wordingContract: {
        allowedClaim:
          'document adapter plumbing + IR ingestion proven (canonical materialization pending)',
        forbiddenPhrase: 'document layer complete',
        invariantRed: wordingInvariantRed,
        forbiddenCount: toNum(wording.forbiddenCount),
        status:
          wordingInvariantRed && toNum(wording.forbiddenCount) > 0
            ? 'violation'
            : wordingInvariantRed
              ? 'restricted'
              : 'open',
      },
    };

    console.log(JSON.stringify(summary, null, 2));
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
