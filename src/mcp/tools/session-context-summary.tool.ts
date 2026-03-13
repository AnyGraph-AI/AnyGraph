import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import neo4j from 'neo4j-driver';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';

function num(val: any): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  if (val.toNumber) return val.toNumber();
  return Number(val) || 0;
}

function str(val: any): string {
  if (val == null) return '';
  return String(val);
}

export function createSessionContextSummaryTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'session_context_summary',
    'Cold-start context from graph: what is in progress, blocked, and what changed recently. ' +
      'Use this at session start to bootstrap from graph truth.',
    {
      projectFilter: z.string().optional().describe('Optional plan project filter, e.g. codegraph'),
      limit: z.number().optional().describe('Max tasks/results to include (default 10)'),
    },
    async (args) => {
      try {
        const limit = neo4j.int(args.limit || 10);
        const projectId = args.projectFilter ? `plan_${args.projectFilter.replace(/-/g, '_')}` : null;

        const lines: string[] = ['# 🧭 Session Context Summary\n'];

        const statusRows = await neo4jService.run(
          `MATCH (t:Task)
           WHERE t.projectId STARTS WITH 'plan_'
             AND ($projectId IS NULL OR t.projectId = $projectId)
           RETURN
             count(CASE WHEN coalesce(t.status,'planned') = 'in_progress' THEN 1 END) AS inProgress,
             count(CASE WHEN coalesce(t.status,'planned') = 'blocked' THEN 1 END) AS blocked,
             count(CASE WHEN coalesce(t.status,'planned') = 'planned' THEN 1 END) AS planned,
             count(CASE WHEN coalesce(t.status,'planned') = 'done' THEN 1 END) AS done`,
          { projectId },
        );

        const s = statusRows[0] ?? {};
        lines.push(`- In progress: **${num(s.inProgress)}**`);
        lines.push(`- Blocked: **${num(s.blocked)}**`);
        lines.push(`- Planned: **${num(s.planned)}**`);
        lines.push(`- Done: **${num(s.done)}**\n`);

        const nextRows = await neo4jService.run(
          `MATCH (t:Task)
           WHERE t.projectId STARTS WITH 'plan_'
             AND coalesce(t.status,'planned') <> 'done'
             AND ($projectId IS NULL OR t.projectId = $projectId)
           OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task)
           WITH t, count(DISTINCT CASE WHEN coalesce(d.status,'planned') <> 'done' THEN d END) AS openDeps
           WHERE coalesce(t.status,'planned') <> 'blocked'
           RETURN t.projectId AS projectId, t.name AS task, t.line AS line, openDeps
           ORDER BY openDeps ASC, coalesce(t.line, 999999) ASC
           LIMIT $limit`,
          { projectId, limit },
        );

        lines.push('## Next tasks (ready first)');
        for (const row of nextRows) {
          lines.push(`- [${str(row.projectId)}] ${str(row.task)} (line ${num(row.line)}, openDeps ${num(row.openDeps)})`);
        }
        lines.push('');

        const changedRows = await neo4jService.run(
          `MATCH (v:VerificationRun)
           WHERE v.projectId IS NOT NULL
           RETURN v.projectId AS projectId,
                  v.runId AS runId,
                  v.finishedAt AS finishedAt,
                  v.headSha AS headSha,
                  v.decisionHash AS decisionHash
           ORDER BY coalesce(v.finishedAt, v.startedAt) DESC
           LIMIT $limit`,
          { limit },
        );

        lines.push('## Recent verification runs');
        for (const row of changedRows) {
          lines.push(`- ${str(row.projectId)} | ${str(row.runId)} | ${str(row.finishedAt)} | ${str(row.headSha).slice(0, 12)}`);
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}
