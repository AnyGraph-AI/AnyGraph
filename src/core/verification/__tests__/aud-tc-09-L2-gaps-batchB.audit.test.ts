/**
 * AUD-TC-09 L2 Gap-Fill Tests — Batch B
 *
 * Gap-fills for behaviors not covered by existing tests.
 * B6 (Health Witness) review.
 */
import { describe, it, expect } from 'vitest';

// ─── Gap 1: view-enforcement.ts — validateRunViewPartition ──────────
// Existing tests cover enforceMutationBoundary, classifyFieldsByView, executeViewTransform,
// describeViewBoundaries — but validateRunViewPartition is untested.

import {
  validateRunViewPartition,
  classifyFieldsByView,
} from '../view-enforcement.js';
import {
  VIEW_FIELD_REGISTRY,
} from '../verification-schema.js';

describe('view-enforcement.ts — validateRunViewPartition gap-fill', () => {
  it('returns valid=true for system-level ingest with fields from multiple views', () => {
    const result = validateRunViewPartition({
      status: 'satisfies',           // evidence
      effectiveConfidence: 0.9,      // trust
      lifecycleState: 'active',      // decision
      sourceKind: 'typeChecker',     // provenance
    });
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.viewCounts.evidence).toBe(1);
    expect(result.viewCounts.trust).toBe(1);
    expect(result.viewCounts.decision).toBe(1);
    expect(result.viewCounts.provenance).toBe(1);
  });

  it('excludes id/projectId/createdAt/updatedAt/tool from view classification', () => {
    const result = validateRunViewPartition({
      id: 'vr:test:1',
      projectId: 'proj_test',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      tool: 'test-tool',
      status: 'satisfies',
    });
    // Only 'status' should be counted — the excluded fields are not classified
    expect(result.viewCounts.evidence).toBe(1);
    expect(result.viewCounts.provenance).toBe(0);
    expect(result.viewCounts.trust).toBe(0);
    expect(result.viewCounts.decision).toBe(0);
  });

  it('counts unknown fields (not in VIEW_FIELD_REGISTRY) under unknown', () => {
    const result = validateRunViewPartition({
      status: 'satisfies',
      customField: 'custom-value',
    });
    expect(result.viewCounts.unknown).toBe(1);
  });

  it('handles empty props (no fields)', () => {
    const result = validateRunViewPartition({});
    expect(result.valid).toBe(true);
    expect(result.viewCounts.evidence).toBe(0);
    expect(result.viewCounts.trust).toBe(0);
    expect(result.viewCounts.decision).toBe(0);
    expect(result.viewCounts.provenance).toBe(0);
  });
});

// ─── Gap 2: runtime-trace-schema.ts — rejection of invalid enum values ──────
// Existing tests validate acceptance of valid values but some rejection paths
// are only partially covered.

import {
  RuntimeTraceNodeTypeSchema,
  RuntimeTraceEdgeTypeSchema,
  RuntimeTraceMetadataSchema,
  RuntimeTraceEnvelopeSchema,
  RuntimeRetentionPolicySchema,
} from '../runtime-trace-schema.js';

describe('runtime-trace-schema.ts — validation rejection gap-fill', () => {
  it('rejects invalid RuntimeTraceNodeType values', () => {
    expect(RuntimeTraceNodeTypeSchema.safeParse('Agent').success).toBe(false);
    expect(RuntimeTraceNodeTypeSchema.safeParse('').success).toBe(false);
    expect(RuntimeTraceNodeTypeSchema.safeParse(123).success).toBe(false);
  });

  it('rejects invalid RuntimeTraceEdgeType values', () => {
    expect(RuntimeTraceEdgeTypeSchema.safeParse('CONNECTS').success).toBe(false);
    expect(RuntimeTraceEdgeTypeSchema.safeParse('').success).toBe(false);
  });

  it('rejects RuntimeTraceEnvelope with missing required fields', () => {
    // Missing id
    expect(RuntimeTraceEnvelopeSchema.safeParse({
      projectId: 'proj',
      nodeType: 'Decision',
      metadata: { sessionKey: 's', turnId: 't', timestamp: '2026-01-01T00:00:00Z', model: 'm' },
    }).success).toBe(false);

    // Missing metadata
    expect(RuntimeTraceEnvelopeSchema.safeParse({
      id: 'trace:1',
      projectId: 'proj',
      nodeType: 'Decision',
    }).success).toBe(false);

    // Invalid nodeType
    expect(RuntimeTraceEnvelopeSchema.safeParse({
      id: 'trace:1',
      projectId: 'proj',
      nodeType: 'InvalidType',
      metadata: { sessionKey: 's', turnId: 't', timestamp: '2026-01-01T00:00:00Z', model: 'm' },
    }).success).toBe(false);
  });

  it('rejects RuntimeTraceMetadata with invalid timestamp format', () => {
    expect(RuntimeTraceMetadataSchema.safeParse({
      sessionKey: 's',
      turnId: 't',
      timestamp: 'not-a-date',
      model: 'm',
    }).success).toBe(false);
  });

  it('rejects RuntimeRetentionPolicy with negative days', () => {
    expect(RuntimeRetentionPolicySchema.safeParse({
      hotWindowDays: -1,
      aggregateWindowDays: 365,
      aggregateBucket: 'day',
      summarizeAfterDays: 30,
      dropRawAfterDays: 90,
    }).success).toBe(false);
  });

  it('rejects RuntimeTraceMetadata with negative latencyMs', () => {
    expect(RuntimeTraceMetadataSchema.safeParse({
      sessionKey: 's',
      turnId: 't',
      timestamp: '2026-01-01T00:00:00Z',
      model: 'm',
      latencyMs: -100,
    }).success).toBe(false);
  });
});

// ─── Gap 3: verification-schema.ts — AdjudicationRecordSchema accepts optional fields ──
// Existing tests validate required fields but don't test optional field omission.

import {
  AdjudicationRecordSchema,
  PathWitnessSchema,
  VerificationRunSchema,
} from '../verification-schema.js';

describe('verification-schema.ts — optional field gap-fill', () => {
  it('AdjudicationRecordSchema accepts minimal required fields only', () => {
    const result = AdjudicationRecordSchema.safeParse({
      id: 'adj:1',
      projectId: 'proj',
      targetNodeId: 'vr:1',
      adjudicationState: 'open',
      adjudicationReason: 'false_positive',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requiresRevalidation).toBe(false); // default
      expect(result.data.ticketRef).toBeUndefined();
      expect(result.data.approvalMode).toBeUndefined();
    }
  });

  it('PathWitnessSchema defaults witnessType to relatedLocations', () => {
    const result = PathWitnessSchema.safeParse({
      id: 'pw:1',
      projectId: 'proj',
      verificationRunId: 'vr:1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.witnessType).toBe('relatedLocations');
    }
  });

  it('VerificationRunSchema rejects confidence > 1', () => {
    const result = VerificationRunSchema.safeParse({
      id: 'vr:1',
      projectId: 'proj',
      tool: 'test',
      confidence: 2.0,
    });
    expect(result.success).toBe(false);
  });

  it('VerificationRunSchema rejects confidence < 0', () => {
    const result = VerificationRunSchema.safeParse({
      id: 'vr:1',
      projectId: 'proj',
      tool: 'test',
      confidence: -0.5,
    });
    expect(result.success).toBe(false);
  });
});
