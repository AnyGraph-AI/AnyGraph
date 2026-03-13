import { resolve } from 'node:path';

import { parseDocumentCollection, documentSchemaToIr } from '../core/adapters/document/document-parser.js';
import { materializeIrDocument } from '../core/ir/ir-materializer.js';
import { resolveProjectId } from '../core/utils/project-id.js';
import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

async function main(): Promise<void> {
  const sourcePathArg = process.argv[2];
  if (!sourcePathArg) {
    console.error('Usage: node --loader ts-node/esm src/utils/document-adapter-ingest.ts <sourcePath> [projectId]');
    process.exit(1);
  }

  const sourcePath = resolve(sourcePathArg);
  const explicitProjectId = process.argv[3];
  const projectId = resolveProjectId(sourcePath, explicitProjectId);

  const schema = await parseDocumentCollection({
    projectId,
    sourcePath,
  });

  const ir = documentSchemaToIr(schema);

  const result = await materializeIrDocument(ir, {
    batchSize: 500,
    clearProjectFirst: true,
  });

  const neo4j = new Neo4jService();
  try {
    await neo4j.run(
      `MERGE (p:Project {projectId: $projectId})
       SET p.name = coalesce(p.name, $displayName),
           p.displayName = $displayName,
           p.projectType = 'document',
           p.sourceKind = 'parser',
           p.status = 'active',
           p.updatedAt = toString(datetime())`,
      {
        projectId,
        displayName: schema.collection.name,
      },
    );

    await neo4j.run(
      `MATCH (p:Project {projectId: $projectId})
       OPTIONAL MATCH (n {projectId: $projectId})
       WITH p, count(n) AS nodeCount
       OPTIONAL MATCH ()-[r]->()
       WHERE r.projectId = $projectId
       WITH p, nodeCount, count(r) AS edgeCount
       SET p.nodeCount = nodeCount,
           p.edgeCount = edgeCount,
           p.updatedAt = toString(datetime())`,
      { projectId },
    );
  } finally {
    await neo4j.close();
  }

  console.log(
    JSON.stringify({
      ok: true,
      sourcePath,
      projectId,
      documents: schema.documents.length,
      paragraphs: schema.paragraphs.length,
      entities: schema.entities.length,
      witnesses: schema.witnesses.length,
      materialized: result,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
