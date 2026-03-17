/**
 * UI-0: Scoring normalization utilities
 *
 * Provides normalize(), getMaxPainScore(), getMaxAdjustedPain() for UI panels.
 * Results are cached per (projectId, batchKey) to avoid repeated Neo4j queries within a request.
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

// ─── Cache ─────────────────────────────────────────────────────

const cache = new Map<string, { value: number; ts: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function cacheKey(projectId: string, metric: string): string {
  return `${projectId}:${metric}`;
}

function getCached(key: string): number | undefined {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.value;
  }
  cache.delete(key);
  return undefined;
}

function setCache(key: string, value: number): void {
  cache.set(key, { value, ts: Date.now() });
}

/**
 * Clear the scoring cache. Useful after running precompute.
 */
export function clearScoringCache(): void {
  cache.clear();
}

// ─── Max queries ───────────────────────────────────────────────

/**
 * Get the maximum painScore for SourceFiles in a project.
 * Cached per request batch (30s TTL).
 */
export async function getMaxPainScore(
  projectId: string,
  driver: Driver,
): Promise<number> {
  const key = cacheKey(projectId, 'maxPainScore');
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (sf:SourceFile {projectId: $projectId})
       WHERE sf.painScore IS NOT NULL
       RETURN max(sf.painScore) AS maxVal`,
      { projectId },
    );
    const maxVal = toNum(result.records[0]?.get('maxVal') ?? 0);
    setCache(key, maxVal);
    return maxVal;
  } finally {
    await session.close();
  }
}

/**
 * Get the maximum adjustedPain for SourceFiles in a project.
 * Cached per request batch (30s TTL).
 */
export async function getMaxAdjustedPain(
  projectId: string,
  driver: Driver,
): Promise<number> {
  const key = cacheKey(projectId, 'maxAdjustedPain');
  const cached = getCached(key);
  if (cached !== undefined) return cached;

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (sf:SourceFile {projectId: $projectId})
       WHERE sf.adjustedPain IS NOT NULL
       RETURN max(sf.adjustedPain) AS maxVal`,
      { projectId },
    );
    const maxVal = toNum(result.records[0]?.get('maxVal') ?? 0);
    setCache(key, maxVal);
    return maxVal;
  } finally {
    await session.close();
  }
}
