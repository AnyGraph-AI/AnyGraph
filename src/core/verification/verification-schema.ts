import { z } from 'zod';

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

export const VerificationFoundationBundleSchema = z.object({
  projectId: z.string().min(1),
  verificationRuns: z.array(VerificationRunSchema).default([]),
  analysisScopes: z.array(AnalysisScopeSchema).default([]),
  adjudications: z.array(AdjudicationRecordSchema).default([]),
});

export type VerificationRun = z.infer<typeof VerificationRunSchema>;
export type AnalysisScope = z.infer<typeof AnalysisScopeSchema>;
export type AdjudicationRecord = z.infer<typeof AdjudicationRecordSchema>;
export type VerificationFoundationBundle = z.infer<typeof VerificationFoundationBundleSchema>;
