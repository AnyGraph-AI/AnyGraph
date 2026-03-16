/**
 * Vitest Global Teardown — Clean ephemeral test data from Neo4j
 *
 * Spec tests create nodes with __test_ prefixed projectIds.
 * If afterAll doesn't fire (parallel timeouts, SIGTERM), nodes leak
 * and break registry:identity:verify in done-check.
 *
 * This runs once after ALL test files complete, guaranteed by vitest.
 */
import neo4j from 'neo4j-driver';

export async function teardown(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );

  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (n) WHERE n.projectId STARTS WITH '__test_'
         OR n.projectId = 'other_project'
       DETACH DELETE n
       RETURN count(n) AS deleted`,
    );
    const deleted = result.records[0]?.get('deleted')?.toNumber() ?? 0;
    if (deleted > 0) {
      console.log(`[vitest-global-teardown] Cleaned ${deleted} leaked test nodes from Neo4j`);
    }
  } finally {
    await session.close();
    await driver.close();
  }
}
