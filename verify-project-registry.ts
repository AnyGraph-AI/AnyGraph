import { Neo4jService } from './src/storage/neo4j/neo4j.service.js';
import { CONTRACT_QUERY_Q14_PROJECT_COUNTS, CONTRACT_QUERY_Q15_PROJECT_STATUS } from './src/utils/query-contract.js';

interface MismatchRow {
  projectId: string;
  actualNodes: number;
  actualEdges: number;
  registeredNodes: number;
  registeredEdges: number;
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

function fail(message: string): never {
  console.error(`PROJECT_REGISTRY_CHECK_FAILED: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const missing = (await neo4j.run(
      `MATCH (n)
       WHERE n.projectId IS NOT NULL
       WITH DISTINCT n.projectId AS projectId
       WHERE NOT EXISTS { MATCH (:Project {projectId: projectId}) }
       RETURN collect(projectId) AS missingIds`,
    )) as Array<{ missingIds: string[] }>;

    const missingIds = (missing?.[0]?.missingIds ?? []) as string[];
    if (missingIds.length > 0) {
      fail(`Missing :Project rows for: ${missingIds.join(', ')}`);
    }

    const countRows = (await neo4j.run(CONTRACT_QUERY_Q14_PROJECT_COUNTS)) as Array<Record<string, unknown>>;
    const statusRows = (await neo4j.run(CONTRACT_QUERY_Q15_PROJECT_STATUS)) as Array<Record<string, unknown>>;

    const statusByProject = new Map(
      statusRows.map((row) => [String(row.projectId ?? ''), { nodeCount: toNum(row.nodeCount), edgeCount: toNum(row.edgeCount) }]),
    );

    const mismatches: MismatchRow[] = [];
    for (const row of countRows) {
      const projectId = String(row.projectId ?? '');
      if (!projectId) continue;

      const registered = statusByProject.get(projectId);
      if (!registered) continue;

      const actualNodes = toNum(row.nodeCount);
      const actualEdges = toNum(row.edgeCount);
      if (registered.nodeCount !== actualNodes || registered.edgeCount !== actualEdges) {
        mismatches.push({
          projectId,
          actualNodes,
          actualEdges,
          registeredNodes: registered.nodeCount,
          registeredEdges: registered.edgeCount,
        });
      }
    }

    if (mismatches.length > 0) {
      const preview = mismatches
        .slice(0, 10)
        .map(
          (m) =>
            `${m.projectId}(nodes ${m.registeredNodes}->${m.actualNodes}, edges ${m.registeredEdges}->${m.actualEdges})`,
        )
        .join('; ');
      fail(`Found ${mismatches.length} project metric mismatch(es): ${preview}`);
    }

    console.log(
      JSON.stringify({
        ok: true,
        checked: true,
      }),
    );
  } finally {
    await neo4j.getDriver().close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
