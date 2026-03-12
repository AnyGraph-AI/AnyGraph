import { createHash } from 'node:crypto';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { runExceptionEnforcement } from './exception-enforcement.js';

export interface AdvisoryGateResult {
  runsEvaluated: number;
  advisoryPass: number;
  advisoryWarn: number;
  advisoryFail: number;
  decisionsLogged: number;
  replayabilityHashesWritten: number;
}

interface AdvisoryGateOptions {
  policyBundleId?: string;
  policyEngine?: string;
  runExceptionPolicyFirst?: boolean;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toNum(value: unknown, fallback = 0): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableJson(input: unknown): string {
  if (input === null || input === undefined || typeof input !== 'object') {
    return JSON.stringify(input);
  }
  if (Array.isArray(input)) {
    return '[' + input.map((item) => stableJson(item)).join(',') + ']';
  }
  const sortedKeys = Object.keys(input as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((key) => JSON.stringify(key) + ':' + stableJson((input as Record<string, unknown>)[key]));
  return '{' + pairs.join(',') + '}';
}

/**
 * VG-4: OPA/Rego advisory gate lane + decision-log linkage + replayability hash.
 *
 * Advisory means no hard blocking side-effects in CI/write paths. We only compute
 * decisions, link them to findings, and persist deterministic replay metadata.
 */
export async function runAdvisoryGate(
  projectId: string,
  options: AdvisoryGateOptions = {},
): Promise<AdvisoryGateResult> {
  const neo4j = new Neo4jService();

  try {
    if (options.runExceptionPolicyFirst !== false) {
      await runExceptionEnforcement(projectId);
    }

    const policyBundleId = options.policyBundleId ?? 'verification-gate-policy-v1';
    const policyEngine = options.policyEngine ?? 'opa_rego_advisory';
    const evaluatedAt = new Date().toISOString();

    const rows = (await neo4j.run(
      `MATCH (v:VerificationRun {projectId: $projectId})
       OPTIONAL MATCH (a:AdjudicationRecord {projectId: $projectId})-[:ADJUDICATES]->(v)
       WITH v,
            sum(CASE WHEN coalesce(a.isWaiver, false) THEN 1 ELSE 0 END) AS waiverCount,
            sum(CASE WHEN coalesce(a.isWaiver, false) AND coalesce(a.exceptionPolicyCompliant, false) AND coalesce(a.isExpired, false) = false THEN 1 ELSE 0 END) AS compliantWaiverCount,
            sum(CASE WHEN coalesce(a.isWaiver, false) AND (coalesce(a.exceptionPolicyCompliant, false) = false OR coalesce(a.isExpired, false) = true) THEN 1 ELSE 0 END) AS nonCompliantWaiverCount
       RETURN v.id AS runId,
              v.status AS status,
              v.criticality AS criticality,
              v.tool AS tool,
              v.ruleId AS ruleId,
              v.resultFingerprint AS resultFingerprint,
              v.runConfigHash AS runConfigHash,
              v.truthStatus AS truthStatus,
              waiverCount,
              compliantWaiverCount,
              nonCompliantWaiverCount`,
      { projectId },
    )) as Array<Record<string, unknown>>;

    let advisoryPass = 0;
    let advisoryWarn = 0;
    let advisoryFail = 0;
    let decisionsLogged = 0;
    let replayabilityHashesWritten = 0;

    for (const row of rows) {
      const runId = String(row.runId ?? '');
      if (!runId) continue;

      const status = String(row.status ?? 'unknown');
      const criticality = String(row.criticality ?? 'unknown');
      const tool = String(row.tool ?? 'unknown');
      const ruleId = String(row.ruleId ?? 'unknown');
      const resultFingerprint = String(row.resultFingerprint ?? '');
      const runConfigHash = String(row.runConfigHash ?? '');
      const truthStatus = String(row.truthStatus ?? status);

      const waiverCount = toNum(row.waiverCount);
      const compliantWaiverCount = toNum(row.compliantWaiverCount);
      const nonCompliantWaiverCount = toNum(row.nonCompliantWaiverCount);

      let advisoryOutcome = 'advisory_pass';
      let severity = 'low';
      let rationaleCode = 'satisfies_or_non_blocking';

      if (status === 'violates') {
        if (compliantWaiverCount > 0) {
          advisoryOutcome = 'advisory_warn_waived_violation';
          severity = criticality === 'safety_critical' ? 'high' : 'medium';
          rationaleCode = 'violates_with_compliant_waiver';
        } else {
          advisoryOutcome = 'advisory_fail_violation';
          severity = criticality === 'safety_critical' ? 'high' : 'medium';
          rationaleCode = 'violates_without_compliant_waiver';
        }
      } else if (status === 'unknown') {
        advisoryOutcome = 'advisory_warn_unknown';
        severity = 'medium';
        rationaleCode = 'unknown_truth_state';
      }

      if (nonCompliantWaiverCount > 0) {
        if (advisoryOutcome === 'advisory_pass') advisoryOutcome = 'advisory_warn_noncompliant_waiver';
        if (severity === 'low') severity = 'medium';
      }

      const contextPayload = {
        projectId,
        runId,
        policyEngine,
        policyBundleId,
        evaluatedAt,
        status,
        truthStatus,
        advisoryOutcome,
        severity,
        rationaleCode,
        criticality,
        tool,
        ruleId,
        resultFingerprint,
        runConfigHash,
        waiverCount,
        compliantWaiverCount,
        nonCompliantWaiverCount,
      };

      const contextJson = stableJson(contextPayload);
      const externalContextSnapshotRef = `ctx:${sha256(contextJson).slice(0, 32)}`;

      const decisionBasis = {
        ...contextPayload,
        externalContextSnapshotRef,
      };
      const decisionHash = `sha256:${sha256(stableJson(decisionBasis))}`;

      const decisionNodeId = `gate:${projectId}:${runId}:${decisionHash.slice(7, 27)}`;

      await neo4j.run(
        `MATCH (v:VerificationRun {id: $runId, projectId: $projectId})
         SET v.gateLane = 'advisory',
             v.policyEngine = $policyEngine,
             v.policyBundleId = $policyBundleId,
             v.advisoryOutcome = $advisoryOutcome,
             v.decisionHash = $decisionHash,
             v.externalContextSnapshotRef = $externalContextSnapshotRef,
             v.gateEvaluatedAt = $evaluatedAt,
             v.updatedAt = toString(datetime())
         MERGE (d:CodeNode:AdvisoryGateDecision {id: $decisionNodeId})
         SET d.projectId = $projectId,
             d.coreType = 'AdvisoryGateDecision',
             d.policyEngine = $policyEngine,
             d.policyBundleId = $policyBundleId,
             d.lane = 'advisory',
             d.outcome = $advisoryOutcome,
             d.severity = $severity,
             d.rationaleCode = $rationaleCode,
             d.decisionHash = $decisionHash,
             d.externalContextSnapshotRef = $externalContextSnapshotRef,
             d.contextJson = $contextJson,
             d.generatedAt = $evaluatedAt,
             d.updatedAt = toString(datetime())
         MERGE (d)-[e:ADVISES_ON]->(v)
         SET e.projectId = $projectId,
             e.updatedAt = toString(datetime())`,
        {
          runId,
          projectId,
          policyEngine,
          policyBundleId,
          advisoryOutcome,
          decisionHash,
          externalContextSnapshotRef,
          evaluatedAt,
          decisionNodeId,
          severity,
          rationaleCode,
          contextJson,
        },
      );

      if (advisoryOutcome.startsWith('advisory_pass')) advisoryPass++;
      else if (advisoryOutcome.startsWith('advisory_fail')) advisoryFail++;
      else advisoryWarn++;

      decisionsLogged++;
      replayabilityHashesWritten++;
    }

    return {
      runsEvaluated: rows.length,
      advisoryPass,
      advisoryWarn,
      advisoryFail,
      decisionsLogged,
      replayabilityHashesWritten,
    };
  } finally {
    await neo4j.close();
  }
}
