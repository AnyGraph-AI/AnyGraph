/**
 * GC-6: GRC-SELF-DEFENSE — Verifier Self-Defense Check
 *
 * Reflexive integrity: functions in verification/governance/sarif paths
 * MUST have defense-in-depth evidence (parent SourceFile has ANALYZED edges,
 * or function has FLAGS edges, or function has test coverage via TestCase).
 *
 * Functions flagged here are the graph's own blind spots — the verification
 * system can't vouch for the code that runs the verification system.
 *
 * Severity: CRITICAL for high-risk functions (compositeRisk >= 0.7),
 *           WARNING for the rest
 *
 * Exit code: 0 (advisory — logged but doesn't block)
 */
import neo4j from 'neo4j-driver';

interface UndefendedFunction {
  name: string;
  filePath: string;
  riskLevel: number;
  compositeRisk: number;
  riskTier: string;
  flags: string[];
}

export async function checkGrcSelfDefense(driver: InstanceType<typeof neo4j.Driver>): Promise<{
  undefended: UndefendedFunction[];
  total: number;
  defended: number;
}> {
  const session = driver.session();
  try {
    // Find all functions in verification/governance/sarif paths
    const result = await session.run(
      `MATCH (f:CodeNode:TypeScript:Function {projectId: 'proj_c0d3e9a1f200'})
       WHERE f.filePath =~ '.*(verification|governance|sarif).*'
       OPTIONAL MATCH (f)<-[:CONTAINS]-(sf:CodeNode:SourceFile:TypeScript)<-[:ANALYZED]-(vr)
       OPTIONAL MATCH (f)<-[:FLAGS]-(flagVr)
       WITH f, count(DISTINCT vr) AS analyzedCount, count(DISTINCT flagVr) AS flagCount
       RETURN f.name AS name,
              f.filePath AS filePath,
              coalesce(f.riskLevel, 0.0) AS riskLevel,
              coalesce(f.compositeRisk, 0.0) AS compositeRisk,
              coalesce(f.riskTier, 'UNKNOWN') AS riskTier,
              coalesce(f.riskFlags, []) AS flags,
              analyzedCount,
              flagCount`,
    );

    const all = result.records.map((r) => ({
      name: r.get('name') as string,
      filePath: r.get('filePath') as string,
      riskLevel: toNum(r.get('riskLevel')),
      compositeRisk: toNum(r.get('compositeRisk')),
      riskTier: r.get('riskTier') as string,
      flags: r.get('flags') as string[],
      analyzedCount: toNum(r.get('analyzedCount')),
      flagCount: toNum(r.get('flagCount')),
    }));

    const undefended = all
      .filter((f) => f.analyzedCount === 0 && f.flagCount === 0)
      .map(({ name, filePath, riskLevel, compositeRisk, riskTier, flags }) => ({
        name, filePath, riskLevel, compositeRisk, riskTier, flags,
      }));

    const defended = all.length - undefended.length;

    // Report
    console.log(`[GRC-SELF-DEFENSE] ${all.length} governance functions, ${defended} defended, ${undefended.length} undefended`);

    if (undefended.length > 0) {
      const critical = undefended.filter((f) => f.compositeRisk >= 0.7);
      const warning = undefended.filter((f) => f.compositeRisk < 0.7);

      if (critical.length > 0) {
        console.log(`  ⛔ CRITICAL (compositeRisk >= 0.7):`);
        for (const f of critical) {
          console.log(`    ${f.name} — ${f.riskTier}, composite=${f.compositeRisk.toFixed(3)}, structural=${f.riskLevel.toFixed(1)}`);
        }
      }
      if (warning.length > 0) {
        console.log(`  ⚠️  WARNING:`);
        for (const f of warning) {
          console.log(`    ${f.name} — ${f.riskTier}, composite=${f.compositeRisk.toFixed(3)}`);
        }
      }
    } else {
      console.log('  ✅ All governance functions have defense-in-depth evidence');
    }

    return { undefended, total: all.length, defended };
  } finally {
    await session.close();
  }
}

function toNum(v: any): number {
  if (typeof v === 'number') return v;
  if (v && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

// ─── CLI entry point ───────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );
  try {
    const result = await checkGrcSelfDefense(driver);
    process.exit(0); // Advisory — always exit 0
  } finally {
    await driver.close();
  }
}
