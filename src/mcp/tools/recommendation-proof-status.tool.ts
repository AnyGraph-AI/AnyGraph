import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';

function num(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (v.toNumber) return v.toNumber();
  return Number(v) || 0;
}

export function createRecommendationProofStatusTool(server: McpServer) {
  const neo4j = new Neo4jService();

  server.tool(
    'recommendation_proof_status',
    'Status view for recommendation-proof health: freshness, done-vs-proven, and recommendation mismatch rate.',
    {
      projectId: z.string().optional().describe('Plan project id (default: plan_codegraph)'),
      freshnessMaxMinutes: z.number().optional().describe('Freshness threshold in minutes (default 30)'),
    },
    async (args) => {
      try {
        const projectId = args.projectId ?? 'plan_codegraph';
        const freshnessMaxMinutes = args.freshnessMaxMinutes ?? 30;

        const freshnessRows = await neo4j.run(
          `MATCH (p:Project {projectId: $projectId})
           RETURN p.lastParsed AS lastParsed`,
          { projectId },
        );

        const lastParsed = String(freshnessRows[0]?.lastParsed ?? '');
        const parsedTs = Date.parse(lastParsed);
        const ageMinutes = Number.isFinite(parsedTs) ? Math.round((Date.now() - parsedTs) / 60000) : null;
        const fresh = ageMinutes !== null && ageMinutes <= freshnessMaxMinutes;

        const doneVsProvenRows = await neo4j.run(
          `MATCH (t:Task {projectId: $projectId})
           WHERE t.filePath ENDS WITH 'VERIFICATION_GRAPH_ROADMAP.md'
             AND t.name STARTS WITH 'Validate invariant:'
           OPTIONAL MATCH (:InvariantProof {projectId: $projectId})-[p:PROVES]->(t)
           WITH t, count(p) AS proofCount
           RETURN
             count(t) AS totalInvariantTasks,
             sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS doneTasks,
             sum(CASE WHEN t.status = 'done' AND (t.proofRunId IS NULL OR proofCount = 0) THEN 1 ELSE 0 END) AS doneWithoutProof,
             sum(CASE WHEN proofCount > 0 AND t.status <> 'done' THEN 1 ELSE 0 END) AS proofWithoutDone`,
          { projectId },
        );

        const totalInvariantTasks = num(doneVsProvenRows[0]?.totalInvariantTasks);
        const doneTasks = num(doneVsProvenRows[0]?.doneTasks);
        const doneWithoutProof = num(doneVsProvenRows[0]?.doneWithoutProof);
        const proofWithoutDone = num(doneVsProvenRows[0]?.proofWithoutDone);

        const mismatchRows = await neo4j.run(
          `MATCH (t:Task)
           WHERE t.projectId = $projectId
             AND t.status IN ['planned', 'in_progress']
           OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep:Task)
           WITH t, count(CASE WHEN dep.status IN ['planned', 'in_progress', 'blocked'] THEN 1 END) AS openDeps
           WHERE openDeps = 0
           RETURN
             count(t) AS recommendedTasks,
             sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS doneRecommendedTasks`,
          { projectId },
        );

        const recommendedTasks = num(mismatchRows[0]?.recommendedTasks);
        const doneRecommendedTasks = num(mismatchRows[0]?.doneRecommendedTasks);
        const mismatchRate = recommendedTasks > 0 ? doneRecommendedTasks / recommendedTasks : 0;

        const lines: string[] = [];
        lines.push('# 🧭 Recommendation-Proof Health\n');
        lines.push(`- Project: ${projectId}`);
        lines.push(`- Freshness: ${fresh ? '✅ fresh' : '❌ stale'} (lastParsed=${lastParsed || 'missing'}, ageMin=${ageMinutes ?? 'unknown'}, threshold=${freshnessMaxMinutes})`);
        lines.push(`- Done vs Proven: ${doneWithoutProof === 0 && proofWithoutDone === 0 ? '✅ consistent' : '❌ mismatch'} (done=${doneTasks}/${totalInvariantTasks}, doneWithoutProof=${doneWithoutProof}, proofWithoutDone=${proofWithoutDone})`);
        lines.push(`- Recommendation mismatch rate: ${mismatchRate.toFixed(6)} (doneRecommended=${doneRecommendedTasks}, recommended=${recommendedTasks})`);

        return createSuccessResponse(lines.join('\n'));
      } catch (error) {
        return createErrorResponse(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
