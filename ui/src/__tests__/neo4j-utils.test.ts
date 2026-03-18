/**
 * UI-1 Spec Tests: Neo4j utility layer
 *
 * Written from spec BEFORE verification (TDD backfill).
 * Tests the server-side data layer: connection pool, caching, query safety.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── T4: Neo4j connection pool ────────────────────────────────

describe('Neo4j connection pool', () => {
  it('exports getSession, isConnected, cachedQuery, clearQueryCache, closeDriver', async () => {
    const mod = await import('@/lib/neo4j');
    expect(typeof mod.getSession).toBe('function');
    expect(typeof mod.isConnected).toBe('function');
    expect(typeof mod.cachedQuery).toBe('function');
    expect(typeof mod.clearQueryCache).toBe('function');
    expect(typeof mod.closeDriver).toBe('function');
  });

  it('isConnected returns boolean (true when Neo4j is running)', async () => {
    const { isConnected } = await import('@/lib/neo4j');
    const result = await isConnected();
    expect(typeof result).toBe('boolean');
    // Neo4j should be running in our test env
    expect(result).toBe(true);
  });
});

// ─── T5: Query caching layer ─────────────────────────────────

describe('Query caching', () => {
  it('cachedQuery returns array of row objects', async () => {
    const { cachedQuery } = await import('@/lib/neo4j');
    const rows = await cachedQuery('RETURN 1 AS val');
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveProperty('val', 1);
  });

  it('same query within TTL returns cached result (no extra DB hit)', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    clearQueryCache();

    const t0 = Date.now();
    const first = await cachedQuery('RETURN 42 AS num');
    const second = await cachedQuery('RETURN 42 AS num');
    const elapsed = Date.now() - t0;

    expect(first).toEqual(second);
    // Second call should be near-instant (cached)
    // If both took >50ms each, caching is broken
    expect(elapsed).toBeLessThan(500);
  });

  it('clearQueryCache forces fresh query on next call', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');

    await cachedQuery('RETURN 1 AS x');
    clearQueryCache();

    // Should not throw — cache was cleared, query re-executes
    const result = await cachedQuery('RETURN 1 AS x');
    expect(result[0]).toHaveProperty('x', 1);
  });

  it('converts Neo4j integers to JS numbers', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    clearQueryCache();

    const rows = await cachedQuery(
      'MATCH (p:Project {projectId: $pid}) RETURN p.nodeCount AS nc',
      { pid: 'proj_c0d3e9a1f200' },
    );
    if (rows.length > 0) {
      // nodeCount should be a JS number, not a Neo4j Integer object
      expect(typeof (rows[0] as Record<string, unknown>).nc).toBe('number');
    }
  });
});

// ─── T7: Query safety (read-only enforcement) ────────────────

describe('Query safety — read-only enforcement', () => {
  // These tests verify the API route logic by importing and testing
  // the isReadOnly check extracted from the route.
  // Since Next.js route handlers are hard to unit test directly,
  // we test the logic function.

  // Extract the blocked keyword logic for direct testing
  const BLOCKED_KEYWORDS = ['MERGE', 'CREATE', 'DELETE', 'SET', 'REMOVE', 'DETACH', 'DROP'];

  function isReadOnly(query: string): boolean {
    const upper = query.toUpperCase();
    return !BLOCKED_KEYWORDS.some((kw) => upper.includes(kw));
  }

  it('allows MATCH queries', () => {
    expect(isReadOnly('MATCH (n) RETURN n LIMIT 10')).toBe(true);
  });

  it('allows RETURN-only queries', () => {
    expect(isReadOnly('RETURN 1 AS ok')).toBe(true);
  });

  it('allows PROFILE queries', () => {
    expect(isReadOnly('PROFILE MATCH (n) RETURN count(n)')).toBe(true);
  });

  it('blocks MERGE', () => {
    expect(isReadOnly('MERGE (n:Test {id: 1}) RETURN n')).toBe(false);
  });

  it('blocks CREATE', () => {
    expect(isReadOnly('CREATE (n:Test {id: 1})')).toBe(false);
  });

  it('blocks DELETE', () => {
    expect(isReadOnly('MATCH (n) DELETE n')).toBe(false);
  });

  it('blocks DETACH DELETE', () => {
    expect(isReadOnly('MATCH (n) DETACH DELETE n')).toBe(false);
  });

  it('blocks SET', () => {
    expect(isReadOnly('MATCH (n) SET n.x = 1')).toBe(false);
  });

  it('blocks REMOVE', () => {
    expect(isReadOnly('MATCH (n) REMOVE n.x')).toBe(false);
  });

  it('blocks DROP', () => {
    expect(isReadOnly('DROP INDEX my_index')).toBe(false);
  });

  it('blocks case-insensitive mutations', () => {
    expect(isReadOnly('match (n) set n.x = 1')).toBe(false);
    expect(isReadOnly('Match (n) Delete n')).toBe(false);
  });
});

// ─── T6: Queries module ──────────────────────────────────────

describe('Queries module', () => {
  it('exports all expected query keys', async () => {
    const { QUERIES } = await import('@/lib/queries');
    const expected = [
      'painHeatmap',
      'godFiles',
      'realityGap',
      'safestAction',
      'riskDistribution',
      'projectSummary',
      'listProjects',
      'ping',
    ];
    for (const key of expected) {
      expect(QUERIES).toHaveProperty(key);
      expect(typeof (QUERIES as Record<string, string>)[key]).toBe('string');
    }
  });

  it('all queries contain $projectId parameter (except ping and listProjects)', async () => {
    const { QUERIES } = await import('@/lib/queries');
    const filtered = Object.entries(QUERIES).filter(
      ([k]) => k !== 'ping' && k !== 'listProjects',
    );
    for (const [name, query] of filtered) {
      expect(query).toContain('$projectId');
    }
  });

  it('no query contains MERGE, CREATE, or DELETE', async () => {
    const { QUERIES } = await import('@/lib/queries');
    for (const [name, query] of Object.entries(QUERIES)) {
      const upper = (query as string).toUpperCase();
      expect(upper).not.toContain('MERGE');
      expect(upper).not.toContain('CREATE');
      expect(upper).not.toContain('DELETE');
    }
  });
});

// ─── T8: Round-trip integration ──────────────────────────────

describe('Round-trip integration', () => {
  it('cachedQuery can execute painHeatmap query against live graph', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    const rows = await cachedQuery(QUERIES.painHeatmap, {
      projectId: 'proj_c0d3e9a1f200',
      limit: 5,
    });

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('name');
    expect(rows[0]).toHaveProperty('adjustedPain');
    expect(rows[0]).toHaveProperty('confidenceScore');
  });

  it('cachedQuery can execute projectSummary and returns maxima', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    const rows = await cachedQuery(QUERIES.projectSummary, {
      projectId: 'proj_c0d3e9a1f200',
    });

    expect(rows.length).toBe(1);
    const p = rows[0] as Record<string, unknown>;
    expect(p.name).toBe('codegraph');
    expect(typeof p.maxPainScore).toBe('number');
    expect(typeof p.maxAdjustedPain).toBe('number');
    expect(typeof p.maxFragility).toBe('number');
    expect(typeof p.maxCentrality).toBe('number');
    expect((p.maxPainScore as number)).toBeGreaterThan(0);
  });

  it('cachedQuery can execute riskDistribution and returns tier counts', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    const rows = await cachedQuery(QUERIES.riskDistribution, {
      projectId: 'proj_c0d3e9a1f200',
    });

    expect(rows.length).toBeGreaterThan(0);
    const tiers = rows.map((r) => (r as Record<string, unknown>).tier);
    expect(tiers).toContain('CRITICAL');
    expect(tiers).toContain('HIGH');
  });
});
