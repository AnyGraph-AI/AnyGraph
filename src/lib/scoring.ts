/**
 * UI-0: Scoring normalization utilities
 *
 * All max values are pre-stored on Project nodes during precompute.
 * No query-time computation — pure property reads.
 */
import type { Driver } from 'neo4j-driver';

function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (v && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

/**
 * Normalize a value to 0.0-1.0 given the max value.
 */
export function normalize(value: number, max: number): number {
  if (max === 0) return 0;
  return value / max;
}

// ─── Project maxima (pre-stored, single read) ──────────────────

export interface ProjectMaxima {
  maxPainScore: number;
  maxAdjustedPain: number;
  maxFragility: number;
  maxCentrality: number;
}

// In-memory cache: projectId → maxima (populated once per request batch)
const cache = new Map<string, { value: ProjectMaxima; ts: number }>();
const CACHE_TTL_MS = 30_000;

/**
 * Get all pre-stored maxima from the Project node.
 * Single property read, no aggregation.
 */
export async function getProjectMaxima(
  projectId: string,
  driver: Driver,
): Promise<ProjectMaxima> {
  const cached = cache.get(projectId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }
  cache.delete(projectId);

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (p:Project {projectId: $projectId})
       RETURN p.maxPainScore AS maxPainScore,
              p.maxAdjustedPain AS maxAdjustedPain,
              p.maxFragility AS maxFragility,
              p.maxCentrality AS maxCentrality`,
      { projectId },
    );
    const r = result.records[0];
    const value: ProjectMaxima = {
      maxPainScore: toNum(r?.get('maxPainScore') ?? 0),
      maxAdjustedPain: toNum(r?.get('maxAdjustedPain') ?? 0),
      maxFragility: toNum(r?.get('maxFragility') ?? 0),
      maxCentrality: toNum(r?.get('maxCentrality') ?? 0),
    };
    cache.set(projectId, { value, ts: Date.now() });
    return value;
  } finally {
    await session.close();
  }
}

/**
 * Convenience: get max painScore for a project.
 */
export async function getMaxPainScore(
  projectId: string,
  driver: Driver,
): Promise<number> {
  const maxima = await getProjectMaxima(projectId, driver);
  return maxima.maxPainScore;
}

/**
 * Convenience: get max adjustedPain for a project.
 */
export async function getMaxAdjustedPain(
  projectId: string,
  driver: Driver,
): Promise<number> {
  const maxima = await getProjectMaxima(projectId, driver);
  return maxima.maxAdjustedPain;
}

/**
 * Clear the scoring cache. Useful after running precompute.
 */
export function clearScoringCache(): void {
  cache.clear();
}
