/**
 * State Impact Tool
 * Query which functions read/write a specific state field and find race conditions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { toNumber } from '../../core/utils/shared-utils.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createErrorResponse, createSuccessResponse, debugLog, resolveProjectIdOrError } from '../utils.js';

export function createStateImpactTool(server: McpServer) {
  const neo4jService = new Neo4jService();
  
  server.tool(
    'state_impact',
    'Query state field access patterns. Shows which functions read/write a field, detects race conditions ' +
    '(multiple writers to the same field), and traces state flow across handlers.',
    {
      projectId: z.string().describe('Project ID'),
      fieldName: z.string().optional().describe('Specific field name to query (e.g., "pendingBuy", "dcaState"). Omit to list all fields.'),
      writersOnly: z.boolean().optional().describe('Only show writers (useful for finding race conditions)'),
    },
    async (args) => {
      try {
        const resolved = await resolveProjectIdOrError(args.projectId, neo4jService);
        if (!resolved.success) return resolved.error!;
        const projectId = resolved.projectId!;
        
        const results: string[] = [];
        
        if (!args.fieldName) {
          // List all fields with reader/writer counts
          const rows = await neo4jService.run(`
            MATCH (field:Field {projectId: $projectId})
            OPTIONAL MATCH (reader)-[:READS_STATE]->(field)
            WITH field, count(DISTINCT reader) AS readers
            OPTIONAL MATCH (writer)-[:WRITES_STATE]->(field)
            WITH field, readers, count(DISTINCT writer) AS writers
            RETURN field.name AS name, field.semanticRole AS role,
              readers, writers,
              CASE WHEN writers > 1 THEN true ELSE false END AS raceRisk
            ORDER BY writers DESC, readers DESC
          `, { projectId });
          
          if (rows.length === 0) {
            return createSuccessResponse('No state fields found. Check if stateRoots are configured in .codegraph.yml');
          }
          
          results.push('## State Fields\n');
          results.push('| Field | Role | Readers | Writers | Race Risk |');
          results.push('|-------|------|---------|---------|-----------|');
          
          for (const r of rows as any[]) {
            const race = r.raceRisk ? '⚠️ YES' : '—';
            results.push(`| ${r.name} | ${r.role || '—'} | ${toNumber(r.readers)} | ${toNumber(r.writers)} | ${race} |`);
          }
          
          const raceFields = (rows as any[]).filter(r => r.raceRisk);
          if (raceFields.length > 0) {
            results.push(`\n⚠️ **${raceFields.length} fields have multiple writers** — potential race conditions.`);
            results.push('Run `state_impact` with `fieldName` to see which functions conflict.');
          }
        } else {
          // Detailed view for specific field
          const fieldName = args.fieldName;
          
          const readers = await neo4jService.run(`
            MATCH (f)-[:READS_STATE]->(field:Field {name: $fieldName, projectId: $projectId})
            RETURN f.name AS name, f.filePath AS file, f.riskTier AS tier,
              f.registrationKind AS regKind, f.registrationTrigger AS trigger
            ORDER BY f.name
          `, { fieldName, projectId });
          
          const writers = await neo4jService.run(`
            MATCH (f)-[:WRITES_STATE]->(field:Field {name: $fieldName, projectId: $projectId})
            RETURN f.name AS name, f.filePath AS file, f.riskTier AS tier,
              f.registrationKind AS regKind, f.registrationTrigger AS trigger
            ORDER BY f.name
          `, { fieldName, projectId });
          
          results.push(`## State Field: \`${fieldName}\`\n`);
          
          if (!args.writersOnly && readers.length > 0) {
            results.push(`### Readers (${readers.length})\n`);
            results.push('| Function | File | Risk | Registration |');
            results.push('|----------|------|------|-------------|');
            for (const r of readers as any[]) {
              const file = (r.file || '').split('/').slice(-2).join('/');
              const reg = r.regKind ? `${r.regKind}:${r.trigger}` : '—';
              results.push(`| ${r.name} | ${file} | ${r.tier || '?'} | ${reg} |`);
            }
          }
          
          if (writers.length > 0) {
            results.push(`\n### Writers (${writers.length})${writers.length > 1 ? ' ⚠️ RACE RISK' : ''}\n`);
            results.push('| Function | File | Risk | Registration |');
            results.push('|----------|------|------|-------------|');
            for (const w of writers as any[]) {
              const file = (w.file || '').split('/').slice(-2).join('/');
              const reg = w.regKind ? `${w.regKind}:${w.trigger}` : '—';
              results.push(`| ${w.name} | ${file} | ${w.tier || '?'} | ${reg} |`);
            }
            
            if (writers.length > 1) {
              results.push(`\n⚠️ **${writers.length} functions write to \`${fieldName}\`** — verify these can't execute concurrently.`);
            }
          }
          
          if (readers.length === 0 && writers.length === 0) {
            results.push(`No readers or writers found for field \`${fieldName}\`.`);
          }
        }
        
        return createSuccessResponse(results.join('\n'));
      } catch (error: any) {
        debugLog('state_impact error:', error);
        return createErrorResponse(`State impact query failed: ${error.message}`);
      }
    }
  );
}
