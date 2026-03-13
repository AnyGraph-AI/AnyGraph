import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

interface Row {
  projectId: string;
  projectType: string;
  sourceKind: string;
  docCollections: unknown;
  docNodes: unknown;
  paragraphs: unknown;
  docWitnesses: unknown;
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (p:Project)
       OPTIONAL MATCH (a:IRNode {projectId: p.projectId}) WHERE a.kind = 'DocumentCollection'
       WITH p, count(a) AS docCollections
       OPTIONAL MATCH (d:IRNode {projectId: p.projectId}) WHERE d.kind = 'DocumentNode'
       WITH p, docCollections, count(d) AS docNodes
       OPTIONAL MATCH (s:IRNode {projectId: p.projectId}) WHERE s.kind = 'Paragraph'
       WITH p, docCollections, docNodes, count(s) AS paragraphs
       OPTIONAL MATCH (w:DocumentWitness {projectId: p.projectId})
       RETURN p.projectId AS projectId,
              p.projectType AS projectType,
              p.sourceKind AS sourceKind,
              docCollections,
              docNodes,
              paragraphs,
              count(w) AS docWitnesses
       ORDER BY projectId`,
    )) as Row[];

    const findings = rows
      .map((r) => ({
        projectId: String(r.projectId ?? ''),
        projectType: String(r.projectType ?? ''),
        sourceKind: String(r.sourceKind ?? ''),
        docCollections: toNum(r.docCollections),
        docNodes: toNum(r.docNodes),
        paragraphs: toNum(r.paragraphs),
        docWitnesses: toNum(r.docWitnesses),
      }))
      .filter((r) => r.docCollections > 0 || r.docNodes > 0 || r.paragraphs > 0 || r.docWitnesses > 0);

    const nonDocumentNamespaces = findings.filter((r) => r.projectType !== 'document');

    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      projectsWithDocumentLikeData: findings.length,
      nonDocumentNamespaces: nonDocumentNamespaces.length,
      findings,
      recommendation:
        nonDocumentNamespaces.length > 0
          ? 'Migrate or mark shadow-only for listed non-document project namespaces before fail-closed enforcement.'
          : 'No namespace drift detected for document-like nodes.',
    };

    const dir = join(process.cwd(), 'artifacts', 'document-namespace-audit');
    mkdirSync(dir, { recursive: true });
    const ts = payload.generatedAt.replace(/[:.]/g, '-');
    const outPath = join(dir, `${ts}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(payload, null, 2));

    console.log(JSON.stringify({ ...payload, outPath }));
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
