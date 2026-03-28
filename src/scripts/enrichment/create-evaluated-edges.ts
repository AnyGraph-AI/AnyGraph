/**
 * GC-10: Create EVALUATED edges from done-check VRs → Project
 *
 * done-check VRs evaluate project-level invariants, not individual files.
 * They get EVALUATED→Project edges (not ANALYZED→SourceFile).
 * Sets scopeModel='project-level' to distinguish from file-scope tools.
 *
 * Usage: npx tsx src/scripts/enrichment/create-evaluated-edges.ts
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

export async function enrichEvaluatedEdges(driver: Driver): Promise<{
  scopeModelSet: number;
  evaluatedEdges: number;
}> {
  const session = driver.session();
  try {
    // Step 1: Set scopeModel='project-level' on all done-check VRs
    const scopeResult = await session.run(
      `MATCH (vr:VerificationRun)
       WHERE vr.tool = 'done-check'
         AND (vr.scopeModel IS NULL OR vr.scopeModel <> 'project-level')
       SET vr.scopeModel = 'project-level'
       RETURN count(vr) AS updated`,
    );
    const scopeModelSet = toNum(scopeResult.records[0]?.get('updated'));

    // Step 2: Create EVALUATED edges from done-check VR → Project
    // TODO: failedChecks parsing — VR nodes store ok:boolean but not which checks failed.
    // For full implementation: query related GateDecision nodes or enhance verification-done-check-capture.ts
    // to store failureMessage/failedSteps array on VR nodes.
    const evalResult = await session.run(
      `MATCH (vr:VerificationRun)
       WHERE vr.tool = 'done-check'
         AND vr.projectId IS NOT NULL
       MATCH (p:Project {projectId: vr.projectId})
       MERGE (vr)-[r:EVALUATED]->(p)
       ON CREATE SET
         r.derived = true,
         r.source = 'gc10-evaluated-enrichment',
         r.passed = vr.ok,
         r.failedChecks = [],
         r.timestamp = datetime()
       ON MATCH SET
         r.passed = vr.ok,
         r.failedChecks = [],
         r.timestamp = datetime()
       RETURN count(r) AS edges`,
    );
    const evaluatedEdges = toNum(evalResult.records[0]?.get('edges'));

    console.log(`[GC-10] scopeModel set on ${scopeModelSet} VRs`);
    console.log(`[GC-10] ${evaluatedEdges} EVALUATED edges (done-check VR → Project)`);

    return { scopeModelSet, evaluatedEdges };
  } finally {
    await session.close();
  }
}

// Direct execution
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('create-evaluated-edges.ts')) {
  const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'codegraph'));
  enrichEvaluatedEdges(driver)
    .then((result) => {
      console.log(`[GC-10] Done: ${JSON.stringify(result)}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[GC-10] Error:', err);
      process.exit(1);
    })
    .finally(() => driver.close());
}
