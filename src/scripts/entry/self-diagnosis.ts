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

  // D11: Enrichment property coverage — are enrichment properties surviving reparse?
  // (moved below for numbering consistency)
  const d11 = await query(`
    MATCH (f:Function {projectId: $pid})
    WITH count(f) AS total,
         sum(CASE WHEN f.compositeRisk IS NOT NULL THEN 1 ELSE 0 END) AS hasCompositeRisk,
         sum(CASE WHEN f.riskTier IS NOT NULL THEN 1 ELSE 0 END) AS hasRiskTier,
         sum(CASE WHEN f.commitCountRaw IS NOT NULL THEN 1 ELSE 0 END) AS hasGitFreq,
         sum(CASE WHEN f.temporalCoupling IS NOT NULL THEN 1 ELSE 0 END) AS hasTempCoupling
    RETURN total, hasCompositeRisk, hasRiskTier, hasGitFreq, hasTempCoupling
  `, { pid });
  const d11r = d11[0] || {};
  const d11Total = d11r.total || 1;
  const d11CoveragePct = Math.round((d11r.hasCompositeRisk || 0) / d11Total * 100);
  const d11Healthy = d11CoveragePct > 95; // >95% of functions should retain enrichment props
  results.push({
    id: 'D11', question: 'Are enrichment properties surviving reparse? (property clobber detection)',
    answer: `${d11r.hasCompositeRisk}/${d11Total} functions have compositeRisk (${d11CoveragePct}%). riskTier: ${d11r.hasRiskTier}, gitFreq: ${d11r.hasGitFreq}, tempCoupling: ${d11r.hasTempCoupling}`,
    healthy: d11Healthy,
    detail: d11r,
  });

  // D12: Entrypoint dispatch coverage — are all entrypoints wired to handlers?
  const d12 = await query(`
    MATCH (e:Entrypoint {projectId: $pid})
    OPTIONAL MATCH (e)-[:DISPATCHES_TO]->(h)
    WITH count(e) AS total,
         sum(CASE WHEN h IS NOT NULL THEN 1 ELSE 0 END) AS wired,
         collect(CASE WHEN h IS NULL THEN e.name ELSE null END) AS unwired
    RETURN total, wired, total - wired AS disconnected,
           [x IN unwired WHERE x IS NOT NULL] AS disconnectedNames
  `, { pid });
  const d12r = d12[0] || {};
  results.push({
    id: 'D12', question: 'Are all entrypoints wired to handlers? (dispatch coverage)',
    answer: `${d12r.wired}/${d12r.total} entrypoints have DISPATCHES_TO edges. ${d12r.disconnected} disconnected${d12r.disconnectedNames?.length ? ': ' + d12r.disconnectedNames.slice(0, 5).join(', ') : ''}`,
    healthy: (d12r.disconnected || 0) === 0,
    detail: d12r,
  });

  // D13: Plan task evidence coverage — how many "done" tasks have zero evidence?
  const d13 = await query(`
    MATCH (t:Task)
    WHERE t.status = 'done'
    OPTIONAL MATCH (t)-[:HAS_CODE_EVIDENCE]->(e)
    WITH count(t) AS totalDone,
         sum(CASE WHEN e IS NOT NULL THEN 1 ELSE 0 END) AS withEvidence,
         sum(CASE WHEN e IS NULL THEN 1 ELSE 0 END) AS noEvidence
    RETURN totalDone, withEvidence, noEvidence
  `);
  const d13r = d13[0] || {};
  const d13Pct = d13r.totalDone > 0 ? Math.round((d13r.noEvidence / d13r.totalDone) * 100) : 0;
  results.push({
    id: 'D13', question: 'Do "done" tasks have structural evidence? (unproven completions)',
    answer: `${d13r.withEvidence}/${d13r.totalDone} done tasks have code evidence. ${d13r.noEvidence} unproven (${d13Pct}%)`,
    healthy: d13Pct < 50,
    detail: d13r,
  });

  // D14: Provenance coverage — what % of edges have provenance metadata?
  const d14 = await query(`
    MATCH (s {projectId: $pid})-[r]->(t)
    WITH type(r) AS edgeType, count(r) AS total,
         sum(CASE WHEN r.provenance IS NOT NULL THEN 1 ELSE 0 END) AS withProv
    RETURN edgeType, total, withProv,
           CASE WHEN total > 0 THEN round(toFloat(withProv) / total * 100) ELSE 0 END AS pct
    ORDER BY total DESC
  `, { pid });
  const d14Total = d14.reduce((s, r) => s + r.total, 0);
  const d14WithProv = d14.reduce((s, r) => s + r.withProv, 0);
  const d14Pct = d14Total > 0 ? Math.round(d14WithProv / d14Total * 100) : 0;
  const d14Zero = d14.filter(r => r.withProv === 0 && r.total > 10).map(r => r.edgeType);
  results.push({
    id: 'D14', question: 'Do edges have provenance metadata? (audit trail coverage)',
    answer: `${d14WithProv}/${d14Total} edges have provenance (${d14Pct}%). ${d14Zero.length} edge types with 0% provenance${d14Zero.length ? ': ' + d14Zero.slice(0, 5).join(', ') : ''}`,
    healthy: d14Pct > 50,
    detail: { totalEdges: d14Total, withProvenance: d14WithProv, pct: d14Pct, zeroCoverage: d14Zero },
  });

  // D15: Test coverage vs risk — are CRITICAL/HIGH functions in tested files?
  const d15 = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.riskTier IN ['CRITICAL', 'HIGH']
    MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(f)
    OPTIONAL MATCH (sf)<-[:TESTED_BY]-(tf)
    WITH f.riskTier AS tier, count(f) AS total,
         sum(CASE WHEN tf IS NOT NULL THEN 1 ELSE 0 END) AS tested,
         sum(CASE WHEN tf IS NULL THEN 1 ELSE 0 END) AS untested
    RETURN tier, total, tested, untested ORDER BY tier
  `, { pid });
  const d15Untested = d15.reduce((s, r) => s + r.untested, 0);
  const d15Total = d15.reduce((s, r) => s + r.total, 0);
  results.push({
    id: 'D15', question: 'Are CRITICAL/HIGH functions in tested files? (risk vs coverage gap)',
    answer: d15Total > 0
      ? `${d15Untested}/${d15Total} CRITICAL/HIGH functions are in untested files. ${d15.map(r => `${r.tier}: ${r.untested}/${r.total} untested`).join(', ')}`
      : 'No CRITICAL/HIGH functions found (risk tiers may be stale)',
    healthy: d15Total > 0 && d15Untested < d15Total * 0.3,
    detail: { breakdown: d15 },
  });

  // D16: Verification source identity — are there VRs with unknown source?
  const d16 = await query(`
    MATCH (vr:VerificationRun)
    WHERE vr.projectId = $pid OR vr.projectId IS NULL
    RETURN vr.source AS source, count(vr) AS cnt ORDER BY cnt DESC
  `, { pid });
  const d16Null = d16.filter(r => r.source === null).reduce((s, r) => s + r.cnt, 0);
  const d16Total = d16.reduce((s, r) => s + r.cnt, 0);
  results.push({
    id: 'D16', question: 'Do all verification runs have a known source?',
    answer: `${d16Total - d16Null}/${d16Total} VRs have source metadata. ${d16Null} with null source`,
    healthy: d16Null === 0,
    detail: { distribution: d16, nullCount: d16Null },
  });

  // D17: Claim→Evidence→Code chain completeness — can claims reach source code?
  const d17 = await query(`
    MATCH (c:Claim)
    OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(e:Evidence)-[:ANCHORED_TO]->(code)
    WITH count(DISTINCT c) AS totalClaims,
         count(DISTINCT CASE WHEN code IS NOT NULL THEN c END) AS fullyChained
    RETURN totalClaims, fullyChained, totalClaims - fullyChained AS broken
  `);
  const d17r = d17[0] || {};
  const d17Pct = d17r.totalClaims > 0 ? Math.round((d17r.fullyChained / d17r.totalClaims) * 100) : 0;
  results.push({
    id: 'D17', question: 'Can claims reach source code? (Claim→Evidence→Code chain)',
    answer: `${d17r.fullyChained}/${d17r.totalClaims} claims have full chain to code (${d17Pct}%). ${d17r.broken} broken chains`,
    healthy: d17Pct > 10, // Most claims are plan-level, not code-level, so low threshold
    detail: d17r,
  });

  // D18: Property Schema Consistency — do all Function nodes have the same property shape?
  const d18 = await query(`
    MATCH (f:Function {projectId: $pid})
    WITH apoc.coll.sort(keys(f)) AS sig, count(*) AS cnt
    RETURN sig, cnt ORDER BY cnt DESC
  `, { pid });
  const d18Sigs = d18.length;
  const d18MissingRisk = d18.filter(r => !r.sig.includes('compositeRisk') || !r.sig.includes('riskTier'));
  const d18Healthy = d18Sigs <= 3 && d18MissingRisk.length === 0;
  results.push({
    id: 'D18', question: 'Do all Function nodes have consistent property schemas?',
    answer: `${d18Sigs} distinct key signatures. ${d18MissingRisk.length} signatures missing compositeRisk/riskTier${d18Sigs > 3 ? ' — too many variants, enrichment is inconsistent' : ''}`,
    healthy: d18Healthy,
    detail: { signatures: d18Sigs, missingRisk: d18MissingRisk.length, top3: d18.slice(0, 3).map(r => ({ keys: r.sig.length, count: r.cnt })) },
  });

  // D19: Risk Distribution Shape — is any single tier >80% (broken) or >60% (warn)?
  const d19 = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.riskTier IS NOT NULL
    WITH f.riskTier AS tier, count(f) AS cnt
    WITH collect({tier: tier, cnt: cnt}) AS tiers, sum(cnt) AS total
    UNWIND tiers AS t
    RETURN t.tier AS tier, t.cnt AS cnt, round(toFloat(t.cnt) / total * 100, 1) AS pct, total
    ORDER BY t.cnt DESC
  `, { pid });
  const d19MaxPct = d19.length > 0 ? Math.max(...d19.map(r => r.pct)) : 0;
  const d19Dominant = d19.length > 0 ? d19[0].tier : 'none';
  const d19Healthy = d19MaxPct <= 60;
  const d19Status = d19MaxPct > 80 ? 'FAIL — scoring pipeline broken' : d19MaxPct > 60 ? 'WARN — distribution skewed' : 'Healthy spread';
  results.push({
    id: 'D19', question: 'Is the risk tier distribution healthy? (no single tier >60%)',
    answer: `${d19Status}. ${d19.map(r => `${r.tier}: ${r.pct}%`).join(', ')}. Dominant: ${d19Dominant} at ${d19MaxPct}%`,
    healthy: d19Healthy,
    detail: { maxPct: d19MaxPct, dominant: d19Dominant, distribution: d19 },
  });

  return results;
}

async function main() {
  console.log('🔬 Self-Diagnosis — 19 Epistemological Health Checks\n');
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
    console.log(`📊 Health: ${healthy}/${results.length} checks pass, ${unhealthy} need attention`);

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
