/**
 * Evidence Backfill Fast Track
 *
 * Reduces done_without_evidence risk in plan_codegraph by backfilling
 * high-impact done tasks with strict machine-verifiable evidence.
 *
 * Tasks:
 * 1. Define completion taxonomy (done_documented vs done_verified)
 * 2. Build critical shortlist (top 25 by governance impact)
 * 3-4. Backfill with strict evidence (HAS_CODE_EVIDENCE links)
 * 5. Add claim guardrail (block verified claims for plan_only tasks)
 * 6. Add coverage metrics
 * 7. Add regression check
 * 8. Document policy
 *
 * Usage: npx tsx src/utils/evidence-backfill-fast-track.ts [--dry-run] [--report-only]
 */

import 'dotenv/config';
import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'codegraph')
);

const PLAN_PROJECT_ID = 'plan_codegraph';
const CODE_PROJECT_ID = 'proj_c0d3e9a1f200';
const DRY_RUN = process.argv.includes('--dry-run');
const REPORT_ONLY = process.argv.includes('--report-only');

// ============================================================================
// TASK 1: COMPLETION TAXONOMY
// ============================================================================

/**
 * Completion taxonomy:
 * - done_documented: task marked done but no machine evidence (plan checkbox only)
 * - done_verified: task marked done AND has HAS_CODE_EVIDENCE edge(s) to real code
 *
 * We derive these views in queries rather than adding schema fields,
 * keeping the existing `status: 'done'` field intact.
 */

// ============================================================================
// TASK 2: CRITICAL SHORTLIST — High-Impact Evidence Mapping
// ============================================================================

/**
 * Hand-curated mapping: task name → SourceFile(s) that implement it.
 * Only high-confidence, strict matches. No guessing.
 *
 * Priority categories:
 * - GATE/POLICY: governance decision flow
 * - RESOLVER/STATUS: status resolution, done-check
 * - EVIDENCE/PROVENANCE: evidence linking, provenance capture
 * - RUNTIME/CAPTURE: runtime verification, metrics
 * - STRUCTURAL: constraints, drift, integrity
 */
interface EvidenceMapping {
  taskName: string;
  category: 'gate_policy' | 'resolver_status' | 'evidence_provenance' | 'runtime_capture' | 'structural' | 'config_schema' | 'test_harness';
  rank: number;
  rationale: string;
  /** SourceFile names (must exist in proj_c0d3e9a1f200) */
  sourceFiles: string[];
  /** Function names for more precise linking (optional) */
  functions?: string[];
}

const EVIDENCE_MAPPINGS: EvidenceMapping[] = [
  // --- GATE/POLICY (ranks 1-7) ---
  {
    taskName: 'Define and freeze gate decision packet schema',
    category: 'gate_policy',
    rank: 1,
    rationale: 'Core governance schema — GateDecisionPacket, GateMode, ReplayContract',
    sourceFiles: ['gate-decision-packet-schema.ts'],
  },
  {
    taskName: 'Define and freeze change-class matrix schema',
    category: 'config_schema',
    rank: 2,
    rationale: 'Frozen change-class→lane matrix — classifyChange(), getRequiredLanes()',
    sourceFiles: ['change-class-matrix.ts'],
  },
  {
    taskName: 'Define and freeze invariant registry schema',
    category: 'config_schema',
    rank: 3,
    rationale: 'Machine-readable invariant catalog — HARD_INVARIANTS, ADVISORY_INVARIANTS',
    sourceFiles: ['invariant-registry-schema.ts'],
  },
  {
    taskName: 'Define and freeze test provenance schema',
    category: 'evidence_provenance',
    rank: 4,
    rationale: 'SLSA-shaped test provenance — TestProvenanceRecord, FixtureTier',
    sourceFiles: ['test-provenance-schema.ts'],
  },
  {
    taskName: 'Define and freeze eval lineage schema',
    category: 'evidence_provenance',
    rank: 5,
    rationale: 'TEVV lineage — EvalLineageRecord, HazardClass',
    sourceFiles: ['eval-lineage-schema.ts'],
  },
  {
    taskName: 'Pin policy bundles by digest',
    category: 'gate_policy',
    rank: 6,
    rationale: 'Policy bundle assembly + digest pinning for gate replay',
    sourceFiles: ['policy-bundle.ts'],
  },
  {
    taskName: 'Evaluate gates from immutable input snapshots',
    category: 'gate_policy',
    rank: 7,
    rationale: 'Deterministic gate evaluator from frozen inputs + policy',
    sourceFiles: ['gate-evaluator.ts'],
  },
  // --- RESOLVER/STATUS (ranks 8-12) ---
  {
    taskName: 'Add `done-check` gate command that runs governance + parity + integrity checks',
    category: 'resolver_status',
    rank: 8,
    rationale: 'Central governance gate — verification-done-check-capture.ts',
    sourceFiles: ['verification-done-check-capture.ts'],
  },
  {
    taskName: 'Add done-check capture runner: `verification:done-check:capture`',
    category: 'resolver_status',
    rank: 9,
    rationale: 'Captures VerificationRun + GateDecision + CommitSnapshot + Artifact nodes',
    sourceFiles: ['verification-done-check-capture.ts'],
  },
  {
    taskName: 'Add acceptance queries for `done` vs `proven` (task status alone is insufficient)',
    category: 'resolver_status',
    rank: 10,
    rationale: 'Done-vs-proven status queries in verification pipeline',
    sourceFiles: ['verification-done-vs-proven.ts'],
  },
  {
    taskName: 'Add fail-closed governance behavior when invariant fails (block done-check/commit audit pass)',
    category: 'resolver_status',
    rank: 11,
    rationale: 'Fail-closed enforcement in commit audit invariants',
    sourceFiles: ['verify-commit-audit-invariants.ts'],
  },
  {
    taskName: 'Add freshness guard: recommendation queries must fail or auto-refresh when plan ingest is stale',
    category: 'resolver_status',
    rank: 12,
    rationale: 'Freshness guard for plan ingest staleness',
    sourceFiles: ['verify-governance-stale-check.ts'],
  },
  // --- EVIDENCE/PROVENANCE (ranks 13-18) ---
  {
    taskName: 'Add explicit attribution edge(s) for governance causality (`GateDecision-[:AFFECTS_COMMIT]->CommitSnapshot` and/or equivalent)',
    category: 'evidence_provenance',
    rank: 13,
    rationale: 'AFFECTS_COMMIT edges from gate decisions to commits',
    sourceFiles: ['governance-attribution-backfill.ts'],
  },
  {
    taskName: 'Add explicit invariant proof records (`invariantId`, `criterionId`, `runId`, `result`, `artifactHash`, `decisionHash`, `provedAt`)',
    category: 'evidence_provenance',
    rank: 14,
    rationale: 'InvariantProof nodes with hash-linked artifacts',
    sourceFiles: ['verification-invariant-proof-records.ts'],
  },
  {
    taskName: 'Add artifact output for each snapshot materialization with deterministic hash',
    category: 'evidence_provenance',
    rank: 15,
    rationale: 'Integrity snapshot artifacts with SHA-256 hashes',
    sourceFiles: ['graph-integrity-snapshot.ts'],
  },
  {
    taskName: 'Add `IntegritySnapshot` node model in Neo4j (one per snapshot run + project)',
    category: 'evidence_provenance',
    rank: 16,
    rationale: 'IntegritySnapshot node + MEASURED edges',
    sourceFiles: ['integrity-snapshot-graph-ingest.ts'],
  },
  {
    taskName: 'Add `MEASURED` edges from `IntegritySnapshot` to metric-bearing nodes (or canonical metric entities)',
    category: 'evidence_provenance',
    rank: 17,
    rationale: 'MEASURED edges linking snapshots to metrics',
    sourceFiles: ['integrity-snapshot-graph-ingest.ts'],
  },
  {
    taskName: 'Add baseline/diff fields (`baselineRef`, `mergeBase`) to verification evidence',
    category: 'evidence_provenance',
    rank: 18,
    rationale: 'Baseline selector + diff fields in integrity verify',
    sourceFiles: ['verify-graph-integrity.ts'],
  },
  // --- RUNTIME/CAPTURE (ranks 19-22) ---
  {
    taskName: 'Add dashboard npm script (`verification:status:dashboard`)',
    category: 'runtime_capture',
    rank: 19,
    rationale: 'Status dashboard for verification pipeline',
    sourceFiles: ['verification-status-dashboard.ts'],
  },
  {
    taskName: 'Add dashboard/query endpoint for trend line (`timestamp`, `interceptionRate`, key counters)',
    category: 'runtime_capture',
    rank: 20,
    rationale: 'Trend data from integrity snapshot nodes',
    sourceFiles: ['integrity-snapshot-trends.ts'],
  },
  {
    taskName: 'Add commit-audit invariant for S5 trend-source contract (trend/status tooling must source from `IntegritySnapshot`, not ad-hoc file parsing).',
    category: 'runtime_capture',
    rank: 21,
    rationale: 'S5 trend-source contract enforcement',
    sourceFiles: ['verify-commit-audit-invariants.ts'],
  },
  {
    taskName: 'Add commit-audit invariant for S6 output contract (`baselineRef` + `baselineTimestamp` required in canonical integrity verify output).',
    category: 'runtime_capture',
    rank: 22,
    rationale: 'S6 output contract enforcement',
    sourceFiles: ['verify-commit-audit-invariants.ts'],
  },
  // --- STRUCTURAL/TEST HARNESS (ranks 23-25) ---
  {
    taskName: 'Implement S1 minimum: frozen clock/timezone/locale + fixed RNG seeds',
    category: 'test_harness',
    rank: 23,
    rationale: 'Hermetic env — frozen-clock, frozen-locale, seeded-rng',
    sourceFiles: ['frozen-clock.ts', 'frozen-locale.ts', 'seeded-rng.ts'],
  },
  {
    taskName: 'Implement isolated ephemeral Neo4j test runtime with schema reset/rebuild per run',
    category: 'test_harness',
    rank: 24,
    rationale: 'Ephemeral graph with projectId isolation',
    sourceFiles: ['ephemeral-graph.ts'],
  },
  {
    taskName: 'Implement deterministic replay command (one-command replay from snapshot + seed + artifacts)',
    category: 'test_harness',
    rank: 25,
    rationale: 'Replay packets with SHA-256 digest verification',
    sourceFiles: ['replay.ts', 'snapshot-digest.ts'],
  },
];

// ============================================================================
// TASK 3-4: BACKFILL WITH STRICT EVIDENCE
// ============================================================================

async function backfillEvidence(): Promise<{
  linked: number;
  skipped: number;
  notFound: string[];
  linked_tasks: string[];
}> {
  const session = driver.session();
  let linked = 0;
  let skipped = 0;
  const notFound: string[] = [];
  const linked_tasks: string[] = [];

  try {
    for (const mapping of EVIDENCE_MAPPINGS) {
      // Verify task exists and is done
      const taskResult = await session.run(
        `MATCH (t:Task {projectId: $planProjectId, status: 'done'})
         WHERE t.name = $taskName
         RETURN t.name AS name, elementId(t) AS id`,
        { planProjectId: PLAN_PROJECT_ID, taskName: mapping.taskName }
      );

      if (taskResult.records.length === 0) {
        console.log(`  ⚠ Task not found or not done: "${mapping.taskName}"`);
        notFound.push(mapping.taskName);
        continue;
      }

      // Check if already has evidence
      const existingEvidence = await session.run(
        `MATCH (t:Task {projectId: $planProjectId, name: $taskName})-[:HAS_CODE_EVIDENCE]->(sf)
         RETURN count(sf) AS cnt`,
        { planProjectId: PLAN_PROJECT_ID, taskName: mapping.taskName }
      );
      const existingCount = existingEvidence.records[0].get('cnt').low ?? existingEvidence.records[0].get('cnt');
      if (existingCount > 0) {
        console.log(`  ✓ Already has ${existingCount} evidence: "${mapping.taskName}"`);
        skipped++;
        linked_tasks.push(`[already] ${mapping.taskName}`);
        continue;
      }

      // Verify source files exist
      for (const fileName of mapping.sourceFiles) {
        const sfResult = await session.run(
          `MATCH (sf:SourceFile {projectId: $codeProjectId})
           WHERE sf.name = $fileName
           RETURN sf.name AS name, elementId(sf) AS id`,
          { codeProjectId: CODE_PROJECT_ID, fileName }
        );

        if (sfResult.records.length === 0) {
          console.log(`  ⚠ SourceFile not found: "${fileName}" for task "${mapping.taskName}"`);
          notFound.push(`${mapping.taskName} → ${fileName}`);
          continue;
        }

        if (!DRY_RUN && !REPORT_ONLY) {
          // Create HAS_CODE_EVIDENCE edge
          await session.run(
            `MATCH (t:Task {projectId: $planProjectId, name: $taskName})
             MATCH (sf:SourceFile {projectId: $codeProjectId, name: $fileName})
             MERGE (t)-[r:HAS_CODE_EVIDENCE]->(sf)
             SET r.source = 'evidence_backfill_fast_track',
                 r.refType = 'file_path',
                 r.category = $category,
                 r.rank = $rank,
                 r.rationale = $rationale,
                 r.backfilledAt = datetime(),
                 r.confidence = 1.0,
                 r.projectId = $planProjectId`,
            {
              planProjectId: PLAN_PROJECT_ID,
              codeProjectId: CODE_PROJECT_ID,
              taskName: mapping.taskName,
              fileName,
              category: mapping.category,
              rank: neo4j.int(mapping.rank),
              rationale: mapping.rationale,
            }
          );
          linked++;
        } else {
          console.log(`  [dry-run] Would link: "${mapping.taskName}" → ${fileName}`);
          linked++;
        }
      }
      linked_tasks.push(mapping.taskName);
    }
  } finally {
    await session.close();
  }

  return { linked, skipped, notFound, linked_tasks };
}

// ============================================================================
// TASK 5: CLAIM GUARDRAIL
// ============================================================================

/**
 * Check for tasks that have "verified/complete" claims but only plan-level evidence.
 * Returns violations that should block verified-completion claims.
 */
async function checkClaimGuardrail(): Promise<{
  violations: Array<{ taskName: string; claimType: string }>;
  ok: boolean;
}> {
  const session = driver.session();
  try {
    // Find tasks marked done WITHOUT evidence that have claims suggesting completion
    const result = await session.run(
      `MATCH (t:Task {projectId: $planProjectId, status: 'done'})
       WHERE NOT (t)-[:HAS_CODE_EVIDENCE]->()
       AND t.hasCodeEvidence = true
       RETURN t.name AS taskName, 'false_evidence_flag' AS claimType
       ORDER BY t.name
       LIMIT 50`,
      { planProjectId: PLAN_PROJECT_ID }
    );

    const violations = result.records.map(r => ({
      taskName: r.get('taskName') as string,
      claimType: r.get('claimType') as string,
    }));

    return { violations, ok: violations.length === 0 };
  } finally {
    await session.close();
  }
}

// ============================================================================
// TASK 6: COVERAGE METRICS
// ============================================================================

interface CoverageMetrics {
  totalDone: number;
  doneWithEvidence: number;
  doneWithoutEvidence: number;
  doneWithEvidencePct: number;
  topUnverifiedDoneTasks: string[];
  byCategory: Record<string, { total: number; withEvidence: number }>;
}

async function getCoverageMetrics(): Promise<CoverageMetrics> {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (t:Task {projectId: $planProjectId, status: 'done'})
       OPTIONAL MATCH (t)-[:HAS_CODE_EVIDENCE]->(sf)
       WITH t, count(sf) AS evidenceCount
       RETURN
         count(t) AS totalDone,
         sum(CASE WHEN evidenceCount > 0 THEN 1 ELSE 0 END) AS withEvidence,
         sum(CASE WHEN evidenceCount = 0 THEN 1 ELSE 0 END) AS withoutEvidence`,
      { planProjectId: PLAN_PROJECT_ID }
    );

    const row = result.records[0];
    const totalDone = (row.get('totalDone').low ?? row.get('totalDone')) as number;
    const withEvidence = (row.get('withEvidence').low ?? row.get('withEvidence')) as number;
    const withoutEvidence = (row.get('withoutEvidence').low ?? row.get('withoutEvidence')) as number;

    // Top unverified done tasks (by milestone)
    const topResult = await session.run(
      `MATCH (t:Task {projectId: $planProjectId, status: 'done'})
       WHERE NOT (t)-[:HAS_CODE_EVIDENCE]->()
       OPTIONAL MATCH (t)-[:PART_OF]->(m:Milestone)
       RETURN t.name AS task, m.name AS milestone
       ORDER BY milestone, task
       LIMIT 20`,
      { planProjectId: PLAN_PROJECT_ID }
    );

    const topUnverified = topResult.records.map(r => {
      const ms = r.get('milestone') as string;
      return `[${ms?.replace('Milestone ', '') ?? 'no-ms'}] ${r.get('task')}`;
    });

    // By category (from backfill mappings)
    const catResult = await session.run(
      `MATCH (t:Task {projectId: $planProjectId, status: 'done'})
       OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->(sf)
       WITH t, count(sf) AS evidenceCount,
            CASE WHEN r.category IS NOT NULL THEN r.category ELSE 'uncategorized' END AS cat
       RETURN cat, count(t) AS total,
              sum(CASE WHEN evidenceCount > 0 THEN 1 ELSE 0 END) AS withEv
       ORDER BY cat`,
      { planProjectId: PLAN_PROJECT_ID }
    );

    const byCategory: Record<string, { total: number; withEvidence: number }> = {};
    for (const r of catResult.records) {
      const cat = r.get('cat') as string;
      byCategory[cat] = {
        total: (r.get('total').low ?? r.get('total')) as number,
        withEvidence: (r.get('withEv').low ?? r.get('withEv')) as number,
      };
    }

    return {
      totalDone,
      doneWithEvidence: withEvidence,
      doneWithoutEvidence: withoutEvidence,
      doneWithEvidencePct: totalDone > 0 ? Math.round((withEvidence / totalDone) * 1000) / 10 : 0,
      topUnverifiedDoneTasks: topUnverified,
      byCategory,
    };
  } finally {
    await session.close();
  }
}

// ============================================================================
// TASK 7: REGRESSION CHECK
// ============================================================================

interface RegressionCheckResult {
  currentPct: number;
  previousPct: number | null;
  regression: boolean;
  alert: string | null;
}

async function checkCoverageRegression(): Promise<RegressionCheckResult> {
  const metrics = await getCoverageMetrics();
  const currentPct = metrics.doneWithEvidencePct;

  // Check if we have a previous snapshot to compare against
  const session = driver.session();
  try {
    const prevResult = await session.run(
      `MATCH (s:IntegritySnapshot {projectId: $codeProjectId})
       WHERE s.evidenceCoveragePct IS NOT NULL
       RETURN s.evidenceCoveragePct AS pct, s.timestamp AS ts
       ORDER BY s.timestamp DESC
       LIMIT 1`,
      { codeProjectId: CODE_PROJECT_ID }
    );

    let previousPct: number | null = null;
    if (prevResult.records.length > 0) {
      previousPct = prevResult.records[0].get('pct') as number;
    }

    const regression = previousPct !== null && currentPct < previousPct;
    const alert = regression
      ? `⚠ Evidence coverage regression: ${previousPct}% → ${currentPct}% (${(currentPct - previousPct!).toFixed(1)}%)`
      : null;

    return { currentPct, previousPct, regression, alert };
  } finally {
    await session.close();
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('=== Evidence Backfill Fast Track ===\n');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : REPORT_ONLY ? 'REPORT ONLY' : 'LIVE'}\n`);

  // BEFORE metrics
  console.log('--- BEFORE ---');
  const before = await getCoverageMetrics();
  console.log(`Total done tasks: ${before.totalDone}`);
  console.log(`With evidence: ${before.doneWithEvidence} (${before.doneWithEvidencePct}%)`);
  console.log(`Without evidence: ${before.doneWithoutEvidence}`);

  if (!REPORT_ONLY) {
    // BACKFILL
    console.log('\n--- BACKFILLING ---');
    const result = await backfillEvidence();
    console.log(`\nLinked: ${result.linked} edges`);
    console.log(`Skipped (already has evidence): ${result.skipped}`);
    if (result.notFound.length > 0) {
      console.log(`Not found: ${result.notFound.length}`);
      for (const nf of result.notFound) {
        console.log(`  - ${nf}`);
      }
    }

    // AFTER metrics
    console.log('\n--- AFTER ---');
    const after = await getCoverageMetrics();
    console.log(`Total done tasks: ${after.totalDone}`);
    console.log(`With evidence: ${after.doneWithEvidence} (${after.doneWithEvidencePct}%)`);
    console.log(`Without evidence: ${after.doneWithoutEvidence}`);
    console.log(`\nΔ evidence: +${after.doneWithEvidence - before.doneWithEvidence} tasks`);
    console.log(`Δ coverage: ${before.doneWithEvidencePct}% → ${after.doneWithEvidencePct}%`);

    // CLAIM GUARDRAIL
    console.log('\n--- CLAIM GUARDRAIL ---');
    const guardrail = await checkClaimGuardrail();
    if (guardrail.ok) {
      console.log('✓ No false evidence flag violations found');
    } else {
      console.log(`⚠ ${guardrail.violations.length} violations:`);
      for (const v of guardrail.violations.slice(0, 10)) {
        console.log(`  - ${v.taskName}: ${v.claimType}`);
      }
    }

    // REGRESSION CHECK
    console.log('\n--- REGRESSION CHECK ---');
    const regression = await checkCoverageRegression();
    console.log(`Current coverage: ${regression.currentPct}%`);
    if (regression.previousPct !== null) {
      console.log(`Previous coverage: ${regression.previousPct}%`);
    }
    if (regression.alert) {
      console.log(regression.alert);
    } else {
      console.log('✓ No coverage regression detected');
    }

    // TASKS TOUCHED
    console.log('\n--- TASKS TOUCHED ---');
    for (const task of result.linked_tasks) {
      console.log(`  ${task}`);
    }
  }

  // OUTPUT
  console.log('\n--- SUMMARY ---');
  const final = await getCoverageMetrics();
  console.log(JSON.stringify({
    ok: true,
    totalDone: final.totalDone,
    doneWithEvidence: final.doneWithEvidence,
    doneWithoutEvidence: final.doneWithoutEvidence,
    doneWithEvidencePct: final.doneWithEvidencePct,
    topUnverifiedCount: final.topUnverifiedDoneTasks.length,
  }));

  await driver.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
