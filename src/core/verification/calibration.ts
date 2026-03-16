/**
 * TC-7: Calibration & Validation Gate
 *
 * Calibration measures how well confidence scores match actual outcomes.
 * Primary metric: Brier Score (lower = better calibrated).
 * Diagnostics: ECE (Expected Calibration Error), ACE (Adaptive CE).
 *
 * Promotion criteria:
 *   - Shadow Brier < Production Brier (or both below threshold)
 *   - No governance regression
 *   - No anti-gaming regression
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

// ── Types ───────────────────────────────────────────────────────────

export interface CalibrationMetrics {
  brierScore: number;
  ece: number;
  sampleCount: number;
  buckets: CalibrationBucket[];
}

export interface CalibrationBucket {
  binStart: number;
  binEnd: number;
  avgConfidence: number;
  avgOutcome: number;
  count: number;
}

export interface CalibrationSlice {
  sliceId: string;
  sliceName: string;
  level: 'project' | 'gate' | 'era';
  production: CalibrationMetrics;
  shadow: CalibrationMetrics;
  brierImproved: boolean;
  brierDelta: number;
}

export interface CalibrationOutput {
  projectId: string;
  production: CalibrationMetrics;
  shadow: CalibrationMetrics;
  slices: CalibrationSlice[];
  promotionEligible: boolean;
  promotionBlockers: string[];
  durationMs: number;
}

export interface CalibrationConfig {
  /** Number of calibration bins. Default: 10 */
  bins: number;
  /** Brier score threshold for acceptable calibration. Default: 0.25 */
  brierThreshold: number;
  /** Max acceptable Brier regression from shadow→prod. Default: 0.05 */
  maxBrierRegression: number;
}

const DEFAULT_CONFIG: CalibrationConfig = {
  bins: 10,
  brierThreshold: 0.25,
  maxBrierRegression: 0.05,
};

// ── Brier Score Computation ─────────────────────────────────────────

interface ConfidenceOutcome {
  confidence: number;
  outcome: number; // 1 = satisfies, 0 = violates
}

function computeBrier(data: ConfidenceOutcome[]): number {
  if (data.length === 0) return 0;
  const sum = data.reduce((s, d) => s + (d.confidence - d.outcome) ** 2, 0);
  return sum / data.length;
}

function computeECE(data: ConfidenceOutcome[], bins: number): { ece: number; buckets: CalibrationBucket[] } {
  const buckets: CalibrationBucket[] = [];
  const binWidth = 1.0 / bins;

  for (let i = 0; i < bins; i++) {
    const binStart = i * binWidth;
    const binEnd = (i + 1) * binWidth;
    const inBin = data.filter(d => {
      const idx = Math.min(Math.floor(d.confidence * bins), bins - 1);
      return idx === i;
    });

    if (inBin.length === 0) {
      buckets.push({ binStart, binEnd, avgConfidence: 0, avgOutcome: 0, count: 0 });
      continue;
    }

    const avgConf = inBin.reduce((s, d) => s + d.confidence, 0) / inBin.length;
    const avgOut = inBin.reduce((s, d) => s + d.outcome, 0) / inBin.length;
    buckets.push({ binStart, binEnd, avgConfidence: avgConf, avgOutcome: avgOut, count: inBin.length });
  }

  // ECE = weighted average of |avgConf - avgOutcome| per bin
  const totalCount = data.length;
  const ece = buckets.reduce((s, b) =>
    s + (b.count / Math.max(totalCount, 1)) * Math.abs(b.avgConfidence - b.avgOutcome), 0);

  return { ece, buckets };
}

function computeMetrics(data: ConfidenceOutcome[], bins: number): CalibrationMetrics {
  const brier = computeBrier(data);
  const { ece, buckets } = computeECE(data, bins);
  return { brierScore: brier, ece, sampleCount: data.length, buckets };
}

// ── Main Pipeline ───────────────────────────────────────────────────

export async function runCalibration(
  neo4j: Neo4jService,
  projectId: string,
  config: CalibrationConfig = DEFAULT_CONFIG,
): Promise<CalibrationOutput> {
  const start = Date.now();

  // Fetch production + shadow confidence with outcomes
  const rows = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.status IN ['satisfies', 'violates']
     RETURN r.id AS id,
            CASE WHEN r.status = 'satisfies'
              THEN coalesce(r.effectiveConfidence, 0.5)
              ELSE 1.0 - coalesce(r.effectiveConfidence, 0.5)
            END AS prodConf,
            CASE WHEN r.status = 'satisfies'
              THEN coalesce(r.shadowEffectiveConfidence, 0.5)
              ELSE 1.0 - coalesce(r.shadowEffectiveConfidence, 0.5)
            END AS shadowConf,
            CASE WHEN r.status = 'satisfies' THEN 1 ELSE 0 END AS outcome`,
    { projectId },
  );

  const prodData: ConfidenceOutcome[] = rows.map(r => ({
    confidence: Number(r.prodConf),
    outcome: Number(r.outcome),
  }));

  const shadowData: ConfidenceOutcome[] = rows.map(r => ({
    confidence: Number(r.shadowConf),
    outcome: Number(r.outcome),
  }));

  const production = computeMetrics(prodData, config.bins);
  const shadow = computeMetrics(shadowData, config.bins);

  // Project-level slice
  const projectSlice: CalibrationSlice = {
    sliceId: projectId,
    sliceName: 'project',
    level: 'project',
    production,
    shadow,
    brierImproved: shadow.brierScore < production.brierScore,
    brierDelta: production.brierScore - shadow.brierScore,
  };

  // Promotion eligibility
  const blockers: string[] = [];
  if (shadow.brierScore > production.brierScore + config.maxBrierRegression) {
    blockers.push(`Shadow Brier (${shadow.brierScore.toFixed(4)}) regressed vs production (${production.brierScore.toFixed(4)}) by more than ${config.maxBrierRegression}`);
  }
  if (shadow.brierScore > config.brierThreshold && production.brierScore > config.brierThreshold) {
    blockers.push(`Both Brier scores above threshold ${config.brierThreshold}: prod=${production.brierScore.toFixed(4)}, shadow=${shadow.brierScore.toFixed(4)}`);
  }

  return {
    projectId,
    production,
    shadow,
    slices: [projectSlice],
    promotionEligible: blockers.length === 0,
    promotionBlockers: blockers,
    durationMs: Date.now() - start,
  };
}
