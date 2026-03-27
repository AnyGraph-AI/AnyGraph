#!/usr/bin/env npx tsx
/**
 * Evaluation + Regression Feedback Subgraph (Addendum SG-2.4)
 * 
 * Compares graph metrics between runs to detect improvements/regressions.
 * Creates EvaluationRun, MetricResult, and RegressionCase nodes.
 * 
 * Usage: npx tsx run-evaluation.ts [projectId]
 * Default: runs on all projects
 */
import neo4j from 'neo4j-driver';
import { execSync } from 'child_process';

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'codegraph'));

interface MetricDef {
  name: string;
  query: string;
  higherIsBetter: boolean;
}

const METRICS: MetricDef[] = [
  {
    name: 'resolves_to_coverage',
    query: `
      MATCH (i:CodeNode {projectId: $pid})
      WHERE i:Import OR i.type = 'Import'
      WITH count(i) AS total
      OPTIONAL MATCH (i2:CodeNode {projectId: $pid})-[:RESOLVES_TO]->()
      WHERE i2:Import OR i2.type = 'Import'
      WITH total, count(DISTINCT i2) AS resolved
      RETURN CASE WHEN total > 0 THEN round(1000.0 * resolved / total) / 10 ELSE 0 END AS value
    `,
    higherIsBetter: true,
  },
  {
    name: 'unresolved_local_imports',
    query: `
      MATCH (u:UnresolvedReference {projectId: $pid})
      WHERE u.reason = 'local-module-not-found'
      RETURN count(u) AS value
    `,
    higherIsBetter: false,
  },
  {
    name: 'risk_scoring_coverage_pct',
    query: `
      MATCH (f:CodeNode {projectId: $pid})
      WHERE f:Function OR f:Method
      WITH count(f) AS total
      OPTIONAL MATCH (f2:CodeNode {projectId: $pid})
      WHERE (f2:Function OR f2:Method) AND f2.riskLevel IS NOT NULL
      WITH total, count(f2) AS scored
      RETURN CASE WHEN total > 0 THEN round(1000.0 * scored / total) / 10 ELSE 0 END AS value
    `,
    higherIsBetter: true,
  },
  {
    name: 'provenance_coverage_pct',
    query: `
      MATCH (:CodeNode {projectId: $pid})-[r]->(:CodeNode {projectId: $pid})
      WITH count(r) AS total
      OPTIONAL MATCH (:CodeNode {projectId: $pid})-[r2]->(:CodeNode {projectId: $pid})
      WHERE r2.sourceKind IS NOT NULL
      WITH total, count(r2) AS provenance
      RETURN CASE WHEN total > 0 THEN round(1000.0 * provenance / total) / 10 ELSE 0 END AS value
    `,
    higherIsBetter: true,
  },
  {
    name: 'invariant_violations',
    query: `
      MATCH (v:InvariantViolation {projectId: $pid})
      RETURN count(v) AS value
    `,
    higherIsBetter: false,
  },
  {
    name: 'node_count',
    query: `
      MATCH (n:CodeNode {projectId: $pid})
      RETURN count(n) AS value
    `,
    higherIsBetter: true,  // more = better coverage
  },
  {
    name: 'edge_count',
    query: `
      MATCH (:CodeNode {projectId: $pid})-[r]->(:CodeNode {projectId: $pid})
      RETURN count(r) AS value
    `,
    higherIsBetter: true,
  },
  {
    name: 'critical_risk_count',
    query: `
      MATCH (f:CodeNode {projectId: $pid})
      WHERE f.riskTier = 'CRITICAL'
      RETURN count(f) AS value
    `,
    higherIsBetter: false,  // fewer CRITICAL = better
  },
  {
    name: 'orphan_nodes',
    query: `
      MATCH (n:CodeNode {projectId: $pid})
      WHERE NOT (n)<-[:CONTAINS]-() AND NOT n:SourceFile AND NOT n:Project
      AND NOT n:Author AND NOT n:ArchitectureLayer AND NOT n:Field
      AND NOT n:TestCase AND NOT n:UnresolvedReference AND NOT n:AuditCheck AND NOT n:InvariantViolation
      RETURN count(n) AS value
    `,
    higherIsBetter: false,
  },
];

function getParserCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8', cwd: process.cwd() }).trim();
  } catch {
    return 'unknown';
  }
}

async function getBaseline(session: any, projectId: string, metricName: string): Promise<number | null> {
  const result = await session.run(`
    MATCH (run:EvaluationRun {projectId: $pid})-[:MEASURED]->(m:MetricResult {metric: $metric})
    RETURN m.value AS value
    ORDER BY run.timestamp DESC
    LIMIT 1
  `, { pid: projectId, metric: metricName });
  
  if (result.records.length === 0) return null;
  const val = result.records[0].get('value');
  return typeof val?.toNumber === 'function' ? val.toNumber() : val;
}

async function runEvaluation(projectId: string) {
  const session = driver.session();
  const runId = `eval_${Date.now()}`;
  const commit = getParserCommit();
  
  console.log(`\n📊 Evaluating project: ${projectId}`);
  console.log(`   Run: ${runId}`);
  console.log(`   Commit: ${commit}\n`);
  
  try {
    // Create EvaluationRun node
    await session.run(`
      CREATE (run:EvaluationRun {
        runId: $runId,
        projectId: $pid,
        parserCommit: $commit,
        timestamp: datetime(),
        targetRepo: $pid
      })
    `, { runId, pid: projectId, commit });
    
    const results: { metric: string; value: number; baseline: number | null; delta: number | null; status: string }[] = [];
    
    for (const metric of METRICS) {
      // Get current value
      const result = await session.run(metric.query, { pid: projectId });
      let value = 0;
      if (result.records.length > 0) {
        const v = result.records[0].get('value');
        value = typeof v?.toNumber === 'function' ? v.toNumber() : (v || 0);
      }
      
      // Get baseline (previous run)
      const baseline = await getBaseline(session, projectId, metric.name);
      
      // Compute delta and status
      let delta: number | null = null;
      let status = 'unchanged';
      
      if (baseline !== null) {
        delta = value - baseline;
        if (Math.abs(delta) < 0.01) {
          status = 'unchanged';
        } else if (metric.higherIsBetter) {
          status = delta > 0 ? 'improved' : 'regressed';
        } else {
          status = delta < 0 ? 'improved' : 'regressed';
        }
      } else {
        status = 'baseline';  // first run
      }
      
      // Store MetricResult
      await session.run(`
        MATCH (run:EvaluationRun {runId: $runId})
        CREATE (run)-[:MEASURED {sourceKind: 'evaluation'}]->(m:MetricResult {
          metricResultId: $metricResultId,
          metric: $metric,
          value: $value,
          baselineValue: $baseline,
          delta: $delta,
          status: $status,
          projectId: $pid
        })
      `, {
        runId,
        metricResultId: `mr_${runId}_${metric.name}`,
        metric: metric.name,
        value,
        baseline: baseline ?? -1,
        delta: delta ?? 0,
        status,
        pid: projectId,
      });

      // Create RegressionCase node when regression detected (SPEC-GAP-01)
      if (status === 'regressed') {
        const regressionCaseId = `rc_${runId}_${metric.name}`;
        await session.run(`
          MATCH (run:EvaluationRun {runId: $runId})
          MATCH (m:MetricResult {metricResultId: $metricResultId})
          CREATE (rc:RegressionCase {
            regressionCaseId: $regressionCaseId,
            metricName: $metricName,
            metricValue: $metricValue,
            baselineValue: $baselineValue,
            delta: $delta,
            detectedAt: datetime(),
            runId: $runId,
            projectId: $pid
          })
          CREATE (rc)-[:REGRESSION_OF {sourceKind: 'evaluation'}]->(m)
          CREATE (rc)-[:DETECTED_IN {sourceKind: 'evaluation'}]->(run)
        `, {
          runId,
          metricResultId: `mr_${runId}_${metric.name}`,
          regressionCaseId,
          metricName: metric.name,
          metricValue: value,
          baselineValue: baseline ?? -1,
          delta: delta ?? 0,
          pid: projectId,
        });
      }
      
      results.push({ metric: metric.name, value, baseline, delta, status });
    }
    
    // Print results
    const statusEmoji: Record<string, string> = {
      improved: '✅',
      unchanged: '➖',
      regressed: '🔴',
      baseline: '🆕',
    };
    
    console.log(`${'Metric'.padEnd(30)} ${'Value'.padStart(8)} ${'Baseline'.padStart(10)} ${'Delta'.padStart(8)} Status`);
    console.log('-'.repeat(75));
    for (const r of results) {
      const emoji = statusEmoji[r.status] || '❓';
      const baseStr = r.baseline !== null ? String(r.baseline) : 'N/A';
      const deltaStr = r.delta !== null ? (r.delta >= 0 ? `+${r.delta}` : String(r.delta)) : 'N/A';
      console.log(`${emoji} ${r.metric.padEnd(28)} ${String(r.value).padStart(8)} ${baseStr.padStart(10)} ${deltaStr.padStart(8)} ${r.status}`);
    }
    
    // Count regressions
    const regressions = results.filter(r => r.status === 'regressed');
    if (regressions.length > 0) {
      console.log(`\n⚠️ ${regressions.length} metric(s) regressed!`);
    } else {
      console.log('\n✅ No regressions detected.');
    }
    
  } finally {
    await session.close();
  }
}

async function main() {
  const targetPid = process.argv[2];
  
  if (targetPid) {
    await runEvaluation(targetPid);
  } else {
    // Run on all projects
    const session = driver.session();
    const result = await session.run("MATCH (p:Project) RETURN p.projectId AS pid, p.name AS name");
    await session.close();
    
    const codeProjects = result.records.filter(r => {
      const pid = r.get('pid');
      return pid && (pid.startsWith('proj_') && !pid.includes('bible') && !pid.includes('quran') && !pid.includes('deutero') && !pid.includes('pseudo') && !pid.includes('early'));
    });
    
    if (codeProjects.length === 0) {
      console.log('No code projects found.');
    } else {
      for (const r of codeProjects) {
        const pid = r.get('pid');
        const name = r.get('name');
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Project: ${name} (${pid})`);
        console.log('='.repeat(60));
        await runEvaluation(pid);
      }
    }
  }
  
  await driver.close();
  console.log('\n✅ Evaluation complete!');
  console.log('   Query regressions: MATCH (run:EvaluationRun)-[:MEASURED]->(m:MetricResult) WHERE m.status = "regressed" RETURN run.parserCommit, m.metric, m.delta');
}

main().catch(console.error);
