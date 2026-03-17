import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

async function main(): Promise<void> {
  const planProjectId = process.argv[2] ?? 'plan_codegraph';
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (c:Claim {projectId: $planProjectId})
       WHERE c.claimType = 'task_completion'
         AND (
           toLower(coalesce(c.statement,'')) CONTAINS 'document layer complete'
           OR toLower(coalesce(c.statement,'')) CONTAINS 'document complete'
         )
         // Exclude meta-governance tasks ABOUT document-complete wording/assertion rules.
         // These are implementation tasks, not claims that the document layer itself is complete.
         AND NOT toLower(coalesce(c.statement,'')) CONTAINS 'fail claim generation for'
         AND NOT toLower(coalesce(c.statement,'')) CONTAINS 'forbidden wording rule'
       RETURN c.claimId AS claimId,
              c.statement AS statement,
              coalesce(c.supportGrade, 'missing') AS supportGrade,
              coalesce(c.supportSupportCount, 0) AS supportCount,
              coalesce(c.supportRuntimeHits, 0) AS runtimeHits
       ORDER BY c.claimId`,
      { planProjectId },
    )) as Array<Record<string, unknown>>;

    const violations = rows.filter((row) => String(row.supportGrade ?? '') !== 'runtime_materialized');

    if (violations.length > 0) {
      console.error(
        JSON.stringify({
          ok: false,
          planProjectId,
          violations: violations.length,
          details: violations.map((v) => ({
            claimId: String(v.claimId ?? ''),
            supportGrade: String(v.supportGrade ?? ''),
            supportCount: Number(v.supportCount ?? 0),
            runtimeHits: Number(v.runtimeHits ?? 0),
            statement: String(v.statement ?? '').slice(0, 220),
          })),
        }),
      );
      process.exit(1);
    }

    console.log(
      JSON.stringify({
        ok: true,
        planProjectId,
        checkedClaims: rows.length,
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
