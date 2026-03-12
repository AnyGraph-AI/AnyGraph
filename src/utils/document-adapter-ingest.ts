import { resolve } from 'node:path';

import { parseDocumentCollection, documentSchemaToIr } from '../core/adapters/document/document-parser.js';
import { materializeIrDocument } from '../core/ir/ir-materializer.js';
import { resolveProjectId } from '../core/utils/project-id.js';

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

  console.log(
    JSON.stringify({
      ok: true,
      sourcePath,
      projectId,
      documents: schema.documents.length,
      paragraphs: schema.paragraphs.length,
      entities: schema.entities.length,
      materialized: result,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
