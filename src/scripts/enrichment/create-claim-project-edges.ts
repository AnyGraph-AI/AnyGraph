/**
 * GC-3: Claim → Project SPANS_PROJECT edges
 *
 * Creates SPANS_PROJECT edges from Claims to all Projects their evidence touches.
 * Traversal: Claim -[:SUPPORTED_BY]-> Evidence -> (via projectId) -> Project
 *
 * All edges tagged {derived: true, source: 'claim-project'}
 */
import type { Driver } from 'neo4j-driver';

/**
 * Create SPANS_PROJECT edges from Claims → Projects.
 * A claim spans a project if any of its supporting evidence has that project's projectId.
 */
export async function enrichClaimProjects(
  driver: Driver,
  projectId?: string,
): Promise<{ edges: number }> {
  const session = driver.session();
  try {
    const filterClause = projectId
      ? 'AND (e.projectId = $projectId OR c.projectId = $projectId)'
      : '';

    const result = await session.run(
      `MATCH (c:Claim)-[:SUPPORTED_BY]->(e:Evidence)
       WHERE e.projectId IS NOT NULL
       ${filterClause}
       WITH c, e.projectId AS evidenceProjectId
       MATCH (p:Project {projectId: evidenceProjectId})
       MERGE (c)-[r:SPANS_PROJECT]->(p)
       ON CREATE SET r.derived = true, r.source = 'claim-project', r.created = datetime()
       RETURN count(r) AS edges`,
      { projectId: projectId ?? null },
    );
    const edges = result.records[0]?.get('edges')?.toNumber?.() ??
      result.records[0]?.get('edges') ?? 0;

    console.log(`[GC-3] SPANS_PROJECT: ${edges} edges created`);
    return { edges: typeof edges === 'number' ? edges : 0 };
  } finally {
    await session.close();
  }
}

// ─── CLI entry point ───────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const neo4j = await import('neo4j-driver');
  const driver = neo4j.default.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.default.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );
  try {
    const result = await enrichClaimProjects(driver, process.argv[2]);
    console.log(`Done: ${result.edges} SPANS_PROJECT edges`);
  } finally {
    await driver.close();
  }
}
