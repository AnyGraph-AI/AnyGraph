import { Neo4jService } from './src/storage/neo4j/neo4j.service.js';

function fail(message: string): never {
  console.error(`GOVERNANCE_STALE_CHECK_FAILED: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? process.env.STALE_CHECK_PROJECT_ID ?? 'proj_c0d3e9a1f200';
  const maxAgeMinutes = Number(process.env.STALE_CHECK_SLA_MINUTES ?? 240);

  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (v:VerificationRun {projectId: $projectId})
       WHERE v.ranAt IS NOT NULL
       RETURN v.runId AS runId, v.ranAt AS ranAt
       ORDER BY v.ranAt DESC
       LIMIT 1`,
      { projectId },
    )) as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      fail(`No VerificationRun found for project ${projectId}`);
    }

    const runId = String(rows[0].runId ?? '');
    const ranAt = String(rows[0].ranAt ?? '');
    const ts = Date.parse(ranAt);

    if (!Number.isFinite(ts)) {
      fail(`Invalid ranAt timestamp on latest run: ${ranAt}`);
    }

    const ageMinutes = (Date.now() - ts) / 60000;
    const ok = ageMinutes <= maxAgeMinutes;

    const payload = {
      ok,
      projectId,
      runId,
      ranAt,
      ageMinutes: Number(ageMinutes.toFixed(3)),
      maxAgeMinutes,
    };

    if (!ok) {
      console.error(JSON.stringify(payload));
      process.exit(1);
    }

    console.log(JSON.stringify(payload));
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
