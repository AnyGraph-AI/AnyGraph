/**
 * GC-4: Evidence → Project FROM_PROJECT edges
 *
 * Creates FROM_PROJECT edges from Evidence → Project.
 * Primary: match Evidence.projectId to Project.projectId
 * Cross-layer: for cross_cutting_impact evidence, also link to the plan project
 *   whose tasks depend on the code file (via HAS_CODE_EVIDENCE traversal)
 *
 * All edges tagged {derived: true, source: 'evidence-project'}
 */
import type { Driver } from 'neo4j-driver';

/**
 * Create FROM_PROJECT edges from Evidence → Project.
 *
 * Pass 1: Direct match — Evidence.projectId → Project.projectId
 * Pass 2: Cross-layer — cross_cutting_impact evidence gets edges to BOTH
 *         the code project AND the plan project(s) whose tasks reference the code file
 */
export async function enrichEvidenceProject(
  driver: Driver,
): Promise<{ direct: number; crossLayer: number; orphaned: number }> {
  const session = driver.session();
  try {
    // Pass 1: Direct match — every Evidence with projectId gets FROM_PROJECT to its Project
    const directResult = await session.run(
      `MATCH (e:Evidence)
       WHERE e.projectId IS NOT NULL
       MATCH (p:Project {projectId: e.projectId})
       MERGE (e)-[r:FROM_PROJECT]->(p)
       ON CREATE SET r.derived = true, r.source = 'evidence-project', r.created = datetime()
       RETURN count(r) AS edges`,
    );
    const direct = directResult.records[0]?.get('edges')?.toNumber?.() ??
      directResult.records[0]?.get('edges') ?? 0;

    // Pass 2: Cross-layer — cross_cutting_impact evidence links to BOTH code and plan projects
    // These evidence nodes have code projectId but were triggered by plan task → code file overlap
    // Traverse: Evidence (ev_crosscut_{sf.id}) → extract sf.id → match SourceFile →
    //           HAS_CODE_EVIDENCE ← Task → projectId → Project
    const crossResult = await session.run(
      `MATCH (e:Evidence)
       WHERE e.sourceType = 'cross_layer_analysis'
       AND e.id STARTS WITH 'ev_crosscut_'
       WITH e, substring(e.id, apoc.text.indexOf(e.id, 'proj_')) AS sfId
       MATCH (sf:CodeNode {id: sfId})
       MATCH (t:Task)-[:HAS_CODE_EVIDENCE]->(sf)
       WHERE t.projectId IS NOT NULL AND t.projectId <> e.projectId
       MATCH (p:Project {projectId: t.projectId})
       MERGE (e)-[r:FROM_PROJECT]->(p)
       ON CREATE SET r.derived = true, r.source = 'evidence-project-crosslayer', r.created = datetime()
       RETURN count(r) AS edges`,
    );
    const crossLayer = crossResult.records[0]?.get('edges')?.toNumber?.() ??
      crossResult.records[0]?.get('edges') ?? 0;

    // Count orphaned Evidence (no FROM_PROJECT after both passes)
    const orphanResult = await session.run(
      `MATCH (e:Evidence)
       WHERE NOT (e)-[:FROM_PROJECT]->()
       RETURN count(e) AS orphaned`,
    );
    const orphaned = orphanResult.records[0]?.get('orphaned')?.toNumber?.() ??
      orphanResult.records[0]?.get('orphaned') ?? 0;

    console.log(`[GC-4] FROM_PROJECT: ${direct} direct, ${crossLayer} cross-layer, ${orphaned} orphaned`);
    return {
      direct: typeof direct === 'number' ? direct : 0,
      crossLayer: typeof crossLayer === 'number' ? crossLayer : 0,
      orphaned: typeof orphaned === 'number' ? orphaned : 0,
    };
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
    const result = await enrichEvidenceProject(driver);
    console.log(`Done: ${result.direct} direct, ${result.crossLayer} cross-layer, ${result.orphaned} orphaned`);
  } finally {
    await driver.close();
  }
}
