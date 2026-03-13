import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

const PLAN_PROJECT_ID = 'plan_codegraph';
const VERIFICATION_MILESTONE_CODE = 'VG-5';

interface DoneVsProvenRow {
  task: string;
  status: string;
  proofResult: string;
  proofRunId: string;
  proofInvariantId: string;
  proofCount: number;
}

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

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? PLAN_PROJECT_ID;

  const neo4j = new Neo4jService();
  try {
    const rows = await neo4j.run(
      `MATCH (m:Milestone {projectId: $projectId, code: $milestoneCode})
       MATCH (t:Task {projectId: $projectId})-[:PART_OF]->(m)
       WHERE t.name STARTS WITH 'Validate invariant:'
       OPTIONAL MATCH (:InvariantProof {projectId: $projectId})-[p:PROVES]->(t)
       WITH t, count(p) AS proofCount
       RETURN
         t.name AS task,
         coalesce(t.status, 'planned') AS status,
         coalesce(t.proofResult, '') AS proofResult,
         coalesce(t.proofRunId, '') AS proofRunId,
         coalesce(t.proofInvariantId, '') AS proofInvariantId,
         proofCount
       ORDER BY t.line`,
      { projectId, milestoneCode: VERIFICATION_MILESTONE_CODE },
    );

    const typedRows: DoneVsProvenRow[] = rows.map((row) => ({
      task: str(row.task),
      status: str(row.status),
      proofResult: str(row.proofResult),
      proofRunId: str(row.proofRunId),
      proofInvariantId: str(row.proofInvariantId),
      proofCount: toNum(row.proofCount),
    }));

    const doneTasks = typedRows.filter((r) => r.status === 'done').length;
    const doneWithoutProof = typedRows.filter((r) => r.status === 'done' && (r.proofCount === 0 || !r.proofRunId)).length;
    const provenTasks = typedRows.filter((r) => r.proofCount > 0 && r.proofResult === 'pass').length;
    const proofWithoutDone = typedRows.filter((r) => r.proofCount > 0 && r.status !== 'done').length;

    const summary = {
      ok: doneWithoutProof === 0 && proofWithoutDone === 0,
      projectId,
      checked: typedRows.length,
      doneTasks,
      provenTasks,
      doneWithoutProof,
      proofWithoutDone,
      rows: typedRows,
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
