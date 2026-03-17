#!/usr/bin/env npx tsx
/**
 * TC Pipeline Runner
 *
 * Runs the temporal confidence pipeline steps:
 *   tc:recompute    — TC-1/2: incrementalRecompute(scope:full) for all projects
 *   tc:shadow       — TC-3: runShadowPropagation for all projects
 *   tc:debt         — TC-5: computeConfidenceDebt for all projects
 *   tc:anti-gaming  — TC-6: enforceSourceFamilyCaps + verifyAntiGaming
 *   tc:explain      — TC-4: discoverExplainabilityPaths + coverage check
 *   tc:calibrate    — TC-7: runCalibration (Brier/ECE)
 *   tc:promote      — TC-8: evaluatePromotion (advisory) + persist
 *   tc:claims       — TC claim bridge (stamp, orphans, decay)
 *   tc:verify       — verifyShadowIsolation + verifyDebtFieldPresence (BLOCKS on failure)
 *   tc:all          — all of the above in order
 *
 * Usage:
 *   npx tsx src/scripts/entry/tc-pipeline.ts recompute
 *   npx tsx src/scripts/entry/tc-pipeline.ts anti-gaming
 *   npx tsx src/scripts/entry/tc-pipeline.ts calibrate
 *   npx tsx src/scripts/entry/tc-pipeline.ts all
 */

import 'dotenv/config';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { incrementalRecompute } from '../../core/verification/incremental-recompute.js';
import { runShadowPropagation, verifyShadowIsolation } from '../../core/verification/shadow-propagation.js';
import { computeConfidenceDebt, generateDebtDashboard, verifyDebtFieldPresence } from '../../core/verification/confidence-debt.js';
import { runClaimBridge } from '../../core/verification/tc-claim-bridge.js';
import { enforceSourceFamilyCaps, verifyAntiGaming } from '../../core/verification/anti-gaming.js';
import { discoverExplainabilityPaths, verifyExplainabilityCoverage } from '../../core/verification/explainability-paths.js';
import { runCalibration } from '../../core/verification/calibration.js';
import { evaluatePromotion, persistPromotionDecision } from '../../core/verification/promotion-policy.js';

export async function getCodeProjectIds(neo4j: Neo4jService): Promise<string[]> {
  const rows = await neo4j.run(
    `MATCH (p:Project) WHERE p.projectType = 'code' OR p.projectType IS NULL RETURN p.projectId AS id`,
  );
  return rows.map(r => r.id as string).filter(Boolean);
}

/** Returns all project IDs (code + plan). Used by TC-4 explainability which
 *  needs claim-evidence edges that live on plan projects. */
export async function getAllProjectIds(neo4j: Neo4jService): Promise<string[]> {
  const rows = await neo4j.run(
    `MATCH (p:Project) WHERE p.projectId IS NOT NULL RETURN p.projectId AS id`,
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

async function runAntiGaming(neo4j: Neo4jService) {
  const pids = await getCodeProjectIds(neo4j);
  console.log(`[tc:anti-gaming] ${pids.length} projects`);

  for (const pid of pids) {
    const result = await enforceSourceFamilyCaps(neo4j, pid);
    console.log(`  ${pid}: ${result.sourceFamiliesDetected} families, ${result.capsApplied} capped, ${result.duplicatesCollapsed} dupes, ${result.collusionSuspects} collusion suspects, ${result.untrustedSeeded} untrusted seeded (${result.durationMs}ms)`);

    const verify = await verifyAntiGaming(neo4j, pid);
    if (!verify.ok) {
      for (const issue of verify.issues) {
        console.log(`    ⚠️  ${issue}`);
      }
    } else {
      console.log(`  ${pid}: anti-gaming ✅`);
    }
  }
}

async function runExplainability(neo4j: Neo4jService) {
  const pids = await getAllProjectIds(neo4j);
  console.log(`[tc:explain] ${pids.length} projects (all — claim-evidence edges live on plan projects)`);

  for (const pid of pids) {
    const result = await discoverExplainabilityPaths(neo4j, pid);
    console.log(`  ${pid}: ${result.pathsCreated} paths, ${result.pathsSkipped} skipped, ${result.claimsWithPaths}/${result.claimsWithPaths + result.claimsWithoutPaths} claims covered (${result.durationMs}ms)`);

    const coverage = await verifyExplainabilityCoverage(neo4j, pid);
    console.log(`  ${pid}: explainability ${(coverage.coverageRatio * 100).toFixed(1)}% (${coverage.claimsWithout} uncovered)`);
  }
}

async function runCalibrate(neo4j: Neo4jService) {
  const pids = await getCodeProjectIds(neo4j);
  console.log(`[tc:calibrate] ${pids.length} projects`);

  for (const pid of pids) {
    const result = await runCalibration(neo4j, pid);
    console.log(`  ${pid}: Brier prod=${result.production.brierScore.toFixed(4)} shadow=${result.shadow.brierScore.toFixed(4)}, ECE=${result.production.ece.toFixed(4)}, samples=${result.production.sampleCount}, eligible=${result.promotionEligible} (${result.durationMs}ms)`);
    for (const b of result.promotionBlockers) {
      console.log(`    ⚠️  ${b}`);
    }
  }
}

export async function runPromotion(neo4j: Neo4jService) {
  const pids = await getCodeProjectIds(neo4j);
  console.log(`[tc:promote] ${pids.length} projects (advisory mode)`);

  for (const pid of pids) {
    const cal = await runCalibration(neo4j, pid);
    const ag = await verifyAntiGaming(neo4j, pid);

    const decision = evaluatePromotion(
      {
        projectId: pid,
        brierProd: cal.production.brierScore,
        brierShadow: cal.shadow.brierScore,
        governancePass: true, // TODO: wire to governance metric check
        antiGamingPass: ag.ok,
        calibrationPass: cal.promotionEligible,
      },
      { mode: 'advisory', enableEnforcement: false },
    );

    console.log(`  ${pid}: ${decision.reason} (eligible=${decision.promotionEligible}, promoted=${decision.promoted}, hash=${decision.decisionHash.slice(0, 8)})`);

    await persistPromotionDecision(neo4j, decision);
    console.log(`  ${pid}: PromotionDecision persisted (${decision.decisionId})`);
  }
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
      case 'anti-gaming':
        await runAntiGaming(neo4j);
        break;
      case 'explain':
        await runExplainability(neo4j);
        break;
      case 'calibrate':
        await runCalibrate(neo4j);
        break;
      case 'promote':
        await runPromotion(neo4j);
        break;
      case 'all':
        await runRecompute(neo4j);       // TC-1/2: temporal factors
        await runShadow(neo4j);          // TC-3: shadow propagation
        await runDebt(neo4j);            // TC-5: confidence debt
        await runAntiGaming(neo4j);      // TC-6: source family caps
        await runExplainability(neo4j);  // TC-4: influence paths
        await runCalibrate(neo4j);       // TC-7: Brier/ECE
        {
          console.log('[tc:claims] Running claim bridge...');
          const claimResult = await runClaimBridge(neo4j);
          console.log(`  stamped=${claimResult.stamped}, orphansContested=${claimResult.orphansContested}, decayed=${claimResult.decayed} (${claimResult.durationMs}ms)`);
        }
        await runPromotion(neo4j);       // TC-8: advisory evaluation
        const ok = await runVerify(neo4j);
        if (!ok) {
          console.log('\n❌ TC pipeline verification failed');
          process.exit(1);
        }
        console.log('\n✅ TC pipeline complete');
        break;
      default:
        console.error(`Unknown step: ${step}. Use: recompute|shadow|debt|anti-gaming|explain|calibrate|promote|claims|verify|all`);
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
