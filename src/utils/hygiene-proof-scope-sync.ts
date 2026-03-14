import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const SCOPE_VERSION = 'v1';

const CRITICAL_MILESTONE_SELECTORS = [
  'GM-',
  'DL-',
  'HY-14',
  'HY-15',
  'HY-16',
  'HY-17',
  'HY-18',
  'AIH-15',
  'AIH-16',
  'AIH-17',
  'AIH-18',
  'AIH-19',
];

const REQUIRED_EVIDENCE_CLASSES = ['HAS_CODE_EVIDENCE', 'VerificationRun', 'GateDecision', 'CommitSnapshot', 'Artifact', 'DocumentWitness'];

const NEGATIVE_RULES = [
  'plan_only_evidence_insufficient_for_critical_done',
  'code_only_without_runtime_or_governance_evidence_insufficient_for_promotion',
];

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    const nowIso = new Date().toISOString();
    const scopeId = `proof-scope:${PROJECT_ID}:${SCOPE_VERSION}`;

    await session.run(
      `MERGE (s:CodeNode:ProofOfDoneScope {id: $id})
       SET s.projectId = $projectId,
           s.coreType = 'ProofOfDoneScope',
           s.name = 'Critical proof-of-done scope',
           s.scopeVersion = $scopeVersion,
           s.criticalMilestoneSelectors = $criticalMilestoneSelectors,
           s.requiredEvidenceClasses = $requiredEvidenceClasses,
           s.negativeRules = $negativeRules,
           s.updatedAt = datetime($updatedAt)
       WITH s
       MATCH (d:HygieneDomain {id: $domainId})
       MERGE (d)-[:DEFINES_PROOF_SCOPE]->(s)
       WITH s
       MATCH (c:HygieneControl {projectId: $projectId, code: 'B1'})
       MERGE (c)-[:APPLIES_TO]->(s)`,
      {
        id: scopeId,
        projectId: PROJECT_ID,
        scopeVersion: SCOPE_VERSION,
        criticalMilestoneSelectors: CRITICAL_MILESTONE_SELECTORS,
        requiredEvidenceClasses: REQUIRED_EVIDENCE_CLASSES,
        negativeRules: NEGATIVE_RULES,
        updatedAt: nowIso,
        domainId: `hygiene-domain:${PROJECT_ID}`,
      },
    );

    console.log(
      JSON.stringify({
        ok: true,
        projectId: PROJECT_ID,
        scopeId,
        scopeVersion: SCOPE_VERSION,
        criticalMilestoneSelectors: CRITICAL_MILESTONE_SELECTORS,
        requiredEvidenceClasses: REQUIRED_EVIDENCE_CLASSES,
        negativeRules: NEGATIVE_RULES,
      }),
    );
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
