import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

interface Violation {
  code: string;
  projectId: string;
  details: string;
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
    const violations: Violation[] = [];

    const nonDocumentRows = (await neo4j.run(
      `MATCH (p:Project)
       WHERE p.projectType <> 'document'
       WITH p
       OPTIONAL MATCH (n {projectId: p.projectId})
       WHERE ('DocumentWitness' IN labels(n))
          OR ('IRNode' IN labels(n) AND coalesce(n.kind, '') IN ['DocumentCollection','DocumentNode','Paragraph'])
       WITH p, count(n) AS docLikeCount
       WHERE docLikeCount > 0
       RETURN p.projectId AS projectId,
              p.projectType AS projectType,
              p.documentNamespaceStatus AS status,
              p.documentNamespaceExpiresAt AS expiresAt,
              docLikeCount
       ORDER BY p.projectId`,
    )) as Array<Record<string, unknown>>;

    for (const row of nonDocumentRows) {
      const projectId = String(row.projectId ?? '');
      const status = String(row.status ?? '');
      const expiresAt = String(row.expiresAt ?? '');
      const expiryTs = Date.parse(expiresAt);

      if (status !== 'shadow_only') {
        violations.push({
          code: 'missing_shadow_only_annotation',
          projectId,
          details: `status=${status || 'missing'}`,
        });
      }

      if (!Number.isFinite(expiryTs) || expiryTs <= Date.now()) {
        violations.push({
          code: 'invalid_or_expired_shadow_expiry',
          projectId,
          details: `expiresAt=${expiresAt || 'missing'}`,
        });
      }
    }

    const parserCodeRows = (await neo4j.run(
      `MATCH (p:Project)
       WHERE p.projectType = 'code' AND p.sourceKind = 'parser'
       OPTIONAL MATCH (w:DocumentWitness {projectId: p.projectId})
       WITH p, count(w) AS witnessCount
       WHERE witnessCount > 0
       RETURN p.projectId AS projectId, witnessCount`,
    )) as Array<Record<string, unknown>>;

    for (const row of parserCodeRows) {
      violations.push({
        code: 'document_witness_under_code_project',
        projectId: String(row.projectId ?? ''),
        details: `witnessCount=${toNum(row.witnessCount)}`,
      });
    }

    if (violations.length > 0) {
      console.error(
        JSON.stringify({
          ok: false,
          violations: violations.length,
          violationCodes: [...new Set(violations.map((v) => v.code))],
          details: violations,
        }),
      );
      process.exit(1);
    }

    console.log(
      JSON.stringify({
        ok: true,
        checkedNonDocumentNamespaces: nonDocumentRows.length,
        parserCodeProjectsWithWitness: parserCodeRows.length,
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
