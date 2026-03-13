import { resolve } from 'path';

import dotenv from 'dotenv';

import { enrichCrossDomain, ingestToNeo4j, parsePlanDirectory } from '../core/parsers/plan-parser.js';

dotenv.config();

async function main(): Promise<void> {
  const plansDir = process.env.PLANS_DIR
    ? resolve(process.env.PLANS_DIR)
    : resolve(process.cwd(), '..', 'plans');

  const parsed = await parsePlanDirectory(plansDir);

  for (const project of parsed) {
    await ingestToNeo4j(
      project,
      process.env.NEO4J_URI ?? 'bolt://localhost:7687',
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    );
  }

  const result = await enrichCrossDomain(
    parsed,
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    process.env.NEO4J_USER ?? 'neo4j',
    process.env.NEO4J_PASSWORD ?? 'codegraph',
  );

  console.log(
    JSON.stringify({
      ok: true,
      plansDir,
      projects: parsed.length,
      resolved: result.resolved,
      notFound: result.notFound,
      evidenceEdges: result.evidenceEdges,
      driftDetected: result.driftDetected.length,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
