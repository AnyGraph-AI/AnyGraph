/**
 * TC-4: Explainability Path Persistence
 *
 * Every confidence decision should be traceable back to the evidence that
 * influenced it. This module persists the top-k support/contradiction paths
 * from claims through evidence to verification runs.
 *
 * Entities: InfluencePath (node)
 * Edges: EXPLAINS_SUPPORT, EXPLAINS_CONTRADICTION
 *
 * Each path has a stable pathHash (for dedup) and ranked pathWeight.
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createHash } from 'crypto';

// ── Types ───────────────────────────────────────────────────────────

export interface InfluencePath {
  pathHash: string;
  pathWeight: number;
  rank: number;       // 1-indexed rank within its claim (by pathWeight desc)
  direction: 'support' | 'contradiction';
  hops: string[]; // ordered node IDs forming the path
  claimId: string;
  terminalNodeId: string;
  projectId: string;
}

export interface ExplainabilityConfig {
  /** Max paths per claim to persist. Default: 5 */
  topK: number;
  /** Minimum path weight to persist. Default: 0.01 */
  minWeight: number;
  /** Max payload size per retrieval. Default: 50 */
  maxPayload: number;
}

export interface ExplainabilityOutput {
  projectId: string;
  pathsCreated: number;
  pathsSkipped: number;
  claimsWithPaths: number;
  claimsWithoutPaths: number;
  durationMs: number;
}

const DEFAULT_CONFIG: ExplainabilityConfig = {
  topK: 5,
  minWeight: 0.01,
  maxPayload: 50,
};

// ── Path Hash ───────────────────────────────────────────────────────

function computePathHash(hops: string[], direction: string): string {
  const payload = `${direction}:${hops.join('->')}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

// ── Path Discovery ──────────────────────────────────────────────────

export async function discoverExplainabilityPaths(
  neo4j: Neo4jService,
  projectId: string,
  config: ExplainabilityConfig = DEFAULT_CONFIG,
): Promise<ExplainabilityOutput> {
  const start = Date.now();

  // Find all claims with supporting evidence
  const supportPaths = await neo4j.run(
    `MATCH (c:Claim {projectId: $projectId})-[s:SUPPORTED_BY]->(e:Evidence)
     OPTIONAL MATCH (e)-[:PROVES|WITNESSES]->(t)
     WHERE t.projectId = $projectId OR t.projectId IS NULL
     RETURN c.id AS claimId, e.id AS evidenceId, t.id AS terminalId,
            coalesce(e.confidence, 0.5) AS weight,
            'support' AS direction
     ORDER BY weight DESC`,
    { projectId },
  );

  // Find all claims with contradicting evidence
  const contradictionPaths = await neo4j.run(
    `MATCH (c:Claim {projectId: $projectId})-[s:CONTRADICTED_BY]->(e:Evidence)
     OPTIONAL MATCH (e)-[:PROVES|WITNESSES]->(t)
     WHERE t.projectId = $projectId OR t.projectId IS NULL
     RETURN c.id AS claimId, e.id AS evidenceId, t.id AS terminalId,
            coalesce(e.confidence, 0.5) AS weight,
            'contradiction' AS direction
     ORDER BY weight DESC`,
    { projectId },
  );

  const allRawPaths = [...supportPaths, ...contradictionPaths];

  // Group by claim, take top-k per claim
  const byClaim = new Map<string, InfluencePath[]>();

  for (const row of allRawPaths) {
    const claimId = row.claimId as string;
    const evidenceId = row.evidenceId as string;
    const terminalId = (row.terminalId as string | null) ?? evidenceId;
    const weight = row.weight as number;
    const direction = row.direction as 'support' | 'contradiction';

    if (weight < config.minWeight) continue;

    const hops = [claimId, evidenceId];
    if (terminalId !== evidenceId) hops.push(terminalId);

    const path: InfluencePath = {
      pathHash: computePathHash(hops, direction),
      pathWeight: weight,
      rank: 0, // assigned after top-k sort
      direction,
      hops,
      claimId,
      terminalNodeId: terminalId,
      projectId,
    };

    const existing = byClaim.get(claimId) ?? [];
    existing.push(path);
    byClaim.set(claimId, existing);
  }

  // Top-k per claim
  const pathsToCreate: InfluencePath[] = [];
  let skipped = 0;

  for (const [, paths] of byClaim) {
    paths.sort((a, b) => b.pathWeight - a.pathWeight);
    const kept = paths.slice(0, config.topK);
    // Assign rank (1-indexed, per claim)
    kept.forEach((p, i) => { p.rank = i + 1; });
    pathsToCreate.push(...kept);
    skipped += paths.length - kept.length;
  }

  // Persist InfluencePath nodes + edges
  if (pathsToCreate.length > 0) {
    const batch = pathsToCreate.map(p => ({
      pathHash: p.pathHash,
      pathWeight: p.pathWeight,
      rank: p.rank,
      direction: p.direction,
      hopCount: p.hops.length,
      hopsJson: JSON.stringify(p.hops),
      claimId: p.claimId,
      terminalNodeId: p.terminalNodeId,
    }));

    await neo4j.run(
      `UNWIND $batch AS b
       MERGE (ip:InfluencePath {pathHash: b.pathHash, projectId: $projectId})
       SET ip.pathWeight = b.pathWeight,
           ip.rank = b.rank,
           ip.direction = b.direction,
           ip.hopCount = b.hopCount,
           ip.hopsJson = b.hopsJson,
           ip.claimId = b.claimId,
           ip.terminalNodeId = b.terminalNodeId,
           ip.updatedAt = toString(datetime())
       WITH ip, b
       MATCH (c:Claim {id: b.claimId, projectId: $projectId})
       FOREACH (_ IN CASE WHEN b.direction = 'support' THEN [1] ELSE [] END |
         MERGE (c)-[:EXPLAINS_SUPPORT]->(ip)
       )
       FOREACH (_ IN CASE WHEN b.direction = 'contradiction' THEN [1] ELSE [] END |
         MERGE (c)-[:EXPLAINS_CONTRADICTION]->(ip)
       )`,
      { batch, projectId },
    );
  }

  // Count claims with/without paths
  const claimsWithPaths = byClaim.size;
  const totalClaims = await neo4j.run(
    `MATCH (c:Claim {projectId: $projectId}) RETURN count(c) AS cnt`,
    { projectId },
  );
  const total = Number(totalClaims[0]?.cnt ?? 0);

  return {
    projectId,
    pathsCreated: pathsToCreate.length,
    pathsSkipped: skipped,
    claimsWithPaths,
    claimsWithoutPaths: total - claimsWithPaths,
    durationMs: Date.now() - start,
  };
}

// ── Query Contract: Bounded Retrieval ───────────────────────────────

export async function queryExplainabilityPaths(
  neo4j: Neo4jService,
  projectId: string,
  claimId?: string,
  config: ExplainabilityConfig = DEFAULT_CONFIG,
): Promise<InfluencePath[]> {
  const limit = Math.min(config.maxPayload, 100);

  const query = claimId
    ? `MATCH (ip:InfluencePath {projectId: $projectId, claimId: $claimId})
       RETURN ip ORDER BY ip.pathWeight DESC LIMIT $limit`
    : `MATCH (ip:InfluencePath {projectId: $projectId})
       RETURN ip ORDER BY ip.pathWeight DESC LIMIT $limit`;

  const rows = await neo4j.run(query, { projectId, claimId, limit });

  return rows.map(row => {
    const ip = row.ip as any;
    return {
      pathHash: ip.pathHash,
      pathWeight: ip.pathWeight,
      rank: ip.rank ?? 0,
      direction: ip.direction,
      hops: JSON.parse(ip.hopsJson ?? '[]'),
      claimId: ip.claimId,
      terminalNodeId: ip.terminalNodeId,
      projectId: ip.projectId,
    };
  });
}

// ── Governance: Critical updates require explainability ──────────────

export async function verifyExplainabilityCoverage(
  neo4j: Neo4jService,
  projectId: string,
): Promise<{ ok: boolean; claimsWithout: number; total: number; coverageRatio: number }> {
  const rows = await neo4j.run(
    `MATCH (c:Claim {projectId: $projectId})
     OPTIONAL MATCH (c)-[:EXPLAINS_SUPPORT|EXPLAINS_CONTRADICTION]->(ip:InfluencePath)
     WITH c, count(ip) AS pathCount
     RETURN count(c) AS total,
            sum(CASE WHEN pathCount > 0 THEN 1 ELSE 0 END) AS withPaths`,
    { projectId },
  );

  const total = Number(rows[0]?.total ?? 0);
  const withPaths = Number(rows[0]?.withPaths ?? 0);
  const without = total - withPaths;
  const ratio = total > 0 ? withPaths / total : 1.0;

  return { ok: without === 0, claimsWithout: without, total, coverageRatio: ratio };
}
