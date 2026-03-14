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
