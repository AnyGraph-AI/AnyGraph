import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

const PLAN_PROJECT_ID = 'plan_codegraph';
const RUNTIME_PLAN_PROJECT_ID = 'plan_runtime_graph';
const ROADMAP_FILE = 'VERIFICATION_GRAPH_ROADMAP.md';

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

  const neo4j = new Neo4jService();
  try {
    const milestoneRows = await neo4j.run(
      `MATCH (m:Milestone {projectId: $projectId})
       WHERE m.filePath ENDS WITH $roadmapFile
         AND m.code IS NOT NULL
         AND (m.code STARTS WITH 'VG-' OR m.code STARTS WITH 'CA-' OR m.code STARTS WITH 'RTG-')
       OPTIONAL MATCH (t:Task {projectId: $projectId})-[:PART_OF]->(m)
       WITH m.code AS bucket, t
       RETURN
         bucket,
         count(t) AS total,
         sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
         sum(CASE WHEN t.status = 'planned' THEN 1 ELSE 0 END) AS planned,
         sum(CASE WHEN t.status = 'blocked' THEN 1 ELSE 0 END) AS blocked,
         sum(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS inProgress
       ORDER BY bucket`,
      { projectId: planProjectId, roadmapFile: ROADMAP_FILE },
    );

    const nextTaskRows = await neo4j.run(
      `MATCH (t:Task {projectId: $projectId})
       WHERE coalesce(t.status, 'planned') <> 'done'
       OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task {projectId: $projectId})
       WITH t, count(DISTINCT CASE WHEN coalesce(d.status, 'planned') <> 'done' THEN d END) AS openDeps
       WHERE coalesce(t.status, 'planned') <> 'blocked'
       RETURN
         t.id AS id,
         t.line AS line,
         t.name AS task,
         coalesce(t.status, 'planned') AS status,
         openDeps
       ORDER BY openDeps ASC, coalesce(t.line, 999999) ASC
       LIMIT 10`,
      { projectId: planProjectId },
    );

    const blockedRows = await neo4j.run(
      `MATCH (t:Task {projectId: $projectId})
       OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task {projectId: $projectId})
       WITH t, count(DISTINCT CASE WHEN coalesce(d.status, 'planned') <> 'done' THEN d END) AS openDeps
       RETURN
         sum(CASE WHEN coalesce(t.status, 'planned') = 'blocked' THEN 1 ELSE 0 END) AS explicitBlocked,
         sum(CASE WHEN coalesce(t.status, 'planned') <> 'done' AND openDeps > 0 THEN 1 ELSE 0 END) AS effectiveBlocked,
         sum(CASE WHEN t.status IS NULL THEN 1 ELSE 0 END) AS nullStatusCount`,
      { projectId: planProjectId },
    );

    const runtimeRows = await neo4j.run(
      `MATCH (t:Task {projectId: $runtimeProjectId})
       WITH collect(t) AS tasks
       UNWIND tasks AS t
       OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->(e)
       WHERE coalesce(r.projectId, t.projectId) = t.projectId
       WITH tasks, t, count(e) AS evidenceHits
       WITH
         tasks,
         count(DISTINCT CASE WHEN evidenceHits > 0 THEN t END) AS withEvidence,
         count(DISTINCT CASE WHEN t.status = 'done' AND evidenceHits = 0 THEN t END) AS doneWithoutEvidence
       RETURN size(tasks) AS totalTasks, withEvidence, doneWithoutEvidence`,
      { runtimeProjectId },
    );

    const summary = {
      ok: true,
      planProjectId,
      runtimeProjectId,
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
      }))[0] ?? { totalTasks: 0, withEvidence: 0, doneWithoutEvidence: 0 },
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
