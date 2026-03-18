/**
 * GC-9: rebuild-derived — Delete all derived edges and properties, re-run enrichment.
 *
 * Makes the Layer 1 (canonical) / Layer 2 (cached derived) boundary real.
 * Deletes all edges where derived=true, then re-runs enrichment scripts in dependency order.
 *
 * Dependency order (matches done-check pipeline):
 * 1. enrich:temporal-coupling (structural)
 * 2. enrich:git-frequency (git-based)
 * 3. enrich:vr-scope (ANALYZED edges)
 * 4. enrich:evidence-anchor (ANCHORED_TO edges, needs symbolHash)
 * 5. enrich:claim-project (SPANS_PROJECT edges)
 * 6. enrich:evidence-project (FROM_PROJECT edges)
 * 7. enrich:semantic-roles (RF-13 role tagging)
 * 8. enrich:composite-risk (depends on git + vr-scope)
 */
import { execSync } from 'node:child_process';
import neo4j from 'neo4j-driver';

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );

  const session = driver.session();
  try {
    // Step 1: Count derived edges before deletion
    const beforeResult = await session.run(
      `MATCH ()-[r]->()
       WHERE r.derived = true
       RETURN type(r) AS edgeType, count(r) AS cnt
       ORDER BY cnt DESC`,
    );
    const before = beforeResult.records.map((r) => ({
      type: r.get('edgeType') as string,
      count: (r.get('cnt') as any).toNumber?.() ?? r.get('cnt'),
    }));
    const totalBefore = before.reduce((s, e) => s + e.count, 0);
    console.log(`[rebuild-derived] Before: ${totalBefore} derived edges`);
    for (const e of before) {
      console.log(`  ${e.type}: ${e.count}`);
    }

    // Step 2: Delete all derived edges
    const deleteResult = await session.run(
      `MATCH ()-[r]->()
       WHERE r.derived = true
       DELETE r
       RETURN count(r) AS deleted`,
    );
    const deleted = (deleteResult.records[0]?.get('deleted') as any)?.toNumber?.() ??
      deleteResult.records[0]?.get('deleted') ?? 0;
    console.log(`[rebuild-derived] Deleted ${deleted} derived edges`);

    // Step 3: Clear derived properties (compositeRisk, riskTier, riskFlags from GC-5)
    const clearPropsResult = await session.run(
      `MATCH (f:CodeNode:TypeScript:Function)
       WHERE f.compositeRisk IS NOT NULL
       REMOVE f.compositeRisk, f.riskFlags
       SET f.riskTier = 'LOW'
       RETURN count(f) AS cleared`,
    );
    const cleared = (clearPropsResult.records[0]?.get('cleared') as any)?.toNumber?.() ??
      clearPropsResult.records[0]?.get('cleared') ?? 0;
    console.log(`[rebuild-derived] Cleared derived properties on ${cleared} functions`);

    await session.close();

    // Step 4: Re-run enrichment scripts in dependency order
    const scripts = [
      'enrich:normalize-project-labels',
      'enrich:temporal-coupling',
      'enrich:git-frequency',
      'enrich:vr-scope',
      'enrich:evidence-anchor',
      'enrich:claim-project',
      'enrich:evidence-project',
      'enrich:composite-risk',
      'enrich:evaluated-edges',
      'enrich:flags-edges',
      'enrich:entrypoint-edges',
      'enrich:state-fields',
      'enrich:semantic-roles',
      'enrich:precompute-scores',
    ];

    for (const script of scripts) {
      console.log(`[rebuild-derived] Running ${script}...`);
      try {
        execSync(`npm run ${script}`, {
          cwd: process.cwd(),
          stdio: 'pipe',
          timeout: 120_000,
        });
        console.log(`  ✅ ${script} complete`);
      } catch (err: any) {
        console.error(`  ❌ ${script} failed: ${err.stderr?.toString()?.slice(0, 200) || err.message}`);
        // Continue — best-effort rebuild
      }
    }

    // Step 5: Count derived edges after rebuild
    const session2 = driver.session();
    const afterResult = await session2.run(
      `MATCH ()-[r]->()
       WHERE r.derived = true
       RETURN type(r) AS edgeType, count(r) AS cnt
       ORDER BY cnt DESC`,
    );
    const after = afterResult.records.map((r) => ({
      type: r.get('edgeType') as string,
      count: (r.get('cnt') as any).toNumber?.() ?? r.get('cnt'),
    }));
    const totalAfter = after.reduce((s, e) => s + e.count, 0);
    console.log(`\n[rebuild-derived] After: ${totalAfter} derived edges`);
    for (const e of after) {
      console.log(`  ${e.type}: ${e.count}`);
    }
    console.log(`[rebuild-derived] Delta: ${totalAfter - totalBefore} (${totalAfter > totalBefore ? '+' : ''}${totalAfter - totalBefore})`);
    await session2.close();
  } finally {
    await driver.close();
  }
}

main().catch(console.error);
