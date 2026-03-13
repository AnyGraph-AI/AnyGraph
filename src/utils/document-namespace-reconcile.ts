import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main(): Promise<void> {
  const expiresDays = Number(process.env.DOCUMENT_SHADOW_EXPIRES_DAYS ?? 30);
  const expiry = new Date(Date.now() + Math.max(1, expiresDays) * 24 * 60 * 60 * 1000).toISOString();

  const neo4j = new Neo4jService();
  try {
    const rows = await neo4j.run(
      `MATCH (p:Project)
       WHERE p.projectType <> 'document'
       WITH p
       OPTIONAL MATCH (n {projectId: p.projectId})
       WHERE ('DocumentWitness' IN labels(n))
          OR ('IRNode' IN labels(n) AND coalesce(n.kind, '') IN ['DocumentCollection','DocumentNode','Paragraph'])
       WITH p, count(n) AS docLikeCount
       WHERE docLikeCount > 0
       SET p.documentNamespaceStatus = 'shadow_only',
           p.documentNamespaceReason = 'document_like_data_noncanonical_namespace',
           p.documentNamespaceTicket = coalesce(p.documentNamespaceTicket, 'DL-3'),
           p.documentNamespaceAnnotatedAt = toString(datetime()),
           p.documentNamespaceExpiresAt = coalesce(p.documentNamespaceExpiresAt, $expiry),
           p.updatedAt = toString(datetime())
       RETURN p.projectId AS projectId,
              p.projectType AS projectType,
              p.sourceKind AS sourceKind,
              p.documentNamespaceStatus AS documentNamespaceStatus,
              p.documentNamespaceExpiresAt AS documentNamespaceExpiresAt,
              docLikeCount
       ORDER BY p.projectId`,
      { expiry },
    );

    const payload = {
      ok: true,
      shadowExpiresAtDefault: expiry,
      updatedProjects: rows.length,
      projects: (rows as Array<Record<string, unknown>>).map((r) => ({
        projectId: String(r.projectId ?? ''),
        projectType: String(r.projectType ?? ''),
        sourceKind: String(r.sourceKind ?? ''),
        documentNamespaceStatus: String(r.documentNamespaceStatus ?? ''),
        documentNamespaceExpiresAt: String(r.documentNamespaceExpiresAt ?? ''),
        docLikeCount: toNum(r.docLikeCount),
      })),
    };

    console.log(JSON.stringify(payload));
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
