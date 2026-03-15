/**
 * TC↔Claims Bridge
 *
 * Connects temporal confidence to the claim layer:
 *   1. Stamp temporal fields on Claim nodes (observedAt, lastVerifiedAt)
 *   2. Orphan detection — claims whose sourceNodeId references deleted nodes
 *   3. Time-based decay — apply TCF decay to claim evidence weights
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { computeTemporalFactors, type TemporalDecayConfig } from './temporal-confidence.js';

// ── Types ───────────────────────────────────────────────────────────

export interface ClaimBridgeResult {
  stamped: number;
  orphansContested: number;
  decayed: number;
  durationMs: number;
}

const DEFAULT_DECAY: TemporalDecayConfig = {
  decayWindowHours: 720,  // 30 days
  minimumFactor: 0.1,
  defaultValidityHours: 2160,  // 90 days
};

// ── Stamp temporal fields on claims ────────────────────────────────

async function stampClaimTemporalFields(neo4j: Neo4jService): Promise<number> {
  const result = await neo4j.run(
    `MATCH (c:Claim)
     WHERE c.observedAt IS NULL
     SET c.observedAt = coalesce(c.created, c.generatedAt, toString(datetime())),
         c.lastVerifiedAt = coalesce(c.created, c.generatedAt, toString(datetime()))
     RETURN count(c) AS stamped`,
  );
  return Number(result[0]?.stamped ?? 0);
}

// ── Orphan detection ────────────────────────────────────────────────

/**
 * Find claims whose sourceNodeId no longer resolves to a live graph node.
 * Auto-contest orphaned claims (set status='contested', contestReason).
 */
async function detectOrphanClaims(neo4j: Neo4jService): Promise<number> {
  // Claims with sourceNodeId that doesn't match any node
  const result = await neo4j.run(
    `MATCH (c:Claim)
     WHERE c.sourceNodeId IS NOT NULL
       AND c.status <> 'contested'
     WITH c
     OPTIONAL MATCH (n {id: c.sourceNodeId})
     WITH c, n
     WHERE n IS NULL
     SET c.status = 'contested',
         c.contestReason = 'orphan: sourceNodeId ' + c.sourceNodeId + ' no longer exists',
         c.contestedAt = toString(datetime())
     RETURN count(c) AS contested`,
  );
  return Number(result[0]?.contested ?? 0);
}

// ── Time-based decay on claim confidence ────────────────────────────

/**
 * Apply temporal decay to claim confidence based on age.
 * Uses the same computeTemporalFactors as VerificationRun nodes.
 */
async function applyClaimDecay(
  neo4j: Neo4jService,
  config: TemporalDecayConfig = DEFAULT_DECAY,
): Promise<number> {
  const now = new Date();

  // Fetch claims with temporal fields
  const rows = await neo4j.run(
    `MATCH (c:Claim)
     WHERE c.observedAt IS NOT NULL AND c.status <> 'contested'
     RETURN c.id AS id, c.observedAt AS observedAt, c.confidence AS confidence`,
  );

  if (rows.length === 0) return 0;

  const updates: Array<{ id: string; decayedConfidence: number }> = [];
  for (const row of rows) {
    const factors = computeTemporalFactors(
      row.observedAt as string | null,
      row.observedAt as string | null, // validFrom = observedAt for claims
      null, null, now, config,
    );

    const baseConf = (row.confidence as number | null) ?? 0.5;
    const decayed = baseConf * factors.timeConsistencyFactor;

    // Only update if decay is significant (>1% change)
    if (Math.abs(decayed - baseConf) > 0.01) {
      updates.push({ id: row.id as string, decayedConfidence: decayed });
    }
  }

  if (updates.length > 0) {
    await neo4j.run(
      `UNWIND $updates AS u
       MATCH (c:Claim {id: u.id})
       SET c.decayedConfidence = u.decayedConfidence,
           c.lastDecayAt = $now`,
      { updates, now: now.toISOString() },
    );
  }

  return updates.length;
}

// ── Main bridge function ────────────────────────────────────────────

export async function runClaimBridge(
  neo4j: Neo4jService,
  decayConfig?: TemporalDecayConfig,
): Promise<ClaimBridgeResult> {
  const start = Date.now();

  const stamped = await stampClaimTemporalFields(neo4j);
  const orphansContested = await detectOrphanClaims(neo4j);
  const decayed = await applyClaimDecay(neo4j, decayConfig);

  return {
    stamped,
    orphansContested,
    decayed,
    durationMs: Date.now() - start,
  };
}
