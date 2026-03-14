#!/usr/bin/env npx tsx
/**
 * Phase 2.5: Provenance + Confidence on Edges
 * 
 * Adds sourceKind and confidence properties to all derived edges,
 * telling agents WHY the graph believes what it believes.
 * 
 * sourceKind values:
 *   - typeChecker: ts-morph type resolution (highest confidence)
 *   - frameworkExtractor: Grammy/NestJS schema detection
 *   - heuristic: pattern matching, ternary dispatch guessing
 *   - postIngest: Cypher enrichment pass (state edges, risk scoring)
 *   - gitMining: extracted from git log history
 * 
 * Usage: npx tsx add-provenance.ts
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

async function run(label: string, cypher: string) {
  const session = driver.session();
  try {
    const result = await session.run(cypher);
    const count = result.records[0]?.get('count')?.toNumber?.() ?? 
                  result.records[0]?.get('count') ?? 0;
    console.log(`  ✓ ${label}: ${count}`);
    return count;
  } catch (err: any) {
    console.log(`  ✗ ${label}: ${err.message}`);
    return 0;
  } finally {
    await session.close();
  }
}

async function main() {
  console.log('\n📋 Adding provenance + confidence to graph edges\n');

  // CALLS edges — created by extractCallsFromBody in typescript-parser.ts
  // These use ts-morph CallExpression walking — high confidence for resolved calls
  console.log('1. CALLS edges (typeChecker, confidence 0.95):');
  await run('internal CALLS', `
    MATCH ()-[r:CALLS]->()
    WHERE r.resolutionKind = 'internal'
    SET r.sourceKind = 'typeChecker',
        r.confidence = 0.95
    RETURN count(r) AS count
  `);
  await run('fluent CALLS', `
    MATCH ()-[r:CALLS]->()
    WHERE r.resolutionKind = 'fluent'
    SET r.sourceKind = 'typeChecker',
        r.confidence = 0.85
    RETURN count(r) AS count
  `);
  await run('unresolved CALLS', `
    MATCH ()-[r:CALLS]->()
    WHERE r.resolutionKind IS NULL OR r.resolutionKind = 'unresolved'
    SET r.sourceKind = 'typeChecker',
        r.confidence = 0.7
    RETURN count(r) AS count
  `);

  // RESOLVES_TO edges — created by resolveDeferredEdges using getAliasedSymbol
  // This is the most trustworthy resolution — ts-morph type checker
  console.log('\n2. RESOLVES_TO edges (typeChecker, confidence 0.99):');
  await run('RESOLVES_TO', `
    MATCH ()-[r:RESOLVES_TO]->()
    SET r.sourceKind = 'typeChecker',
        r.confidence = 0.99,
        r.resolvedVia = 'aliasedSymbol'
    RETURN count(r) AS count
  `);

  // IMPORTS edges — created by parser from ImportDeclaration AST nodes
  console.log('\n3. IMPORTS edges (typeChecker, confidence 0.99):');
  await run('static IMPORTS', `
    MATCH ()-[r:IMPORTS]->()
    WHERE r.dynamic IS NULL OR r.dynamic = false
    SET r.sourceKind = 'typeChecker',
        r.confidence = 0.99
    RETURN count(r) AS count
  `);
  await run('dynamic IMPORTS', `
    MATCH ()-[r:IMPORTS]->()
    WHERE r.dynamic = true
    SET r.sourceKind = 'typeChecker',
        r.confidence = 0.90
    RETURN count(r) AS count
  `);

  // CONTAINS edges — structural parent-child from AST
  console.log('\n4. CONTAINS edges (typeChecker, confidence 1.0):');
  await run('CONTAINS', `
    MATCH ()-[r:CONTAINS]->()
    SET r.sourceKind = 'typeChecker',
        r.confidence = 1.0
    RETURN count(r) AS count
  `);

  // HAS_PARAMETER, HAS_MEMBER — structural from AST
  console.log('\n5. Structural edges (typeChecker, confidence 1.0):');
  await run('HAS_PARAMETER', `
    MATCH ()-[r:HAS_PARAMETER]->()
    SET r.sourceKind = 'typeChecker',
        r.confidence = 1.0
    RETURN count(r) AS count
  `);
  await run('HAS_MEMBER', `
    MATCH ()-[r:HAS_MEMBER]->()
    SET r.sourceKind = 'typeChecker',
        r.confidence = 1.0
    RETURN count(r) AS count
  `);
  await run('EXTENDS', `
    MATCH ()-[r:EXTENDS]->()
    SET r.sourceKind = 'typeChecker',
        r.confidence = 1.0
    RETURN count(r) AS count
  `);

  // REGISTERED_BY — created by Grammy framework extractor
  console.log('\n6. REGISTERED_BY edges (frameworkExtractor, confidence 0.95):');
  await run('REGISTERED_BY', `
    MATCH ()-[r:REGISTERED_BY]->()
    SET r.sourceKind = 'frameworkExtractor',
        r.confidence = 0.95,
        r.matchedPattern = 'grammy-registration'
    RETURN count(r) AS count
  `);

  // READS_STATE / WRITES_STATE — created by post-ingest Cypher pass
  console.log('\n7. State edges (postIngest, confidence 0.90):');
  await run('READS_STATE', `
    MATCH ()-[r:READS_STATE]->()
    SET r.sourceKind = 'postIngest',
        r.confidence = 0.90,
        r.matchedPattern = 'session-field-access'
    RETURN count(r) AS count
  `);
  await run('WRITES_STATE', `
    MATCH ()-[r:WRITES_STATE]->()
    SET r.sourceKind = 'postIngest',
        r.confidence = 0.90,
        r.matchedPattern = 'session-field-assignment'
    RETURN count(r) AS count
  `);

  // POSSIBLE_CALL — heuristic ternary/interface dispatch
  console.log('\n8. POSSIBLE_CALL edges (heuristic, confidence from edge):');
  await run('POSSIBLE_CALL', `
    MATCH ()-[r:POSSIBLE_CALL]->()
    SET r.sourceKind = 'heuristic'
    // confidence already set per-edge by create-possible-call-edges.ts
    RETURN count(r) AS count
  `);

  // CO_CHANGES_WITH — mined from git log
  console.log('\n9. CO_CHANGES_WITH edges (gitMining, confidence from coupling strength):');
  await run('CO_CHANGES_WITH STRONG', `
    MATCH ()-[r:CO_CHANGES_WITH]->()
    WHERE r.couplingStrength = 'STRONG'
    SET r.sourceKind = 'gitMining',
        r.confidence = 0.90
    RETURN count(r) AS count
  `);
  await run('CO_CHANGES_WITH MODERATE', `
    MATCH ()-[r:CO_CHANGES_WITH]->()
    WHERE r.couplingStrength = 'MODERATE'
    SET r.sourceKind = 'gitMining',
        r.confidence = 0.75
    RETURN count(r) AS count
  `);
  await run('CO_CHANGES_WITH WEAK', `
    MATCH ()-[r:CO_CHANGES_WITH]->()
    WHERE r.couplingStrength = 'WEAK'
    SET r.sourceKind = 'gitMining',
        r.confidence = 0.50
    RETURN count(r) AS count
  `);

  // Summary
  console.log('\n=== PROVENANCE SUMMARY ===');
  const session = driver.session();
  try {
    const summary = await session.run(`
      MATCH ()-[r]->()
      WHERE r.sourceKind IS NOT NULL
      RETURN r.sourceKind AS kind, 
             avg(r.confidence) AS avgConfidence,
             count(r) AS count
      ORDER BY count DESC
    `);
    for (const rec of summary.records) {
      const avg = rec.get('avgConfidence');
      const avgStr = typeof avg === 'number' ? avg.toFixed(2) : avg?.toFixed?.(2) ?? '?';
      console.log(`  ${rec.get('kind')}: ${rec.get('count')} edges (avg confidence: ${avgStr})`);
    }

    const total = await session.run(`
      MATCH ()-[r]->()
      RETURN count(r) AS total, 
             count(CASE WHEN r.sourceKind IS NOT NULL THEN 1 END) AS withProvenance
    `);
    const t = Number(total.records[0].get('total'));
    const p = Number(total.records[0].get('withProvenance'));
    console.log(`\n  Total: ${p}/${t} edges have provenance (${((p/t)*100).toFixed(1)}%)`);
  } finally {
    await session.close();
  }

  await driver.close();
  console.log('\n✅ Provenance enrichment complete!');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
