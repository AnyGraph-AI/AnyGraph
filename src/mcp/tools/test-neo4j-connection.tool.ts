/**
 * Test Neo4j Connection Tool
 * Verifies Neo4j connectivity and APOC plugin availability
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA, MESSAGES } from '../constants.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';

export const createTestNeo4jConnectionTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.testNeo4jConnection,
    {
      title: TOOL_METADATA[TOOL_NAMES.testNeo4jConnection].title,
      description: TOOL_METADATA[TOOL_NAMES.testNeo4jConnection].description,
      inputSchema: {},
    },
    async () => {
      const driver = new Neo4jService().getDriver();

      try {
        const session = driver.session();

        try {
          const basicResult = await session.run(MESSAGES.neo4j.connectionTest);
          const connMsg = basicResult.records[0].get('message');
          const connTime = basicResult.records[0].get('timestamp');

          // APOC is optional — check but don't fail
          let apocMsg = 'APOC not installed (optional)';
          try {
            const apocResult = await session.run(MESSAGES.neo4j.apocTest);
            const apocCount = apocResult.records[0].get('apocFunctions').toNumber();
            apocMsg = `APOC available with ${apocCount} functions`;
          } catch {
            // APOC not installed — that's fine
          }

          // Count graph stats
          const statsResult = await session.run(
            'MATCH (n) WITH count(n) AS nodes MATCH ()-[r]->() RETURN nodes, count(r) AS edges'
          );
          const nodes = statsResult.records[0]?.get('nodes')?.toNumber?.() ?? 0;
          const edges = statsResult.records[0]?.get('edges')?.toNumber?.() ?? 0;

          const message = `Neo4j connected: ${connMsg} at ${connTime}\n${apocMsg}\nGraph: ${nodes} nodes, ${edges} edges`;

          return createSuccessResponse(message);
        } finally {
          await session.close();
        }
      } catch (error) {
        const errorMessage = `${MESSAGES.errors.connectionTestFailed}: ${error.message}\n${MESSAGES.errors.neo4jRequirement}`;
        return createErrorResponse(errorMessage);
      } finally {
        await driver.close();
      }
    },
  );
};
