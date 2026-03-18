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
 *
 * DECISION-FORMULA-REVIEW-2026-03-17: All formulas verified against Decision nodes in Neo4j.
 * Do NOT change these formulas without reading the Decision Log in UI_DASHBOARD.md.
 */
import type { Driver } from 'neo4j-driver';

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
            collect(DISTINCT f.riskTier) AS riskTiers
       RETURN sf.id AS sfId,
              fnIds,
              risks,
              fanOuts,
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

    // File-level TESTED_BY fallback: files with no Functions but with TESTED_BY edges
    // (e.g. queries.ts exports a const object, not functions)
    const fileTestedByResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (sf)-[:TESTED_BY]->()
       WITH sf.id AS sfId, count(*) AS testedByCount
       WHERE testedByCount > 0
       RETURN sfId, testedByCount`,
      { projectId },
    );
    const fileTestedByMap: Record<string, number> = {};
    for (const r of fileTestedByResult.records) {
      fileTestedByMap[r.get('sfId') as string] = toNum(r.get('testedByCount'));
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
    }

    const fileRaws: FileRaw[] = [];
    for (const r of fileDataResult.records) {
      const sfId = r.get('sfId') as string;
      const fnIds = (r.get('fnIds') as string[]).filter((id) => id != null);
      const risks = (r.get('risks') as number[]).filter((v) => v != null).map(toNum);
      const fanOuts = (r.get('fanOuts') as number[]).filter((v) => v != null).map(toNum);
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

      fileRaws.push({
        sfId, fnIds, riskDensity, changeFrequency, testCoverage,
        avgFanOut, coChangeCount, churnTotal, fnDownstreams, fnCentralities,
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
    }[] = [];

    for (const raw of fileRaws) {
      const coverage = coverageMap[raw.sfId] ?? { covered: 0, total: 0 };

      // For confidence: use test coverage as avgEffectiveConfidence proxy
      // until VerificationRun linkage exists (RF-15+)
      const fileCoverage = coverageMap[raw.sfId] ?? { covered: 0, total: 0 };
      const hasTestedBy = (fileTestedByMap[raw.sfId] ?? 0) > 0;
      const avgEffectiveConfidence = fileCoverage.total > 0
        ? fileCoverage.covered / fileCoverage.total
        : hasTestedBy ? 1.0 : 0;

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
        evidenceCount: 0, // No VR linkage yet — will be wired in RF-15+
        freshnessWeight: 0, // No freshness decay yet — will be wired in RF-15+
        normalizedChurn,
      });

      fileUpdates.push({ id: raw.sfId, ...scores });
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
             sf.adjustedPain = u.adjustedPain
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

      await session.run(
        `MATCH (p:Project {projectId: $projectId})
         SET p.maxPainScore = $maxPainScore,
             p.maxAdjustedPain = $maxAdjustedPain,
             p.maxFragility = $maxFragility,
             p.maxCentrality = $maxCentrality`,
        { projectId, maxPainScore, maxAdjustedPain, maxFragility, maxCentrality },
      );
      console.log(`[UI-0] Project maxima stored: painScore=${maxPainScore.toFixed(2)}, adjustedPain=${maxAdjustedPain.toFixed(2)}, fragility=${maxFragility.toFixed(2)}, centrality=${maxCentrality.toFixed(2)}`);
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
