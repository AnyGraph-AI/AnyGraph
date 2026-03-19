import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const DEFAULT_PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const REQUIRED_FAILURE_CLASSES = ['regression', 'security_issue', 'reliability_issue', 'governance_drift'];
const REQUIRED_ENTITY_LABELS = ['Project', 'VerificationRun', 'GateDecision', 'CommitSnapshot', 'Artifact', 'DocumentWitness'] as const;

type RequiredEntityLabel = (typeof REQUIRED_ENTITY_LABELS)[number];

interface EntityRequirementContext {
  documentProjectCount: number;
  advisoryGateDecisionCount: number;
  commitLinkedVerificationRunCount: number;
}

const HARD_REQUIRED_ENTITIES: RequiredEntityLabel[] = ['Project', 'VerificationRun'];

export function getRequiredEntitySet(ctx: EntityRequirementContext): Set<RequiredEntityLabel> {
  const required = new Set<RequiredEntityLabel>(HARD_REQUIRED_ENTITIES);

  // GateDecision required only when gate decision lane has emitted data.
  if (ctx.advisoryGateDecisionCount > 0) required.add('GateDecision');

  // CommitSnapshot required only when commit-linked verification exists.
  if (ctx.commitLinkedVerificationRunCount > 0) required.add('CommitSnapshot');

  // DocumentWitness required only when document projects exist.
  if (ctx.documentProjectCount > 0) required.add('DocumentWitness');

  // Artifact nodes are optional in graph topology (file artifacts exist on disk).
  // Keep reported for visibility, but do not fail closure in their absence.

  return required;
}


async function count(session: any, query: string, params: Record<string, unknown>): Promise<number> {
  const result = await session.run(query, params);
  const value = result.records[0]?.get('count');
  return typeof value?.toNumber === 'function' ? value.toNumber() : Number(value ?? 0);
}

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    const domainCount = await count(
      session,
      `MATCH (d:HygieneDomain {id: $id}) RETURN count(d) AS count`,
      { id: `hygiene-domain:${DEFAULT_PROJECT_ID}` },
    );

    const failureClassCount = await count(
      session,
      `MATCH (f:HygieneFailureClass {projectId: $projectId})
       WHERE f.failureClass IN $required
       RETURN count(DISTINCT f.failureClass) AS count`,
      { projectId: DEFAULT_PROJECT_ID, required: REQUIRED_FAILURE_CLASSES },
    );

    const controlCount = await count(
      session,
      `MATCH (c:HygieneControl {projectId: $projectId}) RETURN count(c) AS count`,
      { projectId: DEFAULT_PROJECT_ID },
    );

    const profileCount = await count(
      session,
      `MATCH (p:RepoHygieneProfile {projectId: $projectId}) RETURN count(p) AS count`,
      { projectId: DEFAULT_PROJECT_ID },
    );

    const mappingCount = await count(
      session,
      `MATCH (c:HygieneControl {projectId: $projectId})-[:TARGETS_FAILURE_CLASS]->(f:HygieneFailureClass {projectId: $projectId})
       RETURN count(*) AS count`,
      { projectId: DEFAULT_PROJECT_ID },
    );

    const profileBindingCount = await count(
      session,
      `MATCH (:RepoHygieneProfile {projectId: $projectId})-[:APPLIES_TO]->(:Project {projectId: $projectId})
       RETURN count(*) AS count`,
      { projectId: DEFAULT_PROJECT_ID },
    );

    const entityCoverageScoped: Record<string, number> = {};
    const entityCoverageGlobal: Record<string, number> = {};
    for (const label of REQUIRED_ENTITY_LABELS) {
      if (label === 'GateDecision') {
        entityCoverageScoped[label] = await count(
          session,
          `MATCH (n {projectId: $projectId})
           WHERE n:GateDecision OR n:AdvisoryGateDecision
           RETURN count(n) AS count`,
          { projectId: DEFAULT_PROJECT_ID },
        );
        entityCoverageGlobal[label] = await count(
          session,
          `MATCH (n)
           WHERE n:GateDecision OR n:AdvisoryGateDecision
           RETURN count(n) AS count`,
          {},
        );
      } else {
        entityCoverageScoped[label] = await count(
          session,
          `MATCH (n:${label} {projectId: $projectId}) RETURN count(n) AS count`,
          { projectId: DEFAULT_PROJECT_ID },
        );
        entityCoverageGlobal[label] = await count(session, `MATCH (n:${label}) RETURN count(n) AS count`, {});
      }
    }

    const documentProjectCount = await count(
      session,
      `MATCH (p:Project)
       WHERE p.projectType = 'document' OR p.sourceKind = 'document-ingest'
       RETURN count(p) AS count`,
      {},
    );

    const advisoryGateDecisionCount = await count(
      session,
      `MATCH (d:AdvisoryGateDecision) RETURN count(d) AS count`,
      {},
    );

    const commitLinkedVerificationRunCount = await count(
      session,
      `MATCH (vr:VerificationRun)
       WHERE vr.commitRef IS NOT NULL
       RETURN count(vr) AS count`,
      {},
    );

    const requiredEntitySet = getRequiredEntitySet({
      documentProjectCount,
      advisoryGateDecisionCount,
      commitLinkedVerificationRunCount,
    });

    const missingEntities = REQUIRED_ENTITY_LABELS.filter(
      (label) => requiredEntitySet.has(label) && entityCoverageGlobal[label] === 0,
    );

    const advisoryMissingEntities = REQUIRED_ENTITY_LABELS.filter(
      (label) => !requiredEntitySet.has(label) && entityCoverageGlobal[label] === 0,
    );

    const checks = {
      domainPresent: domainCount >= 1,
      failureClassesPresent: failureClassCount === REQUIRED_FAILURE_CLASSES.length,
      controlsPresent: controlCount >= 8,
      profilePresent: profileCount >= 1,
      controlMappingsPresent: mappingCount >= 8,
      profileBindingPresent: profileBindingCount >= 1,
      requiredEntityCoveragePresent: missingEntities.length === 0,
    };

    const ok = Object.values(checks).every(Boolean);

    const output = {
      ok,
      projectId: DEFAULT_PROJECT_ID,
      counts: {
        domainCount,
        failureClassCount,
        controlCount,
        profileCount,
        mappingCount,
        profileBindingCount,
      },
      requiredFailureClasses: REQUIRED_FAILURE_CLASSES,
      requiredEntities: REQUIRED_ENTITY_LABELS,
      requiredEntitiesActive: Array.from(requiredEntitySet),
      advisoryEntitiesInactive: advisoryMissingEntities,
      entityRequirementContext: {
        documentProjectCount,
        advisoryGateDecisionCount,
        commitLinkedVerificationRunCount,
      },
      entityCoverageScoped,
      entityCoverageGlobal,
      missingEntities,
      checks,
    };

    if (!ok) {
      console.error(JSON.stringify(output));
      process.exit(1);
    }

    console.log(JSON.stringify(output));
  } finally {
    await session.close();
    await driver.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
}
