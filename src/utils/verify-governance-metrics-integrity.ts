import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? 'proj_c0d3e9a1f200';
  const strict = String(process.env.GOVERNANCE_METRICS_ENFORCE ?? 'false').toLowerCase() === 'true';
  const maxInterceptionDrop = Number(process.env.GOVERNANCE_METRICS_MAX_INTERCEPTION_DROP ?? 0.2);
  const maxRecoveryIncrease = Number(process.env.GOVERNANCE_METRICS_MAX_RECOVERY_INCREASE ?? 2);

  const neo4j = new Neo4jService();

  try {
    const coverageRows = (await neo4j.run(
      `MATCH (g:GateDecision {projectId: $projectId})
       OPTIONAL MATCH (g)-[ac:AFFECTS_COMMIT]->(:CommitSnapshot {projectId: $projectId})
       WITH count(DISTINCT g) AS gateDecisions, count(DISTINCT ac) AS affectsCommitEdges
       MATCH (m:GovernanceMetricSnapshot {projectId: $projectId})
       WITH gateDecisions, affectsCommitEdges, count(m) AS metricSnapshots
       OPTIONAL MATCH (re:RegressionEvent {projectId: $projectId})
       WITH gateDecisions, affectsCommitEdges, metricSnapshots, collect(DISTINCT re) AS regressions
       OPTIONAL MATCH (pr:VerificationRun {projectId: $projectId})-[pe:PREVENTED]->(re2:RegressionEvent {projectId: $projectId})
       RETURN gateDecisions,
              affectsCommitEdges,
              metricSnapshots,
              size(regressions) AS regressionEvents,
              count(DISTINCT pr) AS preventedRuns,
              count(DISTINCT pe) AS preventedEdgesDiagnostic`,
      { projectId },
    )) as Array<Record<string, unknown>>;

    const latestRows = (await neo4j.run(
      `MATCH (m:GovernanceMetricSnapshot {projectId: $projectId})
       RETURN m.timestamp AS timestamp,
              m.interceptionRate AS interceptionRate,
              m.meanRecoveryRuns AS meanRecoveryRuns,
              m.metricHash AS metricHash
       ORDER BY m.timestamp DESC
       LIMIT 2`,
      { projectId },
    )) as Array<Record<string, unknown>>;

    const coverage = coverageRows[0] ?? {};
    const gateDecisions = toNum(coverage.gateDecisions);
    const affectsCommitEdges = toNum(coverage.affectsCommitEdges);
    const metricSnapshots = toNum(coverage.metricSnapshots);
    const regressionEvents = toNum(coverage.regressionEvents);
    const preventedRuns = toNum(coverage.preventedRuns);
    const preventedEdgesDiagnostic = toNum(coverage.preventedEdgesDiagnostic);

    const latest = latestRows[0] ?? {};
    const previous = latestRows[1] ?? {};

    const latestInterception = toNum(latest.interceptionRate);
    const previousInterception = toNum(previous.interceptionRate);
    const latestRecovery = toNum(latest.meanRecoveryRuns);
    const previousRecovery = toNum(previous.meanRecoveryRuns);

    const hasMetricHash = String(latest.metricHash ?? '').startsWith('sha256:');
    const attributionCoverage = gateDecisions > 0 ? affectsCommitEdges / gateDecisions : 1;
    const preventionCoverage = regressionEvents > 0 ? preventedRuns / regressionEvents : 1;

    const interceptionDrop = Math.max(0, previousInterception - latestInterception);
    const recoveryIncrease = Math.max(0, latestRecovery - previousRecovery);

    const driftAlarm = interceptionDrop > maxInterceptionDrop || recoveryIncrease > maxRecoveryIncrease;

    const advisoryOk =
      metricSnapshots > 0 &&
      gateDecisions > 0 &&
      hasMetricHash &&
      attributionCoverage >= 0.95 &&
      preventionCoverage >= 0 &&
      !driftAlarm;

    const payload = {
      ok: true,
      strict,
      advisoryOk,
      projectId,
      metricSnapshots,
      gateDecisions,
      affectsCommitEdges,
      regressionEvents,
      preventedRuns,
      preventedEdgesDiagnostic,
      attributionCoverage,
      preventionCoverage,
      latestInterception,
      previousInterception,
      latestRecovery,
      previousRecovery,
      interceptionDrop,
      recoveryIncrease,
      maxInterceptionDrop,
      maxRecoveryIncrease,
      driftAlarm,
      hasMetricHash,
      generatedAt: new Date().toISOString(),
    };

    const dir = join(process.cwd(), 'artifacts', 'governance-metric-integrity');
    mkdirSync(dir, { recursive: true });
    const ts = payload.generatedAt.replace(/[:.]/g, '-');
    const outPath = join(dir, `${ts}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(payload, null, 2));

    console.log(JSON.stringify({ ...payload, outPath }));

    if (strict && !advisoryOk) {
      process.exit(1);
    }
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
