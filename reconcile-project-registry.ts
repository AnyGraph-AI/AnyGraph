import { Neo4jService } from './src/storage/neo4j/neo4j.service.js';

interface ProjectCountRow {
  projectId: string;
  nodeCount: number;
  edgeCount: number;
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (n)
       WHERE n.projectId IS NOT NULL
       WITH n.projectId AS projectId, count(n) AS nodeCount
       OPTIONAL MATCH ()-[r]->()
       WHERE r.projectId = projectId
       RETURN projectId, nodeCount, count(r) AS edgeCount
       ORDER BY projectId`,
    )) as ProjectCountRow[];

    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const existing = (await neo4j.run(
        `MATCH (p:Project {projectId: $projectId}) RETURN count(p) AS c`,
        { projectId: row.projectId },
      )) as Array<{ c: number }>;

      const exists = Number(existing?.[0]?.c ?? 0) > 0;

      await neo4j.run(
        `MERGE (p:Project {projectId: $projectId})
         ON CREATE SET
           p.name = $name,
           p.displayName = $displayName,
           p.projectType = $projectType,
           p.sourceKind = 'derived',
           p.status = 'complete'
         SET
           p.nodeCount = $nodeCount,
           p.edgeCount = $edgeCount,
           p.updatedAt = toString(datetime())`,
        {
          projectId: row.projectId,
          nodeCount: Number(row.nodeCount ?? 0),
          edgeCount: Number(row.edgeCount ?? 0),
          name: row.projectId,
          displayName: row.projectId,
          projectType: row.projectId.startsWith('plan_') ? 'plan' : 'code',
        },
      );

      if (exists) updated += 1;
      else created += 1;
    }

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

    console.log(
      JSON.stringify({
        ok: true,
        projectsSeen: rows.length,
        created,
        updated,
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
