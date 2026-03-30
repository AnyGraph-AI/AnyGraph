#!/usr/bin/env npx tsx
/**
 * Phase 2.6: Explicit Unresolved References
 * 
 * Creates UnresolvedReference nodes for imports and calls that
 * the parser couldn't resolve. Makes failures visible instead of silent.
 * 
 * An agent can now query: "What did the parser fail to resolve?"
 * instead of trusting that absence of evidence = evidence of absence.
 * 
 * Usage: npx tsx create-unresolved-nodes.ts
 */
import neo4j, { type Driver } from 'neo4j-driver';
import dotenv from 'dotenv';

dotenv.config();

export async function runCypher(driver: Driver, label: string, cypher: string): Promise<number> {
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

export async function createUnresolvedNodes(driver: Driver): Promise<{
  cleared: number;
  created: number;
  localFailures: number;
  assetImports: number;
}> {
  console.log('\n🔍 Creating UnresolvedReference nodes\n');

  const session = driver.session();
  let cleared = 0;
  let created = 0;
  let localFailures = 0;
  let assetImports = 0;

  try {
    // === TRANSACTION BOUNDARY: DELETE + RECREATE must be atomic (SCAR-012 fix) ===
    // If anything throws between delete and recreate, Neo4j rolls back both.
    const tx = session.beginTransaction();

    try {
      // Clear existing unresolved nodes — INSIDE TRANSACTION
      const clearResult = await tx.run(`
        MATCH (u:UnresolvedReference) DETACH DELETE u
        RETURN count(u) AS count
      `);
      cleared = clearResult.records[0]?.get('count')?.toNumber?.() ?? 
                clearResult.records[0]?.get('count') ?? 0;
      console.log(`  ✓ Cleared old UnresolvedReference nodes: ${cleared}`);

      // 1. Unresolved imports — Import nodes without RESOLVES_TO — INSIDE TRANSACTION
      console.log('\n1. Unresolved imports (Import → no RESOLVES_TO):');
      const createResult = await tx.run(`
        MATCH (imp:Import)
        WHERE NOT (imp)-[:RESOLVES_TO]->()
        OPTIONAL MATCH (sf:SourceFile)-[:CONTAINS]->(imp)
        CREATE (u:UnresolvedReference:CodeNode {
          kind: 'import',
          rawText: imp.name,
          reason: CASE
            WHEN imp.name CONTAINS '/dist/' THEN 'build-artifact-reference'
            WHEN imp.name STARTS WITH '.' AND imp.name ENDS WITH '.js' THEN 'local-js-specifier'
            WHEN imp.name STARTS WITH '.' AND (imp.name ENDS WITH '.css' OR imp.name ENDS WITH '.scss' OR imp.name ENDS WITH '.sass' OR imp.name ENDS WITH '.less' OR imp.name ENDS WITH '.svg' OR imp.name ENDS WITH '.png' OR imp.name ENDS WITH '.jpg' OR imp.name ENDS WITH '.gif' OR imp.name ENDS WITH '.webp' OR imp.name ENDS WITH '.woff' OR imp.name ENDS WITH '.woff2' OR imp.name ENDS WITH '.json') THEN 'asset-import'
            WHEN imp.name STARTS WITH '.' THEN 'local-module-not-found'
            ELSE 'external-package'
          END,
          file: COALESCE(sf.filePath, 'unknown'),
          name: imp.name,
          projectId: imp.projectId,
          confidence: 0.0,
          sourceKind: 'unresolved'
        })
        FOREACH (_ IN CASE WHEN sf IS NOT NULL THEN [1] ELSE [] END |
          CREATE (u)-[:ORIGINATES_IN {
            sourceKind: 'postIngest',
            confidence: 0.8
          }]->(sf)
        )
        RETURN count(u) AS count
      `);
      created = createResult.records[0]?.get('count')?.toNumber?.() ?? 
                createResult.records[0]?.get('count') ?? 0;
      console.log(`  ✓ Created UnresolvedReference nodes for imports: ${created}`);

      // Commit transaction — delete + create are atomic
      await tx.commit();
    } catch (err) {
      // Rollback on any error — graph returns to pre-run state
      await tx.rollback();
      console.error('[create-unresolved-nodes] Transaction rolled back due to error:', err);
      throw err;
    }
    // === END TRANSACTION BOUNDARY ===

    // 2. Classify: external packages vs local resolution failures (READ-ONLY, reuses session)
    console.log('\n2. Classifying unresolved imports:');
    const classified = await session.run(`
      MATCH (u:UnresolvedReference {kind: 'import'})
      RETURN u.reason AS reason, count(u) AS count
      ORDER BY count DESC
    `);
    for (const r of classified.records) {
      const reason = r.get('reason') as string;
      const cnt = Number(r.get('count'));
      const icon = reason === 'external-package' ? '📦' : '⚠️';
      console.log(`  ${icon} ${reason}: ${cnt}`);
      if (reason === 'asset-import') assetImports = cnt;
    }

    // 3. Show the local resolution failures (the real problems)
    console.log('\n3. Local resolution failures (these are the real blind spots):');
    const local = await session.run(`
      MATCH (u:UnresolvedReference {kind: 'import', reason: 'local-module-not-found'})
      RETURN u.rawText AS name, u.file AS file
      ORDER BY u.file, u.rawText
      LIMIT 20
    `);
    localFailures = local.records.length;
    if (local.records.length > 0) {
      for (const r of local.records) {
        console.log(`  ⚠️  ${r.get('name')} in ${r.get('file')}`);
      }
    } else {
      console.log('  None — all local imports resolved correctly!');
    }

    // 4. Top external packages that we can't resolve (expected)
    console.log('\n4. External packages (expected unresolved):');
    const external = await session.run(`
      MATCH (u:UnresolvedReference {kind: 'import', reason: 'external-package'})
      RETURN u.rawText AS pkg, count(u) AS usages
      ORDER BY usages DESC
      LIMIT 15
    `);
    for (const r of external.records) {
      console.log(`  📦 ${r.get('pkg')}: ${r.get('usages')} import sites`);
    }

    // 5. Summary
    console.log('\n=== RESOLUTION SUMMARY ===');
    const summary = await session.run(`
      MATCH (imp:Import)
      OPTIONAL MATCH (imp)-[:RESOLVES_TO]->(target)
      RETURN 
        count(imp) AS totalImports,
        count(target) AS resolved,
        count(imp) - count(target) AS unresolved
    `);
    const rec = summary.records[0];
    const total = Number(rec.get('totalImports'));
    const resolved = Number(rec.get('resolved'));
    const unresolved = Number(rec.get('unresolved'));
    console.log(`  Total imports: ${total}`);
    console.log(`  Resolved: ${resolved} (${((resolved/total)*100).toFixed(1)}%)`);
    console.log(`  Unresolved: ${unresolved} (${((unresolved/total)*100).toFixed(1)}%)`);

    const localCount = await session.run(`
      MATCH (u:UnresolvedReference {reason: 'local-module-not-found'})
      RETURN count(u) AS count
    `);
    const localCountNum = Number(localCount.records[0].get('count'));
    if (localCountNum === 0) {
      console.log(`  ✅ All local imports resolved — unresolved are external packages only`);
    } else {
      console.log(`  ⚠️  ${localCountNum} local imports failed to resolve — these are real blind spots`);
    }

  } finally {
    await session.close();
  }

  console.log('\n✅ UnresolvedReference nodes created!');
  console.log('   Query: MATCH (u:UnresolvedReference) RETURN u.kind, u.reason, u.rawText, u.file');

  return { cleared, created, localFailures, assetImports };
}

// CLI entry point — only runs when executed directly
const isDirectRun = process.argv[1]?.endsWith('create-unresolved-nodes.ts') ||
                    process.argv[1]?.endsWith('create-unresolved-nodes.js');

if (isDirectRun) {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph'
    )
  );

  createUnresolvedNodes(driver)
    .then(() => driver.close())
    .catch(err => {
      console.error('Fatal:', err);
      process.exit(1);
    });
}
