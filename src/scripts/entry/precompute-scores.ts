/**
 * UI-0: Precompute Scores — Entry Point
 *
 * Runs the precompute-scores enrichment for all code projects or a specific projectId.
 * Usage: node --loader ts-node/esm src/scripts/entry/precompute-scores.ts [projectId]
 */
import neo4j from 'neo4j-driver';
import { enrichPrecomputeScores } from '../enrichment/precompute-scores.js';

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );

  try {
    const specificProjectId = process.argv[2];

    if (specificProjectId) {
      // Run for a specific project
      console.log(`[precompute-scores] Running for project: ${specificProjectId}`);
      const result = await enrichPrecomputeScores(driver, specificProjectId);
      console.log(`[precompute-scores] Done: ${result.functionsUpdated} functions, ${result.filesUpdated} files`);
    } else {
      // Run for all code projects
      const session = driver.session();
      try {
        const projectsResult = await session.run(
          `MATCH (p:Project)
           WHERE EXISTS { MATCH (:CodeNode:Function {projectId: p.projectId}) }
           RETURN p.projectId AS projectId, p.name AS name`,
        );
        const projects = projectsResult.records.map((r) => ({
          projectId: r.get('projectId') as string,
          name: r.get('name') as string,
        }));
        await session.close();

        for (const proj of projects) {
          console.log(`\n[precompute-scores] === ${proj.name} (${proj.projectId}) ===`);
          const result = await enrichPrecomputeScores(driver, proj.projectId);
          console.log(`[precompute-scores] Done: ${result.functionsUpdated} functions, ${result.filesUpdated} files`);
        }
      } finally {
        await session.close();
      }
    }
  } finally {
    await driver.close();
  }
}

main().catch(console.error);
