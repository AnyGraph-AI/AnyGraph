/**
 * Swarm Graph Refresh Tool
 * 
 * After a real edit, re-parse changed files and update the CodeGraph.
 * Workers MUST call this before swarm_complete_task so the next agent's
 * pre_edit_check and simulate_edit operate on fresh graph data.
 * 
 * Uses the existing performIncrementalParse pipeline:
 * detect changes → save cross-file edges → delete old subgraphs → reparse → reimport
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { performIncrementalParse } from '../handlers/incremental-parse.handler.js';
import { TOOL_NAMES, TOOL_METADATA } from '../constants.js';
import { createErrorResponse, createSuccessResponse, debugLog, resolveProjectIdOrError } from '../utils.js';

const inputSchema = z.object({
  projectId: z.string().describe('Project ID, name, or path'),
});

export const createSwarmGraphRefreshTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.swarmGraphRefresh,
    {
      title: TOOL_METADATA[TOOL_NAMES.swarmGraphRefresh].title,
      description: TOOL_METADATA[TOOL_NAMES.swarmGraphRefresh].description,
      inputSchema: inputSchema.shape,
    },
    async (args: z.infer<typeof inputSchema>) => {
      const neo4jService = new Neo4jService();

      try {
        await debugLog('Swarm graph refresh started', args);

        // Resolve project
        const resolved = await resolveProjectIdOrError(args.projectId, neo4jService);
        if (!resolved.success) return resolved.error;
        const { projectId } = resolved;

        // Get project path
        const projectResult = await neo4jService.run(
          'MATCH (p:Project {projectId: $pid}) RETURN p.path AS path',
          { pid: projectId }
        );
        const projectPath = projectResult[0]?.path;
        if (!projectPath) {
          return createErrorResponse(new Error(`Project ${projectId} not found or has no path`));
        }

        // Run incremental parse — detects changed files, reparses, updates graph
        const result = await performIncrementalParse(
          projectPath as string,
          projectId,
          'tsconfig.json',
        );

        const summary = [
          `Graph refreshed for project ${projectId}`,
          `  Files reparsed: ${result.filesReparsed}`,
          `  Files deleted: ${result.filesDeleted}`,
          `  Nodes updated: ${result.nodesUpdated}`,
          `  Edges updated: ${result.edgesUpdated}`,
        ];

        if (result.filesReparsed === 0 && result.filesDeleted === 0) {
          summary.push('  No changes detected — graph is already current.');
        }

        await debugLog('Swarm graph refresh completed', result);

        return createSuccessResponse(summary.join('\n'));
      } catch (error) {
        console.error('Swarm graph refresh error:', error);
        return createErrorResponse(error);
      } finally {
        await neo4jService.close();
      }
    },
  );
};
