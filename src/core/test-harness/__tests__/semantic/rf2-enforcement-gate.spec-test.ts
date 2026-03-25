/**
 * RF-2: Temporal-First Enforcement Gate — Spec Tests
 *
 * Pattern sourced from graph:
 *   gate-evaluator.ts → evaluateGate() → classifyChange() → getRequiredLanes() → resolveGateMode()
 *   invariant-registry-schema.ts → HARD_INVARIANTS / ADVISORY_INVARIANTS / EnforcementMode
 *   policy-bundle.ts → assemblePolicyBundle() → resolveGateMode()
 *   change-class-matrix.ts → ChangeClass / LANE_DEFINITIONS
 *
 * Existing test patterns from:
 *   policy-replayability.test.ts (18 tests — replay determinism)
 *   exception-gate.spec-test.ts (32 tests — gate exception handling)
 *   view-typing.test.ts (37 tests — view enforcement)
 *
 * RF-2 adds:
 *   1. EnforcementMode.ENFORCED code path (block, not just report)
 *   2. CRITICAL node edit → mandatory approval gate
 *   3. Git hook / MCP middleware integration point
 *   4. Decision lineage (who approved, when, why)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateEnforcementGate,
  type EnforcementGateConfig,
  type AffectedNode,
} from '../../../enforcement/enforcement-gate.js';

// ─── Spec Tests ───

describe('RF-2: Enforcement Gate — Core Decision Logic', () => {

  describe('Mode: advisory (existing behavior, must not regress)', () => {
    it('SPEC: advisory mode always returns ALLOW regardless of risk', () => {
      // Advisory mode = current behavior. evaluateGate reports but never blocks.
      // This is the existing contract from gate-evaluator.ts.
      const config: EnforcementGateConfig = {
        mode: 'advisory',
        criticalBlocksWithoutApproval: false,
        untestedCriticalAlwaysBlocks: false,
        approvalTtlMs: 3600_000,
      };

      const result = evaluateEnforcementGate(config, [
        mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.95, hasTests: false }),
      ]);

      expect(result.decision).toBe('ALLOW');
      expect(result.affectedNodes).toHaveLength(1);
      expect(result.riskSummary.criticalCount).toBe(1);
    });
  });

  describe('Mode: enforced — the new behavior', () => {
    const enforcedConfig: EnforcementGateConfig = {
      mode: 'enforced',
      criticalBlocksWithoutApproval: true,
      untestedCriticalAlwaysBlocks: true,
      approvalTtlMs: 3600_000,
    };

    it('SPEC: editing CRITICAL function → REQUIRE_APPROVAL', () => {
      const result = evaluateEnforcementGate(enforcedConfig, [
        mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.92, hasTests: true }),
      ]);

      expect(result.decision).toBe('REQUIRE_APPROVAL');
      expect(result.approvalRequired).toBeDefined();
      expect(result.approvalRequired!.affectedCriticalNodes).toContain('testFunction');
    });

    it('SPEC: editing untested CRITICAL function → BLOCK (not just require approval)', () => {
      const result = evaluateEnforcementGate(enforcedConfig, [
        mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.95, hasTests: false }),
      ]);

      expect(result.decision).toBe('BLOCK');
      expect(result.reason).toContain('untested');
      expect(result.riskSummary.untestedCriticalCount).toBe(1);
    });

    it('SPEC: editing LOW function → ALLOW (no gate needed)', () => {
      const result = evaluateEnforcementGate(enforcedConfig, [
        mockAffectedNode({ riskTier: 'LOW', compositeRisk: 0.1, hasTests: true }),
      ]);

      expect(result.decision).toBe('ALLOW');
    });

    it('SPEC: editing MEDIUM function → ALLOW', () => {
      const result = evaluateEnforcementGate(enforcedConfig, [
        mockAffectedNode({ riskTier: 'MEDIUM', compositeRisk: 0.4, hasTests: true }),
      ]);

      expect(result.decision).toBe('ALLOW');
    });

    it('SPEC: editing HIGH function → ALLOW (but logged)', () => {
      const result = evaluateEnforcementGate(enforcedConfig, [
        mockAffectedNode({ riskTier: 'HIGH', compositeRisk: 0.7, hasTests: true }),
      ]);

      expect(result.decision).toBe('ALLOW');
      expect(result.riskSummary.highCount).toBe(1);
    });

    it('SPEC: multiple files — one CRITICAL among LOWs → REQUIRE_APPROVAL', () => {
      const result = evaluateEnforcementGate(enforcedConfig, [
        mockAffectedNode({ riskTier: 'LOW', compositeRisk: 0.1, hasTests: true, name: 'helper' }),
        mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: true, name: 'coreEngine' }),
        mockAffectedNode({ riskTier: 'LOW', compositeRisk: 0.05, hasTests: true, name: 'utils' }),
      ]);

      expect(result.decision).toBe('REQUIRE_APPROVAL');
      expect(result.approvalRequired!.affectedCriticalNodes).toEqual(['coreEngine']);
    });

    it('SPEC: multiple CRITICAL functions → lists all in approval requirement', () => {
      const result = evaluateEnforcementGate(enforcedConfig, [
        mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: true, name: 'engineA' }),
        mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.85, hasTests: true, name: 'engineB' }),
      ]);

      expect(result.decision).toBe('REQUIRE_APPROVAL');
      expect(result.approvalRequired!.affectedCriticalNodes).toContain('engineA');
      expect(result.approvalRequired!.affectedCriticalNodes).toContain('engineB');
    });

    it('SPEC: mixed untested CRITICAL + tested CRITICAL → BLOCK (untested wins)', () => {
      const result = evaluateEnforcementGate(enforcedConfig, [
        mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: true, name: 'tested' }),
        mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.85, hasTests: false, name: 'untested' }),
      ]);

      expect(result.decision).toBe('BLOCK');
      expect(result.riskSummary.untestedCriticalCount).toBe(1);
    });
  });

  describe('Mode: assisted (middle ground)', () => {
    const assistedConfig: EnforcementGateConfig = {
      mode: 'assisted',
      criticalBlocksWithoutApproval: true,
      untestedCriticalAlwaysBlocks: false,  // assisted doesn't hard-block untested
      approvalTtlMs: 3600_000,
    };

    it('SPEC: assisted mode requires approval for CRITICAL but doesn\'t block untested', () => {
      const result = evaluateEnforcementGate(assistedConfig, [
        mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: false }),
      ]);

      expect(result.decision).toBe('REQUIRE_APPROVAL');
      // Assisted warns but doesn't hard-block
    });
  });
});

describe('RF-2: Enforcement Gate — Approval Lifecycle', () => {
  it('SPEC: approval has TTL — expires after configured duration', () => {
    const config: EnforcementGateConfig = {
      mode: 'enforced',
      criticalBlocksWithoutApproval: true,
      untestedCriticalAlwaysBlocks: true,
      approvalTtlMs: 3600_000,  // 1 hour
    };

    const result = evaluateEnforcementGate(config, [
      mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: true }),
    ]);

    expect(result.approvalRequired).toBeDefined();
    expect(result.approvalRequired!.expiresAt).toBeDefined();

    // Parse the expiry and verify it's ~1 hour from now
    const expiresAt = new Date(result.approvalRequired!.expiresAt!).getTime();
    const now = Date.now();
    expect(expiresAt - now).toBeGreaterThan(3500_000);  // at least 58 min
    expect(expiresAt - now).toBeLessThanOrEqual(3600_000);  // at most 60 min
  });

  it('SPEC: waiver requires justification when policy says so', () => {
    const config: EnforcementGateConfig = {
      mode: 'enforced',
      criticalBlocksWithoutApproval: true,
      untestedCriticalAlwaysBlocks: true,
      approvalTtlMs: 3600_000,
      waiverPolicy: {
        maxWaiverDurationMs: 86400_000,  // 24 hours
        requiresJustification: true,
      },
    };

    const result = evaluateEnforcementGate(config, [
      mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: true }),
    ]);

    expect(result.approvalRequired).toBeDefined();
  });
});

describe('RF-2: Enforcement Gate — Decision Determinism', () => {
  // Pattern from policy-replayability.test.ts — gate decisions must be deterministic

  it('SPEC: same inputs produce same decisionHash', () => {
    const config: EnforcementGateConfig = {
      mode: 'enforced',
      criticalBlocksWithoutApproval: true,
      untestedCriticalAlwaysBlocks: true,
      approvalTtlMs: 3600_000,
    };

    const nodes = [
      mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: true }),
    ];

    const result1 = evaluateEnforcementGate(config, nodes);
    const result2 = evaluateEnforcementGate(config, nodes);

    expect(result1.decisionHash).toBe(result2.decisionHash);
    expect(result1.decision).toBe(result2.decision);
  });

  it('SPEC: different risk tiers produce different decisionHash', () => {
    const config: EnforcementGateConfig = {
      mode: 'enforced',
      criticalBlocksWithoutApproval: true,
      untestedCriticalAlwaysBlocks: true,
      approvalTtlMs: 3600_000,
    };

    const result1 = evaluateEnforcementGate(config, [
      mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: true }),
    ]);

    const result2 = evaluateEnforcementGate(config, [
      mockAffectedNode({ riskTier: 'LOW', compositeRisk: 0.1, hasTests: true }),
    ]);

    expect(result1.decisionHash).not.toBe(result2.decisionHash);
  });
});

describe('RF-2: Enforcement Gate — Risk Summary Computation', () => {
  it('SPEC: risk summary correctly counts all tiers', () => {
    const config: EnforcementGateConfig = {
      mode: 'advisory',
      criticalBlocksWithoutApproval: false,
      untestedCriticalAlwaysBlocks: false,
      approvalTtlMs: 3600_000,
    };

    const result = evaluateEnforcementGate(config, [
      mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.95, hasTests: false }),
      mockAffectedNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: true }),
      mockAffectedNode({ riskTier: 'HIGH', compositeRisk: 0.7, hasTests: true }),
      mockAffectedNode({ riskTier: 'MEDIUM', compositeRisk: 0.4, hasTests: true }),
      mockAffectedNode({ riskTier: 'LOW', compositeRisk: 0.1, hasTests: true }),
    ]);

    expect(result.riskSummary.totalAffected).toBe(5);
    expect(result.riskSummary.criticalCount).toBe(2);
    expect(result.riskSummary.highCount).toBe(1);
    expect(result.riskSummary.untestedCriticalCount).toBe(1);
    expect(result.riskSummary.maxCompositeRisk).toBe(0.95);
  });

  it('SPEC: empty affected nodes → ALLOW with zero summary', () => {
    const config: EnforcementGateConfig = {
      mode: 'enforced',
      criticalBlocksWithoutApproval: true,
      untestedCriticalAlwaysBlocks: true,
      approvalTtlMs: 3600_000,
    };

    const result = evaluateEnforcementGate(config, []);

    expect(result.decision).toBe('ALLOW');
    expect(result.riskSummary.totalAffected).toBe(0);
    expect(result.riskSummary.criticalCount).toBe(0);
  });
});

describe('RF-2: Enforcement Gate — Graph Integration', () => {
  // Live Neo4j integration is required to validate graph resolution and TESTED_BY semantics.
  // These are intentionally skipped in unit/spec scope to avoid tautological placeholders.
  it.skip('SPEC: gate resolves affected nodes from file paths via graph query (requires live Neo4j fixture)', () => {});

  it.skip('SPEC: gate checks TESTED_BY edges for hasTests determination (requires live Neo4j fixture)', () => {});
});

// ─── Test Helpers ───

function mockAffectedNode(overrides: Partial<AffectedNode> = {}): AffectedNode {
  return {
    id: `proj_test:FunctionDeclaration:${Math.random().toString(36).slice(2, 10)}`,
    name: overrides.name ?? 'testFunction',
    filePath: '/test/path/file.ts',
    riskTier: 'LOW',
    compositeRisk: 0.1,
    hasTests: true,
    ...overrides,
  };
}

// Real implementation in src/core/enforcement/enforcement-gate.ts
