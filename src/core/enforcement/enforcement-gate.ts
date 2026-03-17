/**
 * RF-2: Temporal-First Enforcement Gate
 *
 * Core decision engine for edit gating. Queries the graph for affected nodes,
 * evaluates risk, and returns ALLOW / REQUIRE_APPROVAL / BLOCK.
 *
 * Pattern from: gate-evaluator.ts (evaluateGate → classifyChange → getRequiredLanes → resolveGateMode)
 * Schema from: invariant-registry-schema.ts (EnforcementMode), change-class-matrix.ts (ChangeClass)
 * Replay from: gate-decision-packet-schema.ts (GateDecisionPacket, ReplayContract)
 */

import { createHash } from 'crypto';

// ─── Types ───

export type EnforcementDecision = 'ALLOW' | 'BLOCK' | 'REQUIRE_APPROVAL';
export type GateMode = 'advisory' | 'assisted' | 'enforced';
export type ApproverRole = 'human' | 'senior-agent';

export interface AffectedNode {
  id: string;
  name: string;
  filePath: string;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  compositeRisk: number;
  hasTests: boolean;
}

export interface RiskSummary {
  totalAffected: number;
  criticalCount: number;
  highCount: number;
  untestedCriticalCount: number;
  maxCompositeRisk: number;
}

export interface ApprovalRequirement {
  reason: string;
  requiredApprover: ApproverRole;
  affectedCriticalNodes: string[];
  expiresAt?: string;
}

export interface EnforcementResult {
  decision: EnforcementDecision;
  reason: string;
  affectedNodes: AffectedNode[];
  riskSummary: RiskSummary;
  approvalRequired?: ApprovalRequirement;
  decisionHash: string;
  timestamp: string;
}

export interface WaiverPolicy {
  maxWaiverDurationMs: number;
  requiresJustification: boolean;
}

export interface EnforcementGateConfig {
  mode: GateMode;
  criticalBlocksWithoutApproval: boolean;
  untestedCriticalAlwaysBlocks: boolean;
  approvalTtlMs: number;
  waiverPolicy?: WaiverPolicy;
}

export const DEFAULT_CONFIG: EnforcementGateConfig = {
  mode: 'advisory',
  criticalBlocksWithoutApproval: true,
  untestedCriticalAlwaysBlocks: true,
  approvalTtlMs: 3600_000, // 1 hour
};

// ─── Core Decision Logic ───

export function computeRiskSummary(nodes: AffectedNode[]): RiskSummary {
  return {
    totalAffected: nodes.length,
    criticalCount: nodes.filter(n => n.riskTier === 'CRITICAL').length,
    highCount: nodes.filter(n => n.riskTier === 'HIGH').length,
    untestedCriticalCount: nodes.filter(n => n.riskTier === 'CRITICAL' && !n.hasTests).length,
    maxCompositeRisk: nodes.length > 0
      ? Math.max(...nodes.map(n => n.compositeRisk))
      : 0,
  };
}

export function computeDecisionHash(
  mode: GateMode,
  decision: EnforcementDecision,
  affectedNodes: AffectedNode[],
): string {
  const hashInput = JSON.stringify({
    mode,
    decision,
    affectedNodes: affectedNodes.map(n => ({
      id: n.id,
      riskTier: n.riskTier,
      hasTests: n.hasTests,
    })),
  });
  return createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
}

/**
 * Evaluate the enforcement gate for a set of affected nodes.
 *
 * Decision ladder:
 *   1. advisory → always ALLOW (existing behavior, regression-safe)
 *   2. enforced + untested CRITICAL → BLOCK
 *   3. enforced/assisted + CRITICAL → REQUIRE_APPROVAL
 *   4. everything else → ALLOW
 */
export function evaluateEnforcementGate(
  config: EnforcementGateConfig,
  affectedNodes: AffectedNode[],
): EnforcementResult {
  const riskSummary = computeRiskSummary(affectedNodes);
  const now = new Date();

  let decision: EnforcementDecision = 'ALLOW';
  let reason = 'No enforcement action needed';
  let approvalRequired: ApprovalRequirement | undefined;

  if (config.mode === 'advisory') {
    // Advisory: report only, never block. Existing contract.
    decision = 'ALLOW';
    reason = 'Advisory mode — reporting only';
  } else if (config.mode === 'enforced' || config.mode === 'assisted') {
    // Untested CRITICAL: hard block (enforced only)
    if (config.untestedCriticalAlwaysBlocks && riskSummary.untestedCriticalCount > 0) {
      decision = 'BLOCK';
      reason = `${riskSummary.untestedCriticalCount} CRITICAL function(s) in untested files — cannot proceed without test coverage`;
    }
    // Any CRITICAL: requires approval
    else if (config.criticalBlocksWithoutApproval && riskSummary.criticalCount > 0) {
      decision = 'REQUIRE_APPROVAL';
      reason = `${riskSummary.criticalCount} CRITICAL function(s) affected — approval required`;
      approvalRequired = {
        reason,
        requiredApprover: 'human',
        affectedCriticalNodes: affectedNodes
          .filter(n => n.riskTier === 'CRITICAL')
          .map(n => n.name),
        expiresAt: new Date(now.getTime() + config.approvalTtlMs).toISOString(),
      };
    }
  }

  const decisionHash = computeDecisionHash(config.mode, decision, affectedNodes);

  return {
    decision,
    reason,
    affectedNodes,
    riskSummary,
    approvalRequired,
    decisionHash,
    timestamp: now.toISOString(),
  };
}
