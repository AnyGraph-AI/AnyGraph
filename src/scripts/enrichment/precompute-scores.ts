/**
 * UI-0: Precompute Scores Enrichment
 *
 * Pre-computes scoring properties on Function and SourceFile nodes
 * so UI panels read properties instead of running expensive aggregation queries.
 *
 * Function nodes (per projectId):
 *   - downstreamImpact: count of transitive callees via CALLS edges
 *   - centralityNormalized: fanInCount normalized to 0.0-1.0 within project
 *
 * SourceFile nodes (per projectId):
 *   - basePain: 5-factor weighted (riskDensity×0.30 + changeFreq×0.25 + (1-coverage)×0.25 + fanOut×0.10 + coChange×0.10)
 *   - downstreamImpact: max downstreamImpact of contained CRITICAL/HIGH functions
 *   - centrality: max centralityNormalized of contained functions
 *   - painScore: basePain * (1 + centrality) * (1 + ln(1 + criticalDownstream))
 *   - confidenceScore: 3-factor (effectiveConf×0.5 + evidenceCount×0.3 + freshness×0.2)
 *   - adjustedPain: painScore * (1 + (1 - confidenceScore)) — uncertainty AMPLIFIES
 *   - fragility: adjustedPain * (1 - confidenceScore) * (1 + normalizedChurn)
 *   - activeInProgressTaskCount: in-progress plan tasks linked via HAS_CODE_EVIDENCE
 *   - activeBlockedTaskCount: planned tasks linked to file with unresolved dependencies
 *   - activeBlockerCount: unresolved dependency count across linked blocked tasks
 *   - activeCriticalFunctionCount: number of CRITICAL functions in this file
 *   - activeGateStatus: ALLOW | REQUIRE_APPROVAL | BLOCK (file-scoped RF-2 posture)
 *
 * DECISION-FORMULA-REVIEW-2026-03-17: All formulas verified against Decision nodes in Neo4j.
 * Do NOT change these formulas without reading the Decision Log in UI_DASHBOARD.md.
 */
import type { Driver } from 'neo4j-driver';
import { classifyConfigRisk, type ConfigRiskClass } from '../../core/config/file-risk-label-policy.js';

// ─── Types ─────────────────────────────────────────────────────

export interface FunctionScoreInput {
  id: string;
  fanInCount: number;
}

export interface BasePainInput {
  riskDensity: number;
  changeFrequency: number;
  testCoverage: number;
  avgFanOut: number;
  coChangeCount: number;
  maxRiskDensity: number;
  maxChangeFrequency: number;
  maxAvgFanOut: number;
  maxCoChangeCount: number;
}

export interface ConfidenceScoreInput {
  avgEffectiveConfidence: number;
  evidenceCount: number;
  freshnessWeight: number;
}

export interface FragilityInput {
  adjustedPain: number;
  confidenceScore: number;
  normalizedChurn: number;
}

export interface SourceFileScoreInput {
  // basePain factors
  riskDensity: number;
  changeFrequency: number;
  testCoverage: number;
  avgFanOut: number;
  coChangeCount: number;
  maxRiskDensity: number;
  maxChangeFrequency: number;
  maxAvgFanOut: number;
  maxCoChangeCount: number;
  // painScore factors
  functionDownstreamImpacts: number[];
  functionCentralities: number[];
  // confidenceScore factors
  avgEffectiveConfidence: number;
  evidenceCount: number;
  freshnessWeight: number;
  // fragility factors
  normalizedChurn: number;
}

export interface SourceFileScoreResult {
  basePain: number;
  downstreamImpact: number;
  centrality: number;
  painScore: number;
  confidenceScore: number;
  fragility: number;
  adjustedPain: number;
}

// ─── Pure functions (testable) ─────────────────────────────────

/**
 * Count transitive callees from a given function via BFS.
 * adjacency maps function id → array of callee ids.
 */
export function computeDownstreamImpact(
  functionId: string,
  adjacency: Record<string, string[]>,
): number {
  const visited = new Set<string>([functionId]); // exclude self from count
  const queue: string[] = [];

  // seed with direct callees
  const directCallees = adjacency[functionId] ?? [];
  for (const callee of directCallees) {
    if (!visited.has(callee)) {
      visited.add(callee);
      queue.push(callee);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const callees = adjacency[current] ?? [];
    for (const callee of callees) {
      if (!visited.has(callee)) {
        visited.add(callee);
        queue.push(callee);
      }
    }
  }

  return visited.size - 1; // subtract self
}

/**
 * Max CALLS depth from a function (longest shortest-path from root to reachable node).
 * Returns 0 when no callees.
 */
export function computeMaxCallDepth(
  functionId: string,
  adjacency: Record<string, string[]>,
): number {
  const visited = new Set<string>([functionId]);
  const queue: Array<{ id: string; depth: number }> = [];
  let maxDepth = 0;

  for (const callee of adjacency[functionId] ?? []) {
    if (!visited.has(callee)) {
      visited.add(callee);
      queue.push({ id: callee, depth: 1 });
      maxDepth = Math.max(maxDepth, 1);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const callee of adjacency[current.id] ?? []) {
      if (!visited.has(callee)) {
        visited.add(callee);
        const nextDepth = current.depth + 1;
        maxDepth = Math.max(maxDepth, nextDepth);
        queue.push({ id: callee, depth: nextDepth });
      }
    }
  }

  return maxDepth;
}

/**
 * Compact tier summary string, e.g. "3C,2H,1M".
 */
export function formatRiskTierSummary(riskTiers: Array<string | null | undefined>): string {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const tier of riskTiers) {
    if (tier === 'CRITICAL' || tier === 'HIGH' || tier === 'MEDIUM' || tier === 'LOW') {
      counts[tier]++;
    }
  }

  const parts: string[] = [];
  if (counts.CRITICAL > 0) parts.push(`${counts.CRITICAL}C`);
  if (counts.HIGH > 0) parts.push(`${counts.HIGH}H`);
  if (counts.MEDIUM > 0) parts.push(`${counts.MEDIUM}M`);
  if (counts.LOW > 0) parts.push(`${counts.LOW}L`);
  return parts.length > 0 ? parts.join(',') : '0';
}

export type FileRiskTier = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Canonical GC-11 file-level tier derivation.
 * Rule: max contained Function.riskTier (UNKNOWN when no tiered functions).
 */
export function tierToNum(tier: string | null | undefined): number {
  switch (tier) {
    case 'CRITICAL': return 4;
    case 'HIGH': return 3;
    case 'MEDIUM': return 2;
    case 'LOW': return 1;
    default: return 0;
  }
}

export function numToTier(num: number): FileRiskTier {
  switch (num) {
    case 4: return 'CRITICAL';
    case 3: return 'HIGH';
    case 2: return 'MEDIUM';
    case 1: return 'LOW';
    default: return 'UNKNOWN';
  }
}

export function deriveFileRiskTier(riskTiers: Array<string | null | undefined>): {
  riskTierNum: number;
  riskTier: FileRiskTier;
} {
  const riskTierNum = riskTiers.reduce((max, tier) => Math.max(max, tierToNum(tier)), 0);
  return { riskTierNum, riskTier: numToTier(riskTierNum) };
}

export function isStructuralRoutingSurface(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return normalized.endsWith('/index.ts') || normalized.endsWith('/index.tsx');
}

/**
 * Normalize fanInCount to 0.0-1.0 within project population.
 */
export function computeCentralityNormalized(
  fanInCount: number,
  maxFanIn: number,
): number {
  if (maxFanIn === 0) return 0;
  return fanInCount / maxFanIn;
}

/**
 * 5-factor weighted basePain (DECISION-FORMULA-REVIEW-2026-03-17).
 *
 * basePain = normalize(riskDensity)×0.30 + normalize(changeFreq)×0.25
 *          + (1-testCoverage)×0.25 + normalize(fanOut)×0.10
 *          + normalize(coChange)×0.10
 *
 * Uses riskDensity (sum/count) NOT maxRiskLevel.
 */
export function computeBasePain(input: BasePainInput): number {
  const norm = (val: number, max: number) => (max === 0 ? 0 : val / max);
  return (
    norm(input.riskDensity, input.maxRiskDensity) * 0.30 +
    norm(input.changeFrequency, input.maxChangeFrequency) * 0.25 +
    (1 - input.testCoverage) * 0.25 +
    norm(input.avgFanOut, input.maxAvgFanOut) * 0.10 +
    norm(input.coChangeCount, input.maxCoChangeCount) * 0.10
  );
}

/**
 * painScore = basePain * (1 + centrality) * (1 + ln(1 + downstreamImpact))
 *
 * Log-damping prevents downstream impact from dominating the score.
 * Without damping, a file with downstream=21 gets 22× multiplier,
 * making a basePain=1.46 file score higher than genuinely complex files.
 * With ln: downstream=21 → ~4.1× instead of 22×.
 */
export function computePainScore(
  basePain: number,
  centrality: number,
  downstreamImpact: number,
): number {
  return basePain * (1 + centrality) * (1 + Math.log(1 + downstreamImpact));
}

/**
 * 3-factor confidence score (DECISION-FORMULA-REVIEW-2026-03-17).
 *
 * confidenceScore = avgEffectiveConfidence×W_eff
 *                 + min(evidenceCount,10)/10×W_ev
 *                 + freshnessWeight×W_fr
 *
 * When VerificationRun data is absent (evidenceCount=0, freshness=0),
 * the full weight shifts to effectiveConfidence so tested files reach
 * 100% instead of being capped at 50% by missing infrastructure.
 * Once RF-15 delivers real VR data, the weights activate naturally.
 */
export function computeConfidenceScore(input: ConfidenceScoreInput): number {
  const { avgEffectiveConfidence, evidenceCount, freshnessWeight } = input;

  const W_EFF = 0.5;
  const W_EV = 0.3;
  const W_FR = 0.2;

  // If VR factors are absent (both zero), redistribute their weight to effectiveConf
  const vrAbsent = evidenceCount === 0 && freshnessWeight === 0;
  if (vrAbsent) {
    return avgEffectiveConfidence; // full weight on what we know
  }

  return (
    avgEffectiveConfidence * W_EFF +
    (Math.min(evidenceCount, 10) / 10) * W_EV +
    freshnessWeight * W_FR
  );
}

/**
 * Compound fragility (DECISION-FORMULA-REVIEW-2026-03-17).
 *
 * fragility = adjustedPain × (1-confidenceScore) × (1+normalizedChurn)
 *
 * NOT a linear combination — that was ~90% correlated with basePain.
 * Product answers: "painful AND unprotected AND unstable."
 */
export function computeFragility(input: FragilityInput): number {
  const { adjustedPain, confidenceScore, normalizedChurn } = input;
  return adjustedPain * (1 - confidenceScore) * (1 + normalizedChurn);
}

/**
 * Uncertainty-amplified pain (DECISION-FORMULA-REVIEW-2026-03-17).
 *
 * adjustedPain = painScore × (1 + (1 - confidenceScore))
 *
 * confidence=0 → 2× pain (unknown = worst case)
 * confidence=1 → 1× pain (known = face value)
 *
 * DO NOT change to painScore × (0.5 + 0.5×conf) — that REDUCES pain
 * for untested files, rewarding ignorance. See Decision Log.
 */
export function computeAdjustedPain(
  painScore: number,
  confidenceScore: number,
): number {
  return painScore * (1 + (1 - confidenceScore));
}

export interface ActiveGateInput {
  criticalFunctionCount: number;
  hasTestEvidence: boolean;
}

export type ActiveGateStatus = 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';

/**
 * File-scoped RF-2 gate posture used by UI-8 Active Context precompute.
 */
export function computeActiveGateStatus(input: ActiveGateInput): ActiveGateStatus {
  if (input.criticalFunctionCount <= 0) return 'ALLOW';
  return input.hasTestEvidence ? 'REQUIRE_APPROVAL' : 'BLOCK';
}

/**
 * Compute all SourceFile score properties from pre-aggregated inputs.
 * Uses corrected formulas from DECISION-FORMULA-REVIEW-2026-03-17.
 */
export function computeSourceFileScores(
  input: SourceFileScoreInput,
): SourceFileScoreResult {
  const basePain = computeBasePain({
    riskDensity: input.riskDensity,
    changeFrequency: input.changeFrequency,
    testCoverage: input.testCoverage,
    avgFanOut: input.avgFanOut,
    coChangeCount: input.coChangeCount,
    maxRiskDensity: input.maxRiskDensity,
    maxChangeFrequency: input.maxChangeFrequency,
    maxAvgFanOut: input.maxAvgFanOut,
    maxCoChangeCount: input.maxCoChangeCount,
  });
  const downstreamImpact = input.functionDownstreamImpacts.length > 0
    ? Math.max(...input.functionDownstreamImpacts)
    : 0;
  const centrality = input.functionCentralities.length > 0
    ? Math.max(...input.functionCentralities)
    : 0;
  const painScore = computePainScore(basePain, centrality, downstreamImpact);
  const confidenceScore = computeConfidenceScore({
    avgEffectiveConfidence: input.avgEffectiveConfidence,
    evidenceCount: input.evidenceCount,
    freshnessWeight: input.freshnessWeight,
  });
  const adjustedPain = computeAdjustedPain(painScore, confidenceScore);
  const fragility = computeFragility({
    adjustedPain,
    confidenceScore,
    normalizedChurn: input.normalizedChurn,
  });

  return {
    basePain,
    downstreamImpact,
    centrality,
    painScore,
    confidenceScore,
    fragility,
    adjustedPain,
  };
}

// ─── Neo4j enrichment ──────────────────────────────────────────

function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (v && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

export async function enrichPrecomputeScores(
  driver: Driver,
  projectId: string = 'proj_c0d3e9a1f200',
): Promise<{ functionsUpdated: number; filesUpdated: number }> {
  const session = driver.session();
  try {
    // ── Step 1: Build CALLS adjacency for downstream impact ────
    const callsResult = await session.run(
      `MATCH (caller:CodeNode:Function {projectId: $projectId})-[:CALLS]->(callee:CodeNode:Function {projectId: $projectId})
       RETURN caller.id AS callerId, callee.id AS calleeId`,
      { projectId },
    );

    const adjacency: Record<string, string[]> = {};
    for (const r of callsResult.records) {
      const callerId = r.get('callerId') as string;
      const calleeId = r.get('calleeId') as string;
      if (!adjacency[callerId]) adjacency[callerId] = [];
      adjacency[callerId].push(calleeId);
    }

    // ── Step 2: Get all functions with fanInCount ──────────────
    const functionsResult = await session.run(
      `MATCH (f:CodeNode:Function {projectId: $projectId})
       RETURN f.id AS id, coalesce(f.fanInCount, 0) AS fanInCount`,
      { projectId },
    );

    if (functionsResult.records.length === 0) {
      console.log('[UI-0] No functions found');
      return { functionsUpdated: 0, filesUpdated: 0 };
    }

    const functions = functionsResult.records.map((r) => ({
      id: r.get('id') as string,
      fanInCount: toNum(r.get('fanInCount')),
    }));

    // Compute downstream impact for each function
    const downstreamImpacts: Record<string, number> = {};
    for (const fn of functions) {
      downstreamImpacts[fn.id] = computeDownstreamImpact(fn.id, adjacency);
    }

    // Compute max fanIn for centrality normalization
    const maxFanIn = Math.max(...functions.map((f) => f.fanInCount), 0);

    // Compute centrality for each function
    const centralityMap: Record<string, number> = {};
    for (const fn of functions) {
      centralityMap[fn.id] = computeCentralityNormalized(fn.fanInCount, maxFanIn);
    }

    // ── Step 3: Write function properties ──────────────────────
    const fnUpdates = functions.map((fn) => ({
      id: fn.id,
      downstreamImpact: downstreamImpacts[fn.id],
      centralityNormalized: centralityMap[fn.id],
    }));

    const fnWriteResult = await session.run(
      `UNWIND $updates AS u
       MATCH (f:CodeNode {id: u.id})
       SET f.downstreamImpact = u.downstreamImpact,
           f.centralityNormalized = u.centralityNormalized
       RETURN count(f) AS updated`,
      { updates: fnUpdates },
    );
    const functionsUpdated = toNum(fnWriteResult.records[0]?.get('updated'));
    console.log(`[UI-0] Functions updated: ${functionsUpdated}`);

    // ── Step 4: Aggregate per SourceFile ───────────────────────
    // Get SourceFile -> contained functions with compositeRisk, fanOut, riskTier
    const fileDataResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (sf)-[:CONTAINS]->(f:CodeNode:Function {projectId: $projectId})
       WITH sf,
            collect(DISTINCT f.id) AS fnIds,
            collect(DISTINCT f.compositeRisk) AS risks,
            collect(DISTINCT f.fanOutCount) AS fanOuts,
            collect(f.riskTier) AS riskTiers
       RETURN sf.id AS sfId,
              sf.filePath AS filePath,
              fnIds,
              risks,
              fanOuts,
              riskTiers,
              coalesce(sf.gitChangeFrequency, 0) AS changeFrequency,
              coalesce(sf.churnTotal, 0) AS churnTotal,
              size(fnIds) AS fnCount`,
      { projectId },
    );

    // Get co-change counts per file
    const coChangeResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (sf)-[cc:CO_CHANGES_WITH]->()
       RETURN sf.id AS sfId, count(cc) AS coChangeCount`,
      { projectId },
    );
    const coChangeMap: Record<string, number> = {};
    for (const r of coChangeResult.records) {
      coChangeMap[r.get('sfId') as string] = toNum(r.get('coChangeCount'));
    }

    // Import fan-in/fan-out per file (structural routing metrics)
    const importFanResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (src:CodeNode:SourceFile {projectId: $projectId})-[:IMPORTS]->(sf)
       WITH sf, count(DISTINCT src) AS importFanInCount
       OPTIONAL MATCH (sf)-[:IMPORTS]->(dst:CodeNode:SourceFile {projectId: $projectId})
       RETURN sf.id AS sfId,
              importFanInCount,
              count(DISTINCT dst) AS importFanOutCount`,
      { projectId },
    );
    const importFanMap: Record<string, { fanIn: number; fanOut: number }> = {};
    for (const r of importFanResult.records) {
      importFanMap[r.get('sfId') as string] = {
        fanIn: toNum(r.get('importFanInCount')),
        fanOut: toNum(r.get('importFanOutCount')),
      };
    }

    // Hidden coupling: files that co-change without import in either direction
    const hiddenCouplingResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})-[cc:CO_CHANGES_WITH]->(other:CodeNode:SourceFile {projectId: $projectId})
       WHERE NOT (sf)-[:IMPORTS]->(other) AND NOT (other)-[:IMPORTS]->(sf)
       RETURN sf.id AS sfId, count(DISTINCT other) AS hiddenCouplingCount`,
      { projectId },
    );
    const hiddenCouplingMap: Record<string, number> = {};
    for (const r of hiddenCouplingResult.records) {
      hiddenCouplingMap[r.get('sfId') as string] = toNum(r.get('hiddenCouplingCount'));
    }

    // Distinct authors touching each file (bus factor proxy)
    const busFactorResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (sf)-[:OWNED_BY]->(a:CodeNode:Author)
       RETURN sf.id AS sfId, count(DISTINCT a) AS busFactor`,
      { projectId },
    );
    const busFactorMap: Record<string, number> = {};
    for (const r of busFactorResult.records) {
      busFactorMap[r.get('sfId') as string] = toNum(r.get('busFactor'));
    }

    // Mutable state fields per file (Q6/Q26)
    const stateFieldResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (sf)-[:CONTAINS]->(fld:CodeNode:Field)
       WHERE coalesce(fld.isMutable, true) = true
       RETURN sf.id AS sfId, count(fld) AS stateFieldCount`,
      { projectId },
    );
    const stateFieldMap: Record<string, number> = {};
    for (const r of stateFieldResult.records) {
      stateFieldMap[r.get('sfId') as string] = toNum(r.get('stateFieldCount'));
    }

    // Advisory gate failures targeting each file (Q33)
    const verificationFailResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (d:AdvisoryGateDecision)-[:FLAGS]->(sf)
       WHERE toUpper(coalesce(d.status, '')) IN ['FAIL', 'FAILED', 'BLOCK', 'BLOCKED']
       RETURN sf.id AS sfId, count(d) AS verificationFailCount`,
      { projectId },
    );
    const verificationFailMap: Record<string, number> = {};
    for (const r of verificationFailResult.records) {
      verificationFailMap[r.get('sfId') as string] = toNum(r.get('verificationFailCount'));
    }

    // Claims referencing file through evidence chains (Q31)
    const claimCountResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (e:Evidence)-[:ANCHORED_TO]->(sf)
       OPTIONAL MATCH (c:Claim)-[:SUPPORTED_BY|CONTRADICTED_BY|WITNESSES]->(e)
       RETURN sf.id AS sfId, count(DISTINCT c) AS claimCount`,
      { projectId },
    );
    const claimCountMap: Record<string, number> = {};
    for (const r of claimCountResult.records) {
      claimCountMap[r.get('sfId') as string] = toNum(r.get('claimCount'));
    }

    // UI-8 Active Context (Backend): in-progress task count per file.
    const activeInProgressResult = await session.run(
      `CALL {
         MATCH (t:Task)-[:HAS_CODE_EVIDENCE]->(sf:CodeNode:SourceFile {projectId: $projectId})
         WHERE toLower(coalesce(t.status, '')) IN ['in-progress', 'in_progress', 'in progress']
         RETURN sf.id AS sfId, t.id AS taskId
         UNION
         MATCH (t:Task)-[:HAS_CODE_EVIDENCE]->(fn:CodeNode:Function {projectId: $projectId})
         WHERE toLower(coalesce(t.status, '')) IN ['in-progress', 'in_progress', 'in progress']
         MATCH (sf:CodeNode:SourceFile {projectId: $projectId})-[:CONTAINS]->(fn)
         RETURN sf.id AS sfId, t.id AS taskId
       }
       RETURN sfId, count(DISTINCT taskId) AS activeInProgressTaskCount`,
      { projectId },
    );
    const activeInProgressMap: Record<string, number> = {};
    for (const r of activeInProgressResult.records) {
      activeInProgressMap[r.get('sfId') as string] = toNum(r.get('activeInProgressTaskCount'));
    }

    // UI-8 Active Context (Backend): blocked task + blocker counts per file.
    const blockedTaskResult = await session.run(
      `CALL {
         MATCH (t:Task {status: 'planned'})-[:DEPENDS_ON]->(dep:Task)
         WHERE dep.status <> 'done'
         WITH t, count(DISTINCT dep) AS blockerCount
         MATCH (t)-[:HAS_CODE_EVIDENCE]->(sf:CodeNode:SourceFile {projectId: $projectId})
         RETURN sf.id AS sfId, t.id AS taskId, blockerCount
         UNION
         MATCH (t:Task {status: 'planned'})-[:DEPENDS_ON]->(dep:Task)
         WHERE dep.status <> 'done'
         WITH t, count(DISTINCT dep) AS blockerCount
         MATCH (t)-[:HAS_CODE_EVIDENCE]->(fn:CodeNode:Function {projectId: $projectId})
         MATCH (sf:CodeNode:SourceFile {projectId: $projectId})-[:CONTAINS]->(fn)
         RETURN sf.id AS sfId, t.id AS taskId, blockerCount
       }
       RETURN sfId, collect(DISTINCT {taskId: taskId, blockerCount: blockerCount}) AS blockedTaskRows`,
      { projectId },
    );
    const activeBlockedTaskMap: Record<string, number> = {};
    const activeBlockerCountMap: Record<string, number> = {};
    for (const r of blockedTaskResult.records) {
      const sfId = r.get('sfId') as string;
      const blockedTaskRows = (r.get('blockedTaskRows') as Array<{ taskId: string; blockerCount: number }>) ?? [];
      activeBlockedTaskMap[sfId] = blockedTaskRows.length;
      activeBlockerCountMap[sfId] = blockedTaskRows.reduce((sum, row) => sum + toNum(row.blockerCount), 0);
    }

    // File-level TESTED_BY fallback: files with no Functions but with TESTED_BY edges
    // (e.g. queries.ts exports a const object, not functions)
    const fileTestedByResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (sf)-[:TESTED_BY]->(tf)
       WITH sf.id AS sfId, count(tf) AS testedByCount
       WHERE testedByCount > 0
       RETURN sfId, testedByCount`,
      { projectId },
    );
    const fileTestedByMap: Record<string, number> = {};
    for (const r of fileTestedByResult.records) {
      fileTestedByMap[r.get('sfId') as string] = toNum(r.get('testedByCount'));
    }

    // ── Step 4a-vr: Gather VerificationRun evidence per file ──
    // evidenceCount = distinct VR nodes that ANALYZED or FLAGS functions in this file
    // freshnessWeight = exp(-λ * ageDays) where ageDays = days since most recent VR
    const FRESHNESS_LAMBDA = 0.10; // ~7 day half-life (configurable per project)
    // Query: per-file, each VR's effectiveConfidence and ranAt
    const vrEvidenceResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (vr:VerificationRun)-[:ANALYZED]->(sf)
       WITH sf, collect(DISTINCT {ec: vr.effectiveConfidence, ra: vr.ranAt, id: elementId(vr)}) AS directVrs
       OPTIONAL MATCH (sf)-[:CONTAINS]->(fn:CodeNode)-[:FLAGS]-(vr2:VerificationRun)
       WITH sf, directVrs, collect(DISTINCT {ec: vr2.effectiveConfidence, ra: vr2.ranAt, id: elementId(vr2)}) AS flagVrs
       RETURN sf.id AS sfId, directVrs, flagVrs`,
      { projectId },
    );
    const vrEvidenceMap: Record<string, { evidenceCount: number; avgVrConfidence: number; freshnessWeight: number }> = {};
    const now = Date.now();
    for (const r of vrEvidenceResult.records) {
      const sfId = r.get('sfId') as string;
      const directVrs = r.get('directVrs') as Array<{ec: number | null; ra: string | null; id: string | null}>;
      const flagVrs = r.get('flagVrs') as Array<{ec: number | null; ra: string | null; id: string | null}>;

      // Deduplicate by VR element id, filter nulls (from OPTIONAL MATCH)
      const seen = new Set<string>();
      const allVrs: Array<{ec: number | null; ra: any}> = [];
      for (const v of [...directVrs, ...flagVrs]) {
        if (!v.id) continue; // null from OPTIONAL MATCH
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        allVrs.push(v);
      }

      const confidences = allVrs.map(v => Number(v.ec ?? 0.5)).filter(c => !isNaN(c));
      const avgVrConfidence = confidences.length > 0
        ? confidences.reduce((s, c) => s + c, 0) / confidences.length
        : 0;

      // Freshness from most recent VR
      let daysSinceLastVr = 365;
      for (const v of allVrs) {
        if (v.ra) {
          const raDate = new Date(v.ra.toString());
          const days = Math.max(0, Math.floor((now - raDate.getTime()) / (1000 * 60 * 60 * 24)));
          if (days < daysSinceLastVr) daysSinceLastVr = days;
        }
      }
      const freshnessWeight = Math.exp(-FRESHNESS_LAMBDA * daysSinceLastVr);
      vrEvidenceMap[sfId] = { evidenceCount: allVrs.length, avgVrConfidence, freshnessWeight };
    }

    // RF-15: Blend parse-time (hasTestCaller) with runtime coverage (lineCoverage).
    // hasTestCaller = binary (0 or 1), lineCoverage = 0.0-1.0.
    // Blend: functionCoverage = max(hasTestCaller ? 0.5 : 0, lineCoverage)
    // This ensures: caller-only = 0.5, runtime-only = lineCov, both = max.
    const fnCoverageResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})-[:CONTAINS]->(f:CodeNode:Function {projectId: $projectId})
       RETURN sf.id AS sfId, f.id AS fnId,
              coalesce(f.hasTestCaller, false) AS hasTestCaller,
              coalesce(f.lineCoverage, 0.0) AS lineCoverage`,
      { projectId },
    );

    // Build map: sfId -> { coveredSum, totalCount }
    // coveredSum accumulates blended per-function coverage (0.0-1.0 each)
    const coverageMap: Record<string, { covered: number; total: number }> = {};
    for (const r of fnCoverageResult.records) {
      const sfId = r.get('sfId') as string;
      const hasTestCaller = r.get('hasTestCaller') as boolean;
      const lineCoverage = Number(r.get('lineCoverage') ?? 0);
      const callerScore = hasTestCaller ? 0.5 : 0;
      const blended = Math.max(callerScore, lineCoverage);
      if (!coverageMap[sfId]) coverageMap[sfId] = { covered: 0, total: 0 };
      coverageMap[sfId].total++;
      coverageMap[sfId].covered += blended;
    }

    // ── Step 4b: Compute per-file raw values for normalization ─
    interface FileRaw {
      sfId: string;
      fnIds: string[];
      riskDensity: number;
      changeFrequency: number;
      testCoverage: number;
      avgFanOut: number;
      coChangeCount: number;
      churnTotal: number;
      fnDownstreams: number[];
      fnCentralities: number[];
      riskTierSummary: string;
      riskTierNum: number;
      riskTier: FileRiskTier;
      importFanInCount: number;
      importFanOutCount: number;
      structuralRoutingSurface: boolean;
      configRiskClass: ConfigRiskClass;
      productionRiskExcluded: boolean;
      blastRadiusDepth: number;
      temporalCouplingCount: number;
      busFactor: number;
      stateFieldCount: number;
      verificationFailCount: number;
      claimCount: number;
      hiddenCouplingCount: number;
      activeInProgressTaskCount: number;
      activeBlockedTaskCount: number;
      activeBlockerCount: number;
      activeCriticalFunctionCount: number;
      activeGateStatus: ActiveGateStatus;
    }

    const fileRaws: FileRaw[] = [];
    for (const r of fileDataResult.records) {
      const sfId = r.get('sfId') as string;
      const filePath = (r.get('filePath') as string | null) ?? '';
      const fnIds = (r.get('fnIds') as string[]).filter((id) => id != null);
      const risks = (r.get('risks') as number[]).filter((v) => v != null).map(toNum);
      const fanOuts = (r.get('fanOuts') as number[]).filter((v) => v != null).map(toNum);
      const riskTiers = (r.get('riskTiers') as Array<string | null>).filter((v) => v != null);
      const changeFrequency = toNum(r.get('changeFrequency'));
      const churnTotal = toNum(r.get('churnTotal'));
      const coChangeCount = coChangeMap[sfId] ?? 0;

      const coverage = coverageMap[sfId] ?? { covered: 0, total: 0 };
      // If file has no functions but has TESTED_BY edges, treat as covered (1.0)
      const hasTestedByEdge = (fileTestedByMap[sfId] ?? 0) > 0;
      const testCoverage = coverage.total > 0
        ? coverage.covered / coverage.total
        : hasTestedByEdge ? 1.0 : 0;

      const riskSum = risks.reduce((s, v) => s + v, 0);
      const riskDensity = risks.length > 0 ? riskSum / risks.length : 0;

      const fanOutSum = fanOuts.reduce((s, v) => s + v, 0);
      const avgFanOut = fanOuts.length > 0 ? fanOutSum / fanOuts.length : 0;

      const fnDownstreams = fnIds.map((id) => downstreamImpacts[id] ?? 0);
      const fnCentralities = fnIds.map((id) => centralityMap[id] ?? 0);
      const fnDepths = fnIds.map((id) => computeMaxCallDepth(id, adjacency));
      const configRiskClass = classifyConfigRisk(filePath);
      const productionRiskExcluded = configRiskClass === 'EXAMPLE_ASSET';
      const canonicalTier = deriveFileRiskTier(riskTiers);
      const riskTierNum = productionRiskExcluded ? 0 : canonicalTier.riskTierNum;
      const riskTier: FileRiskTier = productionRiskExcluded ? 'UNKNOWN' : canonicalTier.riskTier;
      const importFan = importFanMap[sfId] ?? { fanIn: 0, fanOut: 0 };
      const structuralRoutingSurface = isStructuralRoutingSurface(filePath);
      const activeCriticalFunctionCount = productionRiskExcluded
        ? 0
        : riskTiers.filter((tier) => tier === 'CRITICAL').length;
      const hasTestEvidence = testCoverage > 0 || (fileTestedByMap[sfId] ?? 0) > 0;

      fileRaws.push({
        sfId,
        fnIds,
        riskDensity,
        changeFrequency,
        testCoverage,
        avgFanOut,
        coChangeCount,
        churnTotal,
        fnDownstreams,
        fnCentralities,
        riskTierSummary: productionRiskExcluded ? 'EXCLUDED_EXAMPLE' : formatRiskTierSummary(riskTiers),
        riskTierNum,
        riskTier,
        importFanInCount: importFan.fanIn,
        importFanOutCount: importFan.fanOut,
        structuralRoutingSurface,
        configRiskClass,
        productionRiskExcluded,
        blastRadiusDepth: fnDepths.length > 0 ? Math.max(...fnDepths) : 0,
        temporalCouplingCount: coChangeCount,
        busFactor: busFactorMap[sfId] ?? 0,
        stateFieldCount: stateFieldMap[sfId] ?? 0,
        verificationFailCount: verificationFailMap[sfId] ?? 0,
        claimCount: claimCountMap[sfId] ?? 0,
        hiddenCouplingCount: hiddenCouplingMap[sfId] ?? 0,
        activeInProgressTaskCount: activeInProgressMap[sfId] ?? 0,
        activeBlockedTaskCount: activeBlockedTaskMap[sfId] ?? 0,
        activeBlockerCount: activeBlockerCountMap[sfId] ?? 0,
        activeCriticalFunctionCount,
        activeGateStatus: computeActiveGateStatus({ criticalFunctionCount: activeCriticalFunctionCount, hasTestEvidence }),
      });
    }

    // Compute project-wide maxima for normalization
    const maxRiskDensity = Math.max(...fileRaws.map((f) => f.riskDensity), 0);
    const maxChangeFrequency = Math.max(...fileRaws.map((f) => f.changeFrequency), 0);
    const maxAvgFanOut = Math.max(...fileRaws.map((f) => f.avgFanOut), 0);
    const maxCoChangeCount = Math.max(...fileRaws.map((f) => f.coChangeCount), 0);
    const maxChurnTotal = Math.max(...fileRaws.map((f) => f.churnTotal), 0);

    const fileUpdates: {
      id: string;
      basePain: number;
      downstreamImpact: number;
      centrality: number;
      painScore: number;
      confidenceScore: number;
      fragility: number;
      adjustedPain: number;
      riskTierSummary: string;
      riskTierNum: number;
      riskTier: FileRiskTier;
      importFanInCount: number;
      importFanOutCount: number;
      structuralRoutingSurface: boolean;
      configRiskClass: ConfigRiskClass;
      productionRiskExcluded: boolean;
      blastRadiusDepth: number;
      temporalCouplingCount: number;
      busFactor: number;
      stateFieldCount: number;
      verificationFailCount: number;
      claimCount: number;
      hiddenCouplingCount: number;
      activeInProgressTaskCount: number;
      activeBlockedTaskCount: number;
      activeBlockerCount: number;
      activeCriticalFunctionCount: number;
      activeGateStatus: ActiveGateStatus;
    }[] = [];

    for (const raw of fileRaws) {
      const coverage = coverageMap[raw.sfId] ?? { covered: 0, total: 0 };

      // Blend test coverage with VR evidence for avgEffectiveConfidence
      const fileCoverage = coverageMap[raw.sfId] ?? { covered: 0, total: 0 };
      const hasTestedBy = (fileTestedByMap[raw.sfId] ?? 0) > 0;
      const testBasedConfidence = fileCoverage.total > 0
        ? fileCoverage.covered / fileCoverage.total
        : hasTestedBy ? 1.0 : 0;

      // Blend test coverage with VR confidence: max of both signals
      const vrEvidence = vrEvidenceMap[raw.sfId] ?? { evidenceCount: 0, avgVrConfidence: 0, freshnessWeight: 0 };
      const avgEffectiveConfidence = Math.max(testBasedConfidence, vrEvidence.avgVrConfidence);

      const normalizedChurn = maxChurnTotal > 0
        ? raw.churnTotal / maxChurnTotal
        : 0;

      const scores = computeSourceFileScores({
        riskDensity: raw.riskDensity,
        changeFrequency: raw.changeFrequency,
        testCoverage: raw.testCoverage,
        avgFanOut: raw.avgFanOut,
        coChangeCount: raw.coChangeCount,
        maxRiskDensity,
        maxChangeFrequency,
        maxAvgFanOut,
        maxCoChangeCount,
        functionDownstreamImpacts: raw.fnDownstreams,
        functionCentralities: raw.fnCentralities,
        avgEffectiveConfidence,
        evidenceCount: vrEvidence.evidenceCount,
        freshnessWeight: vrEvidence.freshnessWeight,
        normalizedChurn,
      });

      fileUpdates.push({
        id: raw.sfId,
        ...scores,
        riskTierSummary: raw.riskTierSummary,
        riskTierNum: raw.riskTierNum,
        riskTier: raw.riskTier,
        importFanInCount: raw.importFanInCount,
        importFanOutCount: raw.importFanOutCount,
        structuralRoutingSurface: raw.structuralRoutingSurface,
        configRiskClass: raw.configRiskClass,
        productionRiskExcluded: raw.productionRiskExcluded,
        blastRadiusDepth: raw.blastRadiusDepth,
        temporalCouplingCount: raw.temporalCouplingCount,
        busFactor: raw.busFactor,
        stateFieldCount: raw.stateFieldCount,
        verificationFailCount: raw.verificationFailCount,
        claimCount: raw.claimCount,
        hiddenCouplingCount: raw.hiddenCouplingCount,
        activeInProgressTaskCount: raw.activeInProgressTaskCount,
        activeBlockedTaskCount: raw.activeBlockedTaskCount,
        activeBlockerCount: raw.activeBlockerCount,
        activeCriticalFunctionCount: raw.activeCriticalFunctionCount,
        activeGateStatus: raw.activeGateStatus,
      });
    }

    // ── Step 5: Write SourceFile properties ────────────────────
    let filesUpdated = 0;
    if (fileUpdates.length > 0) {
      const sfWriteResult = await session.run(
        `UNWIND $updates AS u
         MATCH (sf:CodeNode {id: u.id})
         SET sf.basePain = u.basePain,
             sf.downstreamImpact = u.downstreamImpact,
             sf.centrality = u.centrality,
             sf.painScore = u.painScore,
             sf.confidenceScore = u.confidenceScore,
             sf.fragility = u.fragility,
             sf.adjustedPain = u.adjustedPain,
             sf.riskTierSummary = u.riskTierSummary,
             sf.riskTierNum = u.riskTierNum,
             sf.riskTier = u.riskTier,
             sf.importFanInCount = u.importFanInCount,
             sf.importFanOutCount = u.importFanOutCount,
             sf.structuralRoutingSurface = u.structuralRoutingSurface,
             sf.configRiskClass = u.configRiskClass,
             sf.productionRiskExcluded = u.productionRiskExcluded,
             sf.blastRadiusDepth = u.blastRadiusDepth,
             sf.temporalCouplingCount = u.temporalCouplingCount,
             sf.busFactor = u.busFactor,
             sf.stateFieldCount = u.stateFieldCount,
             sf.verificationFailCount = u.verificationFailCount,
             sf.claimCount = u.claimCount,
             sf.hiddenCouplingCount = u.hiddenCouplingCount,
             sf.activeInProgressTaskCount = u.activeInProgressTaskCount,
             sf.activeBlockedTaskCount = u.activeBlockedTaskCount,
             sf.activeBlockerCount = u.activeBlockerCount,
             sf.activeCriticalFunctionCount = u.activeCriticalFunctionCount,
             sf.activeGateStatus = u.activeGateStatus
         RETURN count(sf) AS updated`,
        { updates: fileUpdates },
      );
      filesUpdated = toNum(sfWriteResult.records[0]?.get('updated'));
    }

    console.log(`[UI-0] SourceFiles updated: ${filesUpdated}`);

    // ── Step 6: Create indexes ─────────────────────────────────
    const indexes = [
      'CREATE INDEX IF NOT EXISTS FOR (sf:SourceFile) ON (sf.painScore)',
      'CREATE INDEX IF NOT EXISTS FOR (sf:SourceFile) ON (sf.adjustedPain)',
      'CREATE INDEX IF NOT EXISTS FOR (sf:SourceFile) ON (sf.riskTier)',
      'CREATE INDEX IF NOT EXISTS FOR (sf:SourceFile) ON (sf.riskTierNum)',
      'CREATE INDEX IF NOT EXISTS FOR (f:Function) ON (f.riskTier)',
    ];
    for (const idx of indexes) {
      try {
        await session.run(idx);
      } catch (err: any) {
        // Index may already exist — that's fine
        if (!err.message?.includes('already exists')) {
          console.warn(`[UI-0] Index warning: ${err.message}`);
        }
      }
    }
    console.log('[UI-0] Indexes ensured');

    // ── Step 7: Store max values on Project node ───────────────
    // Eliminates query-time computation for normalization.
    // UI reads: normalized = sf.adjustedPain / project.maxAdjustedPain
    if (fileUpdates.length > 0) {
      const maxPainScore = Math.max(...fileUpdates.map((u) => u.painScore));
      const maxAdjustedPain = Math.max(...fileUpdates.map((u) => u.adjustedPain));
      const maxFragility = Math.max(...fileUpdates.map((u) => u.fragility));
      const maxCentrality = Math.max(...fileUpdates.map((u) => u.centrality));
      const maxBlastRadiusDepth = Math.max(...fileUpdates.map((u) => u.blastRadiusDepth));
      const maxTemporalCouplingCount = Math.max(...fileUpdates.map((u) => u.temporalCouplingCount));
      const maxBusFactor = Math.max(...fileUpdates.map((u) => u.busFactor));
      const maxStateFieldCount = Math.max(...fileUpdates.map((u) => u.stateFieldCount));
      const maxVerificationFailCount = Math.max(...fileUpdates.map((u) => u.verificationFailCount));
      const maxClaimCount = Math.max(...fileUpdates.map((u) => u.claimCount));
      const maxHiddenCouplingCount = Math.max(...fileUpdates.map((u) => u.hiddenCouplingCount));
      const maxActiveInProgressTaskCount = Math.max(...fileUpdates.map((u) => u.activeInProgressTaskCount));
      const maxActiveBlockedTaskCount = Math.max(...fileUpdates.map((u) => u.activeBlockedTaskCount));
      const maxActiveBlockerCount = Math.max(...fileUpdates.map((u) => u.activeBlockerCount));
      const maxActiveCriticalFunctionCount = Math.max(...fileUpdates.map((u) => u.activeCriticalFunctionCount));

      await session.run(
        `MATCH (p:Project {projectId: $projectId})
         SET p.maxPainScore = $maxPainScore,
             p.maxAdjustedPain = $maxAdjustedPain,
             p.maxFragility = $maxFragility,
             p.maxCentrality = $maxCentrality,
             p.maxBlastRadiusDepth = $maxBlastRadiusDepth,
             p.maxTemporalCouplingCount = $maxTemporalCouplingCount,
             p.maxBusFactor = $maxBusFactor,
             p.maxStateFieldCount = $maxStateFieldCount,
             p.maxVerificationFailCount = $maxVerificationFailCount,
             p.maxClaimCount = $maxClaimCount,
             p.maxHiddenCouplingCount = $maxHiddenCouplingCount,
             p.maxActiveInProgressTaskCount = $maxActiveInProgressTaskCount,
             p.maxActiveBlockedTaskCount = $maxActiveBlockedTaskCount,
             p.maxActiveBlockerCount = $maxActiveBlockerCount,
             p.maxActiveCriticalFunctionCount = $maxActiveCriticalFunctionCount`,
        {
          projectId,
          maxPainScore,
          maxAdjustedPain,
          maxFragility,
          maxCentrality,
          maxBlastRadiusDepth,
          maxTemporalCouplingCount,
          maxBusFactor,
          maxStateFieldCount,
          maxVerificationFailCount,
          maxClaimCount,
          maxHiddenCouplingCount,
          maxActiveInProgressTaskCount,
          maxActiveBlockedTaskCount,
          maxActiveBlockerCount,
          maxActiveCriticalFunctionCount,
        },
      );
      console.log(`[UI-0] Project maxima stored: painScore=${maxPainScore.toFixed(2)}, adjustedPain=${maxAdjustedPain.toFixed(2)}, fragility=${maxFragility.toFixed(2)}, centrality=${maxCentrality.toFixed(2)}, blastDepth=${maxBlastRadiusDepth}, temporal=${maxTemporalCouplingCount}, busFactor=${maxBusFactor}, stateFields=${maxStateFieldCount}, verificationFails=${maxVerificationFailCount}, claims=${maxClaimCount}, hiddenCoupling=${maxHiddenCouplingCount}, activeInProgress=${maxActiveInProgressTaskCount}, activeBlocked=${maxActiveBlockedTaskCount}, blockers=${maxActiveBlockerCount}, criticalFunctions=${maxActiveCriticalFunctionCount}`);
    }

    return { functionsUpdated, filesUpdated };
  } finally {
    await session.close();
  }
}

// ─── CLI entry point ───────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const neo4j = await import('neo4j-driver');
  const driver = neo4j.default.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.default.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );
  try {
    await enrichPrecomputeScores(driver, process.argv[2] ?? 'proj_c0d3e9a1f200');
  } finally {
    await driver.close();
  }
}
