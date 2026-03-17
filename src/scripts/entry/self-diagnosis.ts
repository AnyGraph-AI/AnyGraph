#!/usr/bin/env npx tsx
/**
 * self-diagnosis — 10 epistemological health checks.
 * Tests what the graph knows about its own limitations.
 *
 * Each check answers: "Does the graph know what it doesn't know?"
 * A healthy graph has first-class nodes for unknowns, not absence of data.
 *
 * Usage: npm run self-diagnosis
 */
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'codegraph',
  ),
);

interface DiagResult {
  id: string;
  question: string;
  answer: string;
  healthy: boolean;
  detail: Record<string, any>;
}

async function query(cypher: string, params: Record<string, any> = {}): Promise<Record<string, any>[]> {
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map(r => {
      const obj: Record<string, any> = {};
      r.keys.forEach(k => {
        const val = r.get(k);
        obj[k as string] = typeof val?.toNumber === 'function' ? val.toNumber() : val;
      });
      return obj;
    });
  } finally {
    await session.close();
  }
}

async function getProjectId(): Promise<string> {
  const rows = await query(
    `MATCH (p:Project) WHERE p.path IS NOT NULL
     RETURN p.projectId AS pid ORDER BY p.nodeCount DESC LIMIT 1`,
  );
  return rows[0]?.pid || 'proj_c0d3e9a1f200';
}

async function runDiagnosis(): Promise<DiagResult[]> {
  const pid = await getProjectId();
  const results: DiagResult[] = [];

  // 1. Does the graph track its own blind spots?
  const q1 = await query(`
    MATCH (u:UnresolvedReference {projectId: $pid})
    RETURN u.reason AS reason, count(u) AS cnt ORDER BY cnt DESC
  `, { pid });
  const totalUnresolved = q1.reduce((s, r) => s + r.cnt, 0);
  const localBlind = q1.filter(r => r.reason !== 'external-package').reduce((s, r) => s + r.cnt, 0);
  results.push({
    id: 'D1', question: 'Does the graph track its own blind spots?',
    answer: totalUnresolved > 0
      ? `Yes — ${totalUnresolved} UnresolvedReference nodes (${localBlind} local blind spots)`
      : 'No unresolved references found (suspicious — may mean enrichment hasn\'t run)',
    healthy: totalUnresolved > 0 && localBlind < 20,
    detail: { total: totalUnresolved, local: localBlind, breakdown: q1 },
  });

  // 2. Does ANALYZED coverage match expectations?
  const q2 = await query(`
    MATCH (sf:SourceFile {projectId: $pid})
    OPTIONAL MATCH (sf)<-[:ANALYZED]-(vr)
    WITH count(sf) AS total,
         sum(CASE WHEN vr IS NOT NULL THEN 1 ELSE 0 END) AS analyzed
    RETURN total, analyzed, total - analyzed AS gaps
  `, { pid });
  const coveragePct = q2[0]?.total > 0 ? ((q2[0]?.analyzed / q2[0]?.total) * 100).toFixed(1) : '0';
  results.push({
    id: 'D2', question: 'Does ANALYZED coverage match reality?',
    answer: `${q2[0]?.analyzed}/${q2[0]?.total} files analyzed (${coveragePct}%), ${q2[0]?.gaps} gaps`,
    healthy: parseFloat(coveragePct) > 50,
    detail: q2[0] || {},
  });

  // 3. Are integrity snapshots fresh?
  const q3 = await query(`
    MATCH (s:GraphMetricsSnapshot)
    RETURN s.timestamp AS ts, s.nodeCount AS nodes, s.edgeCount AS edges
    ORDER BY s.timestamp DESC LIMIT 1
  `);
  const lastSnapshot = q3[0]?.ts;
  const snapshotAge = lastSnapshot
    ? Math.round((Date.now() - new Date(lastSnapshot).getTime()) / 3600000)
    : null;
  results.push({
    id: 'D3', question: 'Are integrity snapshots fresh?',
    answer: snapshotAge !== null
      ? `Last snapshot: ${snapshotAge}h ago (${q3[0]?.nodes} nodes, ${q3[0]?.edges} edges)`
      : 'No snapshots found — graph:metrics has never run',
    healthy: snapshotAge !== null && snapshotAge < 24,
    detail: { ageHours: snapshotAge, ...q3[0] },
  });

  // 4. Are there MERGE key collisions? (duplicate nodeIds)
  const q4 = await query(`
    MATCH (n:CodeNode {projectId: $pid})
    WHERE n.nodeId IS NOT NULL
    WITH n.nodeId AS nid, count(n) AS cnt
    WHERE cnt > 1
    RETURN nid, cnt ORDER BY cnt DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'D4', question: 'Are there MERGE key collisions?',
    answer: q4.length > 0
      ? `${q4.length} duplicate nodeIds found — MERGE identity broken`
      : 'No collisions — MERGE keys are unique',
    healthy: q4.length === 0,
    detail: { collisions: q4 },
  });

  // 5. Does the graph know which edges are derived vs canonical?
  const q5 = await query(`
    MATCH (s {projectId: $pid})-[r]->(t)
    RETURN
      sum(CASE WHEN r.derived = true THEN 1 ELSE 0 END) AS derived,
      sum(CASE WHEN r.derived IS NULL OR r.derived = false THEN 1 ELSE 0 END) AS canonical,
      count(r) AS total
  `, { pid });
  const derivedPct = q5[0]?.total > 0
    ? ((q5[0]?.derived / q5[0]?.total) * 100).toFixed(1)
    : '0';
  results.push({
    id: 'D5', question: 'Does the graph distinguish derived from canonical edges?',
    answer: `${q5[0]?.derived} derived, ${q5[0]?.canonical} canonical (${derivedPct}% derived)`,
    healthy: q5[0]?.derived > 0 && q5[0]?.canonical > 0,
    detail: q5[0] || {},
  });

  // 6. Are riskTiers current (not all LOW)?
  const q6 = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.riskTier IS NOT NULL
    RETURN f.riskTier AS tier, count(f) AS cnt ORDER BY cnt DESC
  `, { pid });
  const allLow = q6.length === 1 && q6[0]?.tier === 'LOW';
  const hasCritical = q6.some(r => r.tier === 'CRITICAL');
  results.push({
    id: 'D6', question: 'Are risk tiers current (not stale)?',
    answer: allLow
      ? 'ALL functions are LOW — risk scoring is stale or not running'
      : q6.map(r => `${r.tier}: ${r.cnt}`).join(', '),
    healthy: !allLow && hasCritical,
    detail: { distribution: q6 },
  });

  // 7. Do claims have supporting evidence?
  const q7 = await query(`
    MATCH (c:Claim)
    OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(e)
    WITH c, count(e) AS evidenceCount
    RETURN
      count(c) AS totalClaims,
      sum(CASE WHEN evidenceCount > 0 THEN 1 ELSE 0 END) AS supported,
      sum(CASE WHEN evidenceCount = 0 THEN 1 ELSE 0 END) AS unsupported
  `);
  results.push({
    id: 'D7', question: 'Do claims have supporting evidence?',
    answer: `${q7[0]?.supported}/${q7[0]?.totalClaims} claims have evidence, ${q7[0]?.unsupported} unsupported`,
    healthy: (q7[0]?.unsupported || 0) < (q7[0]?.totalClaims || 1) * 0.2,
    detail: q7[0] || {},
  });

  // 8. Are there orphaned edges (missing source or target)?
  const q8 = await query(`
    MATCH (s {projectId: $pid})-[r]->(t)
    WHERE NOT t.projectId IS NOT NULL AND NOT t:Project
    RETURN type(r) AS edgeType, count(r) AS cnt ORDER BY cnt DESC LIMIT 5
  `, { pid });
  results.push({
    id: 'D8', question: 'Are there orphaned edges (cross-project without target projectId)?',
    answer: q8.length > 0
      ? `${q8.reduce((s, r) => s + r.cnt, 0)} edges point to nodes without projectId`
      : 'No orphaned edges detected',
    healthy: q8.reduce((s, r) => s + r.cnt, 0) < 50,
    detail: { orphans: q8 },
  });

  // 9. Is the TC (Temporal Confidence) pipeline producing values?
  // Note: VRs may not have projectId — check both scoped and global
  let q9 = await query(`
    MATCH (vr:VerificationRun {projectId: $pid})
    WHERE vr.effectiveConfidence IS NOT NULL
    RETURN
      count(vr) AS withEC,
      avg(vr.effectiveConfidence) AS avgEC,
      min(vr.effectiveConfidence) AS minEC,
      max(vr.effectiveConfidence) AS maxEC
  `, { pid });
  let q9b = await query(`
    MATCH (vr:VerificationRun {projectId: $pid})
    WHERE vr.effectiveConfidence IS NULL
    RETURN count(vr) AS withoutEC
  `, { pid });
  // Fallback: if no scoped VRs, check all VRs globally
  if ((q9[0]?.withEC || 0) === 0 && (q9b[0]?.withoutEC || 0) === 0) {
    q9 = await query(`
      MATCH (vr:VerificationRun)
      WHERE vr.effectiveConfidence IS NOT NULL
      RETURN count(vr) AS withEC, avg(vr.effectiveConfidence) AS avgEC,
             min(vr.effectiveConfidence) AS minEC, max(vr.effectiveConfidence) AS maxEC
    `);
    q9b = await query(`
      MATCH (vr:VerificationRun) WHERE vr.effectiveConfidence IS NULL
      RETURN count(vr) AS withoutEC
    `);
  }
  results.push({
    id: 'D9', question: 'Is the TC pipeline producing effectiveConfidence values?',
    answer: (q9[0]?.withEC || 0) > 0
      ? `${q9[0]?.withEC} VRs with EC (avg=${(q9[0]?.avgEC || 0).toFixed(3)}, range ${(q9[0]?.minEC || 0).toFixed(3)}–${(q9[0]?.maxEC || 0).toFixed(3)}), ${q9b[0]?.withoutEC || 0} without`
      : 'No VRs have effectiveConfidence — TC pipeline not running',
    healthy: (q9[0]?.withEC || 0) > 0,  // Some VRs (e.g. done-check) legitimately skip TC
    detail: { ...q9[0], withoutEC: q9b[0]?.withoutEC },
  });

  // 10. Does the graph know its own size accurately?
  const q10a = await query(`
    MATCH (p:Project {projectId: $pid})
    RETURN p.nodeCount AS reportedNodes, p.edgeCount AS reportedEdges
  `, { pid });
  const q10b = await query(`
    MATCH (n {projectId: $pid}) RETURN count(n) AS actualNodes
  `, { pid });
  const q10c = await query(`
    MATCH (s {projectId: $pid})-[r]->(t) RETURN count(r) AS actualEdges
  `, { pid });
  const reportedNodes = q10a[0]?.reportedNodes || 0;
  const actualNodes = q10b[0]?.actualNodes || 0;
  const reportedEdges = q10a[0]?.reportedEdges || 0;
  const actualEdges = q10c[0]?.actualEdges || 0;
  const nodeDrift = Math.abs(reportedNodes - actualNodes);
  const edgeDrift = Math.abs(reportedEdges - actualEdges);
  results.push({
    id: 'D10', question: 'Does the Project node accurately report graph size?',
    answer: `Reported: ${reportedNodes} nodes / ${reportedEdges} edges. Actual: ${actualNodes} / ${actualEdges}. Drift: ${nodeDrift} nodes, ${edgeDrift} edges`,
    healthy: nodeDrift < actualNodes * 0.1 && edgeDrift < actualEdges * 0.2,  // Edge drift expected: derived edges aren't in p.edgeCount
    detail: { reportedNodes, actualNodes, reportedEdges, actualEdges, nodeDrift, edgeDrift },
  });

  return results;
}

async function main() {
  console.log('🔬 Self-Diagnosis — 10 Epistemological Health Checks\n');
  console.log('   "Does the graph know what it doesn\'t know?"\n');

  try {
    const results = await runDiagnosis();

    let healthy = 0;
    let unhealthy = 0;

    for (const r of results) {
      const icon = r.healthy ? '✅' : '❌';
      console.log(`${icon} ${r.id}: ${r.question}`);
      console.log(`   ${r.answer}\n`);

      if (r.healthy) healthy++;
      else unhealthy++;
    }

    console.log('═'.repeat(65));
    console.log(`📊 Health: ${healthy}/10 checks pass, ${unhealthy} need attention`);

    if (unhealthy === 0) {
      console.log('\n✅ Graph is self-aware — knows its own state, gaps, and limitations.');
    } else if (unhealthy <= 3) {
      console.log('\n⚠️  Mostly healthy — a few areas need attention.');
    } else {
      console.log('\n❌ Multiple self-awareness gaps — run enrichment pipeline and rebuild-derived.');
    }

    process.exit(unhealthy > 5 ? 1 : 0);
  } finally {
    await driver.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
