/**
 * RF-15: Verify riskTier ownership contract.
 *
 * Contract:
 * - riskTier is produced by GC-5 composite-risk scoring.
 * - top composite band (>= p95) MUST NOT collapse to LOW-only.
 *
 * This catches legacy writers that overwrite riskTier via absolute thresholds.
 */

import neo4j from 'neo4j-driver';

interface Violation {
  projectId: string;
  topBand: number;
  lowInTopBand: number;
  nonLowInTopBand: number;
}

function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (v && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

export async function verifyRiskTierOwnership(driver: InstanceType<typeof neo4j.Driver>): Promise<{
  checked: number;
  violations: Violation[];
}> {
  const session = driver.session();
  try {
    const projectsRes = await session.run(
      `MATCH (p:Project)
       WHERE p.projectId STARTS WITH 'proj_'
         AND EXISTS { MATCH (:Function {projectId: p.projectId}) }
       RETURN p.projectId AS projectId
       ORDER BY p.projectId`,
    );

    const projectIds = projectsRes.records.map((r) => r.get('projectId') as string);
    const violations: Violation[] = [];

    for (const projectId of projectIds) {
      const r = await session.run(
        `MATCH (f:Function {projectId: $projectId})
         WHERE f.compositeRisk IS NOT NULL
         WITH percentileDisc(f.compositeRisk, 0.95) AS p95
         MATCH (f:Function {projectId: $projectId})
         WHERE f.compositeRisk IS NOT NULL AND f.compositeRisk >= p95
         RETURN count(f) AS topBand,
                sum(CASE WHEN f.riskTier = 'LOW' THEN 1 ELSE 0 END) AS lowInTopBand,
                sum(CASE WHEN f.riskTier IN ['MEDIUM','HIGH','CRITICAL'] THEN 1 ELSE 0 END) AS nonLowInTopBand`,
        { projectId },
      );

      const row = r.records[0];
      if (!row) continue;

      const topBand = toNum(row.get('topBand'));
      const lowInTopBand = toNum(row.get('lowInTopBand'));
      const nonLowInTopBand = toNum(row.get('nonLowInTopBand'));

      if (topBand > 0 && nonLowInTopBand === 0) {
        violations.push({ projectId, topBand, lowInTopBand, nonLowInTopBand });
      }
    }

    return { checked: projectIds.length, violations };
  } finally {
    await session.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );

  try {
    const { checked, violations } = await verifyRiskTierOwnership(driver);
    console.log(`[risk-tier-ownership] Checked ${checked} code project(s)`);

    if (violations.length === 0) {
      console.log('[risk-tier-ownership] ✅ PASS: top composite band has non-LOW tiers in all projects');
      process.exit(0);
    }

    console.error('[risk-tier-ownership] ❌ FAIL: riskTier clobber detected (top composite band collapsed to LOW-only)');
    for (const v of violations) {
      console.error(`  - ${v.projectId}: topBand=${v.topBand}, low=${v.lowInTopBand}, nonLow=${v.nonLowInTopBand}`);
    }
    process.exit(1);
  } finally {
    await driver.close();
  }
}
