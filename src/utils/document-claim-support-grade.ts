import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

type SupportGrade = 'plan_only' | 'code_only' | 'runtime_materialized';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main(): Promise<void> {
  const planProjectId = process.argv[2] ?? 'plan_codegraph';
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (c:Claim {projectId: $planProjectId})
       WHERE c.claimType = 'task_completion'
         AND toLower(coalesce(c.statement, '')) CONTAINS 'document'
       OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(s)
       OPTIONAL MATCH (p:Project {projectId: s.projectId})
       WITH c,
            count(s) AS supportCount,
            sum(CASE
                  WHEN 'DocumentWitness' IN labels(s)
                    OR (('DocumentNode' IN labels(s) OR 'DocumentCollection' IN labels(s) OR 'Paragraph' IN labels(s)) AND p.projectType = 'document')
                  THEN 1 ELSE 0 END) AS runtimeSupportHits,
            sum(CASE
                  WHEN s IS NOT NULL AND (
                    'SourceFile' IN labels(s)
                    OR 'Function' IN labels(s)
                    OR 'Method' IN labels(s)
                    OR 'Task' IN labels(s)
                    OR 'Milestone' IN labels(s)
                    OR ('CodeNode' IN labels(s) AND coalesce(s.coreType, '') <> 'DocumentWitness')
                  )
                  THEN 1 ELSE 0 END) AS codeLikeSupportHits
       WITH c,
            supportCount,
            runtimeSupportHits,
            codeLikeSupportHits,
            CASE
              WHEN runtimeSupportHits > 0 THEN 'runtime_materialized'
              WHEN codeLikeSupportHits > 0 OR supportCount > 0 THEN 'code_only'
              ELSE 'plan_only'
            END AS supportGrade
       SET c.supportGrade = supportGrade,
           c.supportSupportCount = supportCount,
           c.supportRuntimeHits = runtimeSupportHits,
           c.supportCodeHits = codeLikeSupportHits,
           c.supportGradedAt = toString(datetime())
       RETURN c.claimId AS claimId,
              c.statement AS statement,
              supportGrade,
              supportCount,
              runtimeSupportHits,
              codeLikeSupportHits
       ORDER BY c.claimId`,
      { planProjectId },
    )) as Array<Record<string, unknown>>;

    const byGrade: Record<SupportGrade, number> = {
      plan_only: 0,
      code_only: 0,
      runtime_materialized: 0,
    };
    for (const row of rows) {
      const g = String(row.supportGrade ?? 'plan_only') as SupportGrade;
      byGrade[g] = (byGrade[g] ?? 0) + 1;
    }

    console.log(
      JSON.stringify({
        ok: true,
        planProjectId,
        claimsGraded: rows.length,
        byGrade,
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
