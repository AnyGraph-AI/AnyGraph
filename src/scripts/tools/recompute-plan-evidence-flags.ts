import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

export async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const result = await neo4j.run(
      `MATCH (t:Task)
       OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->()
       WITH t,
            sum(CASE WHEN r.refType IN ['file_path', 'function'] THEN 1 ELSE 0 END) AS explicitCount,
            sum(CASE WHEN r.refType = 'semantic_keyword' THEN 1 ELSE 0 END) AS semanticCount
       SET t.hasCodeEvidence = explicitCount > 0,
           t.codeEvidenceCount = explicitCount,
           t.hasSemanticEvidence = semanticCount > 0,
           t.semanticEvidenceCount = semanticCount
       RETURN count(t) AS tasksUpdated`,
    );

    console.log(
      JSON.stringify({
        ok: true,
        tasksUpdated: Number(result?.[0]?.tasksUpdated ?? 0),
      }),
    );
  } finally {
    await neo4j.getDriver().close();
  }
}

// Guard: only run when executed directly (not imported by tests)
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
