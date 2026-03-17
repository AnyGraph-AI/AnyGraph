/**
 * Confidence Governance Analytics
 *
 * Tracks confidence regression budgets, evidence completeness trends,
 * override entropy, and policy effectiveness over time.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L4
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ConfidenceSnapshot {
  timestamp: string;
  projectId: string;
  /** Per-edge-type average confidence */
  edgeConfidence: Record<string, number>;
  /** Total edges with confidence < 1.0 */
  lowConfidenceEdges: number;
  /** Total edges */
  totalEdges: number;
  /** Weighted average confidence */
  weightedAverage: number;
}

export interface EvidenceCompletenessSnapshot {
  timestamp: string;
  projectId: string;
  totalDoneTasks: number;
  tasksWithEvidence: number;
  tasksWithoutEvidence: number;
  completenessPercent: number;
  /** Per-category breakdown */
  byCategory: Record<string, { total: number; withEvidence: number }>;
}

export interface OverrideEvent {
  timestamp: string;
  projectId: string;
  overrideType: 'waiver' | 'mode_downgrade' | 'threshold_relaxation' | 'manual_pass';
  invariantId: string;
  reason: string;
  issuerId: string;
  expiresAt?: string;
}

export interface PolicyEffectivenessSnapshot {
  timestamp: string;
  projectId: string;
  /** How many violations were caught pre-merge */
  preventedViolations: number;
  /** How many violations escaped to production */
  escapedViolations: number;
  /** Prevention rate */
  preventionRate: number;
  /** How many false positives were reported */
  falsePositives: number;
  /** False positive rate */
  falsePositiveRate: number;
  /** Per-invariant effectiveness */
  byInvariant: Record<string, {
    prevented: number;
    escaped: number;
    falsePositive: number;
  }>;
}

// ============================================================================
// CONFIDENCE REGRESSION BUDGET
// ============================================================================

export interface RegressionBudgetConfig {
  /** Maximum allowed confidence drop per snapshot period */
  maxDropPerPeriod: number;
  /** Maximum allowed absolute drop from baseline */
  maxAbsoluteDrop: number;
  /** Minimum acceptable weighted average */
  minimumWeightedAverage: number;
}

export const DEFAULT_REGRESSION_BUDGET: RegressionBudgetConfig = {
  maxDropPerPeriod: 0.05,   // 5% max drop per period
  maxAbsoluteDrop: 0.10,    // 10% max from baseline
  minimumWeightedAverage: 0.80,
};

export interface RegressionCheckResult {
  withinBudget: boolean;
  currentAverage: number;
  previousAverage: number | null;
  baselineAverage: number | null;
  periodDrop: number | null;
  absoluteDrop: number | null;
  alerts: string[];
}

/**
 * Check confidence regression against budget.
 */
export function checkConfidenceRegression(
  current: ConfidenceSnapshot,
  previous: ConfidenceSnapshot | null,
  baseline: ConfidenceSnapshot | null,
  budget: RegressionBudgetConfig = DEFAULT_REGRESSION_BUDGET
): RegressionCheckResult {
  const alerts: string[] = [];
  let withinBudget = true;

  const periodDrop = previous ? previous.weightedAverage - current.weightedAverage : null;
  const absoluteDrop = baseline ? baseline.weightedAverage - current.weightedAverage : null;

  if (current.weightedAverage < budget.minimumWeightedAverage) {
    alerts.push(`Weighted average ${current.weightedAverage.toFixed(3)} below minimum ${budget.minimumWeightedAverage}`);
    withinBudget = false;
  }

  if (periodDrop !== null && periodDrop > budget.maxDropPerPeriod) {
    alerts.push(`Period drop ${periodDrop.toFixed(3)} exceeds budget ${budget.maxDropPerPeriod}`);
    withinBudget = false;
  }

  if (absoluteDrop !== null && absoluteDrop > budget.maxAbsoluteDrop) {
    alerts.push(`Absolute drop ${absoluteDrop.toFixed(3)} from baseline exceeds budget ${budget.maxAbsoluteDrop}`);
    withinBudget = false;
  }

  return {
    withinBudget,
    currentAverage: current.weightedAverage,
    previousAverage: previous?.weightedAverage ?? null,
    baselineAverage: baseline?.weightedAverage ?? null,
    periodDrop,
    absoluteDrop,
    alerts,
  };
}

// ============================================================================
// EVIDENCE COMPLETENESS TREND
// ============================================================================

export interface CompletenessTrend {
  direction: 'improving' | 'stable' | 'declining';
  currentPercent: number;
  previousPercent: number | null;
  delta: number | null;
  alert: string | null;
}

/**
 * Analyze evidence completeness trend.
 */
export function analyzeCompletenessTrend(
  current: EvidenceCompletenessSnapshot,
  previous: EvidenceCompletenessSnapshot | null
): CompletenessTrend {
  const delta = previous ? current.completenessPercent - previous.completenessPercent : null;

  let direction: CompletenessTrend['direction'];
  if (delta === null || Math.abs(delta) < 0.5) {
    direction = 'stable';
  } else if (delta > 0) {
    direction = 'improving';
  } else {
    direction = 'declining';
  }

  const alert = direction === 'declining'
    ? `Evidence completeness declining: ${previous!.completenessPercent.toFixed(1)}% → ${current.completenessPercent.toFixed(1)}% (Δ${delta!.toFixed(1)}%)`
    : null;

  return {
    direction,
    currentPercent: current.completenessPercent,
    previousPercent: previous?.completenessPercent ?? null,
    delta,
    alert,
  };
}

// ============================================================================
// OVERRIDE ENTROPY
// ============================================================================

export interface OverrideEntropyResult {
  totalOverrides: number;
  /** Unique override types used */
  uniqueTypes: number;
  /** Unique invariants overridden */
  uniqueInvariants: number;
  /** Shannon entropy of override type distribution */
  entropy: number;
  /** Active (non-expired) overrides */
  activeOverrides: number;
  /** Expired overrides not cleaned up */
  expiredOverrides: number;
  /** Is entropy within healthy bounds? */
  healthy: boolean;
  /** Alert if unhealthy */
  alert: string | null;
}

/**
 * Compute override entropy — measures how "diverse" override usage is.
 * High entropy = overrides spread across many invariants (concerning)
 * Low entropy = overrides concentrated on few invariants (expected)
 */
export function computeOverrideEntropy(
  events: OverrideEvent[],
  now: Date = new Date(),
  maxHealthyEntropy: number = 2.0
): OverrideEntropyResult {
  if (events.length === 0) {
    return {
      totalOverrides: 0,
      uniqueTypes: 0,
      uniqueInvariants: 0,
      entropy: 0,
      activeOverrides: 0,
      expiredOverrides: 0,
      healthy: true,
      alert: null,
    };
  }

  const typeCounts = new Map<string, number>();
  const invariants = new Set<string>();
  let activeCount = 0;
  let expiredCount = 0;

  for (const event of events) {
    typeCounts.set(event.overrideType, (typeCounts.get(event.overrideType) ?? 0) + 1);
    invariants.add(event.invariantId);

    if (event.expiresAt && new Date(event.expiresAt) < now) {
      expiredCount++;
    } else {
      activeCount++;
    }
  }

  // Shannon entropy
  const total = events.length;
  let entropy = 0;
  for (const count of typeCounts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }

  // Factor in invariant spread
  const invariantEntropy = invariants.size > 1 ? Math.log2(invariants.size) : 0;
  const combinedEntropy = (entropy + invariantEntropy) / 2;

  const healthy = combinedEntropy <= maxHealthyEntropy;
  const alert = healthy ? null :
    `Override entropy ${combinedEntropy.toFixed(2)} exceeds threshold ${maxHealthyEntropy} — ${invariants.size} invariants overridden across ${typeCounts.size} types`;

  return {
    totalOverrides: events.length,
    uniqueTypes: typeCounts.size,
    uniqueInvariants: invariants.size,
    entropy: combinedEntropy,
    activeOverrides: activeCount,
    expiredOverrides: expiredCount,
    healthy,
    alert,
  };
}

// ============================================================================
// CONFIDENCE ENTROPY (RF-10 Task 1)
// ============================================================================

export interface ConfidenceEntropyConfig {
  /** Number of fixed bins for the histogram (default: 10) */
  binCount?: number;
  /** Minimum confidence value for binning (default: 0.0) */
  minConfidence?: number;
  /** Maximum confidence value for binning (default: 1.0) */
  maxConfidence?: number;
}

export interface ConfidenceEntropyResult {
  /** Shannon entropy H = -Σ p log2(p) */
  entropy: number;
  /** H / log2(binCount) — normalized to [0, 1] */
  normalizedEntropy: number;
  /** Maximum possible entropy = log2(binCount) */
  maxEntropy: number;
  /** Number of bins in histogram */
  binCount: number;
  /** Number of non-empty bins */
  occupiedBins: number;
  /** Total VRs processed */
  totalVRs: number;
  /** Per-bin counts */
  binDistribution: number[];
}

const DEFAULT_ENTROPY_CONFIG: Required<ConfidenceEntropyConfig> = {
  binCount: 10,
  minConfidence: 0.0,
  maxConfidence: 1.0,
};

/**
 * Compute Shannon entropy of confidence distribution.
 *
 * Uses fixed-boundary binning: bins are always [min, min+step), [min+step, min+2*step), ..., [max-step, max].
 * This is stable — bin boundaries don't shift with data distribution.
 *
 * H = 0 means all VRs in one bin (degenerate).
 * H = log2(bins) means uniform (maximum uncertainty).
 * Collapse = abrupt H drop. Spike = abrupt H rise.
 */
export function computeConfidenceEntropy(
  vrs: Array<{ effectiveConfidence: number }>,
  config?: ConfidenceEntropyConfig
): ConfidenceEntropyResult {
  const { binCount, minConfidence, maxConfidence } = { ...DEFAULT_ENTROPY_CONFIG, ...config };
  const maxEntropy = binCount > 1 ? Math.log2(binCount) : 0;

  if (vrs.length === 0) {
    return {
      entropy: 0,
      normalizedEntropy: 0,
      maxEntropy,
      binCount,
      occupiedBins: 0,
      totalVRs: 0,
      binDistribution: new Array(binCount).fill(0),
    };
  }

  if (vrs.length === 1) {
    const bins = new Array(binCount).fill(0);
    const binWidth = (maxConfidence - minConfidence) / binCount;
    const idx = Math.min(Math.floor((Math.max(minConfidence, Math.min(maxConfidence, vrs[0].effectiveConfidence)) - minConfidence) / binWidth), binCount - 1);
    bins[idx] = 1;
    return {
      entropy: 0,
      normalizedEntropy: 0,
      maxEntropy,
      binCount,
      occupiedBins: 1,
      totalVRs: 1,
      binDistribution: bins,
    };
  }

  // Fixed-boundary binning
  const bins = new Array(binCount).fill(0);
  const binWidth = (maxConfidence - minConfidence) / binCount;

  for (const vr of vrs) {
    // Clamp to [min, max]
    const clamped = Math.max(minConfidence, Math.min(maxConfidence, vr.effectiveConfidence));
    let idx = Math.floor((clamped - minConfidence) / binWidth);
    // Edge case: value exactly at maxConfidence goes to last bin
    if (idx >= binCount) idx = binCount - 1;
    bins[idx]++;
  }

  // Shannon entropy
  const total = vrs.length;
  let entropy = 0;
  let occupiedBins = 0;

  for (const count of bins) {
    if (count > 0) {
      occupiedBins++;
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }

  return {
    entropy,
    normalizedEntropy: maxEntropy > 0 ? entropy / maxEntropy : 0,
    maxEntropy,
    binCount,
    occupiedBins,
    totalVRs: total,
    binDistribution: bins,
  };
}

// ============================================================================
// ENTROPY ANOMALY DETECTION (RF-10 Task 2)
// ============================================================================

export interface EntropySnapshot {
  timestamp: string;
  entropy: number;
  normalizedEntropy: number;
}

export interface EntropyAnomalyConfig {
  /** Relative drop threshold for collapse detection (default: 0.5 = 50% drop) */
  collapseDropThreshold?: number;
  /** Relative rise threshold for spike detection (default: 0.5 = 50% rise) */
  spikeRiseThreshold?: number;
  /** Absolute normalized entropy floor for collapse (default: 0.15) */
  collapseAbsoluteFloor?: number;
}

export interface EntropyAnomalyResult {
  collapse: boolean;
  spike: boolean;
  alert: string | null;
  /** The drop or rise ratio (latest vs previous) */
  changeRatio: number | null;
}

const DEFAULT_ANOMALY_CONFIG: Required<EntropyAnomalyConfig> = {
  collapseDropThreshold: 0.5,
  spikeRiseThreshold: 0.5,
  collapseAbsoluteFloor: 0.15,
};

/**
 * Detect entropy collapse (abrupt drop) or spike (abrupt rise).
 *
 * Collapse: latest entropy < previous × (1 - threshold), OR normalized < absolute floor.
 * Spike: latest entropy > previous × (1 + threshold).
 */
export function detectEntropyAnomaly(
  history: EntropySnapshot[],
  config?: EntropyAnomalyConfig
): EntropyAnomalyResult {
  const { collapseDropThreshold, spikeRiseThreshold, collapseAbsoluteFloor } =
    { ...DEFAULT_ANOMALY_CONFIG, ...config };

  if (history.length < 2) {
    return { collapse: false, spike: false, alert: null, changeRatio: null };
  }

  // Sort by timestamp, take last two
  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const prev = sorted[sorted.length - 2];
  const curr = sorted[sorted.length - 1];

  let collapse = false;
  let spike = false;
  const alerts: string[] = [];

  if (prev.entropy > 0) {
    const ratio = (prev.entropy - curr.entropy) / prev.entropy;
    
    // Collapse: entropy dropped by more than threshold
    if (ratio >= collapseDropThreshold) {
      collapse = true;
      alerts.push(`Entropy collapse: ${prev.entropy.toFixed(2)} → ${curr.entropy.toFixed(2)} (${(ratio * 100).toFixed(0)}% drop)`);
    }

    // Spike: entropy rose by more than threshold  
    const riseRatio = (curr.entropy - prev.entropy) / prev.entropy;
    if (riseRatio >= spikeRiseThreshold) {
      spike = true;
      alerts.push(`Entropy spike: ${prev.entropy.toFixed(2)} → ${curr.entropy.toFixed(2)} (${(riseRatio * 100).toFixed(0)}% rise)`);
    }
  }

  // Absolute floor check for collapse
  if (!collapse && curr.normalizedEntropy < collapseAbsoluteFloor && prev.normalizedEntropy >= collapseAbsoluteFloor) {
    collapse = true;
    alerts.push(`Entropy collapse below absolute floor: normalized ${curr.normalizedEntropy.toFixed(2)} < ${collapseAbsoluteFloor}`);
  }

  const changeRatio = prev.entropy > 0 ? (curr.entropy - prev.entropy) / prev.entropy : null;

  return {
    collapse,
    spike,
    alert: alerts.length > 0 ? alerts.join('; ') : null,
    changeRatio,
  };
}

// ============================================================================
// ENTROPY-COLLUSION-OVERRIDE CORRELATION (RF-10 Task 3)
// ============================================================================

export interface AntiGamingEvent {
  timestamp: string;
  type: string;
  sourceFamily: string;
}

export interface EntropyCorrelation {
  type: 'collapse_with_gaming' | 'spike_with_overrides' | 'collapse_with_overrides';
  anomalyTimestamp: string;
  relatedEvents: Array<{ timestamp: string; description: string }>;
  severity: 'warning' | 'critical';
}

export interface EntropyCorrelationResult {
  correlations: EntropyCorrelation[];
  anomalyDetected: boolean;
}

/**
 * Correlate entropy anomalies with concurrent anti-gaming triggers and override events.
 *
 * Time window: events within 7 days before the anomaly period are considered concurrent.
 */
export function correlateEntropyAnomalies(
  entropyHistory: EntropySnapshot[],
  antiGamingEvents: AntiGamingEvent[],
  overrideEvents: OverrideEvent[],
  windowDays: number = 7
): EntropyCorrelationResult {
  const anomaly = detectEntropyAnomaly(entropyHistory);

  if (!anomaly.collapse && !anomaly.spike) {
    return { correlations: [], anomalyDetected: false };
  }

  // Get anomaly time window
  const sorted = [...entropyHistory].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const anomalyTime = new Date(sorted[sorted.length - 1].timestamp);
  const windowStart = new Date(anomalyTime.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const correlations: EntropyCorrelation[] = [];

  // Check anti-gaming events in window
  const concurrentGaming = antiGamingEvents.filter(e => {
    const t = new Date(e.timestamp);
    return t >= windowStart && t <= anomalyTime;
  });

  // Check override events in window
  const concurrentOverrides = overrideEvents.filter(e => {
    const t = new Date(e.timestamp);
    return t >= windowStart && t <= anomalyTime;
  });

  if (anomaly.collapse && concurrentGaming.length > 0) {
    correlations.push({
      type: 'collapse_with_gaming',
      anomalyTimestamp: sorted[sorted.length - 1].timestamp,
      relatedEvents: concurrentGaming.map(e => ({
        timestamp: e.timestamp,
        description: `${e.type} on ${e.sourceFamily}`,
      })),
      severity: 'critical',
    });
  }

  if (anomaly.spike && concurrentOverrides.length > 0) {
    correlations.push({
      type: 'spike_with_overrides',
      anomalyTimestamp: sorted[sorted.length - 1].timestamp,
      relatedEvents: concurrentOverrides.map(e => ({
        timestamp: e.timestamp,
        description: `${e.overrideType} on ${e.invariantId}: ${e.reason}`,
      })),
      severity: 'warning',
    });
  }

  if (anomaly.collapse && concurrentOverrides.length > 0) {
    correlations.push({
      type: 'collapse_with_overrides',
      anomalyTimestamp: sorted[sorted.length - 1].timestamp,
      relatedEvents: concurrentOverrides.map(e => ({
        timestamp: e.timestamp,
        description: `${e.overrideType} on ${e.invariantId}: ${e.reason}`,
      })),
      severity: 'critical',
    });
  }

  return {
    correlations,
    anomalyDetected: true,
  };
}

// ============================================================================
// POLICY EFFECTIVENESS
// ============================================================================

export interface PolicyEffectivenessTrend {
  currentPreventionRate: number;
  previousPreventionRate: number | null;
  direction: 'improving' | 'stable' | 'declining';
  falsePositiveRate: number;
  /** Is the policy effective? (prevention high, FP low) */
  effective: boolean;
  alert: string | null;
}

/**
 * Analyze policy effectiveness trend.
 */
export function analyzePolicyEffectiveness(
  current: PolicyEffectivenessSnapshot,
  previous: PolicyEffectivenessSnapshot | null,
  minPreventionRate: number = 0.90,
  maxFalsePositiveRate: number = 0.10
): PolicyEffectivenessTrend {
  const delta = previous ? current.preventionRate - previous.preventionRate : null;
  let direction: PolicyEffectivenessTrend['direction'];
  if (delta === null || Math.abs(delta) < 0.01) {
    direction = 'stable';
  } else if (delta > 0) {
    direction = 'improving';
  } else {
    direction = 'declining';
  }

  const effective = current.preventionRate >= minPreventionRate &&
                    current.falsePositiveRate <= maxFalsePositiveRate;

  const alerts: string[] = [];
  if (current.preventionRate < minPreventionRate) {
    alerts.push(`Prevention rate ${(current.preventionRate * 100).toFixed(1)}% below ${(minPreventionRate * 100).toFixed(1)}% target`);
  }
  if (current.falsePositiveRate > maxFalsePositiveRate) {
    alerts.push(`False positive rate ${(current.falsePositiveRate * 100).toFixed(1)}% above ${(maxFalsePositiveRate * 100).toFixed(1)}% target`);
  }

  return {
    currentPreventionRate: current.preventionRate,
    previousPreventionRate: previous?.preventionRate ?? null,
    direction,
    falsePositiveRate: current.falsePositiveRate,
    effective,
    alert: alerts.length > 0 ? alerts.join('; ') : null,
  };
}
