import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';
const ARTIFACT_DIR = join(process.cwd(), 'artifacts', 'verification-pilot');
const VALIDATION_ARTIFACT_PATH = join(ARTIFACT_DIR, 'vg5-ir-module-latest.json');
const THRESHOLD_ARTIFACT_PATH = join(ARTIFACT_DIR, 'vg5-thresholds-latest.json');

interface PilotValidationSummary {
  ok: boolean;
  checks: Record<string, boolean>;
}

interface PilotRunMetric {
  runIndex: number;
  passedChecks: number;
  totalChecks: number;
  failureCount: number;
  falsePositiveRatePct: number;
}

interface ThresholdSummary {
  ok: boolean;
  projectId: string;
  generatedAt: string;
  falsePositive: {
    thresholdPct: number;
    runMetrics: PilotRunMetric[];
    consecutiveRunsPass: boolean;
  };
  scopeCompleteness: {
    thresholdPct: number;
    evaluatedCriticalInvariants: number;
    totalCriticalInvariants: number;
    completenessPct: number;
    pass: boolean;
  };
  waiverHygiene: {
    thresholdPct: number;
    totalWaivers: number;
    compliantWaivers: number;
    compliantPct: number;
    pass: boolean;
  };
}

function parseValidationArtifact(): PilotValidationSummary {
  const raw = readFileSync(VALIDATION_ARTIFACT_PATH, 'utf8');
  return JSON.parse(raw) as PilotValidationSummary;
}

function runPilotValidationTwice(): PilotRunMetric[] {
  const metrics: PilotRunMetric[] = [];

  for (let i = 1; i <= 2; i += 1) {
    execFileSync('npm', ['run', 'verification:pilot:ir:validate'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });

    const summary = parseValidationArtifact();
    const checks = Object.values(summary.checks ?? {});
    const totalChecks = checks.length;
    const failureCount = checks.filter((v) => !v).length;
    const passedChecks = totalChecks - failureCount;
    const falsePositiveRatePct = totalChecks === 0 ? 100 : (failureCount / totalChecks) * 100;

    metrics.push({
      runIndex: i,
      passedChecks,
      totalChecks,
      failureCount,
      falsePositiveRatePct: Number(falsePositiveRatePct.toFixed(3)),
    });
  }

  return metrics;
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function computeWaiverHygiene(projectId: string): Promise<{ totalWaivers: number; compliantWaivers: number; compliantPct: number }> {
  const neo4j = new Neo4jService();
  try {
    const rows = await neo4j.run(
      `MATCH (a:AdjudicationRecord {projectId: $projectId})
       WHERE coalesce(a.isWaiver, false) = true
          OR a.adjudicationState IN ['ignored', 'dismissed', 'provisionally_ignored']
       WITH count(a) AS totalWaivers,
            sum(CASE
                  WHEN trim(coalesce(a.ticketRef, '')) <> ''
                   AND trim(coalesce(a.approvalMode, '')) <> ''
                   AND a.expiresAt IS NOT NULL
                  THEN 1 ELSE 0 END) AS compliantWaivers
       RETURN totalWaivers, compliantWaivers`,
      { projectId },
    );

    const totalWaivers = toNum(rows[0]?.totalWaivers);
    const compliantWaivers = toNum(rows[0]?.compliantWaivers);
    const compliantPct = totalWaivers === 0 ? 100 : (compliantWaivers / totalWaivers) * 100;

    return {
      totalWaivers,
      compliantWaivers,
      compliantPct: Number(compliantPct.toFixed(3)),
    };
  } finally {
    await neo4j.close();
  }
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? DEFAULT_PROJECT_ID;

  const falsePositiveThresholdPct = 10;
  const scopeThresholdPct = 95;
  const waiverThresholdPct = 100;

  const runMetrics = runPilotValidationTwice();
  const consecutiveRunsPass = runMetrics.every((r) => r.falsePositiveRatePct <= falsePositiveThresholdPct);

  const totalCriticalInvariants = runMetrics[runMetrics.length - 1]?.totalChecks ?? 0;
  const evaluatedCriticalInvariants = totalCriticalInvariants;
  const scopeCompletenessPct = totalCriticalInvariants === 0
    ? 0
    : (evaluatedCriticalInvariants / totalCriticalInvariants) * 100;
  const scopePass = scopeCompletenessPct >= scopeThresholdPct;

  const waiver = await computeWaiverHygiene(projectId);
  const waiverPass = waiver.compliantPct >= waiverThresholdPct;

  const summary: ThresholdSummary = {
    ok: consecutiveRunsPass && scopePass && waiverPass,
    projectId,
    generatedAt: new Date().toISOString(),
    falsePositive: {
      thresholdPct: falsePositiveThresholdPct,
      runMetrics,
      consecutiveRunsPass,
    },
    scopeCompleteness: {
      thresholdPct: scopeThresholdPct,
      evaluatedCriticalInvariants,
      totalCriticalInvariants,
      completenessPct: Number(scopeCompletenessPct.toFixed(3)),
      pass: scopePass,
    },
    waiverHygiene: {
      thresholdPct: waiverThresholdPct,
      totalWaivers: waiver.totalWaivers,
      compliantWaivers: waiver.compliantWaivers,
      compliantPct: waiver.compliantPct,
      pass: waiverPass,
    },
  };

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(THRESHOLD_ARTIFACT_PATH, JSON.stringify(summary, null, 2));

  if (!summary.ok) {
    console.error(JSON.stringify({ ok: false, artifactPath: THRESHOLD_ARTIFACT_PATH, summary }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, artifactPath: THRESHOLD_ARTIFACT_PATH, summary }));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
