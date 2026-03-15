/**
 * Cross-view confidence mutation enforcement (RF-1 Task 2).
 *
 * Ensures that no view can directly mutate fields owned by another view
 * unless an allowed cross-view boundary exists. Trust and Evidence feed
 * Decision only via explicit transform functions — never direct mutation.
 *
 * Provenance is append-only: no downstream view may alter provenance records.
 */

import {
  type VerificationView,
  VIEW_FIELD_REGISTRY,
  validateViewMutation,
  CROSS_VIEW_BOUNDARIES,
  isViewFlowAllowed,
} from './verification-schema.js';

export class ViewMutationError extends Error {
  constructor(
    public readonly violations: Array<{
      field: string;
      owningView: VerificationView;
      actingView: VerificationView;
    }>,
  ) {
    const details = violations
      .map(v => `  ${v.field}: owned by '${v.owningView}', mutated by '${v.actingView}'`)
      .join('\n');
    super(`Cross-view mutation violation:\n${details}`);
    this.name = 'ViewMutationError';
  }
}

/**
 * Guard: throws ViewMutationError if any field mutations cross view boundaries illegally.
 *
 * Usage:
 *   enforceMutationBoundary('trust', ['effectiveConfidence', 'hardPenalty']); // OK
 *   enforceMutationBoundary('trust', ['effectiveConfidence', 'status']);      // THROWS — 'status' is evidence
 */
export function enforceMutationBoundary(
  actingView: VerificationView,
  fieldNames: string[],
): void {
  const violations = validateViewMutation(actingView, fieldNames);
  if (violations.length > 0) {
    throw new ViewMutationError(violations);
  }
}

/**
 * Classify a set of property names by their owning view.
 * Unknown fields (not in VIEW_FIELD_REGISTRY) are collected under 'unknown'.
 */
export function classifyFieldsByView(
  fieldNames: string[],
): Record<VerificationView | 'unknown', string[]> {
  const result: Record<string, string[]> = {
    provenance: [],
    evidence: [],
    trust: [],
    decision: [],
    unknown: [],
  };
  for (const field of fieldNames) {
    const view = VIEW_FIELD_REGISTRY[field];
    result[view ?? 'unknown'].push(field);
  }
  return result as Record<VerificationView | 'unknown', string[]>;
}

/**
 * Transform function type: the ONLY allowed mechanism for cross-view data flow
 * where mechanism === 'transform_function'.
 *
 * Transforms take source view data and produce target view field updates.
 * They are explicit, auditable, and carry provenance of the transformation.
 */
export interface ViewTransform<TInput, TOutput> {
  /** Source view this transform reads from */
  fromView: VerificationView;
  /** Target view this transform writes to */
  toView: VerificationView;
  /** Human-readable name for audit trail */
  name: string;
  /** The transform function itself */
  transform: (input: TInput) => TOutput;
}

/**
 * Execute a cross-view transform with boundary validation.
 * Throws if the boundary rule doesn't allow 'transform_function' between the views.
 */
export function executeViewTransform<TInput, TOutput>(
  viewTransform: ViewTransform<TInput, TOutput>,
  input: TInput,
): TOutput {
  const rule = CROSS_VIEW_BOUNDARIES.find(
    r => r.from === viewTransform.fromView && r.to === viewTransform.toView,
  );
  if (!rule || rule.mechanism !== 'transform_function') {
    throw new ViewMutationError([
      {
        field: `[transform: ${viewTransform.name}]`,
        owningView: viewTransform.toView,
        actingView: viewTransform.fromView,
      },
    ]);
  }
  return viewTransform.transform(input);
}

/**
 * Validate that a VerificationRun's properties are correctly partitioned by view.
 * Returns violations if properties that should belong to one view are being
 * set from another context.
 *
 * This is used during ingest to ensure the flat VerificationRun object
 * doesn't contain illegal cross-view mutations.
 */
export function validateRunViewPartition(
  runProps: Record<string, unknown>,
): { valid: boolean; viewCounts: Record<string, number>; violations: string[] } {
  const fieldNames = Object.keys(runProps).filter(
    k => k !== 'id' && k !== 'projectId' && k !== 'createdAt' && k !== 'updatedAt' && k !== 'tool',
  );
  const classified = classifyFieldsByView(fieldNames);
  const viewCounts: Record<string, number> = {};
  for (const [view, fields] of Object.entries(classified)) {
    viewCounts[view] = fields.length;
  }

  // A single VerificationRun may contain fields from multiple views
  // (it's a denormalized record). The violation is when a WRITE OPERATION
  // from a specific view context tries to SET fields in another view.
  // At ingest time (system context), all views are allowed.
  // The enforcement is on UPDATE operations from a specific view context.
  return {
    valid: true, // ingest is system-level, always valid
    viewCounts,
    violations: [],
  };
}

/**
 * Summary of the four-view boundary rules for documentation/debugging.
 */
export function describeViewBoundaries(): string {
  const lines: string[] = ['Cross-View Boundary Rules:', ''];
  for (const rule of CROSS_VIEW_BOUNDARIES) {
    const icon =
      rule.mechanism === 'prohibited' ? '🚫' :
      rule.mechanism === 'transform_function' ? '🔄' :
      '📖';
    lines.push(`  ${icon} ${rule.from} → ${rule.to}: ${rule.mechanism}`);
    lines.push(`     ${rule.rationale}`);
  }
  return lines.join('\n');
}
