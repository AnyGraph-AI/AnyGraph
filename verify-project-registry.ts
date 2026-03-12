import { Neo4jService } from './src/storage/neo4j/neo4j.service.js';

interface MismatchRow {
  projectId: string;
  actualNodes: number;
  actualEdges: number;
  registeredNodes: number;
  registeredEdges: number;
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

    const mismatches = (await neo4j.run(
      `MATCH (p:Project)
       WHERE p.projectId IS NOT NULL
       OPTIONAL MATCH (n {projectId: p.projectId})
       WITH p, count(n) AS actualNodes
       OPTIONAL MATCH ()-[r]->()
       WHERE r.projectId = p.projectId
       WITH p, actualNodes, count(r) AS actualEdges
       WHERE coalesce(toInteger(p.nodeCount), -1) <> actualNodes
          OR coalesce(toInteger(p.edgeCount), -1) <> actualEdges
       RETURN p.projectId AS projectId,
              actualNodes,
              actualEdges,
              coalesce(toInteger(p.nodeCount), -1) AS registeredNodes,
              coalesce(toInteger(p.edgeCount), -1) AS registeredEdges
       ORDER BY p.projectId`,
    )) as MismatchRow[];

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
