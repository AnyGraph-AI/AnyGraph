import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

export interface ExceptionEnforcementResult {
  waiversChecked: number;
  safetyCriticalWaiversChecked: number;
  safetyCriticalDualApprovalViolations: number;
  safetyCriticalMissingExpiryViolations: number;
  exceptionMissingTicketViolations: number;
  exceptionMissingApprovalModeViolations: number;
  exceptionMissingExpiryViolations: number;
  expiredWaivers: number;
  truthSeparationViolations: number;
}

const WAIVER_STATES = ['ignored', 'dismissed', 'provisionally_ignored'];

function toNum(value: unknown, fallback = 0): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * VG-4 Exception Enforcement Pass
 *
 * Enforces governance policies over AdjudicationRecord waivers:
 * 1) safety_critical waivers require dual approval + expiry
 * 2) exception hygiene requires ticket + approval mode + expiry
 * 3) waived violation remains a violation (truth/gate separation)
 */
export async function runExceptionEnforcement(projectId: string): Promise<ExceptionEnforcementResult> {
  const neo4j = new Neo4jService();

  try {
    const waivers = await neo4j.run(
      `MATCH (a:AdjudicationRecord {projectId: $projectId})
       WHERE a.adjudicationState IN $waiverStates
       SET a.isWaiver = true,
           a.waiverPolicyVersion = 'v1',
           a.policyCheckedAt = toString(datetime()),
           a.updatedAt = toString(datetime())
       RETURN count(a) AS c`,
      { projectId, waiverStates: WAIVER_STATES },
    );
    const waiversChecked = toNum(waivers[0]?.c);

    // Safety-critical policy: dual approval + expiry are required.
    const safetyPolicy = await neo4j.run(
      `MATCH (a:AdjudicationRecord {projectId: $projectId})-[:ADJUDICATES]->(v:VerificationRun {projectId: $projectId})
       WHERE a.isWaiver = true AND v.criticality = 'safety_critical'
       WITH a, v,
            (coalesce(a.approvalMode, '') = 'dual') AS hasDualApproval,
            (a.expiresAt IS NOT NULL) AS hasExpiry
       SET a.requiresDualApproval = true,
           a.requiresExpiry = true,
           a.policyCompliant = hasDualApproval AND hasExpiry,
           a.policyViolationReason = CASE
             WHEN (NOT hasDualApproval) AND (NOT hasExpiry) THEN 'missing_dual_approval_and_expiry'
             WHEN (NOT hasDualApproval) THEN 'missing_dual_approval'
             WHEN (NOT hasExpiry) THEN 'missing_expiry'
             ELSE null
           END,
           a.updatedAt = toString(datetime())
       RETURN count(a) AS checked,
              sum(CASE WHEN hasDualApproval THEN 0 ELSE 1 END) AS dualApprovalViolations,
              sum(CASE WHEN hasExpiry THEN 0 ELSE 1 END) AS missingExpiryViolations`,
      { projectId },
    );

    const safetyCriticalWaiversChecked = toNum(safetyPolicy[0]?.checked);
    const safetyCriticalDualApprovalViolations = toNum(safetyPolicy[0]?.dualApprovalViolations);
    const safetyCriticalMissingExpiryViolations = toNum(safetyPolicy[0]?.missingExpiryViolations);

    // General exception policy hygiene: ticket linkage + approval mode + expiry.
    const exceptionPolicy = await neo4j.run(
      `MATCH (a:AdjudicationRecord {projectId: $projectId})
       WHERE a.isWaiver = true
       WITH a,
            (trim(coalesce(a.ticketRef, '')) <> '') AS hasTicketRef,
            (trim(coalesce(a.approvalMode, '')) <> '') AS hasApprovalMode,
            (a.expiresAt IS NOT NULL) AS hasExpiry,
            (CASE
               WHEN a.expiresAt IS NULL THEN false
               WHEN a.expiresAt < toString(datetime()) THEN true
               ELSE false
             END) AS isExpired
       SET a.hasTicketRef = hasTicketRef,
           a.hasApprovalMode = hasApprovalMode,
           a.hasExpiry = hasExpiry,
           a.isExpired = isExpired,
           a.exceptionPolicyCompliant = hasTicketRef AND hasApprovalMode AND hasExpiry,
           a.updatedAt = toString(datetime())
       RETURN sum(CASE WHEN hasTicketRef THEN 0 ELSE 1 END) AS missingTicket,
              sum(CASE WHEN hasApprovalMode THEN 0 ELSE 1 END) AS missingApprovalMode,
              sum(CASE WHEN hasExpiry THEN 0 ELSE 1 END) AS missingExpiry,
              sum(CASE WHEN isExpired THEN 1 ELSE 0 END) AS expiredWaivers`,
      { projectId },
    );

    const exceptionMissingTicketViolations = toNum(exceptionPolicy[0]?.missingTicket);
    const exceptionMissingApprovalModeViolations = toNum(exceptionPolicy[0]?.missingApprovalMode);
    const exceptionMissingExpiryViolations = toNum(exceptionPolicy[0]?.missingExpiry);
    const expiredWaivers = toNum(exceptionPolicy[0]?.expiredWaivers);

    // Truth/gate separation: waivers may change gate outcome, never truth status.
    const truthSeparation = await neo4j.run(
      `MATCH (a:AdjudicationRecord {projectId: $projectId})-[:ADJUDICATES]->(v:VerificationRun {projectId: $projectId})
       WHERE a.isWaiver = true
       WITH a, v,
            (v.status = 'violates') AS isViolation,
            coalesce(a.exceptionPolicyCompliant, false) AS waiverCompliant
       SET a.truthSeparationViolation = (NOT isViolation),
           a.truthSeparationReason = CASE WHEN isViolation THEN null ELSE 'waiver_targets_non_violating_finding' END,
           v.truthStatus = CASE WHEN v.status = 'violates' THEN 'violates' ELSE coalesce(v.truthStatus, v.status) END,
           v.gateOutcome = CASE
             WHEN isViolation AND waiverCompliant THEN 'waived_violation'
             WHEN isViolation AND NOT waiverCompliant THEN 'blocked_violation'
             ELSE coalesce(v.gateOutcome, 'adjudicated_non_violation')
           END,
           v.updatedAt = toString(datetime())
       RETURN sum(CASE WHEN isViolation THEN 0 ELSE 1 END) AS truthSeparationViolations`,
      { projectId },
    );

    const truthSeparationViolations = toNum(truthSeparation[0]?.truthSeparationViolations);

    return {
      waiversChecked,
      safetyCriticalWaiversChecked,
      safetyCriticalDualApprovalViolations,
      safetyCriticalMissingExpiryViolations,
      exceptionMissingTicketViolations,
      exceptionMissingApprovalModeViolations,
      exceptionMissingExpiryViolations,
      expiredWaivers,
      truthSeparationViolations,
    };
  } finally {
    await neo4j.close();
  }
}
