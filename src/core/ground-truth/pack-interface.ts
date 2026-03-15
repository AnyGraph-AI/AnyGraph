/**
 * Ground Truth Hook — Pack Interface (GTH-1 Task 1)
 *
 * Generic interface that ships with v1, never changes per domain.
 * Domain packs implement this to supply domain-specific queries.
 * The runtime is domain-blind; the pack supplies domain knowledge.
 */

import type {
  Observation,
  IntegrityFinding,
  TransitiveImpactClaim,
  CandidateEdge,
} from './types.js';

/**
 * GroundTruthPack — the domain-specific query provider.
 *
 * One concrete pack (`software-governance`) implements codegraph queries.
 * Additional packs (e.g., `corpus-diagnostic`) can be added as v1.1+.
 *
 * The pack provides:
 * - Panel 1A queries: plan status, governance health, evidence coverage, claims
 * - Panel 1B domain surfaces: coverage, semantic, governance integrity checks
 * - Panel 3 scope checks: transitive impact, candidate MODIFIES edges
 */
export interface GroundTruthPack {
  /** Domain identifier (e.g., 'software-governance', 'corpus-diagnostic') */
  readonly domain: string;
  /** Pack version */
  readonly version: string;

  // ─── Panel 1A queries ───────────────────────────────────────────
  // Each returns observations with per-item provenance
  // (observedAt, source, freshnessState, confidenceClass)

  /**
   * Query plan status: milestone completion, task counts, unblocked tasks.
   * Source: PlanProject, Milestone, Task nodes.
   */
  queryPlanStatus(projectId: string): Promise<Observation[]>;

  /**
   * Query governance health: gate failures, interception rate, metric trends.
   * Source: GovernanceMetricSnapshot (primary per GRC-3/7), GateDecision nodes.
   */
  queryGovernanceHealth(projectId: string): Promise<Observation[]>;

  /**
   * Query evidence coverage: done tasks with/without HAS_CODE_EVIDENCE.
   * Source: Task → HAS_CODE_EVIDENCE → SourceFile edges.
   */
  queryEvidenceCoverage(projectId: string): Promise<Observation[]>;

  /**
   * Query relevant claims for current work scope.
   * Uses structural matching (SUPPORTED_BY → ANCHORS → SourceFile) first,
   * keyword CONTAINS as fallback.
   * Source: Claim, Evidence, Hypothesis nodes.
   */
  queryRelevantClaims(taskId: string, filesTouched: string[], projectId?: string): Promise<Observation[]>;

  // ─── Panel 1B: domain-specific integrity surfaces ───────────────
  // coverage, semantic, governance — varies by pack

  /**
   * Query domain-specific integrity surfaces.
   * Core surfaces (schema, referential, provenance, freshness) are in the runtime.
   * Domain surfaces (coverage, semantic, governance) are in the pack.
   */
  queryIntegritySurfaces(projectId: string): Promise<IntegrityFinding[]>;

  // ─── Panel 3 scope checks ──────────────────────────────────────

  /**
   * Query transitive impact claims for files being touched.
   * Structural matching via SUPPORTED_BY→ANCHORS→SourceFile first,
   * keyword CONTAINS fallback.
   */
  queryTransitiveImpact(filesTouched: string[], projectId?: string): Promise<TransitiveImpactClaim[]>;

  /**
   * Query predicted MODIFIES edges for a task.
   * These are CANDIDATE_MODIFIES (non-authoritative, from task descriptions).
   * Observed edges (TOUCHED) are separate from predicted scope.
   */
  queryCandidateModifies(taskId: string, projectId?: string): Promise<CandidateEdge[]>;

  // ─── GTH-9: Claim Layer Integration ─────────────────────────────

  /**
   * Traverse claim chain path from a task's evidence to downstream claims.
   * Returns claims structurally relevant to the current task scope.
   */
  queryClaimChainForTask(taskId: string, projectId?: string): Promise<Observation[]>;

  /**
   * Surface contradictions relevant to the current milestone scope.
   * Returns claims with CONTRADICTED_BY edges in the milestone's task set.
   */
  queryContradictionsForMilestone(milestone: string, projectId?: string): Promise<Observation[]>;

  /**
   * Surface open hypotheses relevant to the current milestone scope.
   * Includes both integrity-generated and gap-generated hypotheses.
   */
  queryOpenHypothesesForMilestone(milestone: string, projectId?: string): Promise<Observation[]>;

  /** Optional cleanup — close underlying connections */
  close?(): Promise<void>;
}
