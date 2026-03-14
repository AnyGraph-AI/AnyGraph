import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

type FailureClass = 'regression' | 'security_issue' | 'reliability_issue' | 'governance_drift';

interface HygieneControlSeed {
  code: string;
  name: string;
  successSignal: string;
  failureClasses: FailureClass[];
  mode: 'advisory' | 'enforced';
}

const DEFAULT_PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const HYGIENE_SCHEMA_VERSION = '1.0.0';
const PROFILE_VERSION = 'v1';

const FAILURE_CLASSES: Array<{ key: FailureClass; name: string; successSignal: string }> = [
  {
    key: 'regression',
    name: 'Regression prevention',
    successSignal: 'RegressionEvents prevented/contained and no false-complete drift in scoped critical tasks',
  },
  {
    key: 'security_issue',
    name: 'Security posture integrity',
    successSignal: 'Platform parity, secret/dependency controls, and policy checks remain within threshold',
  },
  {
    key: 'reliability_issue',
    name: 'Reliability and operability',
    successSignal: 'Hygiene checks meet p50/p95 latency budgets and avoid workflow-degrading instability',
  },
  {
    key: 'governance_drift',
    name: 'Governance drift prevention',
    successSignal: 'Declared controls, evidence obligations, and exception expiries remain consistent and auditable',
  },
];

const CONTROL_SEEDS: HygieneControlSeed[] = [
  {
    code: 'B1',
    name: 'Proof-of-Done Hygiene',
    successSignal: 'Critical done state requires evidence lineage before promotion',
    failureClasses: ['regression', 'governance_drift'],
    mode: 'enforced',
  },
  {
    code: 'B2',
    name: 'Ownership Hygiene',
    successSignal: 'Critical scopes maintain fresh owner coverage',
    failureClasses: ['governance_drift', 'reliability_issue'],
    mode: 'advisory',
  },
  {
    code: 'B3',
    name: 'Exception Hygiene',
    successSignal: 'Expired waivers fail by default and renewal path is auditable',
    failureClasses: ['governance_drift', 'security_issue'],
    mode: 'enforced',
  },
  {
    code: 'B6',
    name: 'Security Baseline Hygiene',
    successSignal: 'Graph policy stays in parity with platform-native controls',
    failureClasses: ['security_issue', 'governance_drift'],
    mode: 'enforced',
  },
  {
    code: 'B7',
    name: 'Control-Effectiveness Hygiene',
    successSignal: 'Control friction remains justified by measured prevention value',
    failureClasses: ['reliability_issue', 'governance_drift'],
    mode: 'advisory',
  },
  {
    code: 'A2',
    name: 'Agent Approval Hygiene',
    successSignal: 'High-risk actions carry scoped approval evidence',
    failureClasses: ['security_issue', 'governance_drift'],
    mode: 'enforced',
  },
  {
    code: 'A3',
    name: 'AI Eval Regression Hygiene',
    successSignal: 'Skill/model promotions are blocked on regression deltas',
    failureClasses: ['regression', 'reliability_issue'],
    mode: 'enforced',
  },
  {
    code: 'A6',
    name: 'AI Security Hygiene',
    successSignal: 'Prompt/tool/output boundaries block unsafe side effects',
    failureClasses: ['security_issue', 'governance_drift'],
    mode: 'enforced',
  },
];

const REQUIRED_EVIDENCE_ENTITIES = ['Project', 'VerificationRun', 'GateDecision', 'CommitSnapshot', 'Artifact', 'DocumentWitness'];

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );

  const session = driver.session();
  const nowIso = new Date().toISOString();
  const runId = `hygiene-foundation:${DEFAULT_PROJECT_ID}:${Date.now()}`;

  try {
    await session.run(
      `MERGE (d:CodeNode:HygieneDomain {id: $id})
       SET d.projectId = $projectId,
           d.coreType = 'HygieneDomain',
           d.name = 'Repository + AI Hygiene Governance Domain',
           d.schemaVersion = $schemaVersion,
           d.ownedByPlan = $ownedByPlan,
           d.boundaryNote = $boundaryNote,
           d.nonGoals = $nonGoals,
           d.requiredEvidenceEntities = $requiredEntities,
           d.updatedAt = datetime($updatedAt)`,
      {
        id: `hygiene-domain:${DEFAULT_PROJECT_ID}`,
        projectId: DEFAULT_PROJECT_ID,
        schemaVersion: HYGIENE_SCHEMA_VERSION,
        ownedByPlan: 'plans/hygiene-governance/PLAN.md + plans/hygiene-ai/PLAN.md',
        boundaryNote: 'Consumes governance-org primitives (ORG/EVT/RED/REL) without duplicating architecture ownership',
        nonGoals: [
          'Does not redefine GovernanceEvent or reducer architecture',
          'Does not replace existing VerificationRun/GateDecision evidence pipeline',
          'Does not create alternative project identity model outside Project/Repo mapping',
        ],
        requiredEntities: REQUIRED_EVIDENCE_ENTITIES,
        updatedAt: nowIso,
      },
    );

    await session.run(
      `MERGE (v:CodeNode:HygieneSchemaVersion {id: $id})
       SET v.projectId = $projectId,
           v.coreType = 'HygieneSchemaVersion',
           v.name = $name,
           v.version = $version,
           v.updatedAt = datetime($updatedAt)
       WITH v
       MATCH (d:HygieneDomain {id: $domainId})
       MERGE (d)-[:USES_SCHEMA_VERSION]->(v)`,
      {
        id: `hygiene-schema:${DEFAULT_PROJECT_ID}:${HYGIENE_SCHEMA_VERSION}`,
        projectId: DEFAULT_PROJECT_ID,
        name: `Hygiene schema ${HYGIENE_SCHEMA_VERSION}`,
        version: HYGIENE_SCHEMA_VERSION,
        updatedAt: nowIso,
        domainId: `hygiene-domain:${DEFAULT_PROJECT_ID}`,
      },
    );

    for (const failure of FAILURE_CLASSES) {
      await session.run(
        `MERGE (f:CodeNode:HygieneFailureClass {id: $id})
         SET f.projectId = $projectId,
             f.coreType = 'HygieneFailureClass',
             f.name = $name,
             f.failureClass = $failureClass,
             f.successSignal = $successSignal,
             f.updatedAt = datetime($updatedAt)
         WITH f
         MATCH (d:HygieneDomain {id: $domainId})
         MERGE (d)-[:DEFINES_FAILURE_CLASS]->(f)`,
        {
          id: `hygiene-failure-class:${DEFAULT_PROJECT_ID}:${failure.key}`,
          projectId: DEFAULT_PROJECT_ID,
          name: failure.name,
          failureClass: failure.key,
          successSignal: failure.successSignal,
          updatedAt: nowIso,
          domainId: `hygiene-domain:${DEFAULT_PROJECT_ID}`,
        },
      );
    }

    for (const control of CONTROL_SEEDS) {
      await session.run(
        `MERGE (c:CodeNode:HygieneControl {id: $id})
         SET c.projectId = $projectId,
             c.coreType = 'HygieneControl',
             c.code = $code,
             c.name = $name,
             c.mode = $mode,
             c.schemaVersion = $schemaVersion,
             c.successSignal = $successSignal,
             c.updatedAt = datetime($updatedAt)
         WITH c
         MATCH (d:HygieneDomain {id: $domainId})
         MERGE (d)-[:DEFINES_CONTROL]->(c)`,
        {
          id: `hygiene-control:${DEFAULT_PROJECT_ID}:${control.code}`,
          projectId: DEFAULT_PROJECT_ID,
          code: control.code,
          name: control.name,
          mode: control.mode,
          schemaVersion: HYGIENE_SCHEMA_VERSION,
          successSignal: control.successSignal,
          updatedAt: nowIso,
          domainId: `hygiene-domain:${DEFAULT_PROJECT_ID}`,
        },
      );

      for (const failureClass of control.failureClasses) {
        await session.run(
          `MATCH (c:HygieneControl {id: $controlId})
           MATCH (f:HygieneFailureClass {id: $failureId})
           MERGE (c)-[r:TARGETS_FAILURE_CLASS]->(f)
           SET r.updatedAt = datetime($updatedAt)`,
          {
            controlId: `hygiene-control:${DEFAULT_PROJECT_ID}:${control.code}`,
            failureId: `hygiene-failure-class:${DEFAULT_PROJECT_ID}:${failureClass}`,
            updatedAt: nowIso,
          },
        );
      }
    }

    await session.run(
      `MERGE (p:CodeNode:RepoHygieneProfile {id: $id})
       SET p.projectId = $projectId,
           p.coreType = 'RepoHygieneProfile',
           p.name = $name,
           p.profileVersion = $profileVersion,
           p.repoClass = $repoClass,
           p.allowedPathClasses = $allowedPathClasses,
           p.exceptionZones = $exceptionZones,
           p.generatedCodeZones = $generatedCodeZones,
           p.inheritsFrom = $inheritsFrom,
           p.updatedAt = datetime($updatedAt)
       WITH p
       MATCH (d:HygieneDomain {id: $domainId})
       MERGE (d)-[:DEFINES_PROFILE]->(p)`,
      {
        id: `repo-hygiene-profile:${DEFAULT_PROJECT_ID}:code-repo-default`,
        projectId: DEFAULT_PROJECT_ID,
        name: 'Code repository default hygiene profile',
        profileVersion: PROFILE_VERSION,
        repoClass: 'code-repo',
        allowedPathClasses: ['src', 'tests', 'docs', 'scripts', 'ops', 'artifacts', 'generated', 'third_party'],
        exceptionZones: ['experimental', 'legacy'],
        generatedCodeZones: ['generated', 'dist', 'build'],
        inheritsFrom: ['org-default'],
        updatedAt: nowIso,
        domainId: `hygiene-domain:${DEFAULT_PROJECT_ID}`,
      },
    );

    // Bind profile to the current project (repo-level anchor)
    await session.run(
      `MATCH (profile:RepoHygieneProfile {id: $profileId})
       MATCH (proj:Project {projectId: $projectId})
       MERGE (profile)-[:APPLIES_TO]->(proj)`,
      {
        profileId: `repo-hygiene-profile:${DEFAULT_PROJECT_ID}:code-repo-default`,
        projectId: DEFAULT_PROJECT_ID,
      },
    );

    const summary = {
      ok: true,
      runId,
      projectId: DEFAULT_PROJECT_ID,
      schemaVersion: HYGIENE_SCHEMA_VERSION,
      profileVersion: PROFILE_VERSION,
      failureClasses: FAILURE_CLASSES.map((f) => f.key),
      controls: CONTROL_SEEDS.map((c) => c.code),
      requiredEvidenceEntities: REQUIRED_EVIDENCE_ENTITIES,
      timestamp: nowIso,
    };

    const outDir = path.resolve(process.cwd(), 'artifacts', 'hygiene');
    await ensureDir(outDir);
    const outPath = path.join(outDir, `hygiene-foundation-${Date.now()}.json`);
    await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    console.log(JSON.stringify({ ...summary, artifactPath: outPath }));
  } finally {
    await session.close();
    await driver.close();
  }
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
