/**
 * TC-1: Temporal Confidence Computation
 *
 * Computes timeConsistencyFactor and retroactivePenalty for verification evidence.
 *
 * timeConsistencyFactor: How temporally consistent is this evidence?
 *   - 1.0 = fresh, within validity window, not superseded
 *   - Decays toward 0.0 as evidence ages past its validity window
 *   - 0.0 = superseded or expired
 *
 * retroactivePenalty: Penalty applied when evidence is superseded by newer observation
 *   - 1.0 = no penalty (not superseded)
 *   - 0.0 = fully superseded (newer contradicting evidence exists)
 *
 * Production formula:
 *   effectiveConfidence = clamp(baseEvidenceScore × hardPenalty × timeConsistencyFactor × retroactivePenalty)
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

/** Configuration for temporal decay */
export interface TemporalDecayConfig {
  /** Hours after validTo before evidence reaches minimum factor (default: 720 = 30 days) */
  decayWindowHours: number;
  /** Minimum timeConsistencyFactor for expired-but-not-superseded evidence (default: 0.1) */
  minimumFactor: number;
  /** Default validity window hours when validTo is null (default: 2160 = 90 days) */
  defaultValidityHours: number;
}

const DEFAULT_DECAY_CONFIG: TemporalDecayConfig = {
  decayWindowHours: 720,
  minimumFactor: 0.1,
  defaultValidityHours: 2160,
};

export interface TemporalFactors {
  timeConsistencyFactor: number;
  retroactivePenalty: number;
}

/**
 * Compute temporal factors for a single evidence node.
 *
 * @param observedAt - When the evidence was collected
 * @param validFrom - Start of validity window
 * @param validTo - End of validity window (null = open-ended, uses default window)
 * @param supersededAt - When superseded by newer evidence (null = still current)
 * @param now - Current timestamp for comparison
 */
export function computeTemporalFactors(
  observedAt: string | null,
  validFrom: string | null,
  validTo: string | null,
  supersededAt: string | null,
  now: Date = new Date(),
  config: TemporalDecayConfig = DEFAULT_DECAY_CONFIG,
): TemporalFactors {
  // If superseded, apply full retroactive penalty
  if (supersededAt) {
    return {
      timeConsistencyFactor: config.minimumFactor,
      retroactivePenalty: 0.0,
    };
  }

  // No observed time = no temporal signal, assume fresh
  if (!observedAt) {
    return { timeConsistencyFactor: 1.0, retroactivePenalty: 1.0 };
  }

  const observedMs = new Date(observedAt).getTime();
  const nowMs = now.getTime();

  // Determine effective end of validity
  let validEndMs: number;
  if (validTo) {
    validEndMs = new Date(validTo).getTime();
  } else {
    // Open-ended: use default validity window from observedAt
    validEndMs = observedMs + config.defaultValidityHours * 3600_000;
  }

  // Still within validity window
  if (nowMs <= validEndMs) {
    return { timeConsistencyFactor: 1.0, retroactivePenalty: 1.0 };
  }

  // Past validity — compute decay
  const hoursExpired = (nowMs - validEndMs) / 3600_000;
  const decayRatio = Math.min(hoursExpired / config.decayWindowHours, 1.0);
  // Linear decay from 1.0 to minimumFactor
  const factor = 1.0 - decayRatio * (1.0 - config.minimumFactor);

  return {
    timeConsistencyFactor: Math.max(factor, config.minimumFactor),
    retroactivePenalty: 1.0, // Not superseded, just expired
  };
}

/**
 * Batch-update temporal factors for all VerificationRun nodes in a project.
 * Reads observedAt/validFrom/validTo/supersededAt, computes factors, writes back.
 */
export async function updateTemporalFactors(
  neo4j: Neo4jService,
  projectId: string,
  config: TemporalDecayConfig = DEFAULT_DECAY_CONFIG,
): Promise<{ updated: number }> {
  const now = new Date();

  const rows = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.observedAt IS NOT NULL
     RETURN r.id AS id, r.observedAt AS observedAt, r.validFrom AS validFrom,
            r.validTo AS validTo, r.supersededAt AS supersededAt`,
    { projectId },
  );

  if (rows.length === 0) return { updated: 0 };

  const updates = rows.map(row => {
    const factors = computeTemporalFactors(
      row.observedAt as string | null,
      row.validFrom as string | null,
      row.validTo as string | null,
      row.supersededAt as string | null,
      now,
      config,
    );
    return {
      id: row.id,
      timeConsistencyFactor: factors.timeConsistencyFactor,
      retroactivePenalty: factors.retroactivePenalty,
    };
  });

  await neo4j.run(
    `UNWIND $updates AS u
     MATCH (r:VerificationRun {id: u.id, projectId: $projectId})
     SET r.timeConsistencyFactor = u.timeConsistencyFactor,
         r.retroactivePenalty = u.retroactivePenalty`,
    { updates, projectId },
  );

  return { updated: updates.length };
}
