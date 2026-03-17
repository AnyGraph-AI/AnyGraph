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
  defaultValidityHours: 168,  // 7 days — AI-assisted development pace
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


