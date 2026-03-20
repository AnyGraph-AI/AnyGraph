/**
 * UI-1: Neo4j connection pool utility (server-side only)
 *
 * Credentials never leave the server. This module is only imported
 * in API routes and server components.
 *
 * Includes per-request batch caching to avoid duplicate queries
 * within the same API request.
 */
import neo4j, { type Driver, type Session } from 'neo4j-driver';
import { logUiQueryAudit, toHash } from './query-audit';

// ─── Connection Pool (singleton) ───────────────────────────────

let driver: Driver | null = null;

function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI ?? 'bolt://localhost:7687',
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? 'neo4j',
        process.env.NEO4J_PASSWORD ?? 'codegraph',
      ),
      {
        maxConnectionPoolSize: 10,
        connectionAcquisitionTimeout: 5000,
      },
    );
  }
  return driver;
}

export function getSession(): Session {
  return getDriver().session();
}

/**
 * Check Neo4j connectivity. Returns true if connected, false otherwise.
 */
export async function isConnected(): Promise<boolean> {
  const session = getSession();
  try {
    await session.run('RETURN 1');
    return true;
  } catch {
    return false;
  } finally {
    await session.close();
  }
}

// ─── Query Cache (per-request batch) ──────────────────────────

const queryCache = new Map<string, { result: unknown; ts: number }>();
const CACHE_TTL_MS = 5_000; // 5 seconds — covers a single page load

function cacheKey(cypher: string, params: Record<string, unknown>): string {
  return `${cypher}::${JSON.stringify(params)}`;
}

/**
 * Run a Cypher query with per-request caching.
 * Same query+params within CACHE_TTL returns cached result.
 */
export async function cachedQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const key = cacheKey(cypher, params);
  const cached = queryCache.get(key);
  const queryPreview = cypher.replace(/\s+/g, ' ').trim().slice(0, 240);
  const queryHash = toHash(cypher);
  const paramsHash = toHash(JSON.stringify(params));

  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    await logUiQueryAudit({
      ts: new Date().toISOString(),
      queryHash,
      queryPreview,
      paramsHash,
      cacheHit: true,
      rowCount: Array.isArray(cached.result) ? cached.result.length : undefined,
      ok: true,
    });
    return cached.result as T[];
  }

  // Wrap JS numbers that should be integers for Cypher LIMIT/SKIP params
  const safeParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    safeParams[k] = typeof v === 'number' && Number.isInteger(v) ? neo4j.int(v) : v;
  }

  const started = Date.now();
  const session = getSession();
  try {
    const result = await session.run(cypher, safeParams);
    const rows = result.records.map((record) => {
      const obj: Record<string, unknown> = {};
      for (const key of record.keys) {
        const k = String(key);
        const val = record.get(k);
        // Convert Neo4j integers to JS numbers
        obj[k] = val?.toNumber ? val.toNumber() : val;
      }
      return obj as T;
    });
    queryCache.set(key, { result: rows, ts: Date.now() });

    await logUiQueryAudit({
      ts: new Date().toISOString(),
      queryHash,
      queryPreview,
      paramsHash,
      cacheHit: false,
      durationMs: Date.now() - started,
      rowCount: rows.length,
      ok: true,
    });

    return rows;
  } catch (error: unknown) {
    await logUiQueryAudit({
      ts: new Date().toISOString(),
      queryHash,
      queryPreview,
      paramsHash,
      cacheHit: false,
      durationMs: Date.now() - started,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 300) : 'unknown-error',
    });
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * Clear the query cache. Call after mutations.
 */
export function clearQueryCache(): void {
  queryCache.clear();
}

/**
 * Close the driver. Call on shutdown.
 */
export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
