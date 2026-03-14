import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

interface Row {
  edgeType: string;
  updated: number;
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (a)-[r]->()
       WHERE r.projectId IS NULL
         AND a.projectId IS NOT NULL
       WITH r, a.projectId AS projectId
       SET r.projectId = projectId
       WITH type(r) AS edgeType, count(r) AS updated
       RETURN edgeType, updated
       ORDER BY updated DESC`,
    )) as Row[];

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
