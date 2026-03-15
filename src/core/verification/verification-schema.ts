import { z } from 'zod';

// ─── Four-View Structural Separation (RF-1) ────────────────────────
//
// Every verification datum belongs to exactly one of four views:
//
//   ProvenanceView  — Where data came from (tool, version, attestation, digest)
//   EvidenceView    — What was observed (status, grade, criticality, freshness, reproducibility)
//   TrustView       — How much to trust it (computed trust scores, source-family caps)
//   DecisionView    — What to do about it (adjudication, lifecycle, gate verdicts)
//
// Cross-view rules:
//   - Trust and Evidence feed Decision via explicit transforms only
//   - No view may directly mutate confidence values in another view
//   - Provenance is append-only; no downstream view may alter provenance records
//
// See docs/QUERY_CONTRACT_VIEWS.md for canonical boundaries and allowed cross-view edges.

export const VerificationViewSchema = z.enum([
  'provenance',
  'evidence',
  'trust',
  'decision',
]);
export type VerificationView = z.infer<typeof VerificationViewSchema>;

export const VerificationStatusSchema = z.enum(['satisfies', 'violates', 'unknown']);
export const CriticalitySchema = z.enum(['low', 'medium', 'high', 'safety_critical']);
export const EvidenceGradeSchema = z.enum(['A1', 'A2', 'A3']);

export const AdjudicationStateSchema = z.enum([
  'open',
  'reviewing',
  'to_fix',
  'ignored',
  'dismissed',
  'fixed',
  'closed',
  'reopened',
  'provisionally_ignored',
]);

export const AdjudicationReasonSchema = z.enum([
  'false_positive',
  'acceptable_risk',
  'wont_fix',
  'used_in_tests',
  'no_time_to_fix',
  'compensating_control',
  'other',
]);

export const VerificationRunSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  tool: z.string().min(1),
  status: VerificationStatusSchema.default('unknown'),
  criticality: CriticalitySchema.optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  evidenceGrade: EvidenceGradeSchema.optional(),
  freshnessTs: z.string().datetime().optional(),
  toolVersion: z.string().optional(),
  reproducible: z.boolean().optional(),

  // Identity/lifecycle
  resultFingerprint: z.string().optional(),
  lifecycleState: z.string().optional(),
  firstSeenTs: z.string().datetime().optional(),
  lastSeenTs: z.string().datetime().optional(),

  // Baseline/diff
  baselineRef: z.string().optional(),
  mergeBase: z.string().optional(),

  // Tool artifact identity
  queryPackId: z.string().optional(),
  ruleId: z.string().optional(),
  policyBundleId: z.string().optional(),
  runConfigHash: z.string().optional(),

  // Provenance/replay
  attestationRef: z.string().optional(),
  subjectDigest: z.string().optional(),
  predicateType: z.string().optional(),
  verifierId: z.string().optional(),
  timeVerified: z.string().datetime().optional(),
  externalContextSnapshotRef: z.string().optional(),
  decisionHash: z.string().optional(),

  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const AnalysisScopeSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  verificationRunId: z.string().min(1),
  scanRoots: z.array(z.string()).default([]),
  includedPaths: z.array(z.string()).default([]),
  excludedPaths: z.array(z.string()).default([]),
  excludeSource: z.string().optional(),
  buildMode: z.enum(['none', 'autobuild', 'manual', 'custom']).optional(),
  supportedLanguages: z.array(z.string()).default([]),
  analyzedLanguages: z.array(z.string()).default([]),
  targetFileCount: z.number().int().nonnegative().optional(),
  analyzedFileCount: z.number().int().nonnegative().optional(),
  skippedFileCount: z.number().int().nonnegative().optional(),
  analysisErrorCount: z.number().int().nonnegative().optional(),
  warningCount: z.number().int().nonnegative().optional(),
  suppressedErrors: z.boolean().optional(),
  scopeCompleteness: z.enum(['complete', 'partial', 'unknown']).default('unknown'),
  scopeEvidenceRef: z.string().optional(),

  // optional explicit unscanned targets
  unscannedTargetNodeIds: z.array(z.string()).default([]),
});

export const AdjudicationRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  targetNodeId: z.string().min(1),
  adjudicationState: AdjudicationStateSchema,
  adjudicationReason: AdjudicationReasonSchema,
  adjudicationComment: z.string().optional(),
  requestedAt: z.string().datetime().optional(),
  approvedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  requestedBy: z.string().optional(),
  approvedBy: z.string().optional(),
  approvalMode: z.enum(['single', 'dual', 'delegated']).optional(),
  branchScope: z.enum(['single_ref', 'branch_family', 'global']).optional(),
  ticketRef: z.string().optional(),
  adjudicationSource: z.string().optional(),
  requiresRevalidation: z.boolean().default(false),
});

export const PathWitnessSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  verificationRunId: z.string().min(1),
  witnessType: z.enum(['relatedLocations', 'codeFlows', 'hybrid']).default('relatedLocations'),
  criticality: CriticalitySchema.optional(),
  summary: z.string().optional(),
  payloadJson: z.string().optional(),
});

export const VerificationFoundationBundleSchema = z.object({
  projectId: z.string().min(1),
  verificationRuns: z.array(VerificationRunSchema).default([]),
  analysisScopes: z.array(AnalysisScopeSchema).default([]),
  adjudications: z.array(AdjudicationRecordSchema).default([]),
  pathWitnesses: z.array(PathWitnessSchema).default([]),
});

export type VerificationRun = z.infer<typeof VerificationRunSchema>;
export type AnalysisScope = z.infer<typeof AnalysisScopeSchema>;
export type AdjudicationRecord = z.infer<typeof AdjudicationRecordSchema>;
export type PathWitness = z.infer<typeof PathWitnessSchema>;
export type VerificationFoundationBundle = z.infer<typeof VerificationFoundationBundleSchema>;

// ─── Four-View Typed Schemas (RF-1) ────────────────────────────────
//
// Each view owns a strict subset of verification properties.
// View assignment is enforced at schema level — properties cannot
// migrate between views without explicit schema migration.

/**
 * ProvenanceView — immutable record of where data came from.
 * Append-only: no downstream view may alter provenance records.
 */
export const ProvenanceViewSchema = z.object({
  sourceKind: z.enum(['typeChecker', 'frameworkExtractor', 'heuristic', 'postIngest', 'gitMining', 'sarifImport', 'manualAttestation']),
  toolVersion: z.string().optional(),
  attestationRef: z.string().optional(),
  subjectDigest: z.string().optional(),
  predicateType: z.string().optional(),
  verifierId: z.string().optional(),
  timeVerified: z.string().datetime().optional(),
  runConfigHash: z.string().optional(),
  queryPackId: z.string().optional(),
  policyBundleId: z.string().optional(),
  externalContextSnapshotRef: z.string().optional(),
});

/**
 * EvidenceView — what was observed, when, and whether it's reproducible.
 * Observations are factual records; they do not express trust or decisions.
 */
export const EvidenceViewSchema = z.object({
  status: VerificationStatusSchema.default('unknown'),
  criticality: CriticalitySchema.optional(),
  evidenceGrade: EvidenceGradeSchema.optional(),
  freshnessTs: z.string().datetime().optional(),
  reproducible: z.boolean().optional(),
  resultFingerprint: z.string().optional(),
  firstSeenTs: z.string().datetime().optional(),
  lastSeenTs: z.string().datetime().optional(),
  baselineRef: z.string().optional(),
  mergeBase: z.string().optional(),

  // ─── TC-1: Temporal Confidence Fields ─────────────────────────
  /** When this evidence was observed/collected (ingestion timestamp) */
  observedAt: z.string().datetime().optional(),
  /** Start of the validity window for this evidence */
  validFrom: z.string().datetime().optional(),
  /** End of the validity window (null = still valid) */
  validTo: z.string().datetime().nullable().optional(),
  /** Timestamp when this evidence was superseded by newer observation */
  supersededAt: z.string().datetime().nullable().optional(),
});

/**
 * TrustView — computed trust scores derived from evidence and provenance.
 * Trust/Evidence feed Decision via explicit transforms only.
 * Source-family caps and collusion signals live here.
 */
export const TrustViewSchema = z.object({
  /** Raw evidence-derived confidence before trust adjustments */
  baseEvidenceScore: z.number().min(0).max(1).optional(),
  /** Effective confidence after trust computation */
  effectiveConfidence: z.number().min(0).max(1).optional(),
  /** Source family for deduplication and cap enforcement */
  sourceFamily: z.string().optional(),
  /** Source family contribution cap (0.0–1.0) */
  sourceFamilyCap: z.number().min(0).max(1).optional(),
  /** Whether this source is flagged for potential collusion */
  collusionFlag: z.boolean().optional(),
  /** Hard penalty factor applied during trust computation (0.0–1.0) */
  hardPenalty: z.number().min(0).max(1).optional(),
  /** Time consistency factor for temporal trust decay (TC-1) */
  timeConsistencyFactor: z.number().min(0).max(1).optional(),
  /** Retroactive penalty applied when evidence is superseded or validity expires (TC-1) */
  retroactivePenalty: z.number().min(0).max(1).optional(),
  /** Shadow confidence from propagation engine — NEVER overwrites effectiveConfidence (TC-3) */
  shadowEffectiveConfidence: z.number().min(0).max(1).optional(),
  /** Influence score from shadow propagation (TC-3) */
  shadowInfluenceScore: z.number().min(0).max(1).optional(),
  /** Normalization mode used by shadow propagation (TC-3) */
  normalizationMode: z.enum(['linear', 'softmax']).optional(),
  /** Damping factor used by shadow propagation (TC-3) */
  dampingFactorUsed: z.number().min(0).max(1).optional(),
  /** Version counter for confidence recomputation lineage */
  confidenceVersion: z.number().int().nonnegative().optional(),
  /** Hash of all inputs used to compute this confidence value */
  confidenceInputsHash: z.string().optional(),
  /** Timestamp of last confidence recomputation */
  lastRecomputeAt: z.string().datetime().optional(),
  /** Reason for last recomputation (e.g., 'delta_scoped', 'full_rerun', 'manual') */
  recomputeReason: z.string().optional(),
});

/**
 * DecisionView — what to do about the evidence + trust signals.
 * Adjudication, lifecycle state, and gate verdicts live here.
 * May only be fed by Trust and Evidence via explicit transform functions.
 */
export const DecisionViewSchema = z.object({
  lifecycleState: z.string().optional(),
  adjudicationState: AdjudicationStateSchema.optional(),
  adjudicationReason: AdjudicationReasonSchema.optional(),
  adjudicationComment: z.string().optional(),
  approvalMode: z.enum(['single', 'dual', 'delegated']).optional(),
  branchScope: z.enum(['single_ref', 'branch_family', 'global']).optional(),
  decisionHash: z.string().optional(),
  /** Gate verdict derived from trust + evidence */
  gateVerdict: z.enum(['pass', 'fail', 'warn', 'skip']).optional(),
  /** Whether this decision requires human revalidation */
  requiresRevalidation: z.boolean().default(false),
});

export type ProvenanceView = z.infer<typeof ProvenanceViewSchema>;
export type EvidenceView = z.infer<typeof EvidenceViewSchema>;
export type TrustView = z.infer<typeof TrustViewSchema>;
export type DecisionView = z.infer<typeof DecisionViewSchema>;

// ─── View Field Registry ────────────────────────────────────────────
//
// Canonical mapping of property names to their owning view.
// Used by cross-view mutation guards and query contract enforcement.

export const VIEW_FIELD_REGISTRY: Readonly<Record<string, VerificationView>> = {
  // ProvenanceView fields
  sourceKind: 'provenance',
  toolVersion: 'provenance',
  attestationRef: 'provenance',
  subjectDigest: 'provenance',
  predicateType: 'provenance',
  verifierId: 'provenance',
  timeVerified: 'provenance',
  runConfigHash: 'provenance',
  queryPackId: 'provenance',
  policyBundleId: 'provenance',
  externalContextSnapshotRef: 'provenance',

  // EvidenceView fields
  status: 'evidence',
  criticality: 'evidence',
  evidenceGrade: 'evidence',
  freshnessTs: 'evidence',
  reproducible: 'evidence',
  resultFingerprint: 'evidence',
  firstSeenTs: 'evidence',
  lastSeenTs: 'evidence',
  baselineRef: 'evidence',
  mergeBase: 'evidence',
  // TC-1: Temporal fields
  observedAt: 'evidence',
  validFrom: 'evidence',
  validTo: 'evidence',
  supersededAt: 'evidence',

  // TrustView fields
  baseEvidenceScore: 'trust',
  effectiveConfidence: 'trust',
  sourceFamily: 'trust',
  sourceFamilyCap: 'trust',
  collusionFlag: 'trust',
  hardPenalty: 'trust',
  timeConsistencyFactor: 'trust',
  retroactivePenalty: 'trust',
  shadowEffectiveConfidence: 'trust',
  shadowInfluenceScore: 'trust',
  normalizationMode: 'trust',
  dampingFactorUsed: 'trust',
  confidenceVersion: 'trust',
  confidenceInputsHash: 'trust',
  lastRecomputeAt: 'trust',
  recomputeReason: 'trust',

  // DecisionView fields
  lifecycleState: 'decision',
  adjudicationState: 'decision',
  adjudicationReason: 'decision',
  adjudicationComment: 'decision',
  approvalMode: 'decision',
  branchScope: 'decision',
  decisionHash: 'decision',
  gateVerdict: 'decision',
  requiresRevalidation: 'decision',
} as const;

// ─── Cross-View Boundary Rules ──────────────────────────────────────
//
// Defines which views may read from which other views,
// and through what mechanism (direct read vs transform function).

export interface ViewBoundaryRule {
  /** Source view providing data */
  from: VerificationView;
  /** Target view consuming data */
  to: VerificationView;
  /** How data crosses the boundary */
  mechanism: 'direct_read' | 'transform_function' | 'prohibited';
  /** Human-readable rationale */
  rationale: string;
}

/**
 * Canonical cross-view boundary rules.
 * 'prohibited' means no data flow is allowed in that direction.
 * 'transform_function' means data must pass through an explicit function.
 * 'direct_read' means the target view may read source view fields directly.
 */
export const CROSS_VIEW_BOUNDARIES: readonly ViewBoundaryRule[] = [
  // Provenance is readable by all views (append-only source of truth)
  { from: 'provenance', to: 'evidence', mechanism: 'direct_read', rationale: 'Evidence needs to know where observations came from' },
  { from: 'provenance', to: 'trust', mechanism: 'direct_read', rationale: 'Trust computation needs provenance metadata (sourceKind, toolVersion)' },
  { from: 'provenance', to: 'decision', mechanism: 'direct_read', rationale: 'Decisions reference provenance for audit trail' },

  // Evidence feeds Trust and Decision via transforms only
  { from: 'evidence', to: 'trust', mechanism: 'transform_function', rationale: 'Trust scores are computed FROM evidence, not copied' },
  { from: 'evidence', to: 'decision', mechanism: 'transform_function', rationale: 'Decisions are derived FROM evidence, not direct reads' },
  { from: 'evidence', to: 'provenance', mechanism: 'prohibited', rationale: 'Evidence must not alter provenance (append-only)' },

  // Trust feeds Decision via transform only
  { from: 'trust', to: 'decision', mechanism: 'transform_function', rationale: 'Gate verdicts are computed FROM trust scores' },
  { from: 'trust', to: 'provenance', mechanism: 'prohibited', rationale: 'Trust must not alter provenance (append-only)' },
  { from: 'trust', to: 'evidence', mechanism: 'prohibited', rationale: 'Trust must not alter evidence observations' },

  // Decision feeds nothing — it's the terminal view
  { from: 'decision', to: 'provenance', mechanism: 'prohibited', rationale: 'Decision must not alter provenance' },
  { from: 'decision', to: 'evidence', mechanism: 'prohibited', rationale: 'Decision must not alter evidence' },
  { from: 'decision', to: 'trust', mechanism: 'prohibited', rationale: 'Decision must not alter trust scores' },
] as const;

/**
 * Check whether a cross-view data flow is allowed.
 * Returns the boundary rule (or undefined if no rule exists — treat as prohibited).
 */
export function checkViewBoundary(from: VerificationView, to: VerificationView): ViewBoundaryRule | undefined {
  return CROSS_VIEW_BOUNDARIES.find(r => r.from === from && r.to === to);
}

/**
 * Returns true if `from` view is allowed to write/mutate fields in `to` view.
 * Only 'direct_read' and 'transform_function' are allowed — 'prohibited' returns false.
 */
export function isViewFlowAllowed(from: VerificationView, to: VerificationView): boolean {
  if (from === to) return true; // same-view mutations are always allowed
  const rule = checkViewBoundary(from, to);
  return rule !== undefined && rule.mechanism !== 'prohibited';
}

/**
 * Validate that a set of field mutations only touches fields within the specified view.
 * Returns an array of violations (empty = valid).
 */
export function validateViewMutation(
  actingView: VerificationView,
  fieldNames: string[],
): Array<{ field: string; owningView: VerificationView; actingView: VerificationView }> {
  const violations: Array<{ field: string; owningView: VerificationView; actingView: VerificationView }> = [];
  for (const field of fieldNames) {
    const owningView = VIEW_FIELD_REGISTRY[field];
    if (owningView && owningView !== actingView) {
      // Direct field mutation across views is ALWAYS prohibited.
      // Even 'transform_function' boundaries require using executeViewTransform(),
      // not direct field assignment. Only same-view mutations are free.
      violations.push({ field, owningView, actingView });
    }
  }
  return violations;
}
