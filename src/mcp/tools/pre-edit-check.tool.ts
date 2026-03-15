/**
 * Pre-Edit Check Tool
 * 
 * The gate. Agent calls this BEFORE editing any function/method.
 * Returns risk assessment and whether simulate_edit is REQUIRED.
 * 
 * Flow:
 *   1. Agent wants to edit a function
 *   2. Agent calls pre_edit_check(functionName)
 *   3. Tool returns: risk tier, fan-in, callers, state access, verdict
 *   4. If verdict is SIMULATE_FIRST → agent MUST call simulate_edit before proceeding
 *   5. If verdict is PROCEED_WITH_CAUTION → agent should check callers
 *   6. If verdict is SAFE → agent can edit freely
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { checkBookmarkWarnings } from '../../core/ground-truth/warn-enforcement.js';
import { emitTouched } from '../../core/ground-truth/observed-events.js';
import { TOOL_NAMES, TOOL_METADATA } from '../constants.js';
import { createErrorResponse, createSuccessResponse, debugLog, resolveProjectIdOrError } from '../utils.js';

const inputSchema = z.object({
  projectId: z.string().describe('Project ID, name, or path'),
  functionName: z.string().describe('Name of the function/method to check'),
  filePath: z.string().optional().describe('File path to disambiguate if multiple functions share the name'),
  agentId: z.string().optional().describe('Agent ID for SessionBookmark tracking (default: watson-main)'),
});

export const createPreEditCheckTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.preEditCheck,
    {
      title: TOOL_METADATA[TOOL_NAMES.preEditCheck].title,
      description: TOOL_METADATA[TOOL_NAMES.preEditCheck].description,
      inputSchema: inputSchema.shape,
    },
    async (args: z.infer<typeof inputSchema>) => {
      const neo4jService = new Neo4jService();

      try {
        const { functionName, filePath } = args;
        await debugLog('Pre-edit check', { functionName, filePath });

        // Resolve project
        const resolved = await resolveProjectIdOrError(args.projectId, neo4jService);
        if (!resolved.success) return resolved.error;
        const { projectId } = resolved;

        // Find the function/method
        const fileFilter = filePath
          ? 'AND (n.filePath = $filePath OR n.filePath ENDS WITH $filePath)'
          : '';

        const nodeResult = await neo4jService.run(`
          MATCH (n {projectId: $pid})
          WHERE (n:Function OR n:Method) AND n.name = $name ${fileFilter}
          RETURN n.name AS name, n.filePath AS filePath, n.riskLevel AS riskLevel,
                 n.riskTier AS riskTier, n.fanInCount AS fanInCount, n.fanOutCount AS fanOutCount,
                 n.lineCount AS lineCount, n.isExported AS isExported,
                 n.isInnerFunction AS isInnerFunction, labels(n) AS labels
        `, { pid: projectId, name: functionName, filePath: filePath || '' });

        if (nodeResult.length === 0) {
          return createErrorResponse(
            `Function "${functionName}" not found in project. Check spelling or provide filePath.`
          );
        }

        // If multiple matches, list them for disambiguation
        if (nodeResult.length > 1 && !filePath) {
          const matches = nodeResult.map((r: any) => `  - ${r.name} in ${r.filePath} (risk: ${r.riskTier})`);
          return createSuccessResponse(
            `Multiple functions named "${functionName}" found. Provide filePath to disambiguate:\n${matches.join('\n')}`
          );
        }

        const node = nodeResult[0];
        const riskLevel = typeof node.riskLevel === 'object' 
          ? (node.riskLevel as any).toNumber() 
          : (node.riskLevel ?? 0);
        const fanIn = typeof node.fanInCount === 'object'
          ? (node.fanInCount as any).toNumber()
          : (node.fanInCount ?? 0);
        const fanOut = typeof node.fanOutCount === 'object'
          ? (node.fanOutCount as any).toNumber()
          : (node.fanOutCount ?? 0);
        const lineCount = typeof node.lineCount === 'object'
          ? (node.lineCount as any).toNumber()
          : (node.lineCount ?? 0);

        // Get callers
        const callersResult = await neo4jService.run(`
          MATCH (caller)-[:CALLS]->(n {projectId: $pid})
          WHERE (n:Function OR n:Method) AND n.name = $name
          ${fileFilter ? 'AND (n.filePath = $filePath OR n.filePath ENDS WITH $filePath)' : ''}
          RETURN DISTINCT caller.name AS callerName, caller.filePath AS callerFile
          ORDER BY callerFile
          LIMIT 30
        `, { pid: projectId, name: functionName, filePath: filePath || '' });

        // Get state access
        const stateResult = await neo4jService.run(`
          MATCH (n {projectId: $pid})
          WHERE (n:Function OR n:Method) AND n.name = $name
          ${fileFilter ? 'AND (n.filePath = $filePath OR n.filePath ENDS WITH $filePath)' : ''}
          OPTIONAL MATCH (n)-[:READS_STATE]->(r:Field)
          OPTIONAL MATCH (n)-[:WRITES_STATE]->(w:Field)
          RETURN collect(DISTINCT r.name) AS reads, collect(DISTINCT w.name) AS writes
        `, { pid: projectId, name: functionName, filePath: filePath || '' });

        const stateReads = (stateResult[0]?.reads as string[])?.filter(Boolean) || [];
        const stateWrites = (stateResult[0]?.writes as string[])?.filter(Boolean) || [];

        // Check temporal coupling
        const coChangeResult = await neo4jService.run(`
          MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(n)
          WHERE (n:Function OR n:Method) AND n.name = $name
          ${fileFilter ? 'AND (n.filePath = $filePath OR n.filePath ENDS WITH $filePath)' : ''}
          WITH sf
          MATCH (sf)-[r:CO_CHANGES_WITH]->(other:SourceFile)
          WHERE r.coChangeCount >= 3
          RETURN other.filePath AS coupledFile, r.coChangeCount AS coChanges
          ORDER BY r.coChangeCount DESC
          LIMIT 5
        `, { pid: projectId, name: functionName, filePath: filePath || '' });

        // Determine verdict
        let verdict: string;
        let verdictReason: string;
        const riskTier = node.riskTier || 'LOW';

        if (riskTier === 'CRITICAL' || fanIn > 50) {
          verdict = 'SIMULATE_FIRST';
          verdictReason = riskTier === 'CRITICAL'
            ? `CRITICAL risk (${Math.round(riskLevel)}). You MUST run simulate_edit before changing this function.`
            : `${fanIn} callers depend on this. You MUST run simulate_edit before changing this function.`;
        } else if (riskTier === 'HIGH' || fanIn > 15 || stateWrites.length > 2) {
          verdict = 'SIMULATE_FIRST';
          verdictReason = `HIGH risk. ${fanIn} callers, ${stateWrites.length} state writes. Run simulate_edit before proceeding.`;
        } else if (riskTier === 'MEDIUM' || fanIn > 5 || stateWrites.length > 0) {
          verdict = 'PROCEED_WITH_CAUTION';
          verdictReason = `MEDIUM risk. Check the ${fanIn} callers listed below before editing.`;
        } else {
          verdict = 'SAFE';
          verdictReason = `LOW risk, ${fanIn} callers. Safe to edit.`;
        }

        // GTH-5: Bookmark warnings (non-blocking)
        const effectiveAgentId = args.agentId ?? 'watson-main';
        const bookmarkWarnings = await checkBookmarkWarnings(neo4jService, effectiveAgentId);

        // GTH-6: Emit TOUCHED edge (non-blocking, fire-and-forget)
        if (node.filePath) {
          emitTouched(neo4jService, String(node.filePath), {
            agentId: effectiveAgentId,
            projectId,
          }).catch(() => {}); // never block on observation failure
        }

        // Format output
        const lines: string[] = [];
        const icon = { SIMULATE_FIRST: '🔴', PROCEED_WITH_CAUTION: '⚠️', SAFE: '✅' }[verdict] || '❓';

        // Prepend bookmark warnings if any
        if (bookmarkWarnings.length > 0) {
          for (const w of bookmarkWarnings) {
            lines.push(`⚡ [${w.code}] ${w.message}`);
          }
          lines.push('');
        }

        lines.push(`${icon} ${verdict}: ${functionName}`);
        lines.push(verdictReason);
        lines.push('');
        lines.push(`Risk: ${riskTier} (score: ${Math.round(riskLevel)})`);
        lines.push(`Fan-in: ${fanIn} callers | Fan-out: ${fanOut} callees | Lines: ${lineCount}`);
        lines.push(`Exported: ${node.isExported ? 'yes' : 'no'} | Inner function: ${node.isInnerFunction ? 'yes' : 'no'}`);
        lines.push(`File: ${node.filePath}`);

        if (callersResult.length > 0) {
          lines.push('');
          lines.push(`Callers (${callersResult.length}${callersResult.length >= 30 ? '+' : ''}):`);
          for (const c of callersResult as any[]) {
            lines.push(`  ← ${c.callerName} (${c.callerFile})`);
          }
        }

        if (stateReads.length > 0 || stateWrites.length > 0) {
          lines.push('');
          lines.push('State access:');
          if (stateReads.length > 0) lines.push(`  Reads: ${stateReads.join(', ')}`);
          if (stateWrites.length > 0) lines.push(`  Writes: ${stateWrites.join(', ')}`);
        }

        if (coChangeResult.length > 0) {
          lines.push('');
          lines.push('Temporal coupling (files that always change with this one):');
          for (const cc of coChangeResult as any[]) {
            const count = typeof cc.coChanges === 'object' ? (cc.coChanges as any).toNumber() : cc.coChanges;
            lines.push(`  ↔ ${cc.coupledFile} (${count} co-changes)`);
          }
        }

        if (verdict === 'SIMULATE_FIRST') {
          lines.push('');
          lines.push('NEXT STEP: Call simulate_edit with the modified file content before applying changes.');
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (error) {
        console.error('Pre-edit check error:', error);
        return createErrorResponse(error);
      } finally {
        await neo4jService.close();
      }
    },
  );
};
