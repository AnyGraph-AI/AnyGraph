/**
 * @module enrich-code-embedding-inputs
 *
 * ## embeddingInput Specification
 *
 * ### Purpose
 * Composes a concise, semantically-rich text representation for each Function/Method
 * node to be used as input for vector embedding. The resulting `embeddingInput` property
 * enables similarity search across code entities via downstream `embed-nodes.ts`.
 *
 * ### Composition Format
 * The embeddingInput string is a newline-separated concatenation of:
 *
 * 1. **name** (required): `name: <functionName>`
 * 2. **jsdoc** (optional): `jsdoc: <firstNonTagLine>` — first non-@tag line from JSDoc block
 * 3. **line** (optional): `line: <firstCodeLine>` — first non-comment code line (max 220 chars)
 *
 * Example output:
 * ```
 * name: calculateRisk
 * jsdoc: Computes composite risk score from structural metrics
 * line: export function calculateRisk(metrics: RiskMetrics): number {
 * ```
 *
 * ### Max Length Constraint
 * No truncation is applied here. The downstream consumer (`embed-nodes.ts`) enforces
 * `MAX_CHARS = 28000` (~7000 tokens) when submitting to the embedding API. The composition
 * format is designed to stay well under this limit for typical functions.
 *
 * ### Rationale
 * This format provides semantic richness for vector search by combining:
 * - **Identifier** (name): enables exact-match style similarity
 * - **Intent** (JSDoc summary): captures human-described purpose
 * - **Structure** (first code line): encodes signature, return type, and modifiers
 *
 * This trio maximizes embedding quality for "find similar functions" queries while
 * remaining compact enough to avoid token limit issues at scale.
 *
 * ### Properties Set
 * - `embeddingInput`: the composed text (string)
 * - `embeddingInputVersion`: schema version (currently 1)
 * - `jsDocSummary`: extracted JSDoc first line
 * - `firstCodeLine`: extracted first non-comment code line
 * - `descriptionText`: fallback to name if not already set
 * - `updatedAt`: ISO timestamp of enrichment
 */

import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

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
