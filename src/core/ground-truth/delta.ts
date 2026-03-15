/**
 * Ground Truth Hook — Delta Engine (GTH-3)
 *
 * Computes Panel 3: the diff between Panel 1 (graph state) and Panel 2 (agent state).
 * Observational only — no recommendations, no recovery actions inline.
 * Recovery references go in footer appendix (mirror/policy boundary enforcement).
 *
 * Three confidence tiers:
 * - exact: graph fact directly contradicts agent state
 * - derived: computed from graph relationships
 * - predicted: inferred from heuristics or absence
 */

import type {
  DeltaItem,
  DeltaTier,
  Panel1Output,
  Panel2Output,
  Panel3Output,
  TransitiveImpactClaim,
  CandidateEdge,
} from './types.js';

export interface DeltaInput {
  panel1: Panel1Output;
  panel2: Panel2Output;
  transitiveImpact: TransitiveImpactClaim[];
  candidateModifies: CandidateEdge[];
}

/**
 * Compute the delta between graph state and agent state.
 *
 * Mirror/policy boundary: Panel 3 is purely observational.
 * It reports what IS, never what to DO. Recovery procedures
 * are in a separate appendix, never inline with observations.
 */
export function computeDelta(input: DeltaInput): Panel3Output {
  const deltas: DeltaItem[] = [];

  // ─── Exact tier: direct graph facts ─────────────────────────────
  computeExactDeltas(input, deltas);

  // ─── Derived tier: computed from relationships ──────────────────
  computeDerivedDeltas(input, deltas);

  // ─── Predicted tier: heuristic/absence ──────────────────────────
  computePredictedDeltas(input, deltas);

  return {
    deltas,
    transitiveImpact: input.transitiveImpact,
    candidateModifies: input.candidateModifies,
  };
}

// ─── Exact Deltas ─────────────────────────────────────────────────

function computeExactDeltas(input: DeltaInput, deltas: DeltaItem[]): void {
  const { panel1, panel2 } = input;

  // Task status mismatch: agent claims a task that's already done
  if (panel2.currentTaskId) {
    const planStatus = panel1.planStatus[0]?.value as any;
    // Check if task exists in unblocked list
    const unblockedObs = panel1.planStatus[2]?.value as any[];
    if (unblockedObs) {
      const taskInUnblocked = unblockedObs.some(
        (u: any) => u.task === panel2.currentTaskId,
      );
      if (!taskInUnblocked && panel2.status === 'in_progress') {
        deltas.push({
          description: `Agent claims task "${panel2.currentTaskId}" but it is not in the unblocked task list`,
          tier: 'exact',
          panel: 'computed',
          severity: 'warning',
        });
      }
    }
  }

  // Agent is IDLE but has a currentTaskId
  if (panel2.status === 'idle' && panel2.currentTaskId) {
    deltas.push({
      description: `Agent status is IDLE but currentTaskId is set to "${panel2.currentTaskId}"`,
      tier: 'exact',
      panel: 'agent',
      severity: 'warning',
    });
  }

  // Integrity failures are exact facts
  const criticalFindings = [
    ...panel1.integrity.core,
    ...panel1.integrity.domain,
  ].filter(f => !f.pass && f.severity === 'critical');

  for (const finding of criticalFindings) {
    deltas.push({
      description: `Critical integrity failure: ${finding.description} (observed: ${finding.observedValue}, expected: ${finding.expectedValue})`,
      tier: 'exact',
      panel: 'graph',
      severity: 'critical',
    });
  }
}

// ─── Derived Deltas ───────────────────────────────────────────────

function computeDerivedDeltas(input: DeltaInput, deltas: DeltaItem[]): void {
  const { panel1, panel2 } = input;

  // Evidence coverage gap
  const evObs = panel1.evidenceCoverage[0]?.value as any;
  if (evObs && evObs.pct < 50) {
    deltas.push({
      description: `Evidence coverage at ${evObs.pct}% (${evObs.withEvidence}/${evObs.total} done tasks have structural proof)`,
      tier: 'derived',
      panel: 'graph',
      severity: evObs.pct < 25 ? 'warning' : 'info',
    });
  }

  // Governance staleness
  const govObs = panel1.governanceHealth[0];
  if (govObs?.freshnessState === 'stale') {
    const govValue = govObs.value as any;
    deltas.push({
      description: `Governance data is stale (${govValue.ageHours ?? '?'}h old)`,
      tier: 'derived',
      panel: 'graph',
      severity: 'warning',
    });
  }

  // Transitive impact claims affecting current work
  if (input.transitiveImpact.length > 0) {
    deltas.push({
      description: `${input.transitiveImpact.length} transitive impact claim(s) affect files being touched`,
      tier: 'derived',
      panel: 'graph',
      severity: 'info',
    });
  }

  // Integrity warning-level findings count
  const warningFindings = [
    ...panel1.integrity.core,
    ...panel1.integrity.domain,
  ].filter(f => !f.pass && f.severity === 'warning');

  if (warningFindings.length > 0) {
    deltas.push({
      description: `${warningFindings.length} integrity warning(s) across ${new Set(warningFindings.map(f => f.surface)).size} surface(s)`,
      tier: 'derived',
      panel: 'graph',
      severity: 'info',
    });
  }
}

// ─── Predicted Deltas ─────────────────────────────────────────────

function computePredictedDeltas(input: DeltaInput, deltas: DeltaItem[]): void {
  // Candidate MODIFIES scope mismatch
  if (input.candidateModifies.length > 0 && input.panel2.currentTaskId) {
    deltas.push({
      description: `${input.candidateModifies.length} predicted file(s) in scope for current task (CANDIDATE_MODIFIES)`,
      tier: 'predicted',
      panel: 'graph',
      severity: 'info',
    });
  }

  // Relevant claims from Panel 1A
  if (input.panel1.relevantClaims.length > 0) {
    const keywordOnly = input.panel1.relevantClaims.filter(
      c => (c.value as any)?.matchMethod === 'keyword',
    );
    if (keywordOnly.length > 0) {
      deltas.push({
        description: `${keywordOnly.length} claim(s) matched by keyword only (no structural evidence chain)`,
        tier: 'predicted',
        panel: 'graph',
        severity: 'info',
      });
    }
  }
}

// ─── Mirror/Policy Boundary ───────────────────────────────────────

/**
 * Recovery appendix — separate from observations.
 *
 * Panel 3 is purely observational. This function generates
 * recovery REFERENCES (not instructions) for a separate appendix.
 * Never included inline with delta observations.
 *
 * Mirror principle: the hook shows what IS. Recovery is policy.
 */
export function generateRecoveryAppendix(deltas: DeltaItem[]): string[] {
  const references: string[] = [];

  for (const delta of deltas) {
    if (delta.severity === 'critical') {
      references.push(
        `[${delta.description}] → See: governance gate documentation, integrity finding resolution trail`,
      );
    }
    if (delta.description.includes('stale')) {
      references.push(
        `[${delta.description}] → See: done-check pipeline, GovernanceMetricSnapshot refresh`,
      );
    }
    if (delta.description.includes('evidence coverage')) {
      references.push(
        `[${delta.description}] → See: evidence-auto-linker, evidence backfill fast track`,
      );
    }
  }

  return references;
}
