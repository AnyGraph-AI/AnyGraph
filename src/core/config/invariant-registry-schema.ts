/**
 * Invariant Registry Schema — Governance Contract
 *
 * Machine-readable catalog of all governance invariants.
 * Each invariant has a class, scope, enforcement mode, and diagnostic query.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N1, S2 Invariant Registry
 */

export const INVARIANT_REGISTRY_SCHEMA_VERSION = '1.0.0' as const;

// ============================================================================
// INVARIANT CLASSIFICATION
// ============================================================================

export enum InvariantClass {
  /** DB-enforceable constraints (uniqueness, existence, type) */
  STRUCTURAL = 'structural',
  /** Hard semantic rules that must never be violated */
  HARD_SEMANTIC = 'hardSemantic',
  /** Soft semantic rules that start advisory and ratchet to enforced */
  SOFT_SEMANTIC = 'softSemantic',
  /** Heuristic rules based on statistical thresholds */
  HEURISTIC = 'heuristic',
}

export enum InvariantScope {
  TASK = 'task',
  MILESTONE = 'milestone',
  PROJECT = 'project',
  GLOBAL = 'global',
}

export enum EnforcementMode {
  /** Fail-closed immediately on violation */
  ENFORCED = 'enforced',
  /** Log and report but don't block */
  ADVISORY = 'advisory',
  /** Block with human override available */
  ASSISTED = 'assisted',
}

// ============================================================================
// INVARIANT DEFINITION
// ============================================================================

export interface InvariantDefinition {
  /** Unique identifier (e.g., 'done_without_witness') */
  invariantId: string;
  /** Classification */
  class: InvariantClass;
  /** Scope of enforcement */
  scope: InvariantScope;
  /** Current enforcement mode */
  enforcementMode: EnforcementMode;
  /** What evidence is required to satisfy this invariant */
  requiredEvidence: string;
  /** How stale can the evidence be before re-verification is needed */
  freshnessPolicy: string;
  /** Can this invariant be waived? */
  waiverable: boolean;
  /** Who owns this invariant */
  owner: string;
  /** How often should this invariant be reviewed */
  reviewCadence: string;
  /** Cypher query template for diagnostics */
  diagnosticQueryTemplate: string;
  /** Schema for counterexample artifacts */
  counterexampleSchema: CounterexampleSchema;
  /** Human-readable description */
  description: string;
}

export interface CounterexampleSchema {
  /** Fields that must be present in a counterexample */
  requiredFields: string[];
  /** Optional fields */
  optionalFields?: string[];
}

// ============================================================================
// FROZEN REGISTRY (v1) — Hard Invariants
// ============================================================================

export const HARD_INVARIANTS: InvariantDefinition[] = [
  {
    invariantId: 'done_without_witness',
    class: InvariantClass.HARD_SEMANTIC,
    scope: InvariantScope.TASK,
    enforcementMode: EnforcementMode.ENFORCED,
    requiredEvidence: 'At least one HAS_CODE_EVIDENCE edge or DocumentWitness node',
    freshnessPolicy: 'recheck on plan re-ingest',
    waiverable: false,
    owner: 'governance',
    reviewCadence: 'every plan re-ingest',
    diagnosticQueryTemplate: `MATCH (t:Task {projectId: $projectId, status: 'done'})
WHERE NOT (t)-[:HAS_CODE_EVIDENCE]->() AND NOT (t)<-[:WITNESSES]-()
RETURN t.name, t.id`,
    counterexampleSchema: { requiredFields: ['taskId', 'taskName', 'projectId'] },
    description: 'A task marked done must have at least one evidence witness',
  },
  {
    invariantId: 'cross_project_witness_reference',
    class: InvariantClass.HARD_SEMANTIC,
    scope: InvariantScope.GLOBAL,
    enforcementMode: EnforcementMode.ENFORCED,
    requiredEvidence: 'Evidence edges must reference nodes in the same project or explicitly linked projects',
    freshnessPolicy: 'recheck on edge creation',
    waiverable: false,
    owner: 'governance',
    reviewCadence: 'every ingest',
    diagnosticQueryTemplate: `MATCH (t:Task)-[e:HAS_CODE_EVIDENCE]->(sf)
WHERE t.projectId <> sf.projectId
AND NOT EXISTS { MATCH (pp:PlanProject {projectId: t.projectId})-[:TARGETS]->(:Project {projectId: sf.projectId}) }
RETURN t.name, t.projectId, sf.projectId`,
    counterexampleSchema: { requiredFields: ['taskId', 'taskProjectId', 'evidenceProjectId'] },
    description: 'Evidence edges must not cross project boundaries without explicit TARGETS linkage',
  },
  {
    invariantId: 'expired_waiver_allows_progress',
    class: InvariantClass.HARD_SEMANTIC,
    scope: InvariantScope.TASK,
    enforcementMode: EnforcementMode.ENFORCED,
    requiredEvidence: 'Waiver expiresAt must be in the future for the waiver to suppress violations',
    freshnessPolicy: 'recheck on gate run',
    waiverable: false,
    owner: 'governance',
    reviewCadence: 'every gate run',
    diagnosticQueryTemplate: `MATCH (w {coreType: 'HygieneException'})
WHERE w.expiresAt < datetime()
AND w.status = 'active'
RETURN w.stableId, w.expiresAt, w.invariantId`,
    counterexampleSchema: { requiredFields: ['waiverId', 'expiresAt', 'invariantId'] },
    description: 'Expired waivers must not suppress governance violations',
  },
  {
    invariantId: 'missing_required_policy_bundle_digest',
    class: InvariantClass.HARD_SEMANTIC,
    scope: InvariantScope.GLOBAL,
    enforcementMode: EnforcementMode.ENFORCED,
    requiredEvidence: 'GateDecision nodes must have policyBundleDigest field',
    freshnessPolicy: 'recheck on gate run',
    waiverable: false,
    owner: 'governance',
    reviewCadence: 'every gate run',
    diagnosticQueryTemplate: `MATCH (gd:GateDecision)
WHERE gd.policyBundleDigest IS NULL
RETURN gd.runId, gd.projectId`,
    counterexampleSchema: { requiredFields: ['runId', 'projectId'] },
    description: 'Gate decisions must reference their policy bundle by digest',
  },
  {
    invariantId: 'missing_required_test_provenance',
    class: InvariantClass.HARD_SEMANTIC,
    scope: InvariantScope.GLOBAL,
    enforcementMode: EnforcementMode.ENFORCED,
    requiredEvidence: 'VerificationRun nodes must have provenance fields (commitSha, artifactHash)',
    freshnessPolicy: 'recheck on verification capture',
    waiverable: false,
    owner: 'governance',
    reviewCadence: 'every verification run',
    diagnosticQueryTemplate: `MATCH (vr:VerificationRun)
WHERE vr.commitSha IS NULL OR vr.artifactHash IS NULL
RETURN vr.runId, vr.projectId`,
    counterexampleSchema: { requiredFields: ['runId', 'missingFields'] },
    description: 'Verification runs must capture provenance (commit SHA, artifact hash)',
  },
  {
    invariantId: 'contract_break_on_required_surface',
    class: InvariantClass.STRUCTURAL,
    scope: InvariantScope.PROJECT,
    enforcementMode: EnforcementMode.ENFORCED,
    requiredEvidence: 'Contract corpus must pass for all required surfaces',
    freshnessPolicy: 'recheck on schema/query/artifact change',
    waiverable: false,
    owner: 'governance',
    reviewCadence: 'every merge',
    diagnosticQueryTemplate: `MATCH (qc:QueryContract {projectId: $projectId})
WHERE qc.status = 'failing'
RETURN qc.name, qc.surface, qc.lastError`,
    counterexampleSchema: { requiredFields: ['contractName', 'surface', 'error'] },
    description: 'Contract breaks on required surfaces block merge',
  },
];

// ============================================================================
// FROZEN REGISTRY (v1) — Advisory Invariants (ratchet by telemetry)
// ============================================================================

export const ADVISORY_INVARIANTS: InvariantDefinition[] = [
  {
    invariantId: 'insufficient_scope_completeness',
    class: InvariantClass.SOFT_SEMANTIC,
    scope: InvariantScope.PROJECT,
    enforcementMode: EnforcementMode.ADVISORY,
    requiredEvidence: 'Scope completeness above configured threshold',
    freshnessPolicy: 'recheck on scope resolution',
    waiverable: true,
    owner: 'governance',
    reviewCadence: 'weekly',
    diagnosticQueryTemplate: `MATCH (as:AnalysisScope {projectId: $projectId})
WHERE as.completeness < $threshold
RETURN as.scopeId, as.completeness`,
    counterexampleSchema: { requiredFields: ['scopeId', 'completeness', 'threshold'] },
    description: 'Analysis scope completeness should meet minimum threshold',
  },
  {
    invariantId: 'stale_recommendation_inputs',
    class: InvariantClass.SOFT_SEMANTIC,
    scope: InvariantScope.PROJECT,
    enforcementMode: EnforcementMode.ADVISORY,
    requiredEvidence: 'Plan ingest timestamp within freshness SLA',
    freshnessPolicy: 'recheck before recommendation tools',
    waiverable: true,
    owner: 'governance',
    reviewCadence: 'every recommendation request',
    diagnosticQueryTemplate: `MATCH (pp:PlanProject {projectId: $projectId})
WHERE pp.lastIngestAt < datetime() - duration({hours: $maxAgeHours})
RETURN pp.projectId, pp.lastIngestAt`,
    counterexampleSchema: { requiredFields: ['projectId', 'lastIngestAt', 'maxAgeHours'] },
    description: 'Recommendation inputs must be fresh (plan re-ingest within SLA)',
  },
  {
    invariantId: 'confidence_below_threshold',
    class: InvariantClass.HEURISTIC,
    scope: InvariantScope.TASK,
    enforcementMode: EnforcementMode.ADVISORY,
    requiredEvidence: 'Confidence score above configured minimum',
    freshnessPolicy: 'recheck on confidence recompute',
    waiverable: true,
    owner: 'governance',
    reviewCadence: 'weekly',
    diagnosticQueryTemplate: `MATCH (c:Claim {projectId: $projectId})
WHERE c.confidence < $threshold
RETURN c.statement, c.confidence`,
    counterexampleSchema: { requiredFields: ['claimId', 'confidence', 'threshold'] },
    description: 'Claims with confidence below threshold should be investigated',
  },
  {
    invariantId: 'suspicious_evidence_density',
    class: InvariantClass.HEURISTIC,
    scope: InvariantScope.TASK,
    enforcementMode: EnforcementMode.ADVISORY,
    requiredEvidence: 'Evidence density within expected range for task complexity',
    freshnessPolicy: 'recheck on evidence change',
    waiverable: true,
    owner: 'governance',
    reviewCadence: 'weekly',
    diagnosticQueryTemplate: `MATCH (t:Task {projectId: $projectId})-[e:HAS_CODE_EVIDENCE]->()
WITH t, count(e) AS evidenceCount
WHERE evidenceCount > $maxExpected
RETURN t.name, evidenceCount`,
    counterexampleSchema: { requiredFields: ['taskId', 'evidenceCount', 'maxExpected'] },
    description: 'Suspiciously high evidence density may indicate false linking',
  },
];

/** Full registry (combined) */
export const INVARIANT_REGISTRY: InvariantDefinition[] = [
  ...HARD_INVARIANTS,
  ...ADVISORY_INVARIANTS,
];
