import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

interface Row {
  edgeType: string;
  updated: number;
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rowsFromSource = (await neo4j.run(
      `MATCH (a)-[r]->()
       WHERE r.projectId IS NULL
         AND a.projectId IS NOT NULL
       WITH r, a.projectId AS projectId
       SET r.projectId = projectId
       WITH type(r) AS edgeType, count(r) AS updated
       RETURN edgeType, updated
       ORDER BY updated DESC`,
    )) as Row[];

    const rowsFromTarget = (await neo4j.run(
      `MATCH ()-[r:ANALYZED|SPANS_PROJECT|FROM_PROJECT]->(b)
       WHERE r.projectId IS NULL
         AND b.projectId IS NOT NULL
       WITH r, b.projectId AS projectId
       SET r.projectId = projectId
       WITH type(r) AS edgeType, count(r) AS updated
       RETURN edgeType, updated
       ORDER BY updated DESC`,
    )) as Row[];

    const byType = new Map<string, number>();
    for (const row of [...rowsFromSource, ...rowsFromTarget]) {
      byType.set(row.edgeType, (byType.get(row.edgeType) ?? 0) + Number(row.updated ?? 0));
    }

    const rows = [...byType.entries()]
      .map(([edgeType, updated]) => ({ edgeType, updated }))
      .sort((a, b) => b.updated - a.updated);

    const totalUpdated = rows.reduce((sum, row) => sum + Number(row.updated ?? 0), 0);

    console.log(
      JSON.stringify({
        ok: true,
        totalUpdated,
        byType: rows,
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
