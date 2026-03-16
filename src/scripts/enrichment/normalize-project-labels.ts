/**
 * GC-9: Normalize Project node labels
 *
 * Ensures all Project nodes have the CodeNode label for consistent querying.
 * Various code paths (CLI, watcher, parsers) create Project nodes with
 * inconsistent label sets. This normalizes them all to CodeNode:Project.
 *
 * Usage: npx tsx src/scripts/enrichment/normalize-project-labels.ts
 */
import neo4j, { type Driver } from 'neo4j-driver';

function toNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'bigint') return Number(val);
  if (typeof val === 'object' && val !== null && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return Number(val) || 0;
}

export async function normalizeProjectLabels(driver: Driver): Promise<{ normalized: number }> {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (p:Project)
       WHERE NOT p:CodeNode
       SET p:CodeNode
       RETURN count(p) AS normalized`,
    );
    const normalized = toNum(result.records[0]?.get('normalized'));
    if (normalized > 0) {
      console.log(`[GC-9] Normalized ${normalized} Project nodes (added CodeNode label)`);
    }
    return { normalized };
  } finally {
    await session.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('normalize-project-labels.ts')) {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'codegraph'));
  normalizeProjectLabels(driver)
    .then((r) => { console.log(`[GC-9] Done: ${JSON.stringify(r)}`); process.exit(0); })
    .catch((e) => { console.error('[GC-9] Error:', e); process.exit(1); })
    .finally(() => driver.close());
}
