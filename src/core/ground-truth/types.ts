/**
 * Ground Truth Hook — Core Type Definitions (GTH-1 Task 3)
 *
 * Observation and IntegrityFinding types with per-item provenance.
 * These are the data contracts for all three panels.
 */

// ─── Observation (Panel 1A data unit) ───────────────────────────────

/** Freshness state of an individual observation */
export type FreshnessState = 'fresh' | 'stale' | 'unknown';

/** Confidence classification for observations */
export type ConfidenceClass = 'exact' | 'derived' | 'predicted';

/**
 * A single graph observation with per-item provenance.
 * Every piece of data from Panel 1A carries this envelope so stale data
 * is visible per-item, not just per-panel.
 */
export interface Observation {
  /** The observed value (type depends on query) */
  value: unknown;
  /** ISO timestamp of when this observation was made */
  observedAt: string;
  /** Source node type or query name that produced this observation */
  source: string;
  /** Whether the underlying data is current */
  freshnessState: FreshnessState;
  /** Whether this is a graph fact, computed value, or heuristic */
  confidenceClass: ConfidenceClass;
}

// ─── IntegrityFinding (Panel 1B data unit) ──────────────────────────

/** The seven integrity surfaces, split into core and domain */
export type IntegritySurface =
  // Core surfaces (universal, every domain)
  | 'schema'
  | 'referential'
  | 'provenance'
  | 'freshness'
  | 'trust'
  // Domain-specific surfaces (varies by pack)
  | 'coverage'
  | 'semantic'
  | 'governance';

/** Core surfaces belong to the runtime; domain surfaces belong to the pack */
export type SurfaceClass = 'core' | 'domain';

/** Finding severity */
export type FindingSeverity = 'critical' | 'warning' | 'info';

/** Trend computed by comparing current vs previous observation */
export type FindingTrend = 'improving' | 'stable' | 'degrading' | 'new';

/** Check tier — determines when a check runs */
export type CheckTier = 'fast' | 'medium' | 'heavy';

/**
 * DTO that flattens the two-node graph structure (IntegrityFindingDefinition +
 * IntegrityFindingObservation) into a single object for API consumers.
 *
 * The graph stores these as separate linked nodes; this interface is the read model.
 */
export interface IntegrityFinding {
  /** Stable ID of the check definition */
  definitionId: string;
  /** Which integrity surface this check belongs to */
  surface: IntegritySurface;
  /** Whether this is a core (universal) or domain-specific surface */
  surfaceClass: SurfaceClass;
  /** Finding severity */
  severity: FindingSeverity;
  /** Human-readable description of what's checked */
  description: string;
  /** Observed value from the check */
  observedValue: number;
  /** Expected value (threshold) */
  expectedValue: number;
  /** Whether the check passes */
  pass: boolean;
  /** Trend vs previous observation */
  trend: FindingTrend;
  /** Which tier this check belongs to */
  tier: CheckTier;
  /** ISO timestamp of observation */
  observedAt: string;
}

// ─── IntegrityReport (Panel 1B output) ──────────────────────────────

export interface IntegrityReport {
  /** Core integrity findings (from runtime) */
  core: IntegrityFinding[];
  /** Domain-specific integrity findings (from pack) */
  domain: IntegrityFinding[];
  /** Summary stats */
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    criticalFailures: number;
  };
}

// ─── Discrepancy types ──────────────────────────────────────────────

export type DiscrepancyType =
  | 'StructuralViolation'
  | 'EvidenceGap'
  | 'FreshnessBreach'
  | 'ReferentialDrift'
  | 'SemanticConflict'
  | 'CoverageGap'
  | 'ObservedUnmodeledReality';

// ─── TransitiveImpact + CandidateEdge (Panel 3 inputs) ─────────────

export interface TransitiveImpactClaim {
  claimId: string;
  statement: string;
  confidence: number;
  affectedFiles: string[];
  /** Whether match was structural (SUPPORTED_BY chain) or keyword fallback */
  matchMethod: 'structural' | 'keyword';
}

export interface CandidateEdge {
  taskId: string;
  taskName: string;
  targetFilePath: string;
  confidence: number;
  source: 'task_description' | 'keyword_match' | 'historical';
}

// ─── Delta types (Panel 3 output units) ─────────────────────────────

export type DeltaTier = 'exact' | 'derived' | 'predicted';

export interface DeltaItem {
  /** What changed */
  description: string;
  /** Confidence tier */
  tier: DeltaTier;
  /** Source panel */
  panel: 'graph' | 'agent' | 'computed';
  /** Severity of the delta */
  severity: 'info' | 'warning' | 'critical';
}

// ─── Three-Panel Output ─────────────────────────────────────────────

export interface Panel1Output {
  /** Panel 1A: Graph state observations */
  planStatus: Observation[];
  governanceHealth: Observation[];
  evidenceCoverage: Observation[];
  relevantClaims: Observation[];
  /** GTH-9: Claim chain contradictions for current milestone scope */
  contradictions?: Observation[];
  /** GTH-9: Open hypotheses for current milestone scope */
  openHypotheses?: Observation[];
  /** TC bridge: temporal confidence health */
  temporalConfidence?: Observation[];
  /** Panel 1B: Integrity report */
  integrity: IntegrityReport;
}

export interface Panel2Output {
  agentId: string;
  status: string;
  currentTaskId: string | null;
  currentMilestone: string | null;
  sessionBookmark: Record<string, unknown> | null;
}

export interface Panel3Output {
  deltas: DeltaItem[];
  transitiveImpact: TransitiveImpactClaim[];
  candidateModifies: CandidateEdge[];
}

// ─── Typed observation value shapes (replaces `as any`) ─────────

export interface TaskStatusValue {
  done?: number;
  planned?: number;
  total: number;
  pct: number;
  [key: string]: unknown;
}

export interface MilestoneValue {
  name: string;
  done: number;
  total: number;
}

export interface UnblockedTaskValue {
  milestone: string;
  task: string;
}

export interface GovernanceHealthValue {
  verificationRuns: number;
  gateFailures: number;
  interceptionRate: number;
  invariantViolations: number;
  ageHours: number;
  error?: string;
}

export interface EvidenceCoverageValue {
  withEvidence: number;
  withoutEvidence: number;
  total: number;
  pct: number;
}

export interface ClaimMatchValue {
  claimId: string;
  statement: string;
  confidence: number;
  matchMethod: string;
}

export interface GroundTruthOutput {
  panel1: Panel1Output;
  panel2: Panel2Output;
  panel3: Panel3Output;
  /** Hook run metadata */
  meta: {
    runAt: string;
    projectId: string;
    depth: CheckTier;
    durationMs: number;
  };
}
