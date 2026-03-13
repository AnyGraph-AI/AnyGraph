import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';
import {
  CONTRACT_QUERY_Q11_BLOCKED,
  CONTRACT_QUERY_Q11_MILESTONE_BUCKETS,
  CONTRACT_QUERY_Q11_NEXT_TASKS,
  CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE,
} from './query-contract.js';

dotenv.config();

const PLAN_PROJECT_ID = 'plan_codegraph';
const RUNTIME_PLAN_PROJECT_ID = 'plan_runtime_graph';

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
    const milestoneRows = await neo4j.run(CONTRACT_QUERY_Q11_MILESTONE_BUCKETS, { projectId: planProjectId });

    const nextTaskRows = await neo4j.run(CONTRACT_QUERY_Q11_NEXT_TASKS, { projectId: planProjectId });

    const blockedRows = await neo4j.run(CONTRACT_QUERY_Q11_BLOCKED, { projectId: planProjectId });

    const runtimeRows = await neo4j.run(CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE, { runtimeProjectId });

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
        evidenceEdgeCount: toNum(row.evidenceEdgeCount),
        evidenceArtifactCount: toNum(row.evidenceArtifactCount),
      }))[0] ?? {
        totalTasks: 0,
        withEvidence: 0,
        doneWithoutEvidence: 0,
        evidenceEdgeCount: 0,
        evidenceArtifactCount: 0,
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
