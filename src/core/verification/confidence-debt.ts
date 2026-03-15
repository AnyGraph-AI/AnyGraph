/**
 * TC-5: Confidence Debt Prioritization
 *
 * Confidence debt = gap between required and effective confidence.
 * High-debt entities are the best investigation targets.
 *
 * debt = max(0, requiredConfidence - effectiveConfidence)
 *
 * Aggregation views: per-task, per-gate, per-project.
 * Dashboard output: thresholded alert flags.
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

// ── Types ───────────────────────────────────────────────────────────

export interface DebtRecord {
  id: string;
  name: string;
  kind: string;
  requiredConfidence: number;
  effectiveConfidence: number;
  confidenceDebt: number;
}

export interface DebtAggregation {
  level: 'task' | 'gate' | 'project';
  id: string;
  name: string;
  totalDebt: number;
  avgDebt: number;
  maxDebt: number;
  entityCount: number;
  highDebtCount: number;
}

export interface DebtDashboard {
  projectId: string;
  totalEntities: number;
  entitiesWithDebt: number;
  totalDebt: number;
  avgDebt: number;
  maxDebt: number;
  highDebtThreshold: number;
  highDebtEntities: DebtRecord[];
  aggregations: DebtAggregation[];
  alerts: string[];
  durationMs: number;
}

export interface DebtConfig {
  /** Default required confidence for entities without explicit requirement. Default: 0.7 */
  defaultRequired: number;
  /** Threshold above which debt is "high". Default: 0.3 */
  highDebtThreshold: number;
  /** Max high-debt entities to include in dashboard. Default: 20 */
  maxHighDebt: number;
}

const DEFAULT_CONFIG: DebtConfig = {
  defaultRequired: 0.7,
  highDebtThreshold: 0.3,
  maxHighDebt: 20,
};

// ── Debt Computation ────────────────────────────────────────────────

/**
 * Stamp debt fields on VerificationRun nodes that have temporal factors.
 */
export async function computeConfidenceDebt(
  neo4j: Neo4jService,
  projectId: string,
  config: DebtConfig = DEFAULT_CONFIG,
): Promise<{ stamped: number }> {
  const result = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.timeConsistencyFactor IS NOT NULL
     SET r.requiredConfidence = coalesce(r.requiredConfidence, $defaultRequired),
         r.effectiveConfidence = coalesce(r.effectiveConfidence,
           r.timeConsistencyFactor * coalesce(r.retroactivePenalty, 1.0)),
         r.confidenceDebt = CASE
           WHEN coalesce(r.requiredConfidence, $defaultRequired) >
                coalesce(r.effectiveConfidence,
                  r.timeConsistencyFactor * coalesce(r.retroactivePenalty, 1.0))
           THEN coalesce(r.requiredConfidence, $defaultRequired) -
                coalesce(r.effectiveConfidence,
                  r.timeConsistencyFactor * coalesce(r.retroactivePenalty, 1.0))
           ELSE 0.0
         END
     RETURN count(r) AS stamped`,
    { projectId, defaultRequired: config.defaultRequired },
  );

  return { stamped: Number(result[0]?.stamped ?? 0) };
}

// ── Debt Dashboard ──────────────────────────────────────────────────

export async function generateDebtDashboard(
  neo4j: Neo4jService,
  projectId: string,
  config: DebtConfig = DEFAULT_CONFIG,
): Promise<DebtDashboard> {
  const start = Date.now();

  // First stamp debt
  await computeConfidenceDebt(neo4j, projectId, config);

  // Fetch all entities with debt info
  const rows = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.confidenceDebt IS NOT NULL
     RETURN r.id AS id, r.tool AS name, 'VerificationRun' AS kind,
            r.requiredConfidence AS required,
            r.effectiveConfidence AS effective,
            r.confidenceDebt AS debt
     ORDER BY r.confidenceDebt DESC`,
    { projectId },
  );

  const records: DebtRecord[] = rows.map(r => ({
    id: r.id as string,
    name: (r.name as string) ?? r.id as string,
    kind: r.kind as string,
    requiredConfidence: r.required as number,
    effectiveConfidence: r.effective as number,
    confidenceDebt: r.debt as number,
  }));

  const withDebt = records.filter(r => r.confidenceDebt > 0);
  const highDebt = records.filter(r => r.confidenceDebt >= config.highDebtThreshold);
  const totalDebt = records.reduce((s, r) => s + r.confidenceDebt, 0);
  const avgDebt = records.length > 0 ? totalDebt / records.length : 0;
  const maxDebt = records.length > 0 ? Math.max(...records.map(r => r.confidenceDebt)) : 0;

  // Project-level aggregation
  const projectAgg: DebtAggregation = {
    level: 'project',
    id: projectId,
    name: projectId,
    totalDebt,
    avgDebt,
    maxDebt,
    entityCount: records.length,
    highDebtCount: highDebt.length,
  };

  // Alerts
  const alerts: string[] = [];
  if (maxDebt >= 0.5) alerts.push(`Critical: max confidence debt ${maxDebt.toFixed(3)} (entity: ${records[0]?.id})`);
  if (highDebt.length > records.length * 0.3) {
    alerts.push(`Warning: ${highDebt.length}/${records.length} entities (${(highDebt.length / records.length * 100).toFixed(0)}%) above high-debt threshold`);
  }
  if (avgDebt > 0.2) alerts.push(`Warning: average debt ${avgDebt.toFixed(3)} exceeds 0.2`);

  return {
    projectId,
    totalEntities: records.length,
    entitiesWithDebt: withDebt.length,
    totalDebt,
    avgDebt,
    maxDebt,
    highDebtThreshold: config.highDebtThreshold,
    highDebtEntities: highDebt.slice(0, config.maxHighDebt),
    aggregations: [projectAgg],
    alerts,
    durationMs: Date.now() - start,
  };
}

// ── Governance: Debt fields in canonical output ─────────────────────

export async function verifyDebtFieldPresence(
  neo4j: Neo4jService,
  projectId: string,
): Promise<{ ok: boolean; missingDebt: number; total: number }> {
  const rows = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.effectiveConfidence IS NOT NULL AND r.confidenceDebt IS NULL
     RETURN count(r) AS missing`,
    { projectId },
  );
  const total = await neo4j.run(
    `MATCH (r:VerificationRun {projectId: $projectId})
     WHERE r.effectiveConfidence IS NOT NULL
     RETURN count(r) AS cnt`,
    { projectId },
  );

  const missing = Number(rows[0]?.missing ?? 0);
  const cnt = Number(total[0]?.cnt ?? 0);

  return { ok: missing === 0, missingDebt: missing, total: cnt };
}
