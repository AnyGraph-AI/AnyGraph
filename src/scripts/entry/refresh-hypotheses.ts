#!/usr/bin/env npx tsx
/**
 * Refresh integrity hypotheses: re-generate from discrepancies, auto-resolve stale.
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { IntegrityHypothesisGenerator } from '../../core/ground-truth/integrity-hypothesis-generator.js';

async function main() {
  const neo4j = new Neo4jService();

  try {
    const gen = new IntegrityHypothesisGenerator(neo4j);

    // Project-scoped
    const projHyps = await gen.generateFromDiscrepancies('proj_c0d3e9a1f200');
    console.log(`Project-scoped: generated ${projHyps.length} new, resolved stale`);

    // Global
    const globalHyps = await gen.generateFromDiscrepancies();
    console.log(`Global: generated ${globalHyps.length} new, resolved stale`);

    // Report open
    const open = await gen.getOpenIntegrityHypotheses();
    console.log(`\nOpen hypotheses remaining: ${open.length}`);
    for (const h of open) {
      console.log(`  ${h.name.substring(0, 120)}`);
    }
  } finally {
    await neo4j.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
