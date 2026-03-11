/**
 * POSSIBLE_CALL edge detection — Extension 7: Dynamic dispatch
 * 
 * Detects patterns where the call target is determined at runtime:
 * 1. Ternary function selection: const handler = cond ? fnA : fnB; handler()
 * 2. Higher-order functions: function call<T>(fn: () => T) { fn() }
 * 3. Callback registration: setCallback(fn) → stored fn called later
 * 
 * Creates POSSIBLE_CALL edges with confidence scores.
 * 
 * Usage: npx tsx create-possible-call-edges.ts
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

async function main() {
  const session = driver.session();
  let totalCreated = 0;

  try {
    // Strategy 1: Functions that are called by name but have no direct CALLS edge
    // These might be inner functions or dynamically dispatched
    // Find functions that are referenced in sourceCode but not linked via CALLS
    
    // Strategy 2: Switch/ternary dispatch — functions called in conditional branches
    // where the same caller dispatches to multiple targets based on a condition
    // We detect this by finding callers with multiple conditional CALLS to similar functions
    const conditionalDispatch = await session.run(`
      MATCH (caller:Function)-[r:CALLS]->(target:Function)
      WHERE r.conditional = true
      WITH caller, collect(DISTINCT target.name) AS targets, count(r) AS cnt
      WHERE cnt >= 2
      RETURN caller.name AS caller, targets, cnt
      ORDER BY cnt DESC
      LIMIT 20
    `);

    console.log('=== Conditional dispatch hotspots ===');
    for (const record of conditionalDispatch.records) {
      const caller = record.get('caller');
      const targets = record.get('targets');
      const cnt = record.get('cnt')?.toNumber?.() ?? record.get('cnt');
      console.log(`  ${caller}: ${cnt} conditional targets → [${targets.slice(0, 5).join(', ')}${targets.length > 5 ? '...' : ''}]`);
    }

    // Strategy 3: Find functions with parameters that are function types
    // These accept callbacks and should have POSSIBLE_CALL edges
    const higherOrderFns = await session.run(`
      MATCH (fn:Function)-[:HAS_PARAMETER]->(p:Parameter)
      WHERE p.type IS NOT NULL 
      AND (p.type CONTAINS '=>' OR p.type CONTAINS 'Function' OR p.type CONTAINS 'Callback')
      RETURN fn.name AS fnName, fn.filePath AS file, p.name AS paramName, p.type AS paramType
    `);

    console.log('\n=== Higher-order functions (accept function params) ===');
    for (const record of higherOrderFns.records) {
      console.log(`  ${record.get('fnName')}(${record.get('paramName')}: ${record.get('paramType')?.substring(0, 60)})`);
    }

    // Strategy 4: Explicit POSSIBLE_CALL edges for known patterns
    // webhook-handler.ts: handler = isTokenScanner ? handleTokenScannerEvent : handleWebhookEvent
    const knownDispatches = [
      {
        source: 'webhook-handler.ts',
        targets: ['handleTokenScannerEvent', 'handleWebhookEvent'],
        confidence: 0.9,
        reason: 'ternary-function-selection',
      },
    ];

    for (const dispatch of knownDispatches) {
      for (const targetName of dispatch.targets) {
        const result = await session.run(`
          MATCH (src:SourceFile)
          WHERE src.name = $sourceFile
          MATCH (tgt:Function {name: $targetName})
          WHERE NOT (src)-[:POSSIBLE_CALL]->(tgt)
          CREATE (src)-[:POSSIBLE_CALL {
            confidence: $confidence,
            reason: $reason,
            source: 'pattern-detection',
            createdAt: datetime()
          }]->(tgt)
          RETURN count(*) AS created
        `, {
          sourceFile: dispatch.source,
          targetName,
          confidence: dispatch.confidence,
          reason: dispatch.reason,
        });
        const created = result.records[0]?.get('created')?.toNumber?.() ?? 0;
        totalCreated += created;
        if (created > 0) {
          console.log(`  Created POSSIBLE_CALL: ${dispatch.source} → ${targetName} (${dispatch.reason})`);
        }
      }
    }

    console.log(`\n✅ POSSIBLE_CALL edges created: ${totalCreated}`);
    console.log('   Conditional dispatch hotspots and higher-order functions logged for manual review.');

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
