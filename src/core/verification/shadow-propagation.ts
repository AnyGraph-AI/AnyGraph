/**
 * TC-3: Shadow Propagation Engine (Advisory Lane)
 *
 * Normalized + damped confidence propagation that runs in shadow mode only.
 * Shadow outputs are ADVISORY — they never overwrite production effectiveConfidence.
 *
 * Propagation model:
 *   For each VerificationRun, compute a shadow confidence that accounts for
 *   the temporal factors of related evidence (via PRECEDES chain, code evidence links).
 *
 *   shadowEffectiveConfidence = normalize(Σ(neighbor.tcf × neighbor.penalty × weight) × damping)
 *
 * The shadow lane exists to:
 *   1. Preview what production confidence WOULD look like with propagation
 *   2. Compare shadow vs production for promotion-readiness
 *   3. Detect confidence anomalies (shadow diverges significantly from production)
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

// ── Types ───────────────────────────────────────────────────────────

export type NormalizationMode = 'linear' | 'softmax';

export interface ShadowPropagationConfig {
  /** Damping factor (0.0–1.0). Higher = more influence from neighbors. Default: 0.85 */
  dampingFactor: number;
  /** Max propagation hops. Default: 3 */
  maxHops: number;
  /** Normalization mode. Default: 'linear' */
  normalizationMode: NormalizationMode;
  /** Minimum influence threshold to propagate. Default: 0.01 */
  minInfluence: number;
}

export interface ShadowResult {
  runId: string;
  shadowEffectiveConfidence: number;
  shadowInfluenceScore: number;
  normalizationMode: NormalizationMode;
  dampingFactorUsed: number;
  productionConfidence: number | null;
  divergence: number;
}

export interface ShadowPropagationOutput {
  projectId: string;
  updated: number;
  skipped: number;
  maxDivergence: number;
  avgDivergence: number;
  durationMs: number;
  promotionReady: boolean;
  promotionBlockers: string[];
}

const DEFAULT_CONFIG: ShadowPropagationConfig = {
  dampingFactor: 0.85,
  maxHops: 3,
  normalizationMode: 'linear',
  minInfluence: 0.01,
};

// ── Shadow Computation (Pure) ───────────────────────────────────────

interface RunData {
  id: string;
  timeConsistencyFactor: number | null;
  retroactivePenalty: number | null;
  effectiveConfidence: number | null;
  neighbors: string[];
}

function computeShadowConfidence(
  run: RunData,
  allRuns: Map<string, RunData>,
  config: ShadowPropagationConfig,
  hop: number = 0,
  visited: Set<string> = new Set(),
): number {
  if (hop >= config.maxHops || visited.has(run.id)) {
    // Base case: use own temporal factors
    const tcf = run.timeConsistencyFactor ?? 1.0;
    const penalty = run.retroactivePenalty ?? 1.0;
    return tcf * penalty;
  }

  visited.add(run.id);

  const ownScore = (run.timeConsistencyFactor ?? 1.0) * (run.retroactivePenalty ?? 1.0);

  if (run.neighbors.length === 0) return ownScore;

  // Gather neighbor influences
  let neighborSum = 0;
  let neighborCount = 0;

  for (const nid of run.neighbors) {
    const neighbor = allRuns.get(nid);
    if (!neighbor) continue;

    const nScore = computeShadowConfidence(neighbor, allRuns, config, hop + 1, new Set(visited));
    if (nScore >= config.minInfluence) {
      neighborSum += nScore;
      neighborCount++;
    }
  }

  if (neighborCount === 0) return ownScore;

  // Normalize
  const avgNeighbor = config.normalizationMode === 'linear'
    ? neighborSum / neighborCount
    : Math.exp(neighborSum / neighborCount) / (1 + Math.exp(neighborSum / neighborCount)); // softmax-ish sigmoid

  // Damped combination: own * (1 - d) + neighbor_avg * d
  const shadow = ownScore * (1 - config.dampingFactor) + avgNeighbor * config.dampingFactor;

  return Math.max(0, Math.min(1, shadow));
}

// ── Main Engine ─────────────────────────────────────────────────────

export async function runShadowPropagation(
  neo4j: Neo4jService,
  projectId: string,
  config: ShadowPropagationConfig = DEFAULT_CONFIG,
): Promise<ShadowPropagationOutput> {
  const start = Date.now();

  // Fetch all runs with temporal factors + neighbor links
  const rows = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     OPTIONAL MATCH (r)-[:PRECEDES]->(next:VerificationRun {projectId: $projectId})
     OPTIONAL MATCH (prev:VerificationRun {projectId: $projectId})-[:PRECEDES]->(r)
     RETURN r.id AS id,
            r.timeConsistencyFactor AS tcf,
            r.retroactivePenalty AS penalty,
            r.effectiveConfidence AS prodConf,
            collect(DISTINCT next.id) + collect(DISTINCT prev.id) AS neighbors`,
    { projectId },
  );

  if (rows.length === 0) {
    return {
      projectId, updated: 0, skipped: 0, maxDivergence: 0,
      avgDivergence: 0, durationMs: Date.now() - start,
      promotionReady: true, promotionBlockers: [],
    };
  }

  // Build run map
  const runMap = new Map<string, RunData>();
  for (const row of rows) {
    const neighbors = (row.neighbors as (string | null)[]).filter((n): n is string => n !== null);
    runMap.set(row.id as string, {
      id: row.id as string,
      timeConsistencyFactor: row.tcf as number | null,
      retroactivePenalty: row.penalty as number | null,
      effectiveConfidence: row.prodConf as number | null,
      neighbors: [...new Set(neighbors)],
    });
  }

  // Compute shadow for each run
  const results: ShadowResult[] = [];
  for (const run of runMap.values()) {
    const shadow = computeShadowConfidence(run, runMap, config);
    const prod = run.effectiveConfidence;
    const divergence = prod !== null ? Math.abs(shadow - prod) : 0;

    results.push({
      runId: run.id,
      shadowEffectiveConfidence: shadow,
      shadowInfluenceScore: run.neighbors.length / Math.max(1, runMap.size),
      normalizationMode: config.normalizationMode,
      dampingFactorUsed: config.dampingFactor,
      productionConfidence: prod,
      divergence,
    });
  }

  // Persist shadow outputs (NEVER overwrites effectiveConfidence)
  const updates = results.map(r => ({
    id: r.runId,
    shadowEffectiveConfidence: r.shadowEffectiveConfidence,
    shadowInfluenceScore: r.shadowInfluenceScore,
    normalizationMode: r.normalizationMode,
    dampingFactorUsed: r.dampingFactorUsed,
  }));

  if (updates.length > 0) {
    await neo4j.run(
      `UNWIND $updates AS u
       MATCH (r:VerificationRun {id: u.id, projectId: $projectId})
       SET r.shadowEffectiveConfidence = u.shadowEffectiveConfidence,
           r.shadowInfluenceScore = u.shadowInfluenceScore,
           r.normalizationMode = u.normalizationMode,
           r.dampingFactorUsed = u.dampingFactorUsed`,
      { updates, projectId },
    );
  }

  // Promotion readiness evaluation
  const divergences = results.map(r => r.divergence);
  const maxDiv = Math.max(...divergences, 0);
  const avgDiv = divergences.length > 0 ? divergences.reduce((a, b) => a + b, 0) / divergences.length : 0;

  const blockers: string[] = [];
  if (maxDiv > 0.3) blockers.push(`Max divergence ${maxDiv.toFixed(3)} exceeds 0.3 threshold`);
  if (avgDiv > 0.15) blockers.push(`Avg divergence ${avgDiv.toFixed(3)} exceeds 0.15 threshold`);

  const noTcf = results.filter(r => r.shadowEffectiveConfidence === 1.0 && r.productionConfidence === null).length;
  if (noTcf > results.length * 0.5) {
    blockers.push(`${noTcf}/${results.length} runs have no production confidence to compare`);
  }

  return {
    projectId,
    updated: updates.length,
    skipped: 0,
    maxDivergence: maxDiv,
    avgDivergence: avgDiv,
    durationMs: Date.now() - start,
    promotionReady: blockers.length === 0,
    promotionBlockers: blockers,
  };
}

// ── Guardrail: Shadow CANNOT overwrite production ───────────────────

/**
 * Verify that no VerificationRun has shadowEffectiveConfidence copied into
 * effectiveConfidence. This is a governance check, not a runtime guard.
 */
export async function verifyShadowIsolation(
  neo4j: Neo4jService,
  projectId: string,
): Promise<{ ok: boolean; violations: number }> {
  const rows = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.shadowEffectiveConfidence IS NOT NULL
       AND r.effectiveConfidence IS NOT NULL
       AND r.shadowEffectiveConfidence = r.effectiveConfidence
       AND r.effectiveConfidence <> 1.0
     RETURN count(r) AS cnt`,
    { projectId },
  );
  const cnt = Number(rows[0]?.cnt ?? 0);
  return { ok: cnt === 0, violations: cnt };
}
