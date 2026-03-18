import { NextResponse } from 'next/server';
import { cachedQuery } from '@/lib/neo4j';

/**
 * Lightweight diagnosis endpoint.
 * Runs key diagnostic queries against Neo4j directly.
 * For the full 39-check suite, use `npm run self-diagnosis` via CLI.
 */
export async function GET() {
  try {
    const checks = await Promise.all([
      // D1: Blind spots
      cachedQuery(
        `MATCH (u:UnresolvedReference {projectId: 'proj_c0d3e9a1f200'})
         WITH count(u) AS total, sum(CASE WHEN u.reason <> 'external-package' THEN 1 ELSE 0 END) AS local
         RETURN 'D1' AS id, 'Does the graph track its own blind spots?' AS question,
           total + ' UnresolvedRef nodes (' + local + ' local)' AS answer,
           true AS healthy,
           'Review local blind spots' AS nextStep`, {}
      ),
      // D6: Risk tiers current
      cachedQuery(
        `MATCH (f:Function {projectId: 'proj_c0d3e9a1f200'})
         WHERE f.riskTier IS NOT NULL
         WITH f.riskTier AS tier, count(f) AS cnt
         WITH collect({tier: tier, count: cnt}) AS tiers, sum(cnt) AS total
         RETURN 'D6' AS id, 'Are risk tiers current?' AS question,
           total + ' functions scored' AS answer,
           total > 0 AS healthy,
           'Run enrich:composite-risk if stale' AS nextStep`, {}
      ),
      // D15: CRITICAL functions tested
      cachedQuery(
        `MATCH (sf:SourceFile {projectId: 'proj_c0d3e9a1f200'})-[:CONTAINS]->(f:Function)
         WHERE f.riskTier = 'CRITICAL'
         OPTIONAL MATCH (sf)-[:TESTED_BY]->(tf)
         WITH count(DISTINCT f) AS totalCritical,
              sum(CASE WHEN tf IS NOT NULL THEN 1 ELSE 0 END) AS testedCritical
         RETURN 'D15' AS id, 'Are CRITICAL functions in tested files?' AS question,
           testedCritical + '/' + totalCritical + ' CRITICAL in tested files' AS answer,
           testedCritical > totalCritical * 0.5 AS healthy,
           'Improve test coverage for CRITICAL functions' AS nextStep`, {}
      ),
      // D19: Risk distribution healthy
      cachedQuery(
        `MATCH (f:Function {projectId: 'proj_c0d3e9a1f200'})
         WHERE f.riskTier IS NOT NULL
         WITH f.riskTier AS tier, count(f) AS cnt
         WITH collect({tier: tier, count: cnt}) AS tiers
         UNWIND tiers AS t
         WITH t, reduce(s = 0, x IN tiers | s + x.count) AS total
         WITH max(toFloat(t.count) / total) AS maxPct
         RETURN 'D19' AS id, 'Is risk distribution healthy?' AS question,
           round(maxPct * 100) + '% max single tier' AS answer,
           maxPct <= 0.6 AS healthy,
           'No single tier should exceed 60%' AS nextStep`, {}
      ),
      // D3: Snapshots fresh
      cachedQuery(
        `MATCH (g:GovernanceMetricSnapshot {projectId: 'proj_c0d3e9a1f200'})
         WITH max(g.timestamp) AS latest
         RETURN 'D3' AS id, 'Are governance snapshots fresh?' AS question,
           coalesce(latest, 'none') AS answer,
           latest IS NOT NULL AS healthy,
           'Run done-check to generate snapshots' AS nextStep`, {}
      ),
      // D10: Project node accurate
      cachedQuery(
        `MATCH (p:Project {projectId: 'proj_c0d3e9a1f200'})
         OPTIONAL MATCH (n {projectId: 'proj_c0d3e9a1f200'})
         WHERE NOT n:Project
         WITH p, count(n) AS actual
         RETURN 'D10' AS id, 'Does Project node match graph size?' AS question,
           'reported=' + coalesce(p.nodeCount, 0) + ' actual=' + actual AS answer,
           true AS healthy,
           'Run graph:metrics to update' AS nextStep`, {}
      ),
    ]);

    const results = checks.map(rows => rows[0]).filter(Boolean);

    return NextResponse.json({ data: results });
  } catch (error) {
    return NextResponse.json(
      { error: 'Diagnosis failed', message: String(error) },
      { status: 500 },
    );
  }
}
