import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

interface MismatchSummary {
  ok: boolean;
  projectFilter: string | null;
  recommendedTasks: number;
  doneRecommendedTasks: number;
  mismatchRate: number;
  maxAllowedMismatchRate: number;
  sample: Array<{ projectId: string; task: string; status: string; line: number }>;
}

/**
 * VG-6 recommendation mismatch metric
 *
 * Measures whether the dependency-aware recommendation query would surface any
 * task already marked done. Policy target: mismatchRate = 0.
 */
async function main(): Promise<void> {
  const projectFilter = process.argv[2] ?? null;
  const maxAllowedMismatchRate = Number(process.env.MAX_RECOMMENDATION_MISMATCH_RATE ?? 0);

  const neo4j = new Neo4jService();
  try {
    const filterClause = projectFilter
      ? `AND t.projectId = $projectId`
      : '';

    // Mirror recommendation query shape (dependency-aware next tasks)
    const rows = await neo4j.run(
      `MATCH (t:Task)
       WHERE t.projectId STARTS WITH 'plan_'
         AND t.status IN ['planned', 'in_progress'] ${filterClause}
       OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep:Task)
       WITH t, count(CASE WHEN dep.status IN ['planned', 'in_progress', 'blocked'] THEN 1 END) AS openDeps
       WHERE openDeps = 0
       RETURN t.projectId AS projectId,
              t.name AS task,
              t.status AS status,
              t.line AS line
       ORDER BY t.projectId, t.line`,
      projectFilter ? { projectId: projectFilter } : {},
    );

    const recommendedTasks = rows.length;
    const doneRows = rows.filter((r) => str(r.status) === 'done');
    const doneRecommendedTasks = doneRows.length;
    const mismatchRate = recommendedTasks === 0 ? 0 : doneRecommendedTasks / recommendedTasks;

    const summary: MismatchSummary = {
      ok: mismatchRate <= maxAllowedMismatchRate,
      projectFilter,
      recommendedTasks,
      doneRecommendedTasks,
      mismatchRate: Number(mismatchRate.toFixed(6)),
      maxAllowedMismatchRate,
      sample: doneRows.slice(0, 10).map((r) => ({
        projectId: str(r.projectId),
        task: str(r.task),
        status: str(r.status),
        line: toNum(r.line),
      })),
    };

    if (!summary.ok) {
      console.error(JSON.stringify(summary, null, 2));
      process.exit(1);
    }

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
