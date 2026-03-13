import { Neo4jService } from './src/storage/neo4j/neo4j.service.js';

function extractJsDocSummary(sourceCode: string): string {
  const match = sourceCode.match(/\/\*\*([\s\S]*?)\*\//);
  if (!match) return '';

  const lines = match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('@'));

  return lines[0] ?? '';
}

function extractFirstCodeLine(sourceCode: string): string {
  const lines = sourceCode.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('/*')) continue;
    if (trimmed.startsWith('*')) continue;
    return trimmed.slice(0, 220);
  }
  return '';
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (fn)
       WHERE (
         fn:Function OR fn:Method
         OR fn.coreType IN ['FunctionDeclaration', 'MethodDeclaration']
         OR fn.semanticType IN ['function', 'method']
       )
       RETURN fn.id AS id, fn.name AS name, fn.sourceCode AS sourceCode, fn.projectId AS projectId`,
    )) as Array<Record<string, unknown>>;

    let updated = 0;

    for (const row of rows) {
      const id = String(row.id ?? '');
      if (!id) continue;

      const name = String(row.name ?? '');
      const sourceCode = String(row.sourceCode ?? '');
      const jsDocSummary = extractJsDocSummary(sourceCode);
      const firstCodeLine = extractFirstCodeLine(sourceCode);

      const embeddingInput = [
        `name: ${name}`,
        jsDocSummary ? `jsdoc: ${jsDocSummary}` : null,
        firstCodeLine ? `line: ${firstCodeLine}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      await neo4j.run(
        `MATCH (fn {id: $id})
         SET fn.descriptionText = coalesce(fn.descriptionText, $descriptionText),
             fn.jsDocSummary = $jsDocSummary,
             fn.firstCodeLine = $firstCodeLine,
             fn.embeddingInput = $embeddingInput,
             fn.embeddingInputVersion = 1,
             fn.updatedAt = toString(datetime())`,
        {
          id,
          descriptionText: name,
          jsDocSummary,
          firstCodeLine,
          embeddingInput,
        },
      );

      updated += 1;
    }

    console.log(JSON.stringify({ ok: true, scanned: rows.length, updated }));
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
