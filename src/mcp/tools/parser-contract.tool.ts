import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';

export function createParserContractStatusTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'parser_contract_status',
    'Shows parser contract graph status and optional blast radius for a parser function.',
    {
      functionName: z.string().optional().describe('Optional parser function name for blast radius lookup (e.g., enrichCrossDomain)'),
    },
    async (args) => {
      try {
        const lines: string[] = ['# 🧩 Parser Contract Status\n'];

        const summary = await neo4jService.run(
          `MATCH (c:ParserContract)
           OPTIONAL MATCH (c)-[r]->()
           RETURN count(DISTINCT c) AS contractNodes, count(DISTINCT r) AS outgoingEdges`,
        );

        const contractNodes = Number(summary?.[0]?.contractNodes ?? 0);
        const outgoingEdges = Number(summary?.[0]?.outgoingEdges ?? 0);

        lines.push(`Contract nodes: ${contractNodes}`);
        lines.push(`Outgoing edges: ${outgoingEdges}`);

        const byStage = await neo4jService.run(
          `MATCH (c:ParserContract)
           RETURN c.stage AS stage, count(c) AS count
           ORDER BY stage`,
        );

        if (byStage.length > 0) {
          lines.push('\n## By stage');
          for (const row of byStage) {
            lines.push(`- ${String(row.stage)}: ${Number(row.count ?? 0)}`);
          }
        }

        if (args.functionName) {
          const blast = await neo4jService.run(
            `MATCH (c:ParserContract {functionName: $fn})-[r]->(target)
             RETURN c.name AS contract, type(r) AS edgeType, target.name AS target
             ORDER BY edgeType, target`,
            { fn: args.functionName },
          );

          lines.push(`\n## Blast radius for \`${args.functionName}\``);
          if (blast.length === 0) {
            lines.push('No contract edges found for that function.');
          } else {
            for (const row of blast) {
              lines.push(`- ${String(row.edgeType)} → ${String(row.target ?? row.contract ?? 'unknown')}`);
            }
          }
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createErrorResponse(`Failed to query parser contract status: ${message}`);
      }
    },
  );
}
