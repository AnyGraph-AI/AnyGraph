/**
 * RF-1: Four-View Structural Separation Tests
 *
 * Verifies that the verification schema correctly classifies fields into
 * ProvenanceView, EvidenceView, TrustView, and DecisionView, and that
 * cross-view mutation boundaries are enforced.
 */
import { describe, it, expect } from 'vitest';
import {
  VerificationViewSchema,
  ProvenanceViewSchema,
  EvidenceViewSchema,
  TrustViewSchema,
  DecisionViewSchema,
  VIEW_FIELD_REGISTRY,
  CROSS_VIEW_BOUNDARIES,
  checkViewBoundary,
  isViewFlowAllowed,
  validateViewMutation,
  type VerificationView,
} from '../../../verification/verification-schema.js';
import {
  enforceMutationBoundary,
  classifyFieldsByView,
  executeViewTransform,
  ViewMutationError,
  describeViewBoundaries,
  type ViewTransform,
} from '../../../verification/view-enforcement.js';

describe('RF-1: Four-View Structural Separation', () => {
  // ─── View Enum ────────────────────────────────────────────────
  describe('VerificationView enum', () => {
    it('defines exactly four views', () => {
      const views = VerificationViewSchema.options;
      expect(views).toHaveLength(4);
      expect(views).toContain('provenance');
      expect(views).toContain('evidence');
      expect(views).toContain('trust');
      expect(views).toContain('decision');
    });
  });

  // ─── Per-View Schemas ─────────────────────────────────────────
  describe('ProvenanceView schema', () => {
    it('accepts valid provenance data', () => {
      const result = ProvenanceViewSchema.safeParse({
        sourceKind: 'typeChecker',
        toolVersion: '5.4.0',
        attestationRef: 'sha256:abc123',
      });
      expect(result.success).toBe(true);
    });

    it('requires sourceKind', () => {
      const result = ProvenanceViewSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects invalid sourceKind values', () => {
      const result = ProvenanceViewSchema.safeParse({ sourceKind: 'magic' });
      expect(result.success).toBe(false);
    });
  });

  describe('EvidenceView schema', () => {
    it('accepts valid evidence data with defaults', () => {
      const result = EvidenceViewSchema.parse({});
      expect(result.status).toBe('unknown');
    });

    it('accepts full evidence data', () => {
      const result = EvidenceViewSchema.safeParse({
        status: 'satisfies',
        criticality: 'high',
        evidenceGrade: 'A1',
        freshnessTs: '2026-03-14T22:00:00Z',
        reproducible: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('TrustView schema', () => {
    it('accepts valid trust data', () => {
      const result = TrustViewSchema.safeParse({
        baseEvidenceScore: 0.8,
        effectiveConfidence: 0.72,
        hardPenalty: 0.9,
        timeConsistencyFactor: 1.0,
        confidenceVersion: 3,
      });
      expect(result.success).toBe(true);
    });

    it('rejects out-of-range confidence values', () => {
      const result = TrustViewSchema.safeParse({ effectiveConfidence: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('DecisionView schema', () => {
    it('accepts valid decision data', () => {
      const result = DecisionViewSchema.safeParse({
        lifecycleState: 'active',
        gateVerdict: 'pass',
        requiresRevalidation: false,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid gate verdicts', () => {
      const result = DecisionViewSchema.safeParse({ gateVerdict: 'maybe' });
      expect(result.success).toBe(false);
    });
  });

  // ─── VIEW_FIELD_REGISTRY ──────────────────────────────────────
  describe('VIEW_FIELD_REGISTRY', () => {
    it('maps every ProvenanceView field to provenance', () => {
      const provenanceFields = Object.keys(ProvenanceViewSchema.shape);
      for (const field of provenanceFields) {
        expect(VIEW_FIELD_REGISTRY[field]).toBe('provenance');
      }
    });

    it('maps every EvidenceView field to evidence', () => {
      const evidenceFields = Object.keys(EvidenceViewSchema.shape);
      for (const field of evidenceFields) {
        expect(VIEW_FIELD_REGISTRY[field]).toBe('evidence');
      }
    });

    it('maps every TrustView field to trust', () => {
      const trustFields = Object.keys(TrustViewSchema.shape);
      for (const field of trustFields) {
        expect(VIEW_FIELD_REGISTRY[field]).toBe('trust');
      }
    });

    it('maps every DecisionView field to decision', () => {
      const decisionFields = Object.keys(DecisionViewSchema.shape);
      for (const field of decisionFields) {
        expect(VIEW_FIELD_REGISTRY[field]).toBe('decision');
      }
    });

    it('has no overlapping fields between views', () => {
      const allSchemaFields = [
        ...Object.keys(ProvenanceViewSchema.shape),
        ...Object.keys(EvidenceViewSchema.shape),
        ...Object.keys(TrustViewSchema.shape),
        ...Object.keys(DecisionViewSchema.shape),
      ];
      const unique = new Set(allSchemaFields);
      expect(unique.size).toBe(allSchemaFields.length);
    });
  });

  // ─── Cross-View Boundaries ────────────────────────────────────
  describe('CROSS_VIEW_BOUNDARIES', () => {
    it('defines exactly 12 boundary rules (all pairs)', () => {
      expect(CROSS_VIEW_BOUNDARIES).toHaveLength(12);
    });

    it('provenance is readable by all downstream views', () => {
      expect(checkViewBoundary('provenance', 'evidence')?.mechanism).toBe('direct_read');
      expect(checkViewBoundary('provenance', 'trust')?.mechanism).toBe('direct_read');
      expect(checkViewBoundary('provenance', 'decision')?.mechanism).toBe('direct_read');
    });

    it('evidence feeds trust and decision via transform only', () => {
      expect(checkViewBoundary('evidence', 'trust')?.mechanism).toBe('transform_function');
      expect(checkViewBoundary('evidence', 'decision')?.mechanism).toBe('transform_function');
    });

    it('trust feeds decision via transform only', () => {
      expect(checkViewBoundary('trust', 'decision')?.mechanism).toBe('transform_function');
    });

    it('no view can write back to provenance', () => {
      expect(checkViewBoundary('evidence', 'provenance')?.mechanism).toBe('prohibited');
      expect(checkViewBoundary('trust', 'provenance')?.mechanism).toBe('prohibited');
      expect(checkViewBoundary('decision', 'provenance')?.mechanism).toBe('prohibited');
    });

    it('decision is terminal — cannot feed any other view', () => {
      expect(checkViewBoundary('decision', 'provenance')?.mechanism).toBe('prohibited');
      expect(checkViewBoundary('decision', 'evidence')?.mechanism).toBe('prohibited');
      expect(checkViewBoundary('decision', 'trust')?.mechanism).toBe('prohibited');
    });
  });

  // ─── isViewFlowAllowed ────────────────────────────────────────
  describe('isViewFlowAllowed', () => {
    it('allows same-view mutations', () => {
      expect(isViewFlowAllowed('trust', 'trust')).toBe(true);
      expect(isViewFlowAllowed('evidence', 'evidence')).toBe(true);
    });

    it('allows provenance reads by all', () => {
      expect(isViewFlowAllowed('provenance', 'evidence')).toBe(true);
      expect(isViewFlowAllowed('provenance', 'trust')).toBe(true);
    });

    it('blocks prohibited flows', () => {
      expect(isViewFlowAllowed('decision', 'trust')).toBe(false);
      expect(isViewFlowAllowed('trust', 'evidence')).toBe(false);
    });
  });

  // ─── validateViewMutation ─────────────────────────────────────
  describe('validateViewMutation', () => {
    it('returns no violations for same-view fields', () => {
      const violations = validateViewMutation('trust', [
        'effectiveConfidence',
        'hardPenalty',
        'baseEvidenceScore',
      ]);
      expect(violations).toHaveLength(0);
    });

    it('returns violations when trust tries to mutate evidence fields', () => {
      const violations = validateViewMutation('trust', [
        'effectiveConfidence',
        'status', // evidence field!
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0].field).toBe('status');
      expect(violations[0].owningView).toBe('evidence');
      expect(violations[0].actingView).toBe('trust');
    });

    it('returns violations when decision tries to mutate provenance', () => {
      const violations = validateViewMutation('decision', [
        'gateVerdict',
        'sourceKind', // provenance field!
      ]);
      expect(violations).toHaveLength(1);
      expect(violations[0].field).toBe('sourceKind');
    });

    it('ignores unknown fields (not in registry)', () => {
      const violations = validateViewMutation('trust', [
        'effectiveConfidence',
        'someCustomField', // not in registry
      ]);
      expect(violations).toHaveLength(0);
    });
  });

  // ─── enforceMutationBoundary ──────────────────────────────────
  describe('enforceMutationBoundary', () => {
    it('does not throw for valid same-view mutations', () => {
      expect(() => {
        enforceMutationBoundary('evidence', ['status', 'criticality', 'evidenceGrade']);
      }).not.toThrow();
    });

    it('throws ViewMutationError for cross-view violations', () => {
      expect(() => {
        enforceMutationBoundary('evidence', ['status', 'effectiveConfidence']);
      }).toThrow(ViewMutationError);
    });

    it('throws with detailed violation info', () => {
      try {
        enforceMutationBoundary('decision', ['gateVerdict', 'baseEvidenceScore', 'sourceKind']);
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ViewMutationError);
        const err = e as ViewMutationError;
        expect(err.violations).toHaveLength(2);
        expect(err.violations.map(v => v.field).sort()).toEqual(['baseEvidenceScore', 'sourceKind']);
      }
    });
  });

  // ─── classifyFieldsByView ─────────────────────────────────────
  describe('classifyFieldsByView', () => {
    it('correctly classifies mixed fields', () => {
      const result = classifyFieldsByView([
        'sourceKind', 'status', 'effectiveConfidence', 'gateVerdict', 'unknownField',
      ]);
      expect(result.provenance).toEqual(['sourceKind']);
      expect(result.evidence).toEqual(['status']);
      expect(result.trust).toEqual(['effectiveConfidence']);
      expect(result.decision).toEqual(['gateVerdict']);
      expect(result.unknown).toEqual(['unknownField']);
    });
  });

  // ─── executeViewTransform ─────────────────────────────────────
  describe('executeViewTransform', () => {
    it('allows evidence → trust transforms', () => {
      const transform: ViewTransform<{ status: string }, { baseEvidenceScore: number }> = {
        fromView: 'evidence',
        toView: 'trust',
        name: 'evidence-to-trust-score',
        transform: (input) => ({
          baseEvidenceScore: input.status === 'satisfies' ? 0.9 : 0.1,
        }),
      };
      const result = executeViewTransform(transform, { status: 'satisfies' });
      expect(result.baseEvidenceScore).toBe(0.9);
    });

    it('allows trust → decision transforms', () => {
      const transform: ViewTransform<{ effectiveConfidence: number }, { gateVerdict: string }> = {
        fromView: 'trust',
        toView: 'decision',
        name: 'trust-to-gate-verdict',
        transform: (input) => ({
          gateVerdict: input.effectiveConfidence >= 0.7 ? 'pass' : 'fail',
        }),
      };
      const result = executeViewTransform(transform, { effectiveConfidence: 0.8 });
      expect(result.gateVerdict).toBe('pass');
    });

    it('throws for prohibited transforms (decision → trust)', () => {
      const badTransform: ViewTransform<Record<string, unknown>, Record<string, unknown>> = {
        fromView: 'decision',
        toView: 'trust',
        name: 'illegal-decision-to-trust',
        transform: () => ({}),
      };
      expect(() => executeViewTransform(badTransform, {})).toThrow(ViewMutationError);
    });

    it('throws for direct_read-only boundaries used as transform (provenance → evidence)', () => {
      // provenance → evidence is direct_read, NOT transform_function
      // You can READ provenance from evidence context, but not TRANSFORM into it
      const transform: ViewTransform<Record<string, unknown>, Record<string, unknown>> = {
        fromView: 'provenance',
        toView: 'evidence',
        name: 'provenance-to-evidence-transform',
        transform: () => ({}),
      };
      expect(() => executeViewTransform(transform, {})).toThrow(ViewMutationError);
    });
  });

  // ─── describeViewBoundaries ───────────────────────────────────
  describe('describeViewBoundaries', () => {
    it('produces readable output with all 12 rules', () => {
      const output = describeViewBoundaries();
      expect(output).toContain('provenance → evidence');
      expect(output).toContain('decision → trust');
      expect(output).toContain('prohibited');
      expect(output).toContain('transform_function');
      expect(output).toContain('direct_read');
    });
  });
});
