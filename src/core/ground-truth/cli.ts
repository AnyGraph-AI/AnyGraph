/**
 * Ground Truth Hook — CLI Entry Point (GTH-5)
 *
 * Usage:
 *   npm run ground-truth -- --project proj_c0d3e9a1f200
 *   npm run ground-truth -- --project proj_c0d3e9a1f200 --depth full
 *   npm run ground-truth -- --project proj_c0d3e9a1f200 --depth full --verbose
 *   npm run ground-truth -- --project proj_c0d3e9a1f200 --agent watson
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { GroundTruthRuntime } from './runtime.js';
import { SoftwareGovernancePack } from './packs/software.js';
import { generateRecoveryAppendix } from './delta.js';
import type {
  CheckTier,
  GroundTruthOutput,
  IntegrityFinding,
  TaskStatusValue,
  MilestoneValue,
  UnblockedTaskValue,
  GovernanceHealthValue,
  EvidenceCoverageValue,
} from './types.js';

export async function main() {
  const args = process.argv.slice(2);
  const projectIdx = args.indexOf('--project');
  const depthIdx = args.indexOf('--depth');
  const agentIdx = args.indexOf('--agent');
  const verbose = args.includes('--verbose') || args.includes('-v');

  const projectId = projectIdx >= 0 ? args[projectIdx + 1] : 'proj_c0d3e9a1f200';
  const depthArg = depthIdx >= 0 ? args[depthIdx + 1] : 'medium';
  const agentId = agentIdx >= 0 ? args[agentIdx + 1] : undefined;
  const depth: CheckTier = depthArg === 'full' ? 'heavy' : (depthArg as CheckTier);

  // F2: Share single Neo4jService across pack + runtime (no triple connection)
  const neo4j = new Neo4jService();
  const pack = new SoftwareGovernancePack(neo4j);
  const runtime = new GroundTruthRuntime(pack, neo4j);

  try {
    const output = await runtime.run({ projectId, depth, agentId });
    printOutput(output, verbose);
  } finally {
    await neo4j.close();
  }
}

export function printOutput(output: GroundTruthOutput, verbose: boolean): void {
  const { panel1, panel2, panel3, meta } = output;

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  GROUND TRUTH HOOK — ${meta.projectId}`);
  console.log(`  Depth: ${meta.depth} | Duration: ${meta.durationMs}ms | ${meta.runAt}`);
  if (verbose) console.log('  Mode: VERBOSE');
  console.log('═══════════════════════════════════════════════════════');

  // ─── Panel 1A: Graph State ──────────────────────────────────────
  console.log('\n── Panel 1A: Graph State ──────────────────────────────\n');

  for (const obs of panel1.planStatus) {
    if (obs.source === 'Task') {
      const v = obs.value as TaskStatusValue;
      console.log(`  Plan: ${v.done ?? '?'}/${v.total ?? '?'} done (${v.pct ?? '?'}%)`);
    } else if (obs.source === 'Milestone') {
      const milestones = obs.value as MilestoneValue[];
      const done = milestones.filter((m) => m.done === m.total);
      const remaining = milestones.filter((m) => m.done < m.total);
      console.log(`  Milestones: ${done.length} done, ${remaining.length} remaining`);
      if (verbose) {
        for (const m of done) {
          console.log(`    ✅ ${m.name} (${m.done}/${m.total})`);
        }
        for (const m of remaining) {
          const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
          console.log(`    ⬚ ${m.name} (${m.done}/${m.total} — ${pct}%)`);
        }
      }
    } else if (obs.source === 'DEPENDS_ON') {
      const tasks = obs.value as UnblockedTaskValue[];
      console.log(`  Unblocked tasks: ${tasks.length}`);
      const limit = verbose ? tasks.length : 5;
      for (const t of tasks.slice(0, limit)) {
        console.log(`    [${t.milestone}] ${t.task}`);
      }
      if (!verbose && tasks.length > 5) console.log(`    ... and ${tasks.length - 5} more`);
    }
  }

  for (const obs of panel1.governanceHealth) {
    const v = obs.value as GovernanceHealthValue;
    const icon = obs.freshnessState === 'fresh' ? '✅' : '⚠️';
    if (v.error) {
      console.log(`  Governance: ${icon} ${v.error}`);
    } else {
      console.log(`  Governance: ${icon} ${v.verificationRuns ?? 0} runs, ${v.gateFailures ?? 0} failures, interception ${v.interceptionRate ?? '?'}`);
    }
  }

  for (const obs of panel1.evidenceCoverage) {
    const v = obs.value as EvidenceCoverageValue;
    console.log(`  Evidence: ${v.withEvidence}/${v.total} done tasks have structural proof (${v.pct}%)`);
  }

  // TC bridge: temporal confidence health
  if (panel1.temporalConfidence && panel1.temporalConfidence.length > 0) {
    for (const obs of panel1.temporalConfidence) {
      const v = obs.value as Record<string, unknown>;
      const icon = v.severity === 'warning' ? '⚠️' : '🕐';
      console.log(`  TC: ${icon} ${v.label}`);
    }
  }

  // GTH-9: Contradictions
  if (panel1.contradictions && panel1.contradictions.length > 0) {
    console.log('');
    console.log('  ── Contradictions (current milestone) ──');
    for (const obs of panel1.contradictions) {
      const v = obs.value as { statement: string; contradiction: string };
      console.log(`    ⚡ ${v.statement} — contra: ${v.contradiction}`);
    }
  }

  // GTH-9: Open Hypotheses
  if (panel1.openHypotheses && panel1.openHypotheses.length > 0) {
    console.log('');
    console.log('  ── Open Hypotheses (current milestone) ──');
    for (const obs of panel1.openHypotheses) {
      const v = obs.value as { name: string; domain: string; severity: string };
      const sev = v.severity === 'critical' ? '🔴' : v.severity === 'warning' ? '🟡' : 'ℹ️';
      console.log(`    ${sev} [${v.domain}] ${v.name}`);
    }
  }

  // ─── Panel 1B: Integrity ────────────────────────────────────────
  console.log('\n── Panel 1B: Integrity ────────────────────────────────\n');
  const { integrity } = panel1;
  console.log(`  ${integrity.summary.passed}/${integrity.summary.totalChecks} checks pass`);
  if (integrity.summary.criticalFailures > 0) {
    console.log(`  🔴 ${integrity.summary.criticalFailures} CRITICAL failure(s)`);
  }

  const allChecks = [...integrity.core, ...integrity.domain];
  if (verbose) {
    // Show every check with pass/fail
    for (const f of allChecks) {
      const icon = f.pass
        ? '✅'
        : f.severity === 'critical' ? '🔴' : f.severity === 'warning' ? '🟡' : 'ℹ️';
      const status = f.pass ? 'PASS' : `FAIL (${f.observedValue} vs expected ${f.expectedValue})`;
      console.log(`  ${icon} [${f.surface}] ${f.description} — ${status}`);
    }
  } else {
    // Brief mode: only show failures
    const failures = allChecks.filter(f => !f.pass);
    for (const f of failures) {
      const icon = f.severity === 'critical' ? '🔴' : f.severity === 'warning' ? '🟡' : 'ℹ️';
      console.log(`  ${icon} [${f.surface}] ${f.description} (${f.observedValue} vs expected ${f.expectedValue})`);
    }
  }

  // ─── Panel 2: Agent Briefing ────────────────────────────────────
  console.log('\n── Panel 2: Agent Briefing ────────────────────────────\n');

  const b = panel2.briefing;
  if (b) {
    const pct = b.milestone.tasksTotal > 0
      ? Math.round((b.milestone.tasksDone / b.milestone.tasksTotal) * 100)
      : 0;
    const statusIcon = b.milestone.status === 'done' ? '✅'
      : b.milestone.status === 'in_progress' ? '🔜' : '⬜';
    console.log(`  ${statusIcon} Active: ${b.milestone.name} (${b.milestone.status}, ${b.milestone.tasksDone}/${b.milestone.tasksTotal} tasks, ${pct}%)`);

    if (b.milestone.specText) {
      console.log(`\n  Spec:`);
      for (const line of b.milestone.specText.split('\n').slice(0, 5)) {
        console.log(`    ${line}`);
      }
    }

    if (b.inputs.length > 0) {
      console.log(`\n  Depends On:`);
      for (const dep of b.inputs) {
        const icon = dep.status === 'done' ? '✅' : dep.status === 'in_progress' ? '🔜' : '⬜';
        console.log(`    ${icon} ${dep.code}: ${dep.name} — ${dep.status}`);
      }
    }

    if (b.unlocks.length > 0) {
      console.log(`\n  Unlocks:`);
      for (const u of b.unlocks) {
        const icon = u.status === 'done' ? '✅' : u.status === 'in_progress' ? '🔜' : '⬜';
        console.log(`    ${icon} ${u.code}: ${u.name} — ${u.status}`);
      }
    }

    if (b.hazards.length > 0) {
      console.log(`\n  Hazards:`);
      for (const h of b.hazards) {
        const icon = h.severity === 'critical' ? '🔴' : '🟡';
        console.log(`    ${icon} ${h.checkName}`);
      }
    }

    if (b.lastVerified.timestamp) {
      console.log(`\n  Last Verified:`);
      console.log(`    Commit: ${b.lastVerified.commit ?? 'unknown'} | Gate: ${b.lastVerified.gateVerdict ?? 'unknown'} | TC runs: ${b.lastVerified.tcCoverage ?? 'unknown'} | ${b.lastVerified.timestamp}`);
    }

    console.log(`\n  ⛔ Do Not Proceed Without:`);
    console.log(`    • done-check passes (npm run done-check)`);
    console.log(`    • All tests green (npx vitest run)`);
    console.log(`    • Ground truth shows no new integrity errors`);
  } else {
    console.log(`  Agent: ${panel2.agentId}`);
    console.log(`  Status: ${panel2.status}`);
    console.log(`  No active milestone found — all complete or no plan data`);
  }

  if (verbose && panel2.sessionBookmark) {
    const bm = panel2.sessionBookmark as Record<string, unknown>;
    const ws = bm.workingSetNodeIds as string[] | undefined;
    if (ws && ws.length > 0) {
      console.log(`\n  Working set: ${ws.length} nodes`);
      for (const nodeId of ws) {
        console.log(`    • ${nodeId}`);
      }
    }
    if (bm.groundTruthRuns != null) {
      console.log(`  Ground truth runs: ${bm.groundTruthRuns}`);
      console.log(`  Drift detected: ${bm.driftDetected ?? 0}`);
    }
  }

  // ─── Panel 3: Delta ─────────────────────────────────────────────
  console.log('\n── Panel 3: Delta ────────────────────────────────────\n');
  if (panel3.deltas.length === 0) {
    console.log('  No deltas detected');
  } else {
    for (const d of panel3.deltas) {
      const icon = d.severity === 'critical' ? '🔴' : d.severity === 'warning' ? '🟡' : 'ℹ️';
      console.log(`  ${icon} [${d.tier}] ${d.description}`);
    }
  }

  // ─── Recovery Appendix ──────────────────────────────────────────
  const appendix = generateRecoveryAppendix(panel3.deltas);
  if (appendix.length > 0) {
    console.log('\n── Recovery References (appendix) ─────────────────────\n');
    for (const ref of appendix) {
      console.log(`  ${ref}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════\n');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/ground-truth/cli.ts') || process.argv[1]?.endsWith('/ground-truth/cli.js')) {
  main().catch(err => {
    console.error('Ground truth hook failed:', err);
    process.exit(1);
  });
}
