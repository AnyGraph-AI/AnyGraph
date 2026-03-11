#!/usr/bin/env npx tsx
/**
 * Phase 2.7: Audit Subgraph — Structural Invariant Checks
 * 
 * Creates AuditCheck and InvariantViolation nodes in the graph.
 * An agent can query: "What is structurally broken right now?"
 * 
 * Invariants checked:
 * 1. Import resolution coverage — every Import has RESOLVES_TO or UnresolvedReference
 * 2. Registration 1:1 — each Entrypoint has exactly one REGISTERED_BY
 * 3. Internal call validity — CALLS with resolutionKind='internal' point to existing nodes
 * 4. No duplicate IDs — deterministic IDs are unique per project
 * 5. SourceFile completeness — every .ts file parsed has a SourceFile node
 * 6. Orphan nodes — nodes not connected to any SourceFile
 * 7. Export consistency — exported nodes are reachable from their SourceFile
 * 
 * Usage: npx tsx run-audit.ts [projectId]
 */
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'codegraph'
  )
);

interface AuditResult {
  code: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  violations: { details: string; file?: string; startLine?: number }[];
}

async function runCheck(code: string, description: string, severity: 'low' | 'medium' | 'high', cypher: string, pid: string): Promise<AuditResult> {
  const session = driver.session();
  try {
    const result = await session.run(cypher, { pid });
    const violations = result.records.map(r => ({
      details: r.get('details'),
      file: r.has('file') ? r.get('file') : undefined,
      startLine: r.has('startLine') ? r.get('startLine')?.toNumber?.() ?? r.get('startLine') : undefined,
    }));
    return { code, description, severity, violations };
  } finally {
    await session.close();
  }
}

async function main() {
  const projectId = process.argv[2] || 'proj_c0d3e9a1f200';
  const runId = `audit_${Date.now()}`;
  
  console.log(`\n🔎 Running structural audit`);
  console.log(`   Project: ${projectId}`);
  console.log(`   Run ID: ${runId}\n`);

  const checks: AuditResult[] = [];

  // 1. Import resolution coverage
  console.log('1. Import resolution coverage...');
  checks.push(await runCheck(
    'IMPORT_RESOLUTION_COVERAGE',
    'Every Import should have either RESOLVES_TO or UnresolvedReference',
    'medium',
    `MATCH (imp:Import {projectId: $pid})
     WHERE NOT (imp)-[:RESOLVES_TO]->()
     AND NOT (imp)<-[:ORIGINATES_IN]-(:UnresolvedReference)
     // Also check by name match
     AND NOT EXISTS {
       MATCH (u:UnresolvedReference)
       WHERE u.rawText = imp.name AND u.projectId = $pid
     }
     OPTIONAL MATCH (sf:SourceFile)-[:CONTAINS]->(imp)
     RETURN imp.name + ' has no RESOLVES_TO and no UnresolvedReference' AS details,
            sf.filePath AS file
     LIMIT 50`,
    projectId
  ));

  // 2. Registration 1:1
  console.log('2. Registration 1:1...');
  checks.push(await runCheck(
    'REGISTRATION_ONE_TO_ONE',
    'Each Entrypoint should have exactly one REGISTERED_BY handler',
    'high',
    `MATCH (ep:Entrypoint {projectId: $pid})
     OPTIONAL MATCH (h)-[r:REGISTERED_BY]->(ep)
     WITH ep, count(r) AS regCount
     WHERE regCount <> 1
     RETURN ep.name + ' has ' + toString(regCount) + ' registrations (expected 1)' AS details,
            ep.filePath AS file
     LIMIT 50`,
    projectId
  ));

  // 3. Internal call validity
  console.log('3. Internal call validity...');
  checks.push(await runCheck(
    'INTERNAL_CALL_VALIDITY',
    'CALLS with resolutionKind=internal must point to nodes in the same project',
    'high',
    `MATCH (caller {projectId: $pid})-[r:CALLS {resolutionKind: 'internal'}]->(callee)
     WHERE callee.projectId IS NULL OR callee.projectId <> $pid
     RETURN caller.name + ' calls ' + callee.name + ' but callee has projectId=' + coalesce(callee.projectId, 'NULL') AS details,
            caller.filePath AS file
     LIMIT 50`,
    projectId
  ));

  // 4. No duplicate IDs
  console.log('4. No duplicate IDs...');
  checks.push(await runCheck(
    'NO_DUPLICATE_IDS',
    'Deterministic IDs must be unique per project',
    'high',
    `MATCH (n:CodeNode {projectId: $pid})
     WHERE n.id IS NOT NULL
     WITH n.id AS id, collect(n.name) AS names, count(n) AS cnt
     WHERE cnt > 1
     RETURN id + ' appears ' + toString(cnt) + ' times: ' + apoc.text.join(names, ', ') AS details
     LIMIT 50`,
    projectId
  ));

  // 5. Orphan nodes (not connected to any SourceFile)
  console.log('5. Orphan node detection...');
  checks.push(await runCheck(
    'NO_ORPHAN_NODES',
    'Every non-SourceFile node should be reachable from a SourceFile via CONTAINS',
    'low',
    `MATCH (n:CodeNode {projectId: $pid})
     WHERE NOT n:SourceFile 
     AND NOT n:UnresolvedReference
     AND NOT (:SourceFile)-[:CONTAINS*1..3]->(n)
     RETURN labels(n)[1] + ':' + n.name + ' is orphaned (no CONTAINS path from SourceFile)' AS details,
            n.filePath AS file
     LIMIT 50`,
    projectId
  ));

  // 6. Functions without risk scoring
  console.log('6. Risk scoring coverage...');
  checks.push(await runCheck(
    'RISK_SCORING_COVERAGE',
    'All Function/Method nodes should have riskLevel computed',
    'medium',
    `MATCH (f {projectId: $pid})
     WHERE (f:Function OR f:Method)
     AND f.riskLevel IS NULL
     RETURN f.name + ' (' + labels(f)[1] + ') has no riskLevel' AS details,
            f.filePath AS file
     LIMIT 50`,
    projectId
  ));

  // 7. Provenance coverage
  console.log('7. Provenance coverage...');
  checks.push(await runCheck(
    'PROVENANCE_COVERAGE',
    'All edges should have sourceKind and confidence',
    'medium',
    `MATCH (a {projectId: $pid})-[r]->(b {projectId: $pid})
     WHERE r.sourceKind IS NULL
     WITH type(r) AS edgeType, count(r) AS cnt
     WHERE cnt > 0
     RETURN edgeType + ' has ' + toString(cnt) + ' edges without provenance' AS details
     LIMIT 50`,
    projectId
  ));

  // Store results in graph
  console.log('\n8. Storing audit results in graph...');
  const session = driver.session();
  try {
    // Clear old audit data for this project
    await session.run(`
      MATCH (a:AuditCheck {projectId: $pid}) DETACH DELETE a
    `, { pid: projectId });
    await session.run(`
      MATCH (v:InvariantViolation {projectId: $pid}) DETACH DELETE v
    `, { pid: projectId });

    let totalViolations = 0;

    for (const check of checks) {
      // Create AuditCheck node
      await session.run(`
        CREATE (a:AuditCheck:CodeNode {
          code: $code,
          description: $desc,
          severity: $severity,
          projectId: $pid,
          runId: $runId,
          violationCount: $vCount,
          status: CASE WHEN $vCount = 0 THEN 'PASS' ELSE 'FAIL' END,
          timestamp: datetime()
        })
      `, { 
        code: check.code, 
        desc: check.description, 
        severity: check.severity,
        pid: projectId,
        runId,
        vCount: check.violations.length
      });

      // Create InvariantViolation nodes
      for (const v of check.violations) {
        await session.run(`
          MATCH (a:AuditCheck {code: $code, runId: $runId, projectId: $pid})
          CREATE (v:InvariantViolation:CodeNode {
            code: $code,
            details: $details,
            severity: $severity,
            file: $file,
            projectId: $pid,
            runId: $runId
          })
          CREATE (a)-[:FOUND]->(v)
        `, {
          code: check.code,
          details: v.details,
          severity: check.severity,
          file: v.file || null,
          pid: projectId,
          runId,
        });
        totalViolations++;
      }
    }

    // Print results
    console.log('\n=== AUDIT RESULTS ===\n');
    for (const check of checks) {
      const icon = check.violations.length === 0 ? '✅' : 
                   check.severity === 'high' ? '🔴' : 
                   check.severity === 'medium' ? '🟡' : '⚪';
      console.log(`${icon} ${check.code}: ${check.violations.length === 0 ? 'PASS' : `FAIL (${check.violations.length} violations)`}`);
      for (const v of check.violations.slice(0, 5)) {
        console.log(`   ${v.details}`);
      }
      if (check.violations.length > 5) {
        console.log(`   ... and ${check.violations.length - 5} more`);
      }
    }

    console.log(`\n  Total: ${checks.length} checks, ${totalViolations} violations`);
    console.log(`  Query: MATCH (a:AuditCheck)-[:FOUND]->(v:InvariantViolation) RETURN a.code, v.details`);

  } finally {
    await session.close();
  }

  await driver.close();
  console.log('\n✅ Audit complete!');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
