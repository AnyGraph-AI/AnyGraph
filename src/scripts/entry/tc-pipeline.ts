#!/usr/bin/env npx tsx
/**
 * TC Pipeline Runner
 *
 * Runs the temporal confidence pipeline steps:
 *   tc:recompute  — incrementalRecompute(scope:full) for all projects
 *   tc:shadow     — runShadowPropagation for all projects
 *   tc:debt       — computeConfidenceDebt for all projects
 *   tc:verify     — verifyShadowIsolation + verifyDebtFieldPresence for all projects
 *   tc:all        — all of the above in order
 *
 * Usage:
 *   npx tsx src/scripts/entry/tc-pipeline.ts recompute
 *   npx tsx src/scripts/entry/tc-pipeline.ts shadow
 *   npx tsx src/scripts/entry/tc-pipeline.ts debt
 *   npx tsx src/scripts/entry/tc-pipeline.ts verify
 *   npx tsx src/scripts/entry/tc-pipeline.ts all
 */

import 'dotenv/config';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { incrementalRecompute } from '../../core/verification/incremental-recompute.js';
import { runShadowPropagation, verifyShadowIsolation } from '../../core/verification/shadow-propagation.js';
import { computeConfidenceDebt, generateDebtDashboard, verifyDebtFieldPresence } from '../../core/verification/confidence-debt.js';
import { runClaimBridge } from '../../core/verification/tc-claim-bridge.js';

async function getCodeProjectIds(neo4j: Neo4jService): Promise<string[]> {
  const rows = await neo4j.run(
    `MATCH (p:Project) WHERE p.projectType = 'code' OR p.projectType IS NULL RETURN p.projectId AS id`,
  );
  return rows.map(r => r.id as string).filter(Boolean);
}

async function runRecompute(neo4j: Neo4jService) {
  const pids = await getCodeProjectIds(neo4j);
  console.log(`[tc:recompute] ${pids.length} projects`);

  for (const pid of pids) {
    const result = await incrementalRecompute(neo4j, {
      projectId: pid,
      scope: 'full',
      fullOverride: true,
      reason: 'tc_pipeline',
    });
    console.log(`  ${pid}: ${result.updatedCount} updated, ${result.skippedCount} skipped (${result.durationMs}ms)`);
  }
}

async function runShadow(neo4j: Neo4jService) {
  const pids = await getCodeProjectIds(neo4j);
  console.log(`[tc:shadow] ${pids.length} projects`);

  for (const pid of pids) {
    const result = await runShadowPropagation(neo4j, pid);
    console.log(`  ${pid}: ${result.updated} updated, maxDiv=${result.maxDivergence.toFixed(3)}, promotionReady=${result.promotionReady} (${result.durationMs}ms)`);
    if (result.promotionBlockers.length > 0) {
      for (const b of result.promotionBlockers) {
        console.log(`    ⚠️  ${b}`);
      }
    }
  }
}

async function runDebt(neo4j: Neo4jService) {
  const pids = await getCodeProjectIds(neo4j);
  console.log(`[tc:debt] ${pids.length} projects`);

  for (const pid of pids) {
    const dashboard = await generateDebtDashboard(neo4j, pid);
    console.log(`  ${pid}: ${dashboard.entitiesWithDebt}/${dashboard.totalEntities} with debt, avgDebt=${dashboard.avgDebt.toFixed(3)}, maxDebt=${dashboard.maxDebt.toFixed(3)} (${dashboard.durationMs}ms)`);
    for (const alert of dashboard.alerts) {
      console.log(`    🔴 ${alert}`);
    }
  }
}

async function runVerify(neo4j: Neo4jService): Promise<boolean> {
  const pids = await getCodeProjectIds(neo4j);
  console.log(`[tc:verify] ${pids.length} projects`);
  let allOk = true;

  for (const pid of pids) {
    const shadowResult = await verifyShadowIsolation(neo4j, pid);
    const debtResult = await verifyDebtFieldPresence(neo4j, pid);

    const ok = shadowResult.ok && debtResult.ok;
    if (!ok) allOk = false;

    console.log(`  ${pid}: shadow_isolation=${shadowResult.ok ? '✅' : '❌'} (${shadowResult.violations} violations), debt_presence=${debtResult.ok ? '✅' : '⚠️'} (${debtResult.missingDebt}/${debtResult.total} missing)`);
  }

  return allOk;
}

async function main() {
  const step = process.argv[2] ?? 'all';
  const neo4j = new Neo4jService();

  try {
    switch (step) {
      case 'recompute':
        await runRecompute(neo4j);
        break;
      case 'shadow':
        await runShadow(neo4j);
        break;
      case 'debt':
        await runDebt(neo4j);
        break;
      case 'verify': {
        const ok = await runVerify(neo4j);
        if (!ok) process.exit(1);
        break;
      }
      case 'claims': {
        console.log('[tc:claims] Running claim bridge...');
        const claimResult = await runClaimBridge(neo4j);
        console.log(`  stamped=${claimResult.stamped}, orphansContested=${claimResult.orphansContested}, decayed=${claimResult.decayed} (${claimResult.durationMs}ms)`);
        break;
      }
      case 'all':
        await runRecompute(neo4j);
        await runShadow(neo4j);
        await runDebt(neo4j);
        {
          console.log('[tc:claims] Running claim bridge...');
          const claimResult = await runClaimBridge(neo4j);
          console.log(`  stamped=${claimResult.stamped}, orphansContested=${claimResult.orphansContested}, decayed=${claimResult.decayed} (${claimResult.durationMs}ms)`);
        }
        const ok = await runVerify(neo4j);
        if (!ok) {
          console.log('\n❌ TC pipeline verification failed');
          process.exit(1);
        }
        console.log('\n✅ TC pipeline complete');
        break;
      default:
        console.error(`Unknown step: ${step}. Use: recompute|shadow|debt|verify|all`);
        process.exit(1);
    }
  } finally {
    await neo4j.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
