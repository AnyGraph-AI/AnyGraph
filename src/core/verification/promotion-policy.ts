/**
 * TC-8: Promotion Policy Wiring
 *
 * Policy modes for the confidence engine:
 *   - advisory: shadow runs, no enforcement, results logged
 *   - assisted: shadow informs, human decides, decision logged
 *   - enforced: shadow confidence becomes production after gate pass
 *
 * Each promotion decision is materialized with lineage for replay.
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createHash } from 'crypto';

// ── Types ───────────────────────────────────────────────────────────

export type PolicyMode = 'advisory' | 'assisted' | 'enforced';

export interface PromotionDecision {
  decisionId: string;
  projectId: string;
  mode: PolicyMode;
  promotionEligible: boolean;
  evaluatedAt: string;
  decisionHash: string;
  brierProd: number;
  brierShadow: number;
  governancePass: boolean;
  antiGamingPass: boolean;
  calibrationPass: boolean;
  promoted: boolean;
  reason: string;
}

export interface PromotionPolicyConfig {
  /** Current policy mode. Default: 'advisory' */
  mode: PolicyMode;
  /** Whether to actually promote shadow→production when enforced. Default: false */
  enableEnforcement: boolean;
}

const DEFAULT_CONFIG: PromotionPolicyConfig = {
  mode: 'advisory',
  enableEnforcement: false,
};

// ── Decision Hash ───────────────────────────────────────────────────

function hashDecision(
  projectId: string,
  mode: PolicyMode,
  eligible: boolean,
  brierProd: number,
  brierShadow: number,
): string {
  const payload = JSON.stringify({ projectId, mode, eligible, brierProd, brierShadow });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

// ── Evaluate Promotion ──────────────────────────────────────────────

export interface PromotionInputs {
  projectId: string;
  brierProd: number;
  brierShadow: number;
  governancePass: boolean;
  antiGamingPass: boolean;
  calibrationPass: boolean;
}

export function evaluatePromotion(
  inputs: PromotionInputs,
  config: PromotionPolicyConfig = DEFAULT_CONFIG,
): PromotionDecision {
  const now = new Date().toISOString();
  const eligible = inputs.calibrationPass && inputs.governancePass && inputs.antiGamingPass;

  let promoted = false;
  let reason: string;

  switch (config.mode) {
    case 'advisory':
      reason = eligible ? 'Eligible (advisory mode — no promotion)' : 'Not eligible';
      break;
    case 'assisted':
      reason = eligible ? 'Eligible (assisted mode — human decision required)' : 'Not eligible';
      break;
    case 'enforced':
      if (eligible && config.enableEnforcement) {
        promoted = true;
        reason = 'Promoted (enforced mode)';
      } else if (eligible) {
        reason = 'Eligible but enforcement disabled';
      } else {
        reason = 'Not eligible for promotion';
      }
      break;
  }

  const decisionHash = hashDecision(
    inputs.projectId, config.mode, eligible,
    inputs.brierProd, inputs.brierShadow,
  );

  return {
    decisionId: `promo:${inputs.projectId}:${Date.now()}`,
    projectId: inputs.projectId,
    mode: config.mode,
    promotionEligible: eligible,
    evaluatedAt: now,
    decisionHash,
    brierProd: inputs.brierProd,
    brierShadow: inputs.brierShadow,
    governancePass: inputs.governancePass,
    antiGamingPass: inputs.antiGamingPass,
    calibrationPass: inputs.calibrationPass,
    promoted,
    reason,
  };
}

// ── Persist Decision ────────────────────────────────────────────────

export async function persistPromotionDecision(
  neo4j: Neo4jService,
  decision: PromotionDecision,
): Promise<void> {
  await neo4j.run(
    `MERGE (d:PromotionDecision {decisionId: $decisionId})
     SET d += $props,
         d.projectId = $projectId,
         d.updatedAt = toString(datetime())`,
    {
      decisionId: decision.decisionId,
      projectId: decision.projectId,
      props: {
        mode: decision.mode,
        promotionEligible: decision.promotionEligible,
        evaluatedAt: decision.evaluatedAt,
        decisionHash: decision.decisionHash,
        brierProd: decision.brierProd,
        brierShadow: decision.brierShadow,
        governancePass: decision.governancePass,
        antiGamingPass: decision.antiGamingPass,
        calibrationPass: decision.calibrationPass,
        promoted: decision.promoted,
        reason: decision.reason,
      },
    },
  );

  // If promoted in enforced mode, copy shadow→production
  if (decision.promoted) {
    await neo4j.run(
      `MATCH (r:VerificationRun {projectId: $projectId})
       WHERE r.shadowEffectiveConfidence IS NOT NULL
       SET r.effectiveConfidence = r.shadowEffectiveConfidence,
           r.promotionEligible = true,
           r.promotionEvaluatedAt = $evaluatedAt,
           r.promotionDecisionHash = $decisionHash`,
      {
        projectId: decision.projectId,
        evaluatedAt: decision.evaluatedAt,
        decisionHash: decision.decisionHash,
      },
    );
  }
}

// ── Governance: enforced mode requires calibration pass ──────────────

export function validatePolicyTransition(
  currentMode: PolicyMode,
  targetMode: PolicyMode,
  calibrationPass: boolean,
): { ok: boolean; reason: string } {
  if (targetMode === 'enforced' && !calibrationPass) {
    return { ok: false, reason: 'Cannot transition to enforced without passing calibration gate (TC-7)' };
  }
  if (targetMode === 'enforced' && currentMode === 'advisory') {
    return { ok: false, reason: 'Cannot skip assisted mode: advisory → assisted → enforced' };
  }
  return { ok: true, reason: 'Transition allowed' };
}
