import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';
import { CONTRACT_QUERY_Q14_PROJECT_COUNTS, CONTRACT_QUERY_Q15_PROJECT_STATUS } from '../../../src/utils/query-contract.js';

export interface MismatchRow {
  projectId: string;
  actualNodes: number;
  actualEdges: number;
  registeredNodes: number;
  registeredEdges: number;
}

export async function collectMismatches(neo4j: Pick<Neo4jService, 'run'>): Promise<MismatchRow[]> {
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

  return mismatches;
}

export function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -1;
}

export function fail(message: string): never {
  console.error(`PROJECT_REGISTRY_CHECK_FAILED: ${message}`);
  process.exit(1);
}

export async function verifyProjectRegistry(
  neo4j: Pick<Neo4jService, 'run'>,
  failFn: (message: string) => never = fail,
): Promise<{ reconciled: boolean; persistentMismatchCount: number }> {
  const missing = (await neo4j.run(
    `MATCH (n)
     WHERE n.projectId IS NOT NULL
     WITH DISTINCT n.projectId AS projectId
     WHERE NOT EXISTS { MATCH (:Project {projectId: projectId}) }
     RETURN collect(projectId) AS missingIds`,
  )) as Array<{ missingIds: string[] }>;

  const missingIds = (missing?.[0]?.missingIds ?? []) as string[];
  if (missingIds.length > 0) {
    failFn(`Missing :Project rows for: ${missingIds.join(', ')}`);
  }

  let mismatches = await collectMismatches(neo4j);
  let reconciled = false;

  // Self-heal with retries: refresh Project node counts, then re-check.
  for (let attempt = 0; attempt < 3 && mismatches.length > 0; attempt += 1) {
    await neo4j.run(
      `MATCH (p:Project)
       WHERE p.projectId IS NOT NULL
       OPTIONAL MATCH (n {projectId: p.projectId})
       WITH p, count(n) AS nodeCount
       OPTIONAL MATCH ()-[r]->()
       WHERE r.projectId = p.projectId
       WITH p, nodeCount, count(r) AS edgeCount
       SET p.nodeCount = nodeCount,
           p.edgeCount = edgeCount,
           p.updatedAt = toString(datetime())`,
    );
    reconciled = true;
    mismatches = await collectMismatches(neo4j);
  }

  if (mismatches.length > 0) {
    const preview = mismatches
      .slice(0, 10)
      .map(
        (m) => `${m.projectId}(nodes ${m.registeredNodes}->${m.actualNodes}, edges ${m.registeredEdges}->${m.actualEdges})`,
      )
      .join('; ');
    failFn(`Found ${mismatches.length} persistent project metric mismatch(es): ${preview}`);
  }

  return {
    reconciled,
    persistentMismatchCount: mismatches.length,
  };
}

export async function main(createNeo4j: () => Neo4jService = () => new Neo4jService()): Promise<void> {
  const neo4j = createNeo4j();

  try {
    const result = await verifyProjectRegistry(neo4j);
    console.log(
      JSON.stringify({
        ok: true,
        checked: true,
        reconciled: result.reconciled,
        persistentMismatchCount: result.persistentMismatchCount,
      }),
    );
  } finally {
    await neo4j.getDriver().close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
