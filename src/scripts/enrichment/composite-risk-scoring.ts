/**
 * GC-5: Composite Risk Scoring
 *
 * Replaces flat riskTier (78% at 0.0, only LOW/MEDIUM populated) with hybrid scoring:
 * - Composite score: weighted sum of 4 components
 * - Absolute flags: promote tier regardless of percentile
 * - Percentile-based tier assignment with flag-based promotion
 *
 * Components (weights):
 *   structural (0.3): riskLevel — fan-in, complexity, call graph centrality
 *   change     (0.3): churnRelative — lines changed / total lines
 *   ownership  (0.2): author count (0 = max risk, single owner = low, many = medium)
 *   verGap     (0.2): 1.0 if no ANALYZED edges on parent SourceFile, else 0.0
 *
 * Flags (promote tier):
 *   NO_VERIFICATION:       function's file has 0 ANALYZED edges
 *   HIGH_CHURN:            churnRelative >= 2.0
 *   HIGH_TEMPORAL_COUPLING: temporalCoupling >= 3
 *   GOVERNANCE_PATH:       filePath contains verification/, governance/, or sarif
 *
 * Tier assignment:
 *   percentile < 50  → LOW
 *   percentile < 80  → MEDIUM
 *   percentile < 95  → HIGH
 *   percentile >= 95 → CRITICAL
 *   Any flag → promote at least one tier (capped at CRITICAL)
 */
import type { Driver } from 'neo4j-driver';

// ─── Types ─────────────────────────────────────────────────────

export interface CompositeRiskInput {
  riskLevel: number;       // structural — raw from graph
  churnRelative: number;   // change — from GC-1
  authorCount: number;     // ownership — OWNS edge count on parent SourceFile
  hasVerification: boolean; // true if parent SourceFile has ANALYZED edges
  temporalCoupling: number; // co-change coupling count
  filePath: string;        // for governance path flag
}

export interface CompositeRiskResult {
  compositeRisk: number;   // 0.0–1.0 normalized composite score
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  flags: string[];         // absolute flag names
}

// ─── Pure functions (testable) ─────────────────────────────────

/**
 * Normalize a value to 0.0–1.0 using percentile rank within the population.
 * Returns the fraction of values strictly less than this value.
 */
export function percentileRank(value: number, sortedPopulation: number[]): number {
  if (sortedPopulation.length === 0) return 0;
  let count = 0;
  for (const v of sortedPopulation) {
    if (v < value) count++;
    else break; // sorted, so no more will be less
  }
  return count / sortedPopulation.length;
}

/**
 * Compute absolute risk flags.
 */
export function computeFlags(input: CompositeRiskInput): string[] {
  const flags: string[] = [];
  if (!input.hasVerification) flags.push('NO_VERIFICATION');
  if (input.churnRelative >= 2.0) flags.push('HIGH_CHURN');
  if (input.temporalCoupling >= 3) flags.push('HIGH_TEMPORAL_COUPLING');
  if (/\/(verification|governance|sarif)\//i.test(input.filePath)) {
    flags.push('GOVERNANCE_PATH');
  }
  return flags;
}

const TIERS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/**
 * Resolve risk tier from percentile + flags.
 * Percentile thresholds: 50/80/95.
 * Each flag promotes one tier (capped at CRITICAL).
 */
export function resolveRiskTier(
  percentile: number,
  flags: string[],
): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  let tierIndex = 0;
  if (percentile >= 0.95) tierIndex = 3;
  else if (percentile >= 0.80) tierIndex = 2;
  else if (percentile >= 0.50) tierIndex = 1;
  else tierIndex = 0;

  // Flag promotion: each unique flag promotes one tier
  const promotion = Math.min(flags.length, 3 - tierIndex);
  tierIndex += promotion;

  return TIERS[Math.min(tierIndex, 3)];
}

/**
 * Compute composite risk score (0.0–1.0).
 * Each component is percentile-normalized, then weighted.
 */
export function computeCompositeRisk(
  structuralPct: number,
  changePct: number,
  ownershipRisk: number,  // 0.0–1.0 (1.0 = no owner, highest risk)
  verGap: number,         // 0.0 or 1.0
): number {
  return structuralPct * 0.3 + changePct * 0.3 + ownershipRisk * 0.2 + verGap * 0.2;
}

/**
 * Convert author count to ownership risk (0.0–1.0).
 * 0 authors = 1.0 (max risk — no one owns this)
 * 1 author = 0.2 (low risk — clear owner)
 * 2+ authors = 0.5 (medium risk — shared ownership)
 */
export function ownershipRisk(authorCount: number): number {
  if (authorCount === 0) return 1.0;
  if (authorCount === 1) return 0.2;
  return 0.5;
}

// ─── Neo4j enrichment ──────────────────────────────────────────

export async function enrichCompositeRisk(
  driver: Driver,
  projectId: string = 'proj_c0d3e9a1f200',
): Promise<{ updated: number; tierDist: Record<string, number> }> {
  const session = driver.session();
  try {
    // Step 1: Fetch all function data in one query
    const dataResult = await session.run(
      `MATCH (f:CodeNode:TypeScript:Function {projectId: $projectId})
       OPTIONAL MATCH (f)<-[:CONTAINS]-(sf:CodeNode:SourceFile:TypeScript {projectId: $projectId})
       OPTIONAL MATCH (sf)<-[:ANALYZED]-(vr)
       OPTIONAL MATCH (a:Author)-[:OWNS]->(sf)
       WITH f,
            coalesce(f.riskLevel, 0.0) AS riskLevel,
            coalesce(f.churnRelative, 0.0) AS churnRelative,
            coalesce(f.temporalCoupling, 0) AS temporalCoupling,
            f.filePath AS filePath,
            count(DISTINCT vr) AS vrCount,
            count(DISTINCT a) AS authorCount
       RETURN f.id AS id,
              riskLevel,
              churnRelative,
              temporalCoupling,
              filePath,
              vrCount > 0 AS hasVerification,
              authorCount`,
      { projectId },
    );

    if (dataResult.records.length === 0) {
      console.log('[GC-5] No functions found');
      return { updated: 0, tierDist: {} };
    }

    // Parse all records
    const functions = dataResult.records.map((r) => ({
      id: r.get('id') as string,
      riskLevel: toNum(r.get('riskLevel')),
      churnRelative: toNum(r.get('churnRelative')),
      temporalCoupling: toNum(r.get('temporalCoupling')),
      filePath: r.get('filePath') as string,
      hasVerification: r.get('hasVerification') as boolean,
      authorCount: toNum(r.get('authorCount')),
    }));

    // Step 2: Build sorted populations for percentile ranking
    const sortedRisk = functions.map((f) => f.riskLevel).sort((a, b) => a - b);
    const sortedChurn = functions.map((f) => f.churnRelative).sort((a, b) => a - b);

    // Step 3: Compute composite for each function
    const composites: { id: string; compositeRisk: number; flags: string[] }[] = [];
    const updates: { id: string; compositeRisk: number; riskTier: string; flags: string[] }[] = [];

    for (const fn of functions) {
      const input: CompositeRiskInput = {
        riskLevel: fn.riskLevel,
        churnRelative: fn.churnRelative,
        authorCount: fn.authorCount,
        hasVerification: fn.hasVerification,
        temporalCoupling: fn.temporalCoupling,
        filePath: fn.filePath,
      };

      const structuralPct = percentileRank(fn.riskLevel, sortedRisk);
      const changePct = percentileRank(fn.churnRelative, sortedChurn);
      const ownRisk = ownershipRisk(fn.authorCount);
      const verGap = fn.hasVerification ? 0.0 : 1.0;

      const composite = computeCompositeRisk(structuralPct, changePct, ownRisk, verGap);
      const flags = computeFlags(input);

      composites.push({ id: fn.id, compositeRisk: composite, flags });
    }

    // Step 3b: Percentile-rank the composite scores themselves for tier assignment
    // This is the critical step — the raw composite is a weighted sum (0-1),
    // NOT a percentile. We need to rank within the population.
    const sortedComposites = composites.map((c) => c.compositeRisk).sort((a, b) => a - b);

    for (const c of composites) {
      const compositePct = percentileRank(c.compositeRisk, sortedComposites);
      const tier = resolveRiskTier(compositePct, c.flags);
      updates.push({ id: c.id, compositeRisk: c.compositeRisk, riskTier: tier, flags: c.flags });
    }

    // Step 4: Batch update
    const updateResult = await session.run(
      `UNWIND $updates AS u
       MATCH (f:CodeNode {id: u.id})
       SET f.compositeRisk = u.compositeRisk,
           f.riskTier = u.riskTier,
           f.riskFlags = u.flags
       RETURN count(f) AS updated`,
      {
        updates: updates.map((u) => ({
          id: u.id,
          compositeRisk: u.compositeRisk,
          riskTier: u.riskTier,
          flags: u.flags,
        })),
      },
    );
    const updated = updateResult.records[0]?.get('updated')?.toNumber?.() ??
      updateResult.records[0]?.get('updated') ?? 0;

    // Tier distribution
    const tierDist: Record<string, number> = {};
    for (const u of updates) {
      tierDist[u.riskTier] = (tierDist[u.riskTier] || 0) + 1;
    }

    console.log(`[GC-5] Composite risk: ${updated} functions updated`);
    console.log(`[GC-5] Tier distribution: ${JSON.stringify(tierDist)}`);
    console.log(`[GC-5] Flag summary: ${JSON.stringify(flagSummary(updates))}`);

    return { updated: typeof updated === 'number' ? updated : 0, tierDist };
  } finally {
    await session.close();
  }
}

function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (v && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

function flagSummary(updates: { flags: string[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const u of updates) {
    for (const f of u.flags) {
      counts[f] = (counts[f] || 0) + 1;
    }
  }
  return counts;
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
    await enrichCompositeRisk(driver, process.argv[2] ?? 'proj_c0d3e9a1f200');
  } finally {
    await driver.close();
  }
}
