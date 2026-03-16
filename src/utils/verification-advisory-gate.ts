import { runAdvisoryGate } from '../core/verification/index.js';
import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

async function main(): Promise<void> {
  const neo4j = new Neo4jService();
  try {
    const projectIdArg = process.argv[2];
    const policyBundleId = projectIdArg ? process.argv[3] : undefined;
    const projectIds = projectIdArg
      ? [projectIdArg]
      : (await neo4j.run(
          `MATCH (p:Project) WHERE p.projectId IS NOT NULL RETURN p.projectId AS id`,
        )).map((r: any) => r.id as string).filter(Boolean);

    console.log(`[verification:advisory:gate] ${projectIds.length} projects`);
    for (const pid of projectIds) {
      const result = await runAdvisoryGate(pid, {
        policyBundleId,
        runExceptionPolicyFirst: true,
      });
      console.log(JSON.stringify({
        ok: true,
        projectId: pid,
        policyBundleId: policyBundleId ?? 'verification-gate-policy-v1',
        result,
      }));
    }
  } finally {
    await neo4j.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});
