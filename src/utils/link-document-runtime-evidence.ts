import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

const TARGET_TASK =
  'Link runtime ingest artifacts to document-completion tasks via evidence edges (not plan checkbox only)';

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = await neo4j.run(
      `MATCH (t:Task {projectId:'plan_codegraph', name:$taskName})
       MATCH (p:Project {projectType:'document'})
       MATCH (n {projectId:p.projectId})
       WHERE 'DocumentWitness' IN labels(n)
          OR 'DocumentNode' IN labels(n)
          OR 'DocumentCollection' IN labels(n)
          OR 'Paragraph' IN labels(n)
       MERGE (t)-[r:HAS_CODE_EVIDENCE]->(n)
       ON CREATE SET
         r.confidence = 'high',
         r.source = 'runtime_document_ingest',
         r.linkedAt = toString(datetime())
       RETURN count(DISTINCT n) AS linkedNodes,
              count(DISTINCT p) AS documentProjects`,
      { taskName: TARGET_TASK },
    );

    const linkedNodes = Number((rows?.[0] as any)?.linkedNodes?.toNumber?.() ?? (rows?.[0] as any)?.linkedNodes ?? 0);
    const documentProjects = Number((rows?.[0] as any)?.documentProjects?.toNumber?.() ?? (rows?.[0] as any)?.documentProjects ?? 0);

    console.log(
      JSON.stringify({
        ok: true,
        taskName: TARGET_TASK,
        documentProjects,
        linkedNodes,
      }),
    );
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
