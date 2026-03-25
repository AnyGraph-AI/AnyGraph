/**
 * AUD-TC-11c-L1-05 + AUD-TC-11c-L1-06: Barrel Export Smoke Tests
 *
 * Spec source: enforcement/index.ts (19 lines) + ground-truth/index.ts (10 lines)
 *
 * COVERAGE_POLICY_EXCEPTION: barrel-reexport-only files.
 * Verify all named exports resolve correctly — import smoke test sufficient.
 */
import { describe, it, expect } from 'vitest';

// ─── enforcement/index.ts (AUD-TC-11c-L1-05) ────────────────────────────────

describe('AUD-TC-11c | enforcement/index.ts barrel exports', () => {
  it('re-exports all named value exports from enforcement-gate', async () => {
    const mod = await import('../../../core/enforcement/index.js');

    // Value exports
    expect(typeof mod.evaluateEnforcementGate).toBe('function');
    expect(typeof mod.computeRiskSummary).toBe('function');
    expect(typeof mod.computeDecisionHash).toBe('function');
    expect(mod.DEFAULT_CONFIG).toBeDefined();
    expect(typeof mod.DEFAULT_CONFIG).toBe('object');
  });

  it('re-exports resolveAffectedNodes and resolveBlastRadius from graph-resolver', async () => {
    const mod = await import('../../../core/enforcement/index.js');

    expect(typeof mod.resolveAffectedNodes).toBe('function');
    expect(typeof mod.resolveBlastRadius).toBe('function');
  });
});

// ─── ground-truth/index.ts (AUD-TC-11c-L1-06) ───────────────────────────────

describe('AUD-TC-11c | ground-truth/index.ts barrel exports', () => {
  it('re-exports from all declared source modules', async () => {
    const mod = await import('../../../core/ground-truth/index.js');

    // Spot-check representative exports from each source module.
    // types.js — all type exports, no runtime values to check
    // pack-interface.js — interface-only, no runtime values

    // runtime.js
    expect(typeof mod.GroundTruthRuntime).toBe('function');

    // delta.js
    expect(typeof mod.computeDelta).toBe('function');

    // session-bookmark.js
    expect(typeof mod.SessionBookmarkManager).toBe('function');

    // warn-enforcement.js
    expect(typeof mod.checkBookmarkWarnings).toBe('function');

    // observed-events.js
    expect(typeof mod.emitTouched).toBe('function');

    // integrity-persistence.js
    expect(typeof mod.IntegrityPersistence).toBe('function');

    // integrity-hypothesis-generator.js
    expect(typeof mod.IntegrityHypothesisGenerator).toBe('function');
  });

  it('re-exports SoftwareGovernancePack from packs/software.js', async () => {
    const mod = await import('../../../core/ground-truth/index.js');

    expect(typeof mod.SoftwareGovernancePack).toBe('function');
  });
});
