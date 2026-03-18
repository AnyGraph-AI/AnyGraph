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
 *   - basePain: sum of compositeRisk of contained functions
 *   - downstreamImpact: max downstreamImpact of contained functions
 *   - centrality: max centralityNormalized of contained functions
 *   - painScore: basePain * (1 + centrality) * (1 + ln(1 + downstreamImpact))
 *   - confidenceScore: fraction of contained functions with TESTED_BY or ANALYZED on parent file
 *   - fragility: painScore * (1 - confidenceScore)
 *   - adjustedPain: painScore * (0.5 + 0.5 * confidenceScore)
 */
import type { Driver } from 'neo4j-driver';

// ─── Types ─────────────────────────────────────────────────────

export interface FunctionScoreInput {
  id: string;
  fanInCount: number;
}

export interface SourceFileScoreInput {
  compositeRisks: number[];
  functionDownstreamImpacts: number[];
  functionCentralities: number[];
  coveredFunctionCount: number;
  totalFunctionCount: number;
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
 * Sum of compositeRisk of all contained functions.
 */
export function computeBasePain(compositeRisks: number[]): number {
  return compositeRisks.reduce((sum, r) => sum + r, 0);
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
 * Fraction of contained functions that have TESTED_BY or ANALYZED edges on parent file.
 */
export function computeConfidenceScore(
  coveredCount: number,
  totalCount: number,
): number {
  if (totalCount === 0) return 0;
  return coveredCount / totalCount;
}

/**
 * fragility = painScore * (1 - confidenceScore)
 */
export function computeFragility(
  painScore: number,
  confidenceScore: number,
): number {
  return painScore * (1 - confidenceScore);
}

/**
 * adjustedPain = painScore * (0.5 + 0.5 * confidenceScore)
 */
export function computeAdjustedPain(
  painScore: number,
  confidenceScore: number,
): number {
  return painScore * (0.5 + 0.5 * confidenceScore);
}

/**
 * Compute all SourceFile score properties from pre-aggregated inputs.
 */
export function computeSourceFileScores(
  input: SourceFileScoreInput,
): SourceFileScoreResult {
  const basePain = computeBasePain(input.compositeRisks);
  const downstreamImpact = input.functionDownstreamImpacts.length > 0
    ? Math.max(...input.functionDownstreamImpacts)
    : 0;
  const centrality = input.functionCentralities.length > 0
    ? Math.max(...input.functionCentralities)
    : 0;
  const painScore = computePainScore(basePain, centrality, downstreamImpact);
  const confidenceScore = computeConfidenceScore(
    input.coveredFunctionCount,
    input.totalFunctionCount,
  );
  const fragility = computeFragility(painScore, confidenceScore);
  const adjustedPain = computeAdjustedPain(painScore, confidenceScore);

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
    // Get SourceFile -> contained functions with their scores + coverage info
    const fileDataResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (sf)-[:CONTAINS]->(f:CodeNode:Function {projectId: $projectId})
       OPTIONAL MATCH (sf)<-[:TESTED_BY|ANALYZED]-(coverage)
       WITH sf,
            collect(DISTINCT f.id) AS fnIds,
            collect(DISTINCT f.compositeRisk) AS risks,
            count(DISTINCT coverage) AS coverageCount
       RETURN sf.id AS sfId,
              fnIds,
              risks,
              coverageCount > 0 AS hasCoverage,
              size(fnIds) AS fnCount`,
      { projectId },
    );

    // For confidence: count functions whose parent file has TESTED_BY or ANALYZED
    // We need per-function coverage. Let's query that separately.
    const fnCoverageResult = await session.run(
      `MATCH (sf:CodeNode:SourceFile {projectId: $projectId})-[:CONTAINS]->(f:CodeNode:Function {projectId: $projectId})
       OPTIONAL MATCH (sf)-[:TESTED_BY]->(tb)
       OPTIONAL MATCH (sf)-[:ANALYZED]->(az)
       WITH f.id AS fnId, sf.id AS sfId,
            count(DISTINCT tb) + count(DISTINCT az) AS coverageEdges
       RETURN sfId, fnId, coverageEdges > 0 AS isCovered`,
      { projectId },
    );

    // Build map: sfId -> { coveredCount, totalCount }
    const coverageMap: Record<string, { covered: number; total: number }> = {};
    for (const r of fnCoverageResult.records) {
      const sfId = r.get('sfId') as string;
      const isCovered = r.get('isCovered') as boolean;
      if (!coverageMap[sfId]) coverageMap[sfId] = { covered: 0, total: 0 };
      coverageMap[sfId].total++;
      if (isCovered) coverageMap[sfId].covered++;
    }

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

    for (const r of fileDataResult.records) {
      const sfId = r.get('sfId') as string;
      const fnIds = (r.get('fnIds') as string[]).filter((id) => id != null);
      const risks = (r.get('risks') as number[]).filter((v) => v != null).map(toNum);

      const fnDownstreams = fnIds.map((id) => downstreamImpacts[id] ?? 0);
      const fnCentralities = fnIds.map((id) => centralityMap[id] ?? 0);

      const coverage = coverageMap[sfId] ?? { covered: 0, total: 0 };

      const scores = computeSourceFileScores({
        compositeRisks: risks,
        functionDownstreamImpacts: fnDownstreams,
        functionCentralities: fnCentralities,
        coveredFunctionCount: coverage.covered,
        totalFunctionCount: coverage.total,
      });

      fileUpdates.push({ id: sfId, ...scores });
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
