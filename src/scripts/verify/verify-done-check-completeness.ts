/**
 * verify-done-check-completeness.ts
 *
 * Post-run completeness contract probe. Runs AFTER integrity:verify to assert
 * the graph is fully populated with required enrichment edges and properties.
 *
 * AUD-TC-16 Gap 3: A done-check can exit 0 with incomplete enrichment state
 * (0 ANALYZED edges, missing confidenceScore, missing riskTier, etc.) because
 * integrity:verify only checks node/edge count drift, not enrichment completeness.
 *
 * This script catches:
 *   - enrich:vr-scope silently skipped (ANALYZED = 0)
 *   - enrich:precompute-scores partial failure (SourceFiles missing confidenceScore)
 *   - enrich:composite-risk partial failure (Functions missing riskTier)
 *   - enrich:possible-calls silently failed (POSSIBLE_CALL = 0)
 *   - Catastrophically low confidence (avgConf < 0.15)
 *
 * Usage: npx tsx src/scripts/verify/verify-done-check-completeness.ts
 * Output: JSON to stdout with { ok, checks, failures }
 * Exit: 0 if all pass, 1 if any fail
 */
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

const PROJECT_ID = 'proj_c0d3e9a1f200';
const CONFIDENCE_FLOOR = 0.15;

export interface CheckResult {
  name: string;
  passed: boolean;
  value: number | string;
  threshold?: number | string;
  message?: string;
}

export interface CompletenessResult {
  ok: boolean;
  checks: CheckResult[];
  failures: string[];
}

export interface CompletenessQueries {
  analyzedCount(): Promise<number>;
  missingConfidenceCount(): Promise<number>;
  missingRiskTierCount(): Promise<number>;
  possibleCallCount(): Promise<number>;
  avgConfidence(): Promise<number>;
}

export function createNeo4jQueries(neo4j: Neo4jService): CompletenessQueries {
  return {
    async analyzedCount(): Promise<number> {
      const rows = await neo4j.run(`MATCH ()-[r:ANALYZED]->() RETURN count(r) as n`);
      return Number(rows[0]?.n ?? 0);
    },

    async missingConfidenceCount(): Promise<number> {
      const rows = await neo4j.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE NOT coalesce(sf.productionRiskExcluded, false)
           AND sf.confidenceScore IS NULL
         RETURN count(sf) as n`,
        { pid: PROJECT_ID },
      );
      return Number(rows[0]?.n ?? 0);
    },

    async missingRiskTierCount(): Promise<number> {
      const rows = await neo4j.run(
        `MATCH (f:Function {projectId: $pid})
         WHERE f.riskTier IS NULL
         RETURN count(f) as n`,
        { pid: PROJECT_ID },
      );
      return Number(rows[0]?.n ?? 0);
    },

    async possibleCallCount(): Promise<number> {
      const rows = await neo4j.run(
        `MATCH ()-[r:POSSIBLE_CALL {projectId: $pid}]->()
         RETURN count(r) as n`,
        { pid: PROJECT_ID },
      );
      return Number(rows[0]?.n ?? 0);
    },

    async avgConfidence(): Promise<number> {
      const rows = await neo4j.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE NOT coalesce(sf.productionRiskExcluded, false)
           AND sf.confidenceScore IS NOT NULL
         RETURN round(avg(sf.confidenceScore), 3) as avgConf`,
        { pid: PROJECT_ID },
      );
      const val = rows[0]?.avgConf;
      return val === null || val === undefined ? 0 : Number(val);
    },
  };
}

export async function runCompletenessChecks(
  queries: CompletenessQueries,
): Promise<CompletenessResult> {
  const checks: CheckResult[] = [];
  const failures: string[] = [];

  // Check 1: ANALYZED edges > 0
  const analyzedCount = await queries.analyzedCount();
  const analyzedPassed = analyzedCount > 0;
  checks.push({
    name: 'ANALYZED_EDGES',
    passed: analyzedPassed,
    value: analyzedCount,
    threshold: '> 0',
    message: analyzedPassed
      ? `${analyzedCount} ANALYZED edges present`
      : 'ANALYZED edges = 0 — enrich:vr-scope did not complete',
  });
  if (!analyzedPassed) {
    failures.push('ANALYZED edges = 0 — enrich:vr-scope did not complete');
  }

  // Check 2: SourceFile confidenceScore completeness
  const missingConfCount = await queries.missingConfidenceCount();
  const confPassed = missingConfCount === 0;
  checks.push({
    name: 'SOURCEFILE_CONFIDENCE',
    passed: confPassed,
    value: missingConfCount,
    threshold: '= 0',
    message: confPassed
      ? 'All non-excluded SourceFiles have confidenceScore'
      : `${missingConfCount} SourceFiles missing confidenceScore — enrich:precompute-scores incomplete`,
  });
  if (!confPassed) {
    failures.push(
      `${missingConfCount} SourceFiles missing confidenceScore — enrich:precompute-scores incomplete`,
    );
  }

  // Check 3: Function riskTier completeness
  const missingRiskTierCount = await queries.missingRiskTierCount();
  const riskTierPassed = missingRiskTierCount === 0;
  checks.push({
    name: 'FUNCTION_RISKTIER',
    passed: riskTierPassed,
    value: missingRiskTierCount,
    threshold: '= 0',
    message: riskTierPassed
      ? 'All Functions have riskTier'
      : `${missingRiskTierCount} Functions missing riskTier — enrich:composite-risk incomplete`,
  });
  if (!riskTierPassed) {
    failures.push(
      `${missingRiskTierCount} Functions missing riskTier — enrich:composite-risk incomplete`,
    );
  }

  // Check 4: POSSIBLE_CALL edges > 0
  const possibleCallCount = await queries.possibleCallCount();
  const possibleCallPassed = possibleCallCount > 0;
  checks.push({
    name: 'POSSIBLE_CALL_EDGES',
    passed: possibleCallPassed,
    value: possibleCallCount,
    threshold: '> 0',
    message: possibleCallPassed
      ? `${possibleCallCount} POSSIBLE_CALL edges present`
      : 'POSSIBLE_CALL edges = 0 — enrich:possible-calls did not complete',
  });
  if (!possibleCallPassed) {
    failures.push('POSSIBLE_CALL edges = 0 — enrich:possible-calls did not complete');
  }

  // Check 5: avgConf floor
  const avgConf = await queries.avgConfidence();
  const avgConfPassed = avgConf >= CONFIDENCE_FLOOR;
  checks.push({
    name: 'AVG_CONFIDENCE_FLOOR',
    passed: avgConfPassed,
    value: avgConf,
    threshold: `>= ${CONFIDENCE_FLOOR}`,
    message: avgConfPassed
      ? `avgConf = ${avgConf} (above floor)`
      : `avgConf = ${avgConf} — catastrophically low, graph state suspect`,
  });
  if (!avgConfPassed) {
    failures.push(`avgConf = ${avgConf} — catastrophically low, graph state suspect`);
  }

  return {
    ok: failures.length === 0,
    checks,
    failures,
  };
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const queries = createNeo4jQueries(neo4j);
    const result = await runCompletenessChecks(queries);

    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } finally {
    await neo4j.getDriver().close();
  }
}

// Run if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        checks: [],
        failures: [error instanceof Error ? error.message : String(error)],
      }),
    );
    process.exit(1);
  });
}
