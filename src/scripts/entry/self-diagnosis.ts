#!/usr/bin/env npx tsx
/**
 * self-diagnosis — 37 epistemological health checks.
 * Tests what the graph knows about its own limitations.
 *
 * Each check answers: "Does the graph know what it doesn't know?"
 * A healthy graph has first-class nodes for unknowns, not absence of data.
 * Every check includes a nextStep — actionable regardless of status.
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
  nextStep: string;
  detail: Record<string, any>;
}

export async function query(cypher: string, params: Record<string, any> = {}): Promise<Record<string, any>[]> {
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

export async function getProjectId(): Promise<string> {
  const rows = await query(
    `MATCH (p:Project) WHERE p.path IS NOT NULL
     RETURN p.projectId AS pid ORDER BY p.nodeCount DESC LIMIT 1`,
  );
  return rows[0]?.pid || 'proj_c0d3e9a1f200';
}

export async function runDiagnosis(): Promise<DiagResult[]> {
  const pid = await getProjectId();
  const results: DiagResult[] = [];

  // ─── D1: Blind spot tracking ─────────────────────────────────────
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
    nextStep: localBlind > 0
      ? `Review local blind spots: cypher-shell -u neo4j -p codegraph "MATCH (u:UnresolvedReference {projectId: '${pid}'}) WHERE u.reason <> 'external-package' RETURN u.name, u.reason, u.filePath LIMIT 20". Fix .js→.ts specifier mismatches in source imports.`
      : `Run npm run rebuild-derived to regenerate UnresolvedReference nodes if count is 0.`,
    detail: { total: totalUnresolved, local: localBlind, breakdown: q1 },
  });

  // ─── D2: ANALYZED coverage ───────────────────────────────────────
  const q2 = await query(`
    MATCH (sf:SourceFile {projectId: $pid})
    OPTIONAL MATCH (sf)<-[:ANALYZED]-(vr)
    WITH sf, count(vr) AS vrCount
    RETURN count(sf) AS total,
           sum(CASE WHEN vrCount > 0 THEN 1 ELSE 0 END) AS analyzed,
           sum(CASE WHEN vrCount = 0 THEN 1 ELSE 0 END) AS gaps
  `, { pid });
  const coveragePct = q2[0]?.total > 0 ? ((q2[0]?.analyzed / q2[0]?.total) * 100).toFixed(1) : '0';
  const d2Gaps = q2[0]?.gaps || 0;
  results.push({
    id: 'D2', question: 'Does ANALYZED coverage match reality?',
    answer: `${q2[0]?.analyzed}/${q2[0]?.total} files analyzed (${coveragePct}%), ${d2Gaps} gaps`,
    healthy: parseFloat(coveragePct) > 50,
    nextStep: d2Gaps > 0
      ? `Run npm run verification:scan to refresh SARIF data, then npm run enrich:analyzed-edges. List gap files: cypher-shell -u neo4j -p codegraph "MATCH (sf:SourceFile {projectId: '${pid}'}) WHERE NOT (sf)<-[:ANALYZED]-() RETURN sf.name LIMIT 20".`
      : `Coverage is complete. Run npm run verification:scan periodically to keep SARIF data fresh.`,
    detail: q2[0] || {},
  });

  // ─── D3: Snapshot freshness ──────────────────────────────────────
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
    nextStep: snapshotAge === null || snapshotAge > 24
      ? `Run npm run graph:metrics to create a fresh snapshot. Snapshots run automatically at end of npm run done-check.`
      : `Snapshot is fresh. Compare with previous: cypher-shell -u neo4j -p codegraph "MATCH (s:GraphMetricsSnapshot) RETURN s.timestamp, s.nodeCount, s.edgeCount ORDER BY s.timestamp DESC LIMIT 5".`,
    detail: { ageHours: snapshotAge, ...q3[0] },
  });

  // ─── D4: MERGE key collisions ────────────────────────────────────
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
    nextStep: q4.length > 0
      ? `Duplicate nodeIds break MERGE idempotency. Inspect: cypher-shell -u neo4j -p codegraph "MATCH (n:CodeNode {projectId: '${pid}'}) WITH n.nodeId AS nid, collect(n) AS dupes, count(n) AS cnt WHERE cnt > 1 RETURN nid, cnt, [d IN dupes | d.name] LIMIT 10". Fix the parser's nodeId generation in src/core/parsers/typescript-parser.ts.`
      : `No action needed. MERGE keys are clean.`,
    detail: { collisions: q4 },
  });

  // ─── D5: Derived vs canonical edge tagging ───────────────────────
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
    nextStep: (q5[0]?.derived || 0) === 0
      ? `No derived edges tagged. Run npm run edges:normalize to tag all enrichment-created edges with derived:true.`
      : `Run npm run edges:verify to check for untagged enrichment edges. All edges created by enrichment scripts must have {derived: true}.`,
    detail: q5[0] || {},
  });

  // ─── D6: Risk tier currency ──────────────────────────────────────
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
    nextStep: allLow
      ? `Risk tiers are stale. Run: npm run enrich:git-frequency && npm run enrich:temporal-coupling && npm run enrich:composite-risk. The composite risk scorer needs git frequency and temporal coupling data to produce variance.`
      : `Risk tiers are current. To refresh after code changes: npm run enrich:composite-risk. Check stale tiers: npm run governance:stale:verify.`,
    detail: { distribution: q6 },
  });

  // ─── D7: Claim evidence support ──────────────────────────────────
  const q7 = await query(`
    MATCH (c:Claim)
    OPTIONAL MATCH (c)-[:SUPPORTED_BY]->(e)
    WITH c, count(e) AS evidenceCount
    RETURN
      count(c) AS totalClaims,
      sum(CASE WHEN evidenceCount > 0 THEN 1 ELSE 0 END) AS supported,
      sum(CASE WHEN evidenceCount = 0 THEN 1 ELSE 0 END) AS unsupported
  `);
  const d7unsup = q7[0]?.unsupported || 0;
  const d7total = q7[0]?.totalClaims || 1;
  results.push({
    id: 'D7', question: 'Do claims have supporting evidence?',
    answer: `${q7[0]?.supported}/${d7total} claims have evidence, ${d7unsup} unsupported`,
    healthy: d7unsup < d7total * 0.2,
    nextStep: d7unsup > 0
      ? `${d7unsup} claims have no SUPPORTED_BY edges. Run npm run evidence:auto-link to auto-link evidence to claims. List unsupported claims: cypher-shell -u neo4j -p codegraph "MATCH (c:Claim) WHERE NOT (c)-[:SUPPORTED_BY]->() RETURN c.claimType, count(c) AS cnt ORDER BY cnt DESC".`
      : `All claims have evidence. Run npm run evidence:coverage to verify coverage ratios per project.`,
    detail: q7[0] || {},
  });

  // ─── D8: Orphaned cross-project edges ────────────────────────────
  const q8 = await query(`
    MATCH (s {projectId: $pid})-[r]->(t)
    WHERE NOT t.projectId IS NOT NULL AND NOT t:Project
    RETURN type(r) AS edgeType, count(r) AS cnt ORDER BY cnt DESC LIMIT 5
  `, { pid });
  const d8total = q8.reduce((s, r) => s + r.cnt, 0);
  results.push({
    id: 'D8', question: 'Are there orphaned edges (cross-project without target projectId)?',
    answer: q8.length > 0
      ? `${d8total} edges point to nodes without projectId`
      : 'No orphaned edges detected',
    healthy: d8total < 50,
    nextStep: d8total > 0
      ? `${d8total} edges target nodes without projectId. Run npm run edges:normalize to tag cross-project edges. Inspect: cypher-shell -u neo4j -p codegraph "MATCH (s {projectId: '${pid}'})-[r]->(t) WHERE t.projectId IS NULL AND NOT t:Project RETURN type(r), t.name, labels(t) LIMIT 20".`
      : `No orphaned edges. Run npm run edges:verify periodically to confirm.`,
    detail: { orphans: q8 },
  });

  // ─── D9: TC pipeline effectiveConfidence ─────────────────────────
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
  if ((q9[0]?.withEC || 0) === 0 && (q9b[0]?.withoutEC || 0) === 0) {
    q9 = await query(`MATCH (vr:VerificationRun) WHERE vr.effectiveConfidence IS NOT NULL RETURN count(vr) AS withEC, avg(vr.effectiveConfidence) AS avgEC, min(vr.effectiveConfidence) AS minEC, max(vr.effectiveConfidence) AS maxEC`);
    q9b = await query(`MATCH (vr:VerificationRun) WHERE vr.effectiveConfidence IS NULL RETURN count(vr) AS withoutEC`);
  }
  const d9withEC = q9[0]?.withEC || 0;
  const d9withoutEC = q9b[0]?.withoutEC || 0;
  results.push({
    id: 'D9', question: 'Is the TC pipeline producing effectiveConfidence values?',
    answer: d9withEC > 0
      ? `${d9withEC} VRs with EC (avg=${(q9[0]?.avgEC || 0).toFixed(3)}, range ${(q9[0]?.minEC || 0).toFixed(3)}–${(q9[0]?.maxEC || 0).toFixed(3)}), ${d9withoutEC} without`
      : 'No VRs have effectiveConfidence — TC pipeline not running',
    healthy: d9withEC > 0,
    nextStep: d9withEC === 0
      ? `TC pipeline is not producing values. Run npm run tc:recompute to compute effectiveConfidence on all VRs. If no VRs exist, run npm run verification:scan first.`
      : d9withoutEC > 0
        ? `${d9withoutEC} VRs missing effectiveConfidence. Run npm run tc:recompute to fill gaps.`
        : `All VRs have EC. Run npm run tc:verify to confirm pipeline health. Run npm run verification:status:dashboard for per-family breakdown.`,
    detail: { ...q9[0], withoutEC: d9withoutEC },
  });

  // ─── D10: Project node size accuracy ─────────────────────────────
  const q10a = await query(`MATCH (p:Project {projectId: $pid}) RETURN p.nodeCount AS reportedNodes, p.edgeCount AS reportedEdges`, { pid });
  const q10b = await query(`MATCH (n {projectId: $pid}) RETURN count(n) AS actualNodes`, { pid });
  const q10c = await query(`MATCH (s {projectId: $pid})-[r]->(t) RETURN count(r) AS actualEdges`, { pid });
  const reportedNodes = q10a[0]?.reportedNodes || 0;
  const actualNodes = q10b[0]?.actualNodes || 0;
  const reportedEdges = q10a[0]?.reportedEdges || 0;
  const actualEdges = q10c[0]?.actualEdges || 0;
  const nodeDrift = Math.abs(reportedNodes - actualNodes);
  const edgeDrift = Math.abs(reportedEdges - actualEdges);
  results.push({
    id: 'D10', question: 'Does the Project node accurately report graph size?',
    answer: `Reported: ${reportedNodes} nodes / ${reportedEdges} edges. Actual: ${actualNodes} / ${actualEdges}. Drift: ${nodeDrift} nodes, ${edgeDrift} edges`,
    healthy: nodeDrift < actualNodes * 0.1 && edgeDrift < actualEdges * 0.2,
    nextStep: nodeDrift > actualNodes * 0.1 || edgeDrift > actualEdges * 0.2
      ? `Project node counts are stale. Run codegraph parse . to refresh the Project node, or run npm run rebuild-derived which updates Project counts at the end.`
      : `Drift is within tolerance. Edge drift is expected because derived edges are created after parse sets the Project node counts.`,
    detail: { reportedNodes, actualNodes, reportedEdges, actualEdges, nodeDrift, edgeDrift },
  });

  // ─── D11: Enrichment property clobber detection ──────────────────
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
  results.push({
    id: 'D11', question: 'Are enrichment properties surviving reparse? (property clobber detection)',
    answer: `${d11r.hasCompositeRisk}/${d11Total} functions have compositeRisk (${d11CoveragePct}%). riskTier: ${d11r.hasRiskTier}, gitFreq: ${d11r.hasGitFreq}, tempCoupling: ${d11r.hasTempCoupling}`,
    healthy: d11CoveragePct > 95,
    nextStep: d11CoveragePct <= 95
      ? `Enrichment properties were clobbered by reparse. Run npm run rebuild-derived to regenerate all enrichment data. Check src/mcp/handlers/incremental-parse.handler.ts for SET n = p (should be SET n += p).`
      : `Enrichment properties intact. If a reparse drops coverage below 95%, the incremental-parse handler may be using SET n = p instead of SET n += p — check src/mcp/handlers/incremental-parse.handler.ts.`,
    detail: d11r,
  });

  // ─── D12: Entrypoint dispatch coverage ───────────────────────────
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
  const d12disconnected = d12r.disconnected || 0;
  results.push({
    id: 'D12', question: 'Are all entrypoints wired to handlers? (dispatch coverage)',
    answer: `${d12r.wired}/${d12r.total} entrypoints have DISPATCHES_TO edges. ${d12disconnected} disconnected${d12r.disconnectedNames?.length ? ': ' + d12r.disconnectedNames.slice(0, 5).join(', ') : ''}`,
    healthy: d12disconnected === 0,
    nextStep: d12disconnected > 0
      ? `${d12disconnected} entrypoints have no DISPATCHES_TO edge. Run npm run enrich:entrypoint-edges to rewire. Disconnected entrypoints: ${(d12r.disconnectedNames || []).slice(0, 5).join(', ')}. Check src/scripts/enrichment/create-entrypoint-dispatch-edges.ts for matching patterns.`
      : `All entrypoints wired. Run npm run enrich:entrypoint-edges after adding new MCP tools or CLI commands to create their dispatch edges.`,
    detail: d12r,
  });

  // ─── D13: Plan task evidence coverage ────────────────────────────
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
    nextStep: d13Pct > 0
      ? `${d13r.noEvidence} done tasks have no HAS_CODE_EVIDENCE edges. Run npm run plan:evidence:recompute to refresh semantic keyword matching. List unproven tasks: cypher-shell -u neo4j -p codegraph "MATCH (t:Task) WHERE t.status = 'done' AND NOT (t)-[:HAS_CODE_EVIDENCE]->() RETURN t.name, t.projectId LIMIT 20".`
      : `All done tasks have code evidence. Run npm run plan:evidence:recompute after code changes to keep evidence links current.`,
    detail: d13r,
  });

  // ─── D14: Provenance coverage ────────────────────────────────────
  const d14 = await query(`
    MATCH (s {projectId: $pid})-[r]->(t)
    WITH type(r) AS edgeType, count(r) AS total,
         sum(CASE WHEN r.source IS NOT NULL OR r.confidence IS NOT NULL THEN 1 ELSE 0 END) AS withProv
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
    answer: `${d14WithProv}/${d14Total} edges have provenance (${d14Pct}%). ${d14Zero.length} edge types with 0% coverage${d14Zero.length ? ': ' + d14Zero.slice(0, 5).join(', ') : ''}`,
    healthy: d14Pct > 30,
    nextStep: d14Zero.length > 0
      ? `${d14Zero.length} edge types have zero provenance. Run npm run enrich:provenance to backfill. Edge types needing provenance: ${d14Zero.slice(0, 5).join(', ')}. Each enrichment script that creates edges must set {source: 'scriptName', confidence: N} on the edge.`
      : `Provenance coverage is ${d14Pct}%. Target: >80%. Run npm run enrich:provenance to improve. Check src/scripts/enrichment/ for scripts that create edges without source/confidence properties.`,
    detail: { totalEdges: d14Total, withProvenance: d14WithProv, pct: d14Pct, zeroCoverage: d14Zero },
  });

  // ─── D15: Risk vs test coverage gap ──────────────────────────────
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
  // Get top untested CRITICAL files for nextStep
  const d15files = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.riskTier = 'CRITICAL'
    MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(f)
    WHERE NOT (sf)<-[:TESTED_BY]-()
    RETURN sf.name AS file, count(f) AS criticalCount
    ORDER BY criticalCount DESC LIMIT 5
  `, { pid });
  results.push({
    id: 'D15', question: 'Are CRITICAL/HIGH functions in tested files? (risk vs coverage gap)',
    answer: d15Total > 0
      ? `${d15Untested}/${d15Total} CRITICAL/HIGH functions are in untested files. ${d15.map(r => `${r.tier}: ${r.untested}/${r.total} untested`).join(', ')}`
      : 'No CRITICAL/HIGH functions found (risk tiers may be stale)',
    healthy: d15Total > 0 && d15Untested < d15Total * 0.3,
    nextStep: d15Untested > 0
      ? `${d15Untested} CRITICAL/HIGH functions have no test coverage. Top untested CRITICAL files: ${d15files.map(f => `${f.file} (${f.criticalCount} CRITICAL)`).join(', ')}. Write tests for these files, then run npm run enrich:test-coverage to create TESTED_BY edges. Run codegraph enforce <file> to check gate status.`
      : `All CRITICAL/HIGH functions are in tested files. Run npm run enrich:test-coverage after adding new tests to refresh TESTED_BY edges.`,
    detail: { breakdown: d15, topUntestedFiles: d15files },
  });

  // ─── D16: Verification source identity ───────────────────────────
  const d16 = await query(`
    MATCH (vr:VerificationRun)
    WHERE vr.projectId = $pid OR vr.projectId IS NULL
    RETURN vr.tool AS tool, count(vr) AS cnt ORDER BY cnt DESC
  `, { pid });
  const d16Null = d16.filter(r => r.tool === null).reduce((s, r) => s + r.cnt, 0);
  const d16Total = d16.reduce((s, r) => s + r.cnt, 0);
  results.push({
    id: 'D16', question: 'Do all verification runs have a known tool?',
    answer: `${d16Total - d16Null}/${d16Total} VRs have tool metadata. ${d16Null} with unknown tool`,
    healthy: d16Null < d16Total * 0.1,
    nextStep: d16Null > 0
      ? `${d16Null} VRs have no tool property. Inspect: cypher-shell -u neo4j -p codegraph "MATCH (vr:VerificationRun) WHERE vr.tool IS NULL RETURN vr.sourceFamily, vr.ruleId, count(vr) LIMIT 10". Fix the SARIF importer or done-check capture script to set vr.tool on all VRs.`
      : `All VRs have tool metadata. No action needed.`,
    detail: { distribution: d16, nullCount: d16Null },
  });

  // ─── D17: Claim→Evidence→Code chain ──────────────────────────────
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
    healthy: d17Pct > 10,
    nextStep: d17Pct < 100
      ? `${d17r.broken} claims cannot reach source code. Run npm run evidence:auto-link then npm run enrich:evidence-anchor to create ANCHORED_TO edges from Evidence to CodeNodes. Most broken chains are plan-level claims that need ANCHORED_TO edges to the SourceFile/Function they describe.`
      : `All claims reach source code. No action needed.`,
    detail: d17r,
  });

  // ─── D18: Property schema consistency ────────────────────────────
  const d18 = await query(`
    MATCH (f:Function {projectId: $pid})
    WITH apoc.coll.sort(keys(f)) AS sig, count(*) AS cnt
    RETURN sig, cnt ORDER BY cnt DESC
  `, { pid });
  const d18Sigs = d18.length;
  const d18MissingRisk = d18.filter(r => !r.sig.includes('compositeRisk') || !r.sig.includes('riskTier'));
  results.push({
    id: 'D18', question: 'Do all Function nodes have consistent property schemas?',
    answer: `${d18Sigs} distinct key signatures. ${d18MissingRisk.length} signatures missing compositeRisk/riskTier${d18Sigs > 3 ? ' — too many variants, enrichment is inconsistent' : ''}`,
    healthy: d18Sigs <= 3 && d18MissingRisk.length === 0,
    nextStep: d18MissingRisk.length > 0
      ? `${d18MissingRisk.length} Function node groups are missing compositeRisk/riskTier. Run npm run enrich:composite-risk to fill gaps. Inspect: cypher-shell -u neo4j -p codegraph "MATCH (f:Function {projectId: '${pid}'}) WHERE f.compositeRisk IS NULL RETURN f.name, f.filePath LIMIT 10".`
      : d18Sigs > 3
        ? `${d18Sigs} distinct property schemas — enrichment is running inconsistently. Run npm run rebuild-derived to normalize all Function properties.`
        : `Property schemas are consistent. No action needed.`,
    detail: { signatures: d18Sigs, missingRisk: d18MissingRisk.length, top3: d18.slice(0, 3).map(r => ({ keys: r.sig.length, count: r.cnt })) },
  });

  // ─── D19: Risk distribution shape ────────────────────────────────
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
    nextStep: d19MaxPct > 60
      ? `${d19Dominant} tier dominates at ${d19MaxPct}%. Run npm run enrich:git-frequency && npm run enrich:temporal-coupling && npm run enrich:composite-risk to recalculate. If still >60%, check the composite risk formula in src/scripts/enrichment/create-composite-risk.ts — percentile bucketing may need retuning.`
      : `Distribution is healthy. No action needed. Monitor after major code changes — a merge of many new files can skew toward LOW.`,
    detail: { maxPct: d19MaxPct, dominant: d19Dominant, distribution: d19 },
  });

  // ─── D20: Security × Risk × Coverage triple-cross ────────────────
  const d20 = await query(`
    MATCH (vr:VerificationRun {projectId: $pid})-[:FLAGS]->(f)
    WHERE vr.ruleId CONTAINS 'security' OR vr.ruleId CONTAINS 'path-traversal'
       OR vr.ruleId CONTAINS 'child-process' OR vr.ruleId CONTAINS 'unsafe-format'
       OR vr.ruleId CONTAINS 'detect-non-literal'
    AND f.riskTier = 'CRITICAL'
    MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(f)
    OPTIONAL MATCH (sf)<-[:TESTED_BY]-(tf)
    WITH count(DISTINCT f) AS secCritical,
         sum(CASE WHEN tf IS NULL THEN 1 ELSE 0 END) AS secCriticalUntested,
         collect(DISTINCT sf.name) AS files
    RETURN secCritical, secCriticalUntested, files
  `, { pid });
  const d20r = d20[0] || { secCritical: 0, secCriticalUntested: 0, files: [] };
  results.push({
    id: 'D20', question: 'Are security-flagged CRITICAL functions tested? (RF1×RF2 cross-cut)',
    answer: d20r.secCritical > 0
      ? `${d20r.secCriticalUntested}/${d20r.secCritical} security-flagged CRITICAL functions are untested. Files: ${(d20r.files as string[]).slice(0, 5).join(', ')}`
      : 'No security-flagged CRITICAL functions found',
    healthy: d20r.secCriticalUntested === 0,
    nextStep: d20r.secCriticalUntested > 0
      ? `${d20r.secCriticalUntested} CRITICAL functions have Semgrep security findings AND zero test coverage. Files: ${(d20r.files as string[]).slice(0, 5).join(', ')}. Write tests for these files, then run npm run enrich:test-coverage. These are the highest-priority test targets in the codebase.`
      : d20r.secCritical > 0
        ? `All ${d20r.secCritical} security-flagged CRITICAL functions have test coverage. Run npm run verification:scan periodically to check for new security findings.`
        : `No security-flagged CRITICAL functions. Run npm run verification:scan to refresh Semgrep findings.`,
    detail: d20r,
  });

  // ─── D21: Confidence erosion early warning ───────────────────────
  const d21 = await query(`
    MATCH (r:VerificationRun {projectId: $pid})
    WHERE r.effectiveConfidence IS NOT NULL AND r.requiredConfidence IS NOT NULL
    WITH r.sourceFamily AS family,
         min(r.effectiveConfidence - r.requiredConfidence) AS minMargin,
         count(r) AS vrCount,
         sum(CASE WHEN (r.effectiveConfidence - 0.15) < r.requiredConfidence THEN 1 ELSE 0 END) AS wouldFlipAt15
    RETURN family, vrCount,
           round(minMargin * 1000) / 1000.0 AS minMargin,
           wouldFlipAt15
    ORDER BY minMargin
  `, { pid });
  const d21worst = d21.length > 0 ? d21[0] : { family: 'none', minMargin: 0, wouldFlipAt15: 0 };
  const d21anyThin = d21.some(r => r.minMargin < 0.15);
  results.push({
    id: 'D21', question: 'How close are tool families to confidence debt? (erosion early warning)',
    answer: d21.length > 0
      ? d21.map(r => `${r.family}: margin=${r.minMargin}, ${r.wouldFlipAt15}/${r.vrCount} would flip at 15% decay`).join('. ')
      : 'No VRs with effectiveConfidence and requiredConfidence',
    healthy: !d21anyThin,
    nextStep: d21anyThin
      ? `${d21worst.family} has minimum margin of ${d21worst.minMargin} — a ${Math.round((1 - d21worst.minMargin / 0.15) * 100)}% TCF decay would trigger debt. Run npm run verification:scan to refresh SARIF data and re-run npm run tc:recompute. If margin stays thin, consider raising tool confidence in src/core/verification/sarif-importer.ts mapLevelToConfidence().`
      : `All tool families have margin ≥0.15 above required confidence. No erosion risk. Run npm run tc:debt to see current debt dashboard.`,
    detail: { families: d21 },
  });

  // ─── D22: Entrypoint → CRITICAL untested handler chain ───────────
  const d22 = await query(`
    MATCH (e:Entrypoint {projectId: $pid})-[:DISPATCHES_TO]->(f)
    WHERE f.riskTier = 'CRITICAL'
    MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(f)
    WHERE NOT (sf)<-[:TESTED_BY]-()
    RETURN e.name AS entrypoint, e.kind AS kind, f.name AS handler, sf.name AS file
    ORDER BY entrypoint
  `, { pid });
  results.push({
    id: 'D22', question: 'Do user-facing entrypoints dispatch to untested CRITICAL code?',
    answer: d22.length > 0
      ? `${d22.length} entrypoint→CRITICAL untested chains: ${d22.slice(0, 5).map(r => `${r.entrypoint}→${r.handler} (${r.file})`).join(', ')}`
      : 'No entrypoints dispatch to untested CRITICAL functions',
    healthy: d22.length === 0,
    nextStep: d22.length > 0
      ? `${d22.length} user-facing commands route to CRITICAL untested code. Affected entrypoints: ${d22.slice(0, 5).map(r => r.entrypoint).join(', ')}. Write tests for ${[...new Set(d22.map(r => r.file))].slice(0, 3).join(', ')}, then run npm run enrich:test-coverage to create TESTED_BY edges.`
      : `All entrypoints dispatch to tested or non-CRITICAL code. No action needed.`,
    detail: { chains: d22 },
  });

  // ─── D23: Derived edge bloat ratio ───────────────────────────────
  const d23 = await query(`
    MATCH (s:GraphMetricsSnapshot)
    RETURN s.timestamp AS ts, s.derivedEdgeRatio AS ratio, s.derivedEdgeCount AS derived, s.edgeCount AS total
    ORDER BY s.timestamp DESC LIMIT 2
  `);
  const d23Latest = d23[0] || {};
  const d23Prev = d23[1] || {};
  const d23Ratio = d23Latest.ratio ? (d23Latest.ratio * 100).toFixed(1) : 'N/A';
  const d23PrevRatio = d23Prev.ratio ? (d23Prev.ratio * 100).toFixed(1) : null;
  const d23Delta = d23Prev.ratio && d23Latest.ratio ? ((d23Latest.ratio - d23Prev.ratio) * 100).toFixed(1) : null;
  const d23Healthy = !d23Latest.ratio || d23Latest.ratio < 0.20;
  results.push({
    id: 'D23', question: 'Is the derived-to-canonical edge ratio healthy? (graph bloat detection)',
    answer: d23Latest.ratio
      ? `Derived edge ratio: ${d23Ratio}% (${d23Latest.derived}/${d23Latest.total}).${d23Delta ? ` Change from previous: ${d23Delta > '0' ? '+' : ''}${d23Delta}pp` : ''}`
      : 'No GraphMetricsSnapshot nodes — cannot compute ratio',
    healthy: d23Healthy,
    nextStep: !d23Healthy
      ? `Derived edge ratio is ${d23Ratio}% — above 20% threshold. Run npm run rebuild-derived to prune stale derived edges. Check enrichment scripts for edge duplication — each script should use MERGE, not CREATE, for derived edges.`
      : d23Latest.ratio
        ? `Derived ratio is ${d23Ratio}% — healthy (warn at 20%, alarm at 35%). Run npm run graph:metrics after each done-check to track trend.`
        : `Run npm run graph:metrics to create the first snapshot, then run again after done-check to establish a trend.`,
    detail: { latest: d23Latest, previous: d23Prev, delta: d23Delta },
  });

  // ─── D24: Governance trend regression ────────────────────────────
  const d24 = await query(`
    MATCH (m:GovernanceMetricSnapshot {projectId: $pid})
    RETURN m.computedAt AS ts, m.interceptionRate AS intercept,
           m.invariantViolations AS violations, m.gateFailures AS gateFails,
           m.verificationRuns AS vrCount
    ORDER BY m.computedAt DESC LIMIT 1
  `, { pid });
  const d24oldest = await query(`
    MATCH (m:GovernanceMetricSnapshot {projectId: $pid})
    RETURN m.computedAt AS ts, m.interceptionRate AS intercept,
           m.invariantViolations AS violations, m.gateFailures AS gateFails
    ORDER BY m.computedAt ASC LIMIT 1
  `, { pid });
  const d24count = await query(`MATCH (m:GovernanceMetricSnapshot {projectId: $pid}) RETURN count(m) AS cnt`, { pid });
  const d24latest = d24[0] || {};
  const d24first = d24oldest[0] || {};
  const d24n = d24count[0]?.cnt || 0;
  const d24regressed = d24latest.intercept !== undefined && d24first.intercept !== undefined
    && (d24latest.intercept < d24first.intercept || (d24latest.violations || 0) > (d24first.violations || 0));
  results.push({
    id: 'D24', question: 'Is governance health trending stable or regressing?',
    answer: d24n > 0
      ? `${d24n} governance snapshots. Latest: intercept=${d24latest.intercept}, violations=${d24latest.violations}, gateFails=${d24latest.gateFails}. Earliest: intercept=${d24first.intercept}, violations=${d24first.violations}.${d24regressed ? ' REGRESSION DETECTED.' : ' No regression.'}`
      : 'No GovernanceMetricSnapshot nodes — governance:metrics:snapshot has not run',
    healthy: !d24regressed && d24n > 0,
    nextStep: d24n === 0
      ? `Run npm run governance:metrics:snapshot to create the first governance snapshot. It runs automatically as part of npm run done-check.`
      : d24regressed
        ? `Governance has regressed since first snapshot. Run npm run governance:metrics:integrity:verify for detailed comparison. Check npm run done-check output for which gate step is now failing.`
        : `Governance is stable across ${d24n} snapshots. Run npm run governance:metrics:integrity:verify to confirm baseline integrity.`,
    detail: { count: d24n, latest: d24latest, earliest: d24first, regressed: d24regressed },
  });

  // ─── D25: Snapshot cadence consistency ───────────────────────────
  const d25gms = await query(`
    MATCH (s:GraphMetricsSnapshot)
    RETURN s.timestamp AS ts ORDER BY s.timestamp
  `);
  const d25int = await query(`
    MATCH (s:IntegritySnapshot)
    RETURN s.timestamp AS ts ORDER BY s.timestamp DESC LIMIT 1
  `);
  // Check JSONL files via snapshot count
  const d25gmsCount = d25gms.length;
  const d25gmsGap = d25gms.length >= 2
    ? Math.round((new Date(d25gms[d25gms.length - 1].ts).getTime() - new Date(d25gms[d25gms.length - 2].ts).getTime()) / 3600000)
    : null;
  const d25intTs = d25int[0]?.ts;
  const d25intAge = d25intTs
    ? Math.round((Date.now() - new Date(d25intTs).getTime()) / 3600000)
    : null;
  const d25Healthy = d25gmsCount >= 2 && (d25gmsGap === null || d25gmsGap < 48);
  results.push({
    id: 'D25', question: 'Are snapshots being created consistently? (cadence gap detection)',
    answer: `GraphMetricsSnapshot: ${d25gmsCount} nodes${d25gmsGap !== null ? `, last gap: ${d25gmsGap}h` : ''}. IntegritySnapshot in Neo4j: ${d25intTs ? `last ${d25intAge}h ago` : 'none found'}. JSONL files: check artifacts/integrity-snapshots/ for daily files.`,
    healthy: d25Healthy,
    nextStep: d25gmsCount < 2
      ? `Only ${d25gmsCount} GraphMetricsSnapshot nodes. Run npm run done-check at least twice to establish a baseline for delta comparison. Each done-check creates one snapshot.`
      : d25gmsGap !== null && d25gmsGap > 48
        ? `${d25gmsGap}h gap between last two snapshots — exceeds 48h threshold. Ensure npm run done-check runs at least daily. Check if the watcher service is running: systemctl --user status codegraph-watcher.service.`
        : `Snapshot cadence is consistent. Run npm run integrity:verify to compare latest JSONL snapshot against baseline. Run npm run graph:metrics to record a fresh GraphMetricsSnapshot.`,
    detail: { gmsCount: d25gmsCount, gmsGapHours: d25gmsGap, intAge: d25intAge },
  });

  // ── D26–D33: RF-6→RF-9 Confidence & Invariant Meta-Health ──────

  // D26: Is the shadow lane producing variance?
  const d26 = await query(`
    MATCH (r:VerificationRun {projectId: $pid})
    WHERE r.shadowEffectiveConfidence IS NOT NULL
    WITH collect(DISTINCT round(r.shadowEffectiveConfidence * 1000) / 1000.0) AS distinctVals,
      count(r) AS total
    RETURN size(distinctVals) AS distinctShadowValues, total
  `, { pid });
  const d26Distinct = d26[0]?.distinctShadowValues || 0;
  const d26Total = d26[0]?.total || 0;
  const d26Healthy = d26Distinct > 1 || d26Total === 0;
  results.push({
    id: 'D26', question: 'Is the shadow lane producing variance? (degeneracy detection)',
    answer: d26Total === 0
      ? 'No shadow data yet.'
      : `${d26Distinct} distinct shadowEC values across ${d26Total} VRs.${d26Distinct <= 1 ? ' DEGENERATE — all VRs have identical shadowEC.' : ''}`,
    healthy: d26Healthy,
    nextStep: !d26Healthy
      ? `Shadow lane is degenerate (all VRs have same shadowEC). This means TCF=1.0 everywhere — evidence is too young for temporal decay. Run npm run tc:pipeline after evidence ages past defaultValidityHours (168h / 7 days). If you need to test now, backdate VR timestamps.`
      : d26Total === 0
        ? `No shadow data. Run npm run tc:pipeline to compute shadow propagation.`
        : `Shadow lane is producing real variance — ${d26Distinct} distinct values. Shadow vs production divergence is meaningful.`,
    detail: { distinctShadowValues: d26Distinct, total: d26Total },
  });

  // D27: Is shadow divergence trending up or down?
  const d27 = await query(`
    MATCH (r:VerificationRun {projectId: $pid})
    WHERE r.shadowEffectiveConfidence IS NOT NULL AND r.effectiveConfidence IS NOT NULL
    WITH r.tool AS tool,
      avg(abs(r.shadowEffectiveConfidence - r.effectiveConfidence)) AS avgDiv,
      count(r) AS cnt
    RETURN tool, round(avgDiv * 10000) / 10000.0 AS divergence, cnt ORDER BY divergence DESC
  `, { pid });
  const d27MaxDiv = d27.length > 0 ? Math.max(...d27.map(r => r.divergence)) : 0;
  const d27Healthy = d27MaxDiv < 0.30;
  results.push({
    id: 'D27', question: 'Is shadow divergence within safe bounds? (formula drift detection)',
    answer: d27.length === 0
      ? 'No shadow data for divergence check.'
      : `Max tool divergence: ${d27MaxDiv.toFixed(4)}. ${d27.map(r => `${r.tool}: ${r.divergence}`).join(', ')}`,
    healthy: d27Healthy,
    nextStep: !d27Healthy
      ? `Shadow divergence exceeds 0.30 for at least one tool — production and shadow formulas disagree significantly. Review temporal-confidence.ts decay parameters vs shadow-propagation.ts damping. Consider running calibration: npm run tc:pipeline.`
      : d27.length === 0
        ? `No shadow data yet. Run npm run tc:pipeline.`
        : `Shadow divergence is within bounds (<0.30). Divergence shows how much the shadow alternative formula would change confidence scores.`,
    detail: { tools: d27 },
  });

  // D28: Are any tools immune to anti-gaming caps?
  const d28 = await query(`
    MATCH (r:VerificationRun {projectId: $pid})
    WHERE r.sourceFamily IS NOT NULL AND r.effectiveConfidence IS NOT NULL
    WITH r.sourceFamily AS fam, avg(r.effectiveConfidence) AS avgEC, count(r) AS cnt
    WHERE avgEC > 0.85
    RETURN fam, round(avgEC * 1000) / 1000.0 AS avgEC, cnt
  `, { pid });
  const d28Healthy = d28.length === 0;
  results.push({
    id: 'D28', question: 'Are any tools immune to anti-gaming caps? (confidence domination)',
    answer: d28.length === 0
      ? 'No source family exceeds the 0.85 cap.'
      : `${d28.length} families exceed cap: ${d28.map(r => `${r.fam} (avg ${r.avgEC}, n=${r.cnt})`).join(', ')}`,
    healthy: d28Healthy,
    nextStep: !d28Healthy
      ? `Source families exceeding 0.85 cap dominate aggregate confidence. If done-check (confidence=1.0 by design), this is expected — it's a project-level gate. For scanner tools, review anti-gaming sourceFamilyCap in anti-gaming.ts.`
      : `All source families are within the 0.85 anti-gaming cap. Confidence is distributed across tools.`,
    detail: { exceeding: d28 },
  });

  // D29: Is evidence age diverse enough for calibration?
  const d29 = await query(`
    MATCH (r:VerificationRun {projectId: $pid})
    WHERE r.observedAt IS NOT NULL
    WITH min(datetime(r.observedAt)) AS oldest, max(datetime(r.observedAt)) AS newest,
      duration.between(min(datetime(r.observedAt)), max(datetime(r.observedAt))) AS span
    RETURN toString(oldest) AS oldest, toString(newest) AS newest, span.days AS spanDays
  `, { pid });
  const d29SpanDays = d29[0]?.spanDays || 0;
  const d29Healthy = d29SpanDays >= 7;
  results.push({
    id: 'D29', question: 'Is evidence age diverse enough for calibration? (age distribution)',
    answer: d29.length === 0
      ? 'No VR timestamps found.'
      : `Evidence spans ${d29SpanDays} days (${d29[0].oldest} to ${d29[0].newest}). ${d29SpanDays < 7 ? 'Too narrow — calibration Brier will be trivially perfect.' : 'Sufficient age diversity for meaningful calibration.'}`,
    healthy: d29Healthy,
    nextStep: !d29Healthy
      ? `Evidence spans only ${d29SpanDays} days — less than the 7-day validity window. Calibration scores are meaningless (memorizing, not predicting). Re-run SARIF scans (npm run verification:scan) periodically to accumulate diverse-age evidence. The system needs evidence that has actually aged past the 168h validity window.`
      : `Evidence age spans ${d29SpanDays} days. TCF decay will produce real variance once oldest evidence passes the 7-day validity window, enabling meaningful calibration.`,
    detail: { spanDays: d29SpanDays, oldest: d29[0]?.oldest, newest: d29[0]?.newest },
  });

  // D30: Is the promotion gate stuck?
  const d30 = await query(`
    MATCH (r:VerificationRun {projectId: $pid})
    WHERE r.shadowEffectiveConfidence IS NOT NULL AND r.effectiveConfidence IS NOT NULL
    WITH avg(abs(r.shadowEffectiveConfidence - r.effectiveConfidence)) AS avgDiv,
      max(abs(r.shadowEffectiveConfidence - r.effectiveConfidence)) AS maxDiv
    RETURN round(avgDiv * 10000) / 10000.0 AS avgDiv, round(maxDiv * 10000) / 10000.0 AS maxDiv,
      CASE WHEN avgDiv <= 0.15 AND maxDiv <= 0.30 THEN true ELSE false END AS eligible
  `, { pid });
  const d30Eligible = d30[0]?.eligible ?? false;
  results.push({
    id: 'D30', question: 'Is the promotion gate stuck? (shadow→production readiness)',
    answer: d30.length === 0
      ? 'No shadow data — promotion gate not evaluable.'
      : `Promotion: ${d30Eligible ? 'ELIGIBLE' : 'BLOCKED'}. avgDiv=${d30[0].avgDiv}, maxDiv=${d30[0].maxDiv}. Thresholds: avg≤0.15, max≤0.30.`,
    healthy: true, // Being blocked isn't unhealthy — it means the system is correctly cautious
    nextStep: d30Eligible
      ? `Shadow lane is eligible for promotion. Run calibration (npm run tc:pipeline) to check if Brier scores also qualify. Both divergence AND calibration must pass.`
      : d30.length === 0
        ? `No shadow data. Run npm run tc:pipeline to compute shadow propagation.`
        : `Promotion blocked — ${d30[0].avgDiv > 0.15 ? 'avgDiv exceeds 0.15' : 'maxDiv exceeds 0.30'}. This is expected when evidence is young or formulas diverge. Re-evaluate after evidence ages past 7-day validity.`,
    detail: { eligible: d30Eligible, avgDiv: d30[0]?.avgDiv, maxDiv: d30[0]?.maxDiv },
  });

  // D31: Are all formalized invariants executable?
  let d31Failures = 0;
  let d31Total = 0;
  const d31Details: string[] = [];
  try {
    const { INVARIANT_REGISTRY } = await import('../../core/config/invariant-registry-schema.js');
    d31Total = INVARIANT_REGISTRY.length;
    for (const inv of INVARIANT_REGISTRY) {
      try {
        const q = inv.diagnosticQueryTemplate.replace(/\$projectId/g, `'${pid}'`);
        await query(`EXPLAIN ${q}`);
      } catch (e: any) {
        d31Failures++;
        d31Details.push(`${inv.invariantId}: ${e.message?.substring(0, 80)}`);
      }
    }
  } catch {
    d31Details.push('Could not import INVARIANT_REGISTRY');
    d31Failures = -1;
  }
  const d31Healthy = d31Failures === 0 && d31Total > 0;
  results.push({
    id: 'D31', question: 'Are all formalized invariants executable? (query validity)',
    answer: d31Failures === -1
      ? 'Could not load invariant registry.'
      : d31Failures === 0
        ? `All ${d31Total} invariants have valid Cypher queries.`
        : `${d31Failures}/${d31Total} invariants have invalid queries: ${d31Details.join('; ')}`,
    healthy: d31Healthy,
    nextStep: !d31Healthy
      ? `${d31Failures} invariant diagnostic queries fail to parse. Fix the Cypher in invariant-registry-schema.ts. Failures: ${d31Details.join('; ')}`
      : `All ${d31Total} invariant queries are valid. Run them periodically to check for violations: npm run done-check includes invariant evaluation.`,
    detail: { total: d31Total, failures: d31Failures, details: d31Details },
  });

  // D32: Do any ENFORCED invariants have violations?
  const d32 = await query(`
    MATCH (iv:InvariantViolation)
    WHERE iv.enforcementMode = 'enforced' OR iv.severity = 'enforced'
    RETURN iv.invariantId AS invariant, count(iv) AS violations
    ORDER BY violations DESC
  `);
  const d32Violations = d32.reduce((s, r) => s + (r.violations || 0), 0);
  const d32Healthy = d32Violations === 0;
  results.push({
    id: 'D32', question: 'Do any ENFORCED invariants have violations? (illegal state detection)',
    answer: d32Violations === 0
      ? 'No ENFORCED invariant violations. Graph is in a legal state.'
      : `${d32Violations} ENFORCED violations across ${d32.length} invariants: ${d32.map(r => `${r.invariant} (${r.violations})`).join(', ')}. THE GRAPH IS IN AN ILLEGAL STATE.`,
    healthy: d32Healthy,
    nextStep: !d32Healthy
      ? `CRITICAL: ENFORCED invariants are violated — the graph's own rules say this state is illegal. Investigate each: ${d32.map(r => r.invariant).join(', ')}. Run the diagnostic query for each from invariant-registry-schema.ts to find counterexamples. Fix the data or downgrade the invariant to advisory if the rule is wrong.`
      : `No ENFORCED violations. The graph satisfies its own structural laws. Advisory violations may still exist — check with npm run done-check.`,
    detail: { violations: d32 },
  });

  // D33: Is invariant coverage complete?
  let d33Total = 0;
  let d33CoveredScopes: string[] = [];
  try {
    const { INVARIANT_REGISTRY } = await import('../../core/config/invariant-registry-schema.js');
    d33Total = INVARIANT_REGISTRY.length;
    d33CoveredScopes = [...new Set(INVARIANT_REGISTRY.map(i => i.scope))];
  } catch { /* ignore */ }
  const d33NodeTypes = await query(`
    MATCH (n) WHERE n.projectId = $pid
    WITH labels(n) AS lbls UNWIND lbls AS lbl
    RETURN DISTINCT lbl ORDER BY lbl
  `, { pid });
  const d33Labels = d33NodeTypes.map(r => r.lbl);
  const d33Healthy = d33Total >= 10 && d33CoveredScopes.length >= 2;
  results.push({
    id: 'D33', question: 'Is invariant coverage complete? (scope and breadth)',
    answer: `${d33Total} invariants covering scopes: [${d33CoveredScopes.join(', ')}]. Project has ${d33Labels.length} node labels: [${d33Labels.slice(0, 10).join(', ')}${d33Labels.length > 10 ? '...' : ''}].`,
    healthy: d33Healthy,
    nextStep: d33Total < 10
      ? `Only ${d33Total} invariants defined — consider adding more for uncovered node types. RF-9 added provenance, temporal, trust, and saturation. Consider adding invariants for: SourceFile referential integrity, Function call-graph consistency, Claim evidence minimum thresholds.`
      : d33CoveredScopes.length < 2
        ? `Invariants only cover scope: ${d33CoveredScopes.join(', ')}. Add project-scope and milestone-scope invariants for broader coverage.`
        : `${d33Total} invariants across ${d33CoveredScopes.length} scopes. Coverage is adequate. Review quarterly to ensure new node/edge types have corresponding invariants.`,
    detail: { totalInvariants: d33Total, scopes: d33CoveredScopes, nodeLabels: d33Labels },
  });

  // ── D34: Confidence Entropy Health ──────────────────────────────────
  const d34VRs = await query(`
    MATCH (vr:VerificationRun {projectId: $pid})
    WHERE vr.effectiveConfidence IS NOT NULL
    RETURN vr.effectiveConfidence AS ec
  `, { pid });
  
  // Compute entropy inline (same algorithm as confidence-analytics.ts)
  const d34BinCount = 10;
  const d34Bins = new Array(d34BinCount).fill(0);
  for (const row of d34VRs) {
    const ec = typeof row.ec === 'number' ? row.ec : Number(row.ec);
    const idx = Math.min(Math.floor(Math.max(0, Math.min(1, ec)) * d34BinCount), d34BinCount - 1);
    d34Bins[idx]++;
  }
  let d34Entropy = 0;
  let d34Occupied = 0;
  const d34Total = d34VRs.length;
  if (d34Total > 1) {
    for (const count of d34Bins) {
      if (count > 0) {
        d34Occupied++;
        const p = count / d34Total;
        d34Entropy -= p * Math.log2(p);
      }
    }
  }
  const d34MaxEntropy = Math.log2(d34BinCount);
  const d34Normalized = d34MaxEntropy > 0 ? d34Entropy / d34MaxEntropy : 0;
  // Degenerate = all in one bin (H ≈ 0). Healthy = some spread (normalized > 0.2)
  const d34Healthy = d34Total === 0 || d34Normalized > 0.2;
  
  results.push({
    id: 'D34', question: 'Is confidence entropy healthy? (distribution not degenerate)',
    answer: `${d34Total} VRs, entropy H=${d34Entropy.toFixed(3)} (normalized ${(d34Normalized * 100).toFixed(1)}%), ${d34Occupied}/${d34BinCount} bins occupied. Distribution: [${d34Bins.join(', ')}].`,
    healthy: d34Healthy,
    nextStep: d34Total === 0
      ? 'No VRs with effectiveConfidence — run `npm run verification:scan` then `npm run tc:recompute`.'
      : d34Normalized <= 0.2
        ? `Confidence distribution is degenerate (${d34Occupied} bins occupied). This means the TC pipeline isn't producing meaningful variance. Run fresh scans from different tools, or wait for evidence to age past defaultValidityHours (168h) for TCF decay to add variance.`
        : `Entropy is healthy at ${(d34Normalized * 100).toFixed(1)}%. Monitor for collapse — if this drops below 20% in a single period, investigate gaming or tool failure.`,
    detail: { totalVRs: d34Total, entropy: d34Entropy, normalized: d34Normalized, occupied: d34Occupied, bins: d34Bins },
  });

  // ── D35: Confidence Entropy Trend (collapse/spike detection) ──────
  // Compare current entropy with a baseline expectation
  // If all VRs have EC=1.0, that's the degenerate state (D26 also catches this via shadow)
  const d35AllSame = d34Occupied <= 1 && d34Total > 10;
  const d35Healthy = !d35AllSame;
  
  results.push({
    id: 'D35', question: 'Is confidence entropy showing collapse? (abrupt uniformity)',
    answer: d34Total <= 1
      ? 'Insufficient VRs for trend analysis.'
      : d35AllSame
        ? `COLLAPSE: All ${d34Total} VRs concentrated in ${d34Occupied} bin(s). Entropy ≈ 0. The TC pipeline is producing identical confidence for everything — no discrimination.`
        : `${d34Occupied} occupied bins across ${d34Total} VRs. No collapse detected.`,
    healthy: d35Healthy,
    nextStep: d35AllSame
      ? 'Entropy collapse detected. Root causes: (1) All evidence is new (TCF=1.0 everywhere — wait for aging), (2) Single tool dominance (one sourceFamily providing all VRs), (3) Anti-gaming cap too generous. Check D26 (shadow degeneracy) and D28 (source-family dominance) for corroboration.'
      : 'Entropy stable. Record current entropy in GraphMetricsSnapshot for trend tracking. Alert if normalizedEntropy drops >50% between consecutive snapshots.',
    detail: { allSame: d35AllSame, occupiedBins: d34Occupied, totalVRs: d34Total },
  });

  // ── D36: Embedding Coverage (nodes missing/failed embeddings) ──────
  const d36 = await query(`
    MATCH (n:CodeNode {projectId: $pid})
    WHERE n.sourceCode IS NOT NULL
    WITH count(n) AS total,
         sum(CASE WHEN n.embeddingStatus = 'failed' THEN 1 ELSE 0 END) AS failed,
         sum(CASE WHEN n:Embedded THEN 1 ELSE 0 END) AS embedded
    RETURN total, failed, embedded, total - embedded - failed AS missing
  `, { pid });
  const d36Total = Number(d36[0]?.total ?? 0);
  const d36Failed = Number(d36[0]?.failed ?? 0);
  const d36Embedded = Number(d36[0]?.embedded ?? 0);
  const d36Missing = Number(d36[0]?.missing ?? 0);
  const d36Healthy = d36Failed === 0 && d36Missing < d36Total * 0.05;

  results.push({
    id: 'D36', question: 'Do all code nodes have embeddings? (semantic search coverage)',
    answer: `${d36Embedded}/${d36Total} embedded, ${d36Failed} failed, ${d36Missing} missing. Coverage: ${d36Total > 0 ? ((d36Embedded / d36Total) * 100).toFixed(1) : 0}%.`,
    healthy: d36Healthy,
    nextStep: d36Failed > 0
      ? `${d36Failed} nodes have embeddingStatus='failed' — embedding API error during import. These nodes are in the graph but invisible to NL search. Re-run embedding: cypher-shell -u neo4j -p codegraph "MATCH (n:CodeNode {projectId: '${pid}', embeddingStatus: 'failed'}) RETURN n.name, n.embeddingError LIMIT 10".`
      : d36Missing > d36Total * 0.05
        ? `${d36Missing} nodes have sourceCode but no embedding and no failure marker. These may predate the embedding pipeline. Re-run parse or a dedicated embedding enrichment script.`
        : `Embedding coverage is good. ${d36Embedded}/${d36Total} nodes have embeddings for semantic search.`,
    detail: { total: d36Total, embedded: d36Embedded, failed: d36Failed, missing: d36Missing },
  });

  // ── D37: Semantic role coverage (RF-13) ──────
  const d37 = await query(`
    MATCH (sf:SourceFile {projectId: $pid})
    RETURN count(sf) AS total,
           sum(CASE WHEN sf.semanticRole IS NOT NULL THEN 1 ELSE 0 END) AS tagged,
           sum(CASE WHEN sf.semanticRole = 'unclassified' THEN 1 ELSE 0 END) AS unclassified
  `, { pid });
  const d37Total = Number(d37[0]?.total ?? 0);
  const d37Tagged = Number(d37[0]?.tagged ?? 0);
  const d37Unclassified = Number(d37[0]?.unclassified ?? 0);
  const d37Coverage = d37Total > 0 ? (d37Tagged / d37Total) : 0;
  results.push({
    id: 'D37', question: 'Do SourceFiles have semanticRole coverage? (RF-13)',
    answer: `${d37Tagged}/${d37Total} tagged (${(d37Coverage * 100).toFixed(1)}%), unclassified=${d37Unclassified}`,
    healthy: d37Coverage >= 0.99,
    nextStep: d37Coverage < 0.99
      ? `Run npm run enrich:semantic-roles. Then inspect missing roles: cypher-shell -u neo4j -p codegraph "MATCH (sf:SourceFile {projectId: '${pid}'}) WHERE sf.semanticRole IS NULL RETURN sf.name, sf.filePath LIMIT 20".`
      : d37Unclassified > d37Total * 0.5
        ? `Coverage is complete but many files are unclassified (${d37Unclassified}). Expand config/semantic-role-map.json rules to reduce unknowns where appropriate.`
        : `Semantic role coverage is healthy. Use role-scoped queries for RF-14 god-file selection.`,
    detail: { total: d37Total, tagged: d37Tagged, unclassified: d37Unclassified, coverage: d37Coverage },
  });

  // ── D38: Function-level test coverage (RF-14) ──────
  const d38 = await query(`
    MATCH (f:Function {projectId: $pid})
    RETURN count(f) AS total,
           sum(CASE WHEN f.hasTestCaller = true THEN 1 ELSE 0 END) AS covered
  `, { pid });
  const d38Total = Number(d38[0]?.total ?? 0);
  const d38Covered = Number(d38[0]?.covered ?? 0);
  const d38Pct = d38Total > 0 ? (d38Covered / d38Total) : 0;
  results.push({
    id: 'D38', question: 'What percentage of functions have a test caller? (RF-14)',
    answer: `${d38Covered}/${d38Total} (${(d38Pct * 100).toFixed(1)}%) functions have hasTestCaller=true`,
    healthy: d38Pct >= 0.30,
    nextStep: d38Pct < 0.30
      ? `Function-level test coverage is below 30%. Run npm run enrich:test-coverage to refresh, then write tests for CRITICAL untested functions.`
      : `Function-level test coverage is above 30%. Continue to increase coverage for CRITICAL/HIGH risk functions.`,
    detail: { total: d38Total, covered: d38Covered, pct: d38Pct },
  });

  return results;
}

export async function main() {
  console.log('🔬 Self-Diagnosis — 38 Epistemological Health Checks\n');
  console.log('   "Does the graph know what it doesn\'t know?"\n');

  try {
    const results = await runDiagnosis();

    let healthy = 0;
    let unhealthy = 0;

    for (const r of results) {
      const icon = r.healthy ? '✅' : '❌';
      console.log(`${icon} ${r.id}: ${r.question}`);
      console.log(`   ${r.answer}`);
      console.log(`   → ${r.nextStep}\n`);

      if (r.healthy) healthy++;
      else unhealthy++;
    }

    console.log('═'.repeat(65));
    console.log(`📊 Health: ${healthy}/${results.length} checks pass (of 37), ${unhealthy} need attention`);

    // JSON output for machine consumption
    const jsonOutput = {
      timestamp: new Date().toISOString(),
      projectId: await getProjectId(),
      healthy,
      unhealthy,
      total: results.length,
      results,
    };
    console.log('\n' + JSON.stringify(jsonOutput));

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

export async function closeDriver(): Promise<void> {
  await driver.close();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/self-diagnosis.ts') || process.argv[1]?.endsWith('/self-diagnosis.js')) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
