/**
 * AUD-TC-11c-L2-02: enforcement-gate.ts — Supplementary Audit Tests
 *
 * Verdict: ADEQUATE — existing rf2-enforcement-gate.spec-test.ts covers 8/10 behaviors well.
 * These supplementary tests fill the 2 minor gaps:
 *   - DEFAULT_CONFIG actual value verification
 *   - computeRiskSummary standalone (called directly, not through evaluateEnforcementGate)
 *   - computeDecisionHash edge cases
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateEnforcementGate,
  computeRiskSummary,
  computeDecisionHash,
  DEFAULT_CONFIG,
  type EnforcementGateConfig,
  type AffectedNode,
  type RiskSummary,
  type EnforcementResult,
  type EnforcementDecision,
  type GateMode,
  type WaiverPolicy,
  type ApprovalRequirement,
} from '../../enforcement/enforcement-gate.js';

describe('AUD-TC-11c-L2-02: DEFAULT_CONFIG contract verification', () => {
  it('DEFAULT_CONFIG has mode=advisory (safe default)', () => {
    expect(DEFAULT_CONFIG.mode).toBe('advisory');
  });

  it('DEFAULT_CONFIG enables critical blocking', () => {
    expect(DEFAULT_CONFIG.criticalBlocksWithoutApproval).toBe(true);
  });

  it('DEFAULT_CONFIG enables untested-critical blocking', () => {
    expect(DEFAULT_CONFIG.untestedCriticalAlwaysBlocks).toBe(true);
  });

  it('DEFAULT_CONFIG approvalTtlMs is 1 hour', () => {
    expect(DEFAULT_CONFIG.approvalTtlMs).toBe(3600_000);
  });

  it('DEFAULT_CONFIG has no waiverPolicy by default', () => {
    expect(DEFAULT_CONFIG.waiverPolicy).toBeUndefined();
  });
});

describe('AUD-TC-11c-L2-02: computeRiskSummary standalone', () => {
  it('empty array yields zero summary', () => {
    const summary = computeRiskSummary([]);
    expect(summary.totalAffected).toBe(0);
    expect(summary.criticalCount).toBe(0);
    expect(summary.highCount).toBe(0);
    expect(summary.untestedCriticalCount).toBe(0);
    expect(summary.maxCompositeRisk).toBe(0);
  });

  it('single CRITICAL untested node', () => {
    const summary = computeRiskSummary([
      mockNode({ riskTier: 'CRITICAL', compositeRisk: 0.95, hasTests: false }),
    ]);
    expect(summary.totalAffected).toBe(1);
    expect(summary.criticalCount).toBe(1);
    expect(summary.untestedCriticalCount).toBe(1);
    expect(summary.maxCompositeRisk).toBe(0.95);
  });

  it('CRITICAL with tests does not count as untested', () => {
    const summary = computeRiskSummary([
      mockNode({ riskTier: 'CRITICAL', compositeRisk: 0.9, hasTests: true }),
    ]);
    expect(summary.untestedCriticalCount).toBe(0);
    expect(summary.criticalCount).toBe(1);
  });

  it('maxCompositeRisk selects highest value', () => {
    const summary = computeRiskSummary([
      mockNode({ compositeRisk: 0.1 }),
      mockNode({ compositeRisk: 0.99 }),
      mockNode({ compositeRisk: 0.5 }),
    ]);
    expect(summary.maxCompositeRisk).toBe(0.99);
  });
});

describe('AUD-TC-11c-L2-02: computeDecisionHash edge cases', () => {
  it('hash is 16 hex chars (truncated SHA256)', () => {
    const hash = computeDecisionHash('advisory', 'ALLOW', []);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('same mode+decision+different nodes → different hash', () => {
    const h1 = computeDecisionHash('enforced', 'BLOCK', [
      mockNode({ id: 'a', riskTier: 'CRITICAL', hasTests: false }),
    ]);
    const h2 = computeDecisionHash('enforced', 'BLOCK', [
      mockNode({ id: 'b', riskTier: 'CRITICAL', hasTests: true }),
    ]);
    expect(h1).not.toBe(h2);
  });

  it('different mode with same decision and nodes → different hash', () => {
    const nodes = [mockNode({ riskTier: 'LOW' })];
    const h1 = computeDecisionHash('advisory', 'ALLOW', nodes);
    const h2 = computeDecisionHash('assisted', 'ALLOW', nodes);
    expect(h1).not.toBe(h2);
  });
});

describe('AUD-TC-11c-L2-02: EnforcementResult shape verification', () => {
  it('result includes all required fields', () => {
    const result = evaluateEnforcementGate(DEFAULT_CONFIG, []);
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('affectedNodes');
    expect(result).toHaveProperty('riskSummary');
    expect(result).toHaveProperty('decisionHash');
    expect(result).toHaveProperty('timestamp');
  });

  it('timestamp is valid ISO string', () => {
    const result = evaluateEnforcementGate(DEFAULT_CONFIG, []);
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});

describe('AUD-TC-11c-L2-02: Type export verification', () => {
  it('all type exports are accessible', () => {
    // These verify that the types compile and are importable
    const config: EnforcementGateConfig = { ...DEFAULT_CONFIG };
    const node: AffectedNode = mockNode({});
    const summary: RiskSummary = computeRiskSummary([]);
    const decision: EnforcementDecision = 'ALLOW';
    const mode: GateMode = 'advisory';
    const waiver: WaiverPolicy = { maxWaiverDurationMs: 1000, requiresJustification: true };

    expect(config).toBeDefined();
    expect(node).toBeDefined();
    expect(summary).toBeDefined();
    expect(decision).toBe('ALLOW');
    expect(mode).toBe('advisory');
    expect(waiver.requiresJustification).toBe(true);
  });
});

// ─── Helpers ───

function mockNode(overrides: Partial<AffectedNode> = {}): AffectedNode {
  return {
    id: overrides.id ?? `node_${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? 'testFn',
    filePath: '/test/file.ts',
    riskTier: 'LOW',
    compositeRisk: 0.1,
    hasTests: true,
    ...overrides,
  };
}
