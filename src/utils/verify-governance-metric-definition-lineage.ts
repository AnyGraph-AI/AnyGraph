import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? 'proj_c0d3e9a1f200';
  const required = ['preventedRuns', 'preventedEdgesDiagnostic', 'interceptionRate'];
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (m:MetricDefinition {projectId: $projectId})
       WHERE m.name IN $required
       OPTIONAL MATCH (m)-[:USED_BY]->(s:MetricSurface {projectId: $projectId})
       RETURN m.name AS name,
              count(DISTINCT s) AS usedByCount,
              collect(DISTINCT s.surfaceType) AS surfaceTypes,
              collect(DISTINCT s.name) AS surfaces
       ORDER BY name`,
      { projectId, required },
    )) as Array<Record<string, unknown>>;

    const missing = required.filter((name) => !rows.some((r) => String(r.name) === name));

    const lowCoverage = rows.filter((r) => Number(r.usedByCount ?? 0) < 3);

    if (missing.length > 0 || lowCoverage.length > 0) {
      console.error(
        JSON.stringify({
          ok: false,
          projectId,
          missing,
          lowCoverage: lowCoverage.map((r) => ({
            name: String(r.name ?? ''),
            usedByCount: Number(r.usedByCount ?? 0),
            surfaceTypes: r.surfaceTypes,
          })),
        }),
      );
      process.exit(1);
    }

    console.log(
      JSON.stringify({
        ok: true,
        projectId,
        checked: rows.length,
        metrics: rows.map((r) => ({
          name: String(r.name ?? ''),
          usedByCount: Number(r.usedByCount ?? 0),
          surfaceTypes: r.surfaceTypes,
        })),
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
