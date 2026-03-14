/**
 * Graph integrity test harness (Extension 9)
 * 
 * Validates the ingested graph meets structural invariants.
 * Run after parse-and-ingest + post-ingest-all.
 * 
 * Usage: npx tsx test-graph-integrity.ts
 */
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'codegraph'
  )
);

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function query(cypher: string, params?: any): Promise<any[]> {
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map(r => {
      const obj: any = {};
      r.keys.forEach((k: string) => {
        const val = r.get(k);
        obj[k] = typeof val?.toNumber === 'function' ? val.toNumber() : val;
      });
      return obj;
    });
  } finally {
    await session.close();
  }
}

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ': ' + detail : ''}`);
    failed++;
    failures.push(name);
  }
}

async function main() {
  console.log('🧪 CodeGraph Integrity Tests\n');

  // === Test 1: Grammy Schema Detection ===
  console.log('Test 1: Grammy Framework Schema');
  {
    const handlers = await query(`
      MATCH (h:Function)
      WHERE h.semanticType IS NOT NULL
      RETURN count(h) AS cnt
    `);
    assert('Handler nodes with semanticType', handlers[0].cnt > 0, `got ${handlers[0].cnt}`);

    const commands = await query(`
      MATCH (h:CommandHandler) RETURN count(h) AS cnt
    `);
    assert('CommandHandler nodes exist', commands[0].cnt >= 15, `got ${commands[0].cnt}, expected ≥15`);

    const callbacks = await query(`
      MATCH (h:CallbackQueryHandler) RETURN count(h) AS cnt
    `);
    assert('CallbackQueryHandler nodes exist', callbacks[0].cnt >= 100, `got ${callbacks[0].cnt}, expected ≥100`);

    const registeredBy = await query(`
      MATCH ()-[r:REGISTERED_BY]->() RETURN count(r) AS cnt
    `);
    assert('REGISTERED_BY edges exist', registeredBy[0].cnt >= 250, `got ${registeredBy[0].cnt}, expected ≥250`);

    const stateEdges = await query(`
      MATCH ()-[r:READS_STATE|WRITES_STATE]->() RETURN count(r) AS cnt
    `);
    assert('State edges exist (READS_STATE/WRITES_STATE)', stateEdges[0].cnt >= 100, `got ${stateEdges[0].cnt}, expected ≥100`);
  }

  // === Test 2: Risk Scoring on createBot ===
  console.log('\nTest 2: Risk Scoring');
  {
    const createBot = await query(`
      MATCH (f:Function {name: 'createBot'})
      RETURN f.riskLevel AS risk, f.riskTier AS tier, f.fanOutCount AS fanOut, f.lineCount AS lines
    `);
    assert('createBot exists', createBot.length > 0);
    if (createBot.length > 0) {
      assert('createBot is CRITICAL tier', createBot[0].tier === 'CRITICAL', `got ${createBot[0].tier}`);
      assert('createBot riskLevel > 500', createBot[0].risk > 500, `got ${createBot[0].risk}`);
      assert('createBot fanOut > 100', createBot[0].fanOut > 100, `got ${createBot[0].fanOut}`);
      assert('createBot lineCount > 8000', createBot[0].lines > 8000, `got ${createBot[0].lines}`);
    }

    const executeOrder = await query(`
      MATCH (f:Function {name: 'executeOrder'})
      RETURN f.riskTier AS tier, f.fanInCount AS fanIn
    `);
    assert('executeOrder exists with callers', executeOrder.length > 0 && executeOrder[0].fanIn > 5,
      `fanIn: ${executeOrder[0]?.fanIn}`);
  }

  // === Test 3: RESOLVES_TO Coverage ===
  console.log('\nTest 3: Import Resolution');
  {
    const resolution = await query(`
      MATCH (i:Import)
      OPTIONAL MATCH (i)-[:RESOLVES_TO]->(target)
      WITH count(i) AS total, count(target) AS resolved
      RETURN total, resolved, 
             CASE WHEN total > 0 THEN round(100.0 * resolved / total, 1) ELSE 0 END AS pct
    `);
    assert('Import resolution rate > 80%', resolution[0].pct >= 80.0,
      `${resolution[0].resolved}/${resolution[0].total} = ${resolution[0].pct}%`);

    // All unresolved should be external packages
    const unresolvedInternal = await query(`
      MATCH (i:Import)
      WHERE NOT (i)-[:RESOLVES_TO]->()
      AND (i.name STARTS WITH '.' OR i.name STARTS WITH '/')
      RETURN count(i) AS cnt
    `);
    assert('Zero unresolved internal imports', unresolvedInternal[0].cnt === 0,
      `${unresolvedInternal[0].cnt} unresolved internal imports`);
  }

  // === Test 4: Dynamic Import Detection ===
  console.log('\nTest 4: Dynamic Imports');
  {
    const dynamicImports = await query(`
      MATCH ()-[r:IMPORTS]->()
      WHERE r.dynamic = true
      RETURN count(r) AS cnt
    `);
    assert('Dynamic imports detected', dynamicImports[0].cnt > 0, `got ${dynamicImports[0].cnt}`);
  }

  // === Test 5: Barrel Re-exports ===
  console.log('\nTest 5: Barrel Re-exports');
  {
    const barrels = await query(`
      MATCH ()-[r:RESOLVES_TO]->()
      WHERE r.context IS NOT NULL AND r.context CONTAINS 'barrel-reexport'
      RETURN count(r) AS cnt
    `);
    assert('Barrel re-export edges exist', barrels[0].cnt > 0, `got ${barrels[0].cnt}`);
  }

  // === Test 6: Conditional CALLS ===
  console.log('\nTest 6: Conditional Calls');
  {
    const conditional = await query(`
      MATCH ()-[r:CALLS]->()
      WHERE r.conditional = true
      RETURN count(r) AS cnt
    `);
    assert('Conditional calls detected (>100)', conditional[0].cnt > 100, `got ${conditional[0].cnt}`);
  }

  // === Test 7: No Duplicate Node IDs ===
  console.log('\nTest 7: Graph Integrity');
  {
    const dupes = await query(`
      MATCH (n:CodeNode)
      WITH n.nodeId AS id, count(*) AS cnt
      WHERE cnt > 1
      RETURN count(id) AS dupes
    `);
    assert('No duplicate node IDs', dupes[0].dupes === 0, `${dupes[0].dupes} duplicates`);

    // All Function nodes should have filePath
    const noPath = await query(`
      MATCH (f:Function)
      WHERE f.filePath IS NULL
      RETURN count(f) AS cnt
    `);
    assert('All functions have filePath', noPath[0].cnt === 0, `${noPath[0].cnt} without filePath`);

    // All CALLS edges should connect existing nodes
    const danglingCalls = await query(`
      MATCH ()-[r:CALLS]->()
      WHERE r.coreType IS NULL
      RETURN count(r) AS cnt
    `);
    assert('All CALLS edges have coreType', danglingCalls[0].cnt === 0);
  }

  // === Test 8: Cross-file Dependency Chain ===
  console.log('\nTest 8: Dependency Chains');
  {
    // executeOrder should be reachable from bot/index.ts handlers
    const chain = await query(`
      MATCH (h:Function)-[:CALLS*1..5]->(eo:Function {name: 'executeOrder'})
      WHERE h.filePath CONTAINS 'bot/index.ts'
      RETURN count(DISTINCT h) AS callerCount
    `);
    assert('executeOrder reachable from bot handlers (depth ≤5)', chain[0].callerCount > 0,
      `${chain[0].callerCount} bot handlers reach executeOrder`);
  }

  // === Summary ===
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  ❌ ${f}`));
  }
  console.log('');

  await driver.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test harness error:', err);
  process.exit(2);
});
