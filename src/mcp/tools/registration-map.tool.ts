/**
 * Registration Map Tool
 * Query framework entrypoints — what happens when a user sends /start, clicks a button, etc.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { toNumber } from '../../core/utils/shared-utils.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createErrorResponse, createSuccessResponse, debugLog, resolveProjectIdOrError } from '../utils.js';

export function createRegistrationMapTool(server: McpServer) {
  const neo4jService = new Neo4jService();
  
  server.tool(
    'registration_map',
    'Query framework entrypoints (commands, callbacks, events, routes). Shows what handler runs for a given trigger, ' +
    'what it calls, and what state it touches. "What happens when the user sends /buy?"',
    {
      projectId: z.string().describe('Project ID'),
      trigger: z.string().optional().describe('Specific trigger to look up (e.g., "/start", "home:buy", ":message"). Omit to list all.'),
      kind: z.string().optional().describe('Filter by registration kind (command, callback, event, route)'),
    },
    async (args) => {
      try {
        const resolved = await resolveProjectIdOrError(args.projectId, neo4jService);
        if (!resolved.success) return resolved.error!;
        const projectId = resolved.projectId!;
        
        const results: string[] = [];
        
        if (!args.trigger) {
          // List all entrypoints
          let query = `
            MATCH (handler)-[:REGISTERED_BY]->(ep:Entrypoint {projectId: $projectId})
            WHERE ep.registrationKind IS NOT NULL
          `;
          const params: Record<string, any> = { projectId };
          
          if (args.kind) {
            query += ` AND ep.registrationKind = $kind`;
            params.kind = args.kind;
          }
          
          query += `
            OPTIONAL MATCH (handler)-[:CALLS]->(callee)
            WITH ep, handler, count(DISTINCT callee) AS callCount
            OPTIONAL MATCH (handler)-[:WRITES_STATE]->(field:Field)
            WITH ep, handler, callCount, collect(DISTINCT field.name) AS writesFields
            RETURN ep.registrationKind AS kind, ep.registrationTrigger AS trigger,
              ep.framework AS framework,
              handler.name AS handler, handler.filePath AS file,
              handler.riskTier AS tier, callCount,
              writesFields
            ORDER BY ep.registrationKind, ep.registrationTrigger
          `;
          
          const rows = await neo4jService.run(query, params);
          
          if (rows.length === 0) {
            return createSuccessResponse('No entrypoints found. Is this a framework project with .codegraph.yml registrations?');
          }
          
          results.push(`## Registration Map (${rows.length} entrypoints)\n`);
          results.push('| Kind | Trigger | Handler | File | Risk | Calls | Writes |');
          results.push('|------|---------|---------|------|------|-------|--------|');
          
          for (const r of rows as any[]) {
            const file = (r.file || '').split('/').slice(-2).join('/');
            const writes = (r.writesFields || []).join(', ') || '—';
            const calls = toNumber(r.callCount) || 0;
            results.push(`| ${r.kind} | ${r.trigger} | ${r.handler} | ${file} | ${r.tier || '?'} | ${calls} | ${writes} |`);
          }
        } else {
          // Detailed view for specific trigger
          const trigger = args.trigger.replace(/^\//, '');  // strip leading /
          
          const rows = await neo4jService.run(`
            MATCH (handler)-[:REGISTERED_BY]->(ep:Entrypoint {projectId: $projectId})
            WHERE ep.registrationTrigger CONTAINS $trigger
            OPTIONAL MATCH (handler)-[:CALLS]->(callee)
            WITH ep, handler, collect(DISTINCT {name: callee.name, file: callee.filePath, tier: callee.riskTier}) AS callees
            OPTIONAL MATCH (handler)-[rs:READS_STATE]->(rf:Field)
            WITH ep, handler, callees, collect(DISTINCT rf.name) AS reads
            OPTIONAL MATCH (handler)-[ws:WRITES_STATE]->(wf:Field)
            WITH ep, handler, callees, reads, collect(DISTINCT wf.name) AS writes
            RETURN ep.registrationKind AS kind, ep.registrationTrigger AS trigger,
              ep.framework AS framework,
              handler.name AS handlerName, handler.filePath AS handlerFile,
              handler.riskTier AS tier, handler.lineCount AS lines,
              callees, reads, writes
          `, { projectId, trigger });
          
          if (rows.length === 0) {
            return createSuccessResponse(`No entrypoint found matching "${trigger}".`);
          }
          
          for (const r of rows as any[]) {
            const file = (r.handlerFile || '').split('/').slice(-2).join('/');
            results.push(`## ${r.kind}:${r.trigger}\n`);
            results.push(`**Handler:** \`${r.handlerName}\` (${file})`);
            results.push(`**Risk:** ${r.tier || '?'} | **Lines:** ${toNumber(r.lines) || '?'} | **Framework:** ${r.framework || '?'}\n`);
            
            if (r.reads?.length > 0) results.push(`**Reads state:** ${r.reads.join(', ')}`);
            if (r.writes?.length > 0) results.push(`**Writes state:** ${r.writes.join(', ')}`);
            
            const callees = r.callees || [];
            if (callees.length > 0) {
              results.push(`\n### Calls (${callees.length}):\n`);
              for (const c of callees.slice(0, 30)) {
                const cFile = (c.file || '').split('/').slice(-1)[0];
                results.push(`- \`${c.name}\` (${cFile}) [${c.tier || '?'}]`);
              }
              if (callees.length > 30) {
                results.push(`- ... and ${callees.length - 30} more`);
              }
            }
          }
        }
        
        return createSuccessResponse(results.join('\n'));
      } catch (error: any) {
        debugLog('registration_map error:', error);
        return createErrorResponse(`Registration map query failed: ${error.message}`);
      }
    }
  );
}
