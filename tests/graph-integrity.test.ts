/**
 * Graph integrity tests — Extension 9: Minimal Test Harness
 * 
 * Validates the GodSpeed graph against known structural invariants.
 * Run: npx vitest run tests/graph-integrity.test.ts
 * 
 * These tests query the LIVE Neo4j graph. Neo4j must be running with
 * GodSpeed data ingested before running tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import neo4j, { Driver, Session } from 'neo4j-driver';

let driver: Driver;
let session: Session;

beforeAll(() => {
  driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'codegraph')
  );
  session = driver.session();
});

afterAll(async () => {
  await session.close();
  await driver.close();
});

async function query(cypher: string): Promise<any[]> {
  const result = await session.run(cypher);
  return result.records.map(r => {
    const obj: any = {};
    r.keys.forEach(k => {
      const val = r.get(k);
      obj[k] = typeof val?.toNumber === 'function' ? val.toNumber() : val;
    });
    return obj;
  });
}

// ============================================================================
// Test 1: Grammy schema detection
// ============================================================================
describe('Grammy Framework Schema', () => {
  it('should have CommandHandler nodes', async () => {
    const rows = await query(`
      MATCH (h:CommandHandler) RETURN count(h) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(15); // GodSpeed has 18 commands
  });

  it('should have CallbackQueryHandler nodes', async () => {
    const rows = await query(`
      MATCH (h:CallbackQueryHandler) RETURN count(h) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(200); // GodSpeed has 257
  });

  it('should have Entrypoint nodes with REGISTERED_BY edges', async () => {
    const rows = await query(`
      MATCH (h:Function)-[:REGISTERED_BY]->(e:Entrypoint)
      RETURN count(e) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(250);
  });

  it('should have READS_STATE edges to Field nodes', async () => {
    const rows = await query(`
      MATCH ()-[r:READS_STATE]->(f:Field)
      RETURN count(r) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(100);
  });

  it('should have WRITES_STATE edges to Field nodes', async () => {
    const rows = await query(`
      MATCH ()-[r:WRITES_STATE]->(f:Field)
      RETURN count(r) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(50);
  });
});

// ============================================================================
// Test 2: Risk computation on createBot vs other functions
// ============================================================================
describe('Risk Scoring', () => {
  it('createBot should be CRITICAL tier', async () => {
    const rows = await query(`
      MATCH (f:Function {name: 'createBot'})
      RETURN f.riskTier AS tier, f.riskLevel AS level
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].tier).toBe('CRITICAL');
    expect(rows[0].level).toBeGreaterThan(500);
  });

  it('should have functions in all 4 risk tiers', async () => {
    const rows = await query(`
      MATCH (f:Function)
      WHERE f.riskTier IS NOT NULL
      RETURN f.riskTier AS tier, count(f) AS cnt
      ORDER BY cnt DESC
    `);
    const tiers = rows.map(r => r.tier);
    expect(tiers).toContain('CRITICAL');
    expect(tiers).toContain('HIGH');
    expect(tiers).toContain('MEDIUM');
    expect(tiers).toContain('LOW');
  });

  it('fanInCount and fanOutCount should be pre-computed', async () => {
    const rows = await query(`
      MATCH (f:Function)
      WHERE f.fanInCount IS NOT NULL AND f.fanOutCount IS NOT NULL
      RETURN count(f) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(300);
  });
});

// ============================================================================
// Test 3: Import resolution and cross-file dependencies
// ============================================================================
describe('Import Resolution', () => {
  it('RESOLVES_TO coverage should be > 80%', async () => {
    const rows = await query(`
      MATCH (i:Import)
      OPTIONAL MATCH (i)-[:RESOLVES_TO]->(target)
      WITH count(i) AS total, count(target) AS resolved
      RETURN total, resolved, 
        CASE WHEN total > 0 THEN round(100.0 * resolved / total, 1) ELSE 0 END AS pct
    `);
    expect(rows[0].pct).toBeGreaterThanOrEqual(80);
  });

  it('zero internal imports should be unresolved', async () => {
    const rows = await query(`
      MATCH (i:Import)
      WHERE NOT (i)-[:RESOLVES_TO]->()
      AND i.name IS NOT NULL
      AND (i.name STARTS WITH '.' OR i.name STARTS WITH '/')
      RETURN count(i) AS unresolved
    `);
    // All unresolved should be external packages, not relative imports
    expect(rows[0].unresolved).toBe(0);
  });

  it('should have dynamic import edges', async () => {
    const rows = await query(`
      MATCH ()-[r:IMPORTS]->()
      WHERE r.dynamic = true
      RETURN count(r) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(5);
  });

  it('should have barrel re-export RESOLVES_TO edges', async () => {
    const rows = await query(`
      MATCH ()-[r:RESOLVES_TO]->()
      WHERE r.context IS NOT NULL AND r.context CONTAINS 'barrel-reexport'
      RETURN count(r) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(4);
  });
});

// ============================================================================
// Test 4: CALLS edge properties
// ============================================================================
describe('CALLS Edge Properties', () => {
  it('should have conditional CALLS edges', async () => {
    const rows = await query(`
      MATCH ()-[r:CALLS]->()
      WHERE r.conditional = true
      RETURN count(r) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(300);
  });

  it('should have isAsync CALLS edges', async () => {
    const rows = await query(`
      MATCH ()-[r:CALLS]->()
      WHERE r.isAsync = true
      RETURN count(r) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(200);
  });

  it('cross-file calls should exist', async () => {
    const rows = await query(`
      MATCH (src)-[r:CALLS]->(tgt)
      WHERE src.filePath <> tgt.filePath
      RETURN count(r) AS cnt
    `);
    expect(rows[0].cnt).toBeGreaterThanOrEqual(500);
  });
});

// ============================================================================
// Test 5: Structural invariants
// ============================================================================
describe('Structural Invariants', () => {
  it('no duplicate node IDs', async () => {
    const rows = await query(`
      MATCH (n:CodeNode)
      WITH n.nodeId AS id, count(n) AS cnt
      WHERE cnt > 1
      RETURN count(id) AS duplicates
    `);
    expect(rows[0].duplicates).toBe(0);
  });

  it('all Function nodes have filePath', async () => {
    const rows = await query(`
      MATCH (f:Function)
      WHERE f.filePath IS NULL
      RETURN count(f) AS missing
    `);
    expect(rows[0].missing).toBe(0);
  });

  it('every SourceFile has at least one CONTAINS edge', async () => {
    const rows = await query(`
      MATCH (sf:SourceFile)
      WHERE NOT (sf)-[:CONTAINS]->()
      RETURN count(sf) AS empty
    `);
    expect(rows[0].empty).toBe(0);
  });

  it('36 source files parsed', async () => {
    const rows = await query(`
      MATCH (sf:SourceFile)
      RETURN count(sf) AS cnt
    `);
    expect(rows[0].cnt).toBe(36);
  });
});
