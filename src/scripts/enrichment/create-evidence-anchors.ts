/**
 * GC-3: Evidence → Code Anchoring (ANCHORED_TO edges)
 *
 * Creates ANCHORED_TO edges from Evidence → CodeNode.
 * Primary match: extract coreType:hash from Evidence.id → reconstruct CodeNode.id
 * Fallback: match on symbolHash property
 *
 * Also creates SPANS_PROJECT edges from Claims → Projects their evidence touches.
 *
 * All edges tagged {derived: true, source: 'evidence-anchor'}
 */
import crypto from 'node:crypto';
import type { Driver } from 'neo4j-driver';

/**
 * Compute a project-agnostic symbol hash.
 * Same function in different projects → same symbolHash.
 */
export function computeSymbolHash(
  filePath: string,
  name: string,
  coreType: string,
): string {
  const identity = `${filePath}::${name}::${coreType}`;
  return crypto.createHash('sha256').update(identity).digest('hex').substring(0, 16);
}

/**
 * Extract CodeNode ID components from an Evidence ID.
 * Returns null if the ID doesn't embed a CodeNode reference.
 *
 * Pattern: ev_{prefix}_{projectId}:{coreType}:{hash}
 * e.g. ev_risk_proj_c0d3e9a1f200:FunctionDeclaration:a8f5607cf14d65de
 */
export function extractCodeNodeRef(evidenceId: string): {
  projectId: string;
  coreType: string;
  hash: string;
  codeNodeId: string;
} | null {
  const match = evidenceId.match(
    /^ev_\w+_(proj_[a-f0-9]+):(\w+):([a-f0-9]{16})$/,
  );
  if (!match) return null;
  const [, projectId, coreType, hash] = match;
  return {
    projectId,
    coreType,
    hash,
    codeNodeId: `${projectId}:${coreType}:${hash}`,
  };
}

/**
 * Create ANCHORED_TO edges from Evidence → CodeNode.
 *
 * Two-pass strategy:
 * 1. Primary: Extract CodeNode ID from Evidence.id (embedded hash pattern)
 * 2. Fallback: Match via symbolHash for Evidence nodes without embedded refs
 *
 * Returns count of edges created.
 */
export async function enrichEvidenceAnchors(
  driver: Driver,
  projectId?: string,
): Promise<{ anchored: number; skipped: number }> {
  const session = driver.session();
  try {
    const filterClause = projectId
      ? 'AND e.projectId = $projectId'
      : '';

    // Pass 1: Match Evidence → CodeNode via embedded hash in Evidence.id
    // Evidence ID pattern: ev_{prefix}_{projectId}:{coreType}:{hash}
    // CodeNode ID pattern: {projectId}:{coreType}:{hash}
    const result = await session.run(
      `MATCH (e:Evidence)
       WHERE e.id =~ 'ev_\\\\w+_proj_[a-f0-9]+:\\\\w+:[a-f0-9]{16}'
       ${filterClause}
       WITH e,
            // Extract: everything after 'ev_{word}_' up to the end
            substring(e.id, apoc.text.indexOf(e.id, 'proj_')) AS codeNodeId
       MATCH (cn:CodeNode {id: codeNodeId})
       MERGE (e)-[r:ANCHORED_TO]->(cn)
       ON CREATE SET r.derived = true, r.source = 'evidence-anchor', r.created = datetime(), r.projectId = coalesce(e.projectId, cn.projectId)
       ON MATCH SET r.projectId = coalesce(e.projectId, cn.projectId)
       RETURN count(r) AS anchored`,
      { projectId: projectId ?? null },
    );
    const anchored = result.records[0]?.get('anchored')?.toNumber?.() ??
      result.records[0]?.get('anchored') ?? 0;

    // Pass 2: symbolHash fallback for Evidence nodes still without ANCHORED_TO
    // This catches Evidence created by other systems that don't embed CodeNode hashes
    const fallbackResult = await session.run(
      `MATCH (e:Evidence)
       WHERE NOT (e)-[:ANCHORED_TO]->()
       AND e.symbolHash IS NOT NULL
       ${filterClause}
       MATCH (cn:CodeNode {symbolHash: e.symbolHash})
       MERGE (e)-[r:ANCHORED_TO]->(cn)
       ON CREATE SET r.derived = true, r.source = 'evidence-anchor-symbolhash', r.created = datetime(), r.projectId = coalesce(e.projectId, cn.projectId)
       ON MATCH SET r.projectId = coalesce(e.projectId, cn.projectId)
       RETURN count(r) AS anchored`,
      { projectId: projectId ?? null },
    );
    const fallbackAnchored = fallbackResult.records[0]?.get('anchored')?.toNumber?.() ??
      fallbackResult.records[0]?.get('anchored') ?? 0;

    // Count skipped (Evidence with no match)
    const skippedResult = await session.run(
      `MATCH (e:Evidence)
       WHERE NOT (e)-[:ANCHORED_TO]->()
       ${filterClause}
       RETURN count(e) AS skipped`,
      { projectId: projectId ?? null },
    );
    const skipped = skippedResult.records[0]?.get('skipped')?.toNumber?.() ??
      skippedResult.records[0]?.get('skipped') ?? 0;

    const totalAnchored = (typeof anchored === 'number' ? anchored : 0) +
      (typeof fallbackAnchored === 'number' ? fallbackAnchored : 0);

    console.log(`[GC-3] ANCHORED_TO: ${totalAnchored} edges created (${anchored} primary, ${fallbackAnchored} symbolHash fallback), ${skipped} skipped`);
    return { anchored: totalAnchored, skipped };
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
    const result = await enrichEvidenceAnchors(driver, process.argv[2]);
    console.log(`Done: ${result.anchored} anchored, ${result.skipped} skipped`);
  } finally {
    await driver.close();
  }
}
