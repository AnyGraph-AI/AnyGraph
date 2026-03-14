import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function linkCrossDomainDependencies(neo4j: Neo4jService, now: string): Promise<number> {
  const rows = (await neo4j.run(
    `MATCH (pc:Claim {domain: 'plan'})
     WHERE pc.projectId IS NOT NULL

     // First preference: code claim directly tied to task evidence node
     OPTIONAL MATCH (t:Task {id: pc.sourceNodeId})-[:HAS_CODE_EVIDENCE]->(n)
     OPTIONAL MATCH (direct:Claim {domain: 'code', sourceNodeId: n.id})

     // Fallback: strongest code claim in mapped code project
     OPTIONAL MATCH (pp:PlanProject {projectId: pc.projectId})-[:TARGETS]->(cp:Project)
     OPTIONAL MATCH (fallback:Claim {domain: 'code', projectId: cp.projectId})
     WITH pc, direct, fallback
     ORDER BY fallback.confidence DESC
     WITH pc,
          collect(DISTINCT direct)[0] AS directClaim,
          collect(DISTINCT fallback)[0] AS fallbackClaim
     WITH pc, coalesce(directClaim, fallbackClaim) AS cc
     WHERE cc IS NOT NULL

     MERGE (pc)-[r:DEPENDS_ON]->(cc)
     ON CREATE SET r.created = $now
     SET r.projectId = coalesce(pc.projectId, cc.projectId),
         r.reason = 'plan_claim_depends_on_code_claim',
         r.updated = $now
     RETURN count(r) AS c`,
    { now },
  )) as Array<Record<string, unknown>>;

  return toNum(rows[0]?.c);
}

async function synthesizeTransitiveImpact(neo4j: Neo4jService, now: string): Promise<number> {
  const rows = (await neo4j.run(
    `MATCH (codeClaim:Claim {domain: 'code'})
     MATCH (planClaim:Claim {domain: 'plan'})-[:DEPENDS_ON]->(codeClaim)
     OPTIONAL MATCH (docClaim:Claim)
     WHERE docClaim.domain IN ['document', 'corpus', 'cross']
       AND docClaim.projectId = planClaim.projectId
     WITH codeClaim, planClaim, collect(DISTINCT docClaim)[..3] AS downstream
     MERGE (tc:Claim {id: 'claim_transitive_' + planClaim.id + '_' + codeClaim.id})
     ON CREATE SET tc.created = $now
     SET tc.statement = 'Code claim "' + coalesce(codeClaim.claimType, 'unknown') +
                        '" impacts plan claim "' + coalesce(planClaim.claimType, 'unknown') +
                        '" with ' + toString(size(downstream)) + ' downstream domain claims',
         tc.confidence = 0.85,
         tc.domain = 'cross',
         tc.claimType = 'transitive_impact',
         tc.status = 'supported',
         tc.projectId = coalesce(planClaim.projectId, codeClaim.projectId),
         tc.sourceNodeId = coalesce(planClaim.sourceNodeId, codeClaim.sourceNodeId),
         tc.updated = $now
     MERGE (tc)-[:DEPENDS_ON]->(planClaim)
     MERGE (tc)-[:DEPENDS_ON]->(codeClaim)
     FOREACH (d IN [x IN downstream WHERE x IS NOT NULL] | MERGE (tc)-[:DEPENDS_ON]->(d))
     RETURN count(DISTINCT tc) AS c`,
    { now },
  )) as Array<Record<string, unknown>>;

  return toNum(rows[0]?.c);
}

async function detectCrossDomainContradictions(neo4j: Neo4jService, now: string): Promise<number> {
  const rows = (await neo4j.run(
    `MATCH (a:Claim)
     MATCH (b:Claim)
     WHERE id(a) < id(b)
       AND a.domain <> b.domain
       AND coalesce(a.projectId, '') = coalesce(b.projectId, '')
       AND (
         (a.sourceNodeId IS NOT NULL AND b.sourceNodeId IS NOT NULL AND a.sourceNodeId = b.sourceNodeId)
         OR (a.claimType = b.claimType AND a.claimType IS NOT NULL)
       )
       AND (
         (a.status IN ['supported', 'asserted'] AND b.status IN ['refuted', 'contested'])
         OR (b.status IN ['supported', 'asserted'] AND a.status IN ['refuted', 'contested'])
       )
     MERGE (a)-[r:CONTRADICTED_BY]->(b)
     ON CREATE SET r.created = $now
     SET r.projectId = coalesce(a.projectId, b.projectId),
         r.grade = 'A3',
         r.weight = 0.4,
         r.reason = 'cross_domain_status_conflict',
         r.updated = $now
     RETURN count(r) AS c`,
    { now },
  )) as Array<Record<string, unknown>>;

  return toNum(rows[0]?.c);
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();
  const now = new Date().toISOString();

  try {
    const dependencyEdges = await linkCrossDomainDependencies(neo4j, now);
    const transitiveClaims = await synthesizeTransitiveImpact(neo4j, now);
    const contradictionEdges = await detectCrossDomainContradictions(neo4j, now);

    console.log(
      JSON.stringify({
        ok: true,
        dependencyEdges,
        transitiveClaims,
        contradictionEdges,
        generatedAt: now,
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
