import { Neo4jService } from '../storage/neo4j/neo4j.service.js';
import {
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST,
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND,
} from './query-contract.js';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStr(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? 'proj_c0d3e9a1f200';
  const mode = process.argv[3] ?? 'latest'; // latest | trend

  const neo4j = new Neo4jService();

  try {
    if (mode === 'trend') {
      const rows = await neo4j.run(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND, { projectId });
      console.log(
        JSON.stringify(
          {
            ok: true,
            projectId,
            mode,
            count: rows.length,
            trend: rows.map((row) => ({
              timestamp: toStr((row as any).timestamp),
              interceptionRate: toNum((row as any).interceptionRate),
              gateFailures: toNum((row as any).gateFailures),
              failuresResolvedBeforeCommit: toNum((row as any).failuresResolvedBeforeCommit),
              regressionsAfterMerge: toNum((row as any).regressionsAfterMerge),
              invariantViolations: toNum((row as any).invariantViolations),
              falseCompletionEvents: toNum((row as any).falseCompletionEvents),
              meanRecoveryRuns: toNum((row as any).meanRecoveryRuns),
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    const rows = await neo4j.run(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST, { projectId });
    const row = rows[0] as Record<string, unknown> | undefined;

    const operationalRows = await neo4j.run(
      `OPTIONAL MATCH (re:RegressionEvent {projectId: $projectId})
       WITH collect(DISTINCT re) AS regressions
       OPTIONAL MATCH (pr:VerificationRun {projectId: $projectId})-[pe:PREVENTED]->(:RegressionEvent {projectId: $projectId})
       RETURN size(regressions) AS total,
              count(DISTINCT pr) AS preventedRuns,
              count(DISTINCT pe) AS preventedEdgesDiagnostic`,
      { projectId },
    );

    const totalRegressionEvents = toNum((operationalRows[0] as any)?.total);
    const preventedRuns = toNum((operationalRows[0] as any)?.preventedRuns);
    const preventedEdgesDiagnostic = toNum((operationalRows[0] as any)?.preventedEdgesDiagnostic);
    const operationalInterceptionRate = totalRegressionEvents > 0 ? preventedRuns / totalRegressionEvents : 1;

    console.log(
      JSON.stringify(
        {
          ok: true,
          projectId,
          mode: 'latest',
          snapshot: row
            ? {
                id: toStr(row.id),
                timestamp: toStr(row.timestamp),
                snapshotWindow: toStr(row.snapshotWindow),
                schemaVersion: toStr(row.schemaVersion),
                verificationRuns: toNum(row.verificationRuns),
                gateFailures: toNum(row.gateFailures),
                failuresResolvedBeforeCommit: toNum(row.failuresResolvedBeforeCommit),
                regressionsAfterMerge: toNum(row.regressionsAfterMerge),
                preventedRuns: toNum(row.preventedRuns),
                preventedEdgesDiagnostic: toNum(row.preventedEdgesDiagnostic),
                totalRegressionEvents: toNum(row.totalRegressionEvents),
                strictInterceptionRate: toNum(row.interceptionRate),
                operationalInterceptionRate: toNum(row.operationalInterceptionRate),
                invariantViolations: toNum(row.invariantViolations),
                falseCompletionEvents: toNum(row.falseCompletionEvents),
                meanRecoveryRuns: toNum(row.meanRecoveryRuns),
              }
            : null,
          operationalView: {
            totalRegressionEvents,
            preventedRuns,
            preventedEdgesDiagnostic,
            operationalInterceptionRate,
          },
        },
        null,
        2,
      ),
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
