import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

const CODE_PROJECT_ID = 'proj_c0d3e9a1f200';
const PLAN_PROJECT_ID = 'plan_codegraph';
const ROADMAP_FILE = 'VERIFICATION_GRAPH_ROADMAP.md';

const THRESHOLD_ARTIFACT = join(process.cwd(), 'artifacts', 'verification-pilot', 'vg5-thresholds-latest.json');
const VALIDATION_ARTIFACT = join(process.cwd(), 'artifacts', 'verification-pilot', 'vg5-ir-module-latest.json');

interface ThresholdArtifact {
  generatedAt: string;
  falsePositive?: {
    consecutiveRunsPass?: boolean;
  };
  scopeCompleteness?: {
    pass?: boolean;
  };
  waiverHygiene?: {
    pass?: boolean;
  };
}

interface ValidationArtifact {
  generatedAt: string;
  checks?: Record<string, boolean>;
}

interface InvariantMap {
  invariantId: string;
  criterionId: string;
  taskName: string;
  validationKey: keyof NonNullable<ValidationArtifact['checks']>;
}

const INVARIANTS: InvariantMap[] = [
  {
    invariantId: 'vg5.materialization_idempotency',
    criterionId: 'ir.materializer.idempotency.v1',
    taskName: 'Validate invariant: materialization idempotency',
    validationKey: 'materializationIdempotency',
  },
  {
    invariantId: 'vg5.project_scope_integrity',
    criterionId: 'ir.materializer.project_scope_integrity.v1',
    taskName: 'Validate invariant: project-scope integrity',
    validationKey: 'projectScopeIntegrity',
  },
  {
    invariantId: 'vg5.original_edge_type_fidelity',
    criterionId: 'ir.materializer.original_edge_type_fidelity.v1',
    taskName: 'Validate invariant: edge type fidelity via `originalEdgeType`',
    validationKey: 'originalEdgeTypeFidelity',
  },
  {
    invariantId: 'vg5.deterministic_rebuild_totals',
    criterionId: 'ir.materializer.deterministic_rebuild_totals.v1',
    taskName: 'Validate invariant: deterministic clear-and-rebuild totals',
    validationKey: 'deterministicRebuildTotals',
  },
  {
    invariantId: 'vg5.no_orphan_relationship_writes',
    criterionId: 'ir.materializer.no_orphan_relationship_writes.v1',
    taskName: 'Validate invariant: no orphan relationship writes',
    validationKey: 'noOrphanRelationshipWrites',
  },
];

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

async function getLatestDecisionHash(neo4j: Neo4jService): Promise<string | null> {
  const rows = await neo4j.run(
    `MATCH (g:GateDecision {projectId: $projectId})
     RETURN g.decisionHash AS decisionHash
     ORDER BY coalesce(g.evaluatedAt, g.updatedAt, g.createdAt) DESC
     LIMIT 1`,
    { projectId: CODE_PROJECT_ID },
  );

  const hash = rows[0]?.decisionHash;
  return hash ? String(hash) : null;
}

async function main(): Promise<void> {
  const thresholdRaw = readFileSync(THRESHOLD_ARTIFACT, 'utf8');
  const validationRaw = readFileSync(VALIDATION_ARTIFACT, 'utf8');

  const threshold = JSON.parse(thresholdRaw) as ThresholdArtifact;
  const validation = JSON.parse(validationRaw) as ValidationArtifact;

  const artifactHash = sha256(thresholdRaw);
  const validationHash = sha256(validationRaw);

  const neo4j = new Neo4jService();

  try {
    const decisionHash = await getLatestDecisionHash(neo4j);
    const provedAt = threshold.generatedAt ?? new Date().toISOString();

    let proofsUpserted = 0;
    let edgesUpserted = 0;

    for (const inv of INVARIANTS) {
      const pass = Boolean(validation.checks?.[inv.validationKey]);
      const runId = `proof:${inv.invariantId}:${provedAt}`;

      await neo4j.run(
        `MERGE (p:CodeNode:InvariantProof {projectId: $projectId, invariantId: $invariantId, criterionId: $criterionId})
         SET p.runId = $runId,
             p.result = $result,
             p.provedAt = $provedAt,
             p.artifactHash = $artifactHash,
             p.validationHash = $validationHash,
             p.decisionHash = $decisionHash,
             p.sourceArtifactPath = $sourceArtifactPath,
             p.validationArtifactPath = $validationArtifactPath,
             p.updatedAt = toString(datetime())`,
        {
          projectId: PLAN_PROJECT_ID,
          invariantId: inv.invariantId,
          criterionId: inv.criterionId,
          runId,
          result: pass ? 'pass' : 'fail',
          provedAt,
          artifactHash,
          validationHash,
          decisionHash,
          sourceArtifactPath: THRESHOLD_ARTIFACT,
          validationArtifactPath: VALIDATION_ARTIFACT,
        },
      );
      proofsUpserted += 1;

      await neo4j.run(
        `MATCH (p:InvariantProof {projectId: $projectId, invariantId: $invariantId, criterionId: $criterionId})
         MATCH (t:Task {projectId: $projectId, name: $taskName})
         WHERE t.filePath ENDS WITH $roadmapFile
         MERGE (p)-[r:PROVES]->(t)
         SET r.projectId = $projectId,
             r.provedAt = $provedAt,
             r.result = $result,
             r.artifactHash = $artifactHash,
             r.decisionHash = $decisionHash,
             r.updatedAt = toString(datetime())`,
        {
          projectId: PLAN_PROJECT_ID,
          invariantId: inv.invariantId,
          criterionId: inv.criterionId,
          taskName: inv.taskName,
          roadmapFile: ROADMAP_FILE,
          provedAt,
          result: pass ? 'pass' : 'fail',
          artifactHash,
          decisionHash,
        },
      );
      edgesUpserted += 1;

      await neo4j.run(
        `MATCH (t:Task {projectId: $projectId, name: $taskName})
         WHERE t.filePath ENDS WITH $roadmapFile
         SET t.proofInvariantId = $invariantId,
             t.proofCriterionId = $criterionId,
             t.proofRunId = $runId,
             t.proofResult = $result,
             t.proofArtifactHash = $artifactHash,
             t.proofDecisionHash = $decisionHash,
             t.provedAt = $provedAt,
             t.updatedAt = toString(datetime())`,
        {
          projectId: PLAN_PROJECT_ID,
          taskName: inv.taskName,
          roadmapFile: ROADMAP_FILE,
          invariantId: inv.invariantId,
          criterionId: inv.criterionId,
          runId,
          result: pass ? 'pass' : 'fail',
          artifactHash,
          decisionHash,
          provedAt,
        },
      );
    }

    console.log(
      JSON.stringify({
        ok: true,
        projectId: PLAN_PROJECT_ID,
        codeProjectId: CODE_PROJECT_ID,
        proofsUpserted,
        edgesUpserted,
        provedAt,
        artifactHash,
        validationHash,
        decisionHash,
      }),
    );
  } finally {
    await neo4j.close();
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
