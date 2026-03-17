#!/usr/bin/env npx tsx
/**
 * probe-architecture — Run 25 structural queries against the live graph.
 * Instant credibility: one command shows what the graph knows about itself.
 *
 * Usage: npm run probe-architecture
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

interface ProbeResult {
  id: string;
  name: string;
  category: string;
  status: 'pass' | 'warn' | 'info';
  summary: string;
  rows: Record<string, any>[];
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

async function runProbes(): Promise<ProbeResult[]> {
  const pid = await getProjectId();
  const results: ProbeResult[] = [];

  // === Code Graph Understanding ===

  // Q1: Top risk functions
  const q1 = await query(`
    MATCH (f:Function {projectId: $pid})
    RETURN f.name AS name, f.filePath AS file, f.riskLevel AS risk,
           f.fanInCount AS fanIn, f.fanOutCount AS fanOut, f.riskTier AS tier
    ORDER BY f.riskLevel DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q1', name: 'Top 10 functions by riskLevel', category: 'Code',
    status: 'info', summary: `Highest risk: ${q1[0]?.name || 'none'} (${q1[0]?.risk || 0})`,
    rows: q1,
  });

  // Q2: Git change frequency
  const q2 = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.commitCount IS NOT NULL AND f.commitCount > 0
    RETURN f.name AS name, f.commitCount AS commits, f.churnTotal AS churn,
           f.fanInCount AS fanIn
    ORDER BY f.commitCount DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q2', name: 'High change frequency functions', category: 'Code',
    status: q2.length > 0 ? 'info' : 'warn',
    summary: q2.length > 0 ? `Most changed: ${q2[0]?.name} (${q2[0]?.commits} commits)` : 'No git frequency data',
    rows: q2,
  });

  // Q3: Deepest call chains
  const q3 = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.fanOutCount > 5
    OPTIONAL MATCH path = (f)-[:CALLS*1..3]->(t:Function)
    WITH f, count(DISTINCT t) AS blastRadius
    RETURN f.name AS name, f.filePath AS file, f.fanOutCount AS fanOut, blastRadius
    ORDER BY blastRadius DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q3', name: 'Deepest call chains (blast radius)', category: 'Code',
    status: 'info', summary: `Widest blast: ${q3[0]?.name || 'none'} (${q3[0]?.blastRadius || 0} reachable)`,
    rows: q3,
  });

  // Q4: CO_CHANGES_WITH temporal coupling
  const q4 = await query(`
    MATCH (a:SourceFile {projectId: $pid})-[r:CO_CHANGES_WITH]->(b:SourceFile)
    RETURN a.name AS file1, b.name AS file2, r.coChangeCount AS coChanges, r.confidence AS confidence
    ORDER BY r.coChangeCount DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q4', name: 'Temporally coupled files', category: 'Code',
    status: q4.length > 0 ? 'info' : 'warn',
    summary: q4.length > 0 ? `Strongest coupling: ${q4[0]?.file1} ↔ ${q4[0]?.file2} (${q4[0]?.coChanges})` : 'No temporal coupling data',
    rows: q4,
  });

  // Q5: Entrypoint dispatch chains
  const q5 = await query(`
    MATCH (e:Entrypoint {projectId: $pid})-[:DISPATCHES_TO]->(f)
    RETURN e.name AS entrypoint, f.name AS handler, labels(f) AS handlerType
    ORDER BY e.name LIMIT 15
  `, { pid });
  results.push({
    id: 'Q5', name: 'Entrypoint dispatch chains', category: 'Code',
    status: q5.length > 0 ? 'info' : 'warn',
    summary: `${q5.length} entrypoints with dispatch edges`,
    rows: q5.slice(0, 10),
  });

  // Q6: State field read/write analysis
  const q6 = await query(`
    MATCH (f:Field {projectId: $pid})
    OPTIONAL MATCH (f)<-[:WRITES_STATE]-(w)
    OPTIONAL MATCH (f)<-[:READS_STATE]-(r)
    WITH f, count(DISTINCT w) AS writers, count(DISTINCT r) AS readers
    WHERE writers > 0 OR readers > 0
    RETURN f.name AS field, f.className AS class, writers, readers
    ORDER BY readers + writers DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q6', name: 'Mutable state fields', category: 'Code',
    status: q6.length > 0 ? 'info' : 'warn',
    summary: `${q6.length} tracked fields with state edges`,
    rows: q6,
  });

  // === Plan ↔ Code Connections ===

  // Q7: Tasks with code evidence
  const q7 = await query(`
    MATCH (t:Task)-[:HAS_CODE_EVIDENCE]->(sf:SourceFile)
    RETURN t.name AS task, t.status AS status, sf.name AS file
    ORDER BY t.name LIMIT 10
  `);
  results.push({
    id: 'Q7', name: 'Tasks with code evidence', category: 'Plan↔Code',
    status: q7.length > 0 ? 'info' : 'warn',
    summary: `${q7.length}+ tasks linked to source files`,
    rows: q7,
  });

  // Q8: Cross-referenced files (multiple milestones)
  const q8 = await query(`
    MATCH (t:Task)-[:HAS_CODE_EVIDENCE]->(sf:SourceFile)
    MATCH (t)-[:PART_OF]->(m:Milestone)
    WITH sf, collect(DISTINCT m.name) AS milestones
    WHERE size(milestones) > 1
    RETURN sf.name AS file, milestones, size(milestones) AS msCount
    ORDER BY msCount DESC LIMIT 10
  `);
  results.push({
    id: 'Q8', name: 'Code referenced by multiple milestones', category: 'Plan↔Code',
    status: 'info', summary: `${q8.length} files span multiple milestones`,
    rows: q8,
  });

  // Q9: Cross-project code dependencies
  const q9 = await query(`
    MATCH (t:Task)-[:HAS_CODE_EVIDENCE]->(sf:SourceFile)
    WITH sf, collect(DISTINCT t.projectId) AS planProjects
    WHERE size(planProjects) > 1
    RETURN sf.name AS file, planProjects, size(planProjects) AS crossCount
    ORDER BY crossCount DESC LIMIT 10
  `);
  results.push({
    id: 'Q9', name: 'Code referenced across plan projects', category: 'Plan↔Code',
    status: 'info', summary: `${q9.length} files referenced across plan projects`,
    rows: q9,
  });

  // === Verification & Governance ===

  // Q10: VerificationRun distribution
  const q10 = await query(`
    MATCH (vr:VerificationRun {projectId: $pid})
    RETURN vr.sourceFamily AS source, count(vr) AS cnt,
           avg(vr.effectiveConfidence) AS avgEC
    ORDER BY cnt DESC
  `, { pid });
  results.push({
    id: 'Q10', name: 'Verification source distribution', category: 'Verification',
    status: q10.length > 0 ? 'info' : 'warn',
    summary: q10.map(r => `${r.source}: ${r.cnt}`).join(', ') || 'No VRs',
    rows: q10,
  });

  // Q11: FLAGS edge coverage
  const q11 = await query(`
    MATCH (f:Function {projectId: $pid})
    OPTIONAL MATCH (f)<-[:FLAGS]-(vr)
    WITH f, count(vr) AS flagCount
    RETURN
      count(f) AS totalFunctions,
      sum(CASE WHEN flagCount > 0 THEN 1 ELSE 0 END) AS flagged,
      sum(CASE WHEN flagCount = 0 THEN 1 ELSE 0 END) AS unflagged
  `, { pid });
  results.push({
    id: 'Q11', name: 'Function verification coverage (FLAGS)', category: 'Verification',
    status: 'info',
    summary: `${q11[0]?.flagged || 0}/${q11[0]?.totalFunctions || 0} functions have FLAGS edges`,
    rows: q11,
  });

  // Q12: ANALYZED edge coverage
  const q12 = await query(`
    MATCH (sf:SourceFile {projectId: $pid})
    OPTIONAL MATCH (sf)<-[:ANALYZED]-(vr)
    WITH sf, count(vr) AS analyzedCount
    RETURN
      count(sf) AS totalFiles,
      sum(CASE WHEN analyzedCount > 0 THEN 1 ELSE 0 END) AS analyzed,
      sum(CASE WHEN analyzedCount = 0 THEN 1 ELSE 0 END) AS unanalyzed
  `, { pid });
  results.push({
    id: 'Q12', name: 'File verification coverage (ANALYZED)', category: 'Verification',
    status: 'info',
    summary: `${q12[0]?.analyzed || 0}/${q12[0]?.totalFiles || 0} files have ANALYZED edges`,
    rows: q12,
  });

  // Q13: RiskTier distribution
  const q13 = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.riskTier IS NOT NULL
    RETURN f.riskTier AS tier, count(f) AS cnt ORDER BY cnt DESC
  `, { pid });
  results.push({
    id: 'Q13', name: 'Risk tier distribution', category: 'Verification',
    status: q13.some(r => r.tier === 'CRITICAL') ? 'info' : 'warn',
    summary: q13.map(r => `${r.tier}: ${r.cnt}`).join(', ') || 'No risk tiers',
    rows: q13,
  });

  // Q14: CRITICAL functions with zero verification
  const q14 = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.riskTier = 'CRITICAL'
    AND NOT (f)<-[:FLAGS]-()
    RETURN f.name AS name, f.filePath AS file, f.riskLevel AS risk
    ORDER BY f.riskLevel DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q14', name: 'CRITICAL functions without verification', category: 'Verification',
    status: q14.length > 0 ? 'warn' : 'pass',
    summary: q14.length > 0 ? `${q14.length} CRITICAL functions unverified` : 'All CRITICAL functions have verification',
    rows: q14,
  });

  // Q15: Governance self-defense
  const q15 = await query(`
    MATCH (vr:VerificationRun {projectId: $pid})-[:FLAGS]->(f:Function)
    WHERE f.filePath CONTAINS 'verify' OR f.filePath CONTAINS 'governance' OR f.filePath CONTAINS 'audit'
    RETURN f.name AS function, f.filePath AS file, count(vr) AS flagCount
    ORDER BY flagCount DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q15', name: 'Governance function self-defense', category: 'Verification',
    status: q15.length > 0 ? 'info' : 'warn',
    summary: `${q15.length} governance functions have verification coverage`,
    rows: q15,
  });

  // === Claims & Reasoning ===

  // Q16: Claim distribution
  const q16 = await query(`
    MATCH (c:Claim)
    RETURN c.claimType AS type, c.status AS status, count(c) AS cnt
    ORDER BY cnt DESC LIMIT 10
  `);
  results.push({
    id: 'Q16', name: 'Claim distribution by type', category: 'Claims',
    status: q16.length > 0 ? 'info' : 'warn',
    summary: `${q16.reduce((s, r) => s + r.cnt, 0)} total claims`,
    rows: q16,
  });

  // Q17: Contested claims
  const q17 = await query(`
    MATCH (c:Claim)
    WHERE c.status = 'contested'
    RETURN c.statement AS claim, c.confidence AS confidence
    ORDER BY c.confidence ASC LIMIT 5
  `);
  results.push({
    id: 'Q17', name: 'Contested claims (lowest confidence)', category: 'Claims',
    status: q17.length > 0 ? 'warn' : 'pass',
    summary: q17.length > 0 ? `${q17.length} contested claims` : 'No contested claims',
    rows: q17,
  });

  // Q18: Hypotheses
  const q18 = await query(`
    MATCH (h:Hypothesis)
    RETURN h.type AS type, h.severity AS severity, count(h) AS cnt
    ORDER BY cnt DESC
  `);
  results.push({
    id: 'Q18', name: 'Active hypotheses', category: 'Claims',
    status: q18.length > 0 ? 'info' : 'pass',
    summary: `${q18.reduce((s, r) => s + r.cnt, 0)} active hypotheses`,
    rows: q18,
  });

  // === Cross-Layer ===

  // Q19: High-risk + plan task + co-change
  const q19 = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.riskTier IN ['CRITICAL', 'HIGH']
    OPTIONAL MATCH (t:Task)-[:HAS_CODE_EVIDENCE]->(sf:SourceFile)-[:CONTAINS]->(f)
    OPTIONAL MATCH (sf2:SourceFile)-[:CONTAINS]->(f)
    OPTIONAL MATCH (sf2)-[:CO_CHANGES_WITH]-(partner)
    WITH f, count(DISTINCT t) AS taskRefs, count(DISTINCT partner) AS coChangePartners
    WHERE taskRefs > 0 OR coChangePartners > 0
    RETURN f.name AS name, f.filePath AS file, f.riskTier AS tier,
           taskRefs, coChangePartners
    ORDER BY taskRefs + coChangePartners DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q19', name: 'Cross-layer: risk + plan + coupling', category: 'Cross-Layer',
    status: 'info',
    summary: `${q19.length} high-risk functions with plan/coupling context`,
    rows: q19,
  });

  // Q20: Under-verified areas (high risk, no FLAGS, no evidence)
  const q20 = await query(`
    MATCH (f:Function {projectId: $pid})
    WHERE f.riskTier IN ['CRITICAL', 'HIGH']
    AND NOT (f)<-[:FLAGS]-()
    OPTIONAL MATCH (sf:SourceFile)-[:CONTAINS]->(f)
    OPTIONAL MATCH (t:Task)-[:HAS_CODE_EVIDENCE]->(sf)
    WITH f, count(DISTINCT t) AS taskRefs
    WHERE taskRefs = 0
    RETURN f.name AS name, f.filePath AS file, f.riskLevel AS risk, f.riskTier AS tier
    ORDER BY f.riskLevel DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q20', name: 'Under-verified high-risk functions', category: 'Cross-Layer',
    status: q20.length > 0 ? 'warn' : 'pass',
    summary: q20.length > 0 ? `${q20.length} high-risk functions with no verification AND no plan refs` : 'All high-risk functions have coverage',
    rows: q20,
  });

  // Q21: DISPATCHES_TO chain depth
  const q21 = await query(`
    MATCH (e:Entrypoint {projectId: $pid})-[:DISPATCHES_TO]->(h)
    OPTIONAL MATCH path = (h)-[:CALLS*1..4]->(deep)
    WITH e, h, count(DISTINCT deep) AS chainDepth
    RETURN e.name AS entrypoint, h.name AS handler, chainDepth
    ORDER BY chainDepth DESC LIMIT 10
  `, { pid });
  results.push({
    id: 'Q21', name: 'Entrypoint → handler chain depth', category: 'Cross-Layer',
    status: 'info',
    summary: `Deepest chain: ${q21[0]?.entrypoint || 'none'} → ${q21[0]?.chainDepth || 0} functions`,
    rows: q21,
  });

  // Q22: UnresolvedReference breakdown
  const q22 = await query(`
    MATCH (u:UnresolvedReference {projectId: $pid})
    RETURN u.reason AS reason, count(u) AS cnt ORDER BY cnt DESC
  `, { pid });
  results.push({
    id: 'Q22', name: 'Unresolved references', category: 'Cross-Layer',
    status: q22.some(r => r.reason === 'local-module-not-found') ? 'warn' : 'info',
    summary: q22.map(r => `${r.reason}: ${r.cnt}`).join(', ') || 'No unresolved refs',
    rows: q22,
  });

  // Q23: Graph size summary
  const q23 = await query(`
    MATCH (n {projectId: $pid})
    WITH labels(n) AS lbls, count(n) AS cnt
    UNWIND lbls AS lbl
    WITH lbl, sum(cnt) AS total
    WHERE lbl <> 'CodeNode'
    RETURN lbl AS label, total ORDER BY total DESC LIMIT 15
  `, { pid });
  results.push({
    id: 'Q23', name: 'Node type distribution', category: 'Summary',
    status: 'info', summary: `${q23.reduce((s, r) => s + r.total, 0)} total nodes (deduplicated by label)`,
    rows: q23,
  });

  // Q24: Edge type distribution
  const q24 = await query(`
    MATCH (s {projectId: $pid})-[r]->(t)
    RETURN type(r) AS edgeType, count(r) AS cnt,
           sum(CASE WHEN r.derived = true THEN 1 ELSE 0 END) AS derived
    ORDER BY cnt DESC LIMIT 20
  `, { pid });
  results.push({
    id: 'Q24', name: 'Edge type distribution', category: 'Summary',
    status: 'info', summary: `${q24.reduce((s, r) => s + r.cnt, 0)} total edges`,
    rows: q24,
  });

  // Q25: Project registry
  const q25 = await query(`
    MATCH (p:Project)
    RETURN p.name AS name, p.projectId AS pid, p.nodeCount AS nodes, p.edgeCount AS edges, p.status AS status
    ORDER BY p.nodeCount DESC
  `);
  results.push({
    id: 'Q25', name: 'Project registry', category: 'Summary',
    status: 'info', summary: `${q25.length} projects registered`,
    rows: q25,
  });

  return results;
}

async function main() {
  console.log('🏗️  Architecture Probe — 25 Queries Against Live Graph\n');

  try {
    const results = await runProbes();

    // Group by category
    const categories = [...new Set(results.map(r => r.category))];
    let warnings = 0;
    let passes = 0;

    for (const cat of categories) {
      console.log(`\n═══ ${cat} ${'═'.repeat(60 - cat.length)}`);
      const catResults = results.filter(r => r.category === cat);

      for (const r of catResults) {
        const icon = r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️' : 'ℹ️';
        console.log(`\n${icon} ${r.id}: ${r.name}`);
        console.log(`   ${r.summary}`);

        if (r.rows.length > 0 && r.rows.length <= 5) {
          for (const row of r.rows) {
            const vals = Object.entries(row).map(([k, v]) => `${k}=${v}`).join(', ');
            console.log(`   • ${vals}`);
          }
        } else if (r.rows.length > 5) {
          for (const row of r.rows.slice(0, 3)) {
            const vals = Object.entries(row).map(([k, v]) => `${k}=${v}`).join(', ');
            console.log(`   • ${vals}`);
          }
          console.log(`   ... and ${r.rows.length - 3} more`);
        }

        if (r.status === 'warn') warnings++;
        if (r.status === 'pass') passes++;
      }
    }

    console.log(`\n${'═'.repeat(65)}`);
    console.log(`📊 Summary: ${results.length} probes, ${passes} pass, ${warnings} warnings, ${results.length - passes - warnings} info`);

    if (warnings > 0) {
      console.log(`\n⚠️  ${warnings} areas need attention.`);
    } else {
      console.log('\n✅ All probes healthy.');
    }
  } finally {
    await driver.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
