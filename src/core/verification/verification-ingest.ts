import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import {
  VerificationFoundationBundleSchema,
  type VerificationFoundationBundle,
} from './verification-schema.js';

export interface VerificationIngestResult {
  runsUpserted: number;
  scopesUpserted: number;
  adjudicationsUpserted: number;
  pathWitnessesUpserted: number;
  hasScopeEdges: number;
  unscannedEdges: number;
  adjudicatesEdges: number;
  illustratesEdges: number;
}

export async function ingestVerificationFoundation(
  input: VerificationFoundationBundle,
): Promise<VerificationIngestResult> {
  const parsed = VerificationFoundationBundleSchema.parse(input);

  const neo4j = new Neo4jService();
  let runsUpserted = 0;
  let scopesUpserted = 0;
  let adjudicationsUpserted = 0;
  let pathWitnessesUpserted = 0;
  let hasScopeEdges = 0;
  let unscannedEdges = 0;
  let adjudicatesEdges = 0;
  let illustratesEdges = 0;

  try {
    for (const run of parsed.verificationRuns) {
      await neo4j.run(
        `MERGE (n:CodeNode:VerificationRun {id: $id})
         SET n += $props,
             n.coreType = 'VerificationRun',
             n.projectId = $projectId,
             n.updatedAt = toString(datetime())`,
        {
          id: run.id,
          projectId: parsed.projectId,
          props: {
            ...run,
            createdAt: run.createdAt ?? new Date().toISOString(),
          },
        },
      );
      runsUpserted++;
    }

    for (const scope of parsed.analysisScopes) {
      await neo4j.run(
        `MERGE (s:CodeNode:AnalysisScope {id: $id})
         SET s += $props,
             s.coreType = 'AnalysisScope',
             s.projectId = $projectId,
             s.updatedAt = toString(datetime())`,
        {
          id: scope.id,
          projectId: parsed.projectId,
          props: scope,
        },
      );
      scopesUpserted++;

      await neo4j.run(
        `MATCH (r:VerificationRun {id: $runId, projectId: $projectId})
         MATCH (s:AnalysisScope {id: $scopeId, projectId: $projectId})
         MERGE (r)-[e:HAS_SCOPE]->(s)
         SET e.projectId = $projectId,
             e.updatedAt = toString(datetime())`,
        {
          runId: scope.verificationRunId,
          scopeId: scope.id,
          projectId: parsed.projectId,
        },
      );
      hasScopeEdges++;

      for (const targetId of scope.unscannedTargetNodeIds ?? []) {
        await neo4j.run(
          `MATCH (s:AnalysisScope {id: $scopeId, projectId: $projectId})
           MATCH (t:CodeNode {id: $targetId, projectId: $projectId})
           MERGE (s)-[e:UNSCANNED_FOR]->(t)
           SET e.projectId = $projectId,
               e.updatedAt = toString(datetime())`,
          {
            scopeId: scope.id,
            targetId,
            projectId: parsed.projectId,
          },
        );
        unscannedEdges++;
      }
    }

    for (const adj of parsed.adjudications) {
      await neo4j.run(
        `MERGE (a:CodeNode:AdjudicationRecord {id: $id})
         SET a += $props,
             a.coreType = 'AdjudicationRecord',
             a.projectId = $projectId,
             a.updatedAt = toString(datetime())`,
        {
          id: adj.id,
          projectId: parsed.projectId,
          props: adj,
        },
      );
      adjudicationsUpserted++;

      await neo4j.run(
        `MATCH (a:AdjudicationRecord {id: $adjId, projectId: $projectId})
         MATCH (t:CodeNode {id: $targetId, projectId: $projectId})
         MERGE (a)-[e:ADJUDICATES]->(t)
         SET e.projectId = $projectId,
             e.updatedAt = toString(datetime())`,
        {
          adjId: adj.id,
          targetId: adj.targetNodeId,
          projectId: parsed.projectId,
        },
      );
      adjudicatesEdges++;
    }

    for (const w of parsed.pathWitnesses ?? []) {
      await neo4j.run(
        `MERGE (w:CodeNode:PathWitness {id: $id})
         SET w += $props,
             w.coreType = 'PathWitness',
             w.projectId = $projectId,
             w.updatedAt = toString(datetime())`,
        {
          id: w.id,
          projectId: parsed.projectId,
          props: w,
        },
      );
      pathWitnessesUpserted++;

      await neo4j.run(
        `MATCH (w:PathWitness {id: $wid, projectId: $projectId})
         MATCH (v:VerificationRun {id: $vid, projectId: $projectId})
         MERGE (w)-[e:ILLUSTRATES]->(v)
         SET e.projectId = $projectId,
             e.updatedAt = toString(datetime())`,
        {
          wid: w.id,
          vid: w.verificationRunId,
          projectId: parsed.projectId,
        },
      );
      illustratesEdges++;
    }

    return {
      runsUpserted,
      scopesUpserted,
      adjudicationsUpserted,
      pathWitnessesUpserted,
      hasScopeEdges,
      unscannedEdges,
      adjudicatesEdges,
      illustratesEdges,
    };
  } finally {
    await neo4j.close();
  }
}
