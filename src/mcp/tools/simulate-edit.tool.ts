/**
 * Simulate Edit Tool
 * Shows the graph delta of a proposed code change BEFORE applying it.
 */

import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { CORE_TYPESCRIPT_SCHEMA } from '../../core/config/schema.js';
import { TypeScriptParser } from '../../core/parsers/typescript-parser.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { TOOL_NAMES, TOOL_METADATA } from '../constants.js';
import { createErrorResponse, createSuccessResponse, debugLog, resolveProjectIdOrError } from '../utils.js';

interface GraphNode {
  name: string;
  type: string;
  isExported: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
}

const inputSchema = z.object({
  projectId: z.string().describe('Project ID, name, or path'),
  filePath: z.string().describe('Absolute path to the file being modified'),
  modifiedContent: z.string().describe('Full content of the modified file'),
});

export const createSimulateEditTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.simulateEdit,
    {
      title: TOOL_METADATA[TOOL_NAMES.simulateEdit].title,
      description: TOOL_METADATA[TOOL_NAMES.simulateEdit].description,
      inputSchema: inputSchema.shape,
    },
    async (args: z.infer<typeof inputSchema>) => {
      const neo4jService = new Neo4jService();

      try {
        const { filePath, modifiedContent } = args;

        await debugLog('Simulate edit started', { filePath });

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

        const fileName = basename(filePath);

        // 1. Get current graph state for this file
        const currentNodesResult = await neo4jService.run(`
          MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(n)
          WHERE sf.filePath ENDS WITH $fileName OR sf.filePath = $filePath
          RETURN n.name AS name, labels(n) AS labels, n.isExported AS isExported
        `, { pid: projectId, fileName, filePath });

        const currentNodes: GraphNode[] = currentNodesResult.map((r: any) => ({
          name: r.name,
          type: r.labels.filter((l: string) => !['CodeNode', 'TypeScript', 'Embedded'].includes(l))[0] || 'Unknown',
          isExported: r.isExported ?? false,
        }));

        const currentCallsResult = await neo4jService.run(`
          MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(caller)-[:CALLS]->(callee)
          WHERE sf.filePath ENDS WITH $fileName OR sf.filePath = $filePath
          RETURN caller.name AS source, callee.name AS target
        `, { pid: projectId, fileName, filePath });

        const currentCalls: GraphEdge[] = currentCallsResult.map((r: any) => ({
          source: r.source,
          target: r.target,
        }));

        // Get external callers into this file
        const externalCallersResult = await neo4jService.run(`
          MATCH (caller)-[:CALLS]->(callee)
          MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(callee)
          WHERE (sf.filePath ENDS WITH $fileName OR sf.filePath = $filePath)
          AND NOT (sf)-[:CONTAINS]->(caller)
          RETURN DISTINCT caller.name AS caller, caller.filePath AS callerFile, callee.name AS target
        `, { pid: projectId, fileName, filePath });

        const externalCallers = externalCallersResult.map((r: any) => ({
          caller: r.caller,
          callerFile: r.callerFile,
          target: r.target,
        }));

        // 2. Parse modified content (temporarily swap file)
        const originalContent = readFileSync(filePath, 'utf-8');
        let parseResult: any;

        try {
          writeFileSync(filePath, modifiedContent);
          const parser = new TypeScriptParser(
            projectPath, 'tsconfig.json', CORE_TYPESCRIPT_SCHEMA,
            [], undefined, projectId,
          );
          parseResult = await (parser as any).parseChunk([filePath]);
        } finally {
          writeFileSync(filePath, originalContent);
        }

        // 3. Extract new nodes and calls
        const newNodes: GraphNode[] = (parseResult.nodes || [])
          .filter((n: any) => n.properties?.filePath?.endsWith(fileName))
          .map((n: any) => ({
            name: n.properties.name,
            type: n.labels?.filter((l: string) => l !== 'CodeNode' && l !== 'TypeScript')[0] || 'Unknown',
            isExported: n.properties.isExported ?? false,
          }));

        const newCalls: GraphEdge[] = (parseResult.edges || [])
          .filter((e: any) => e.type === 'CALLS')
          .map((e: any) => {
            const src = (parseResult.nodes || []).find((n: any) => n.properties?.id === (e.startNodeId || e.sourceId));
            const tgt = (parseResult.nodes || []).find((n: any) => n.properties?.id === (e.endNodeId || e.targetId));
            return {
              source: src?.properties?.name || '?',
              target: tgt?.properties?.name || '?',
            };
          });

        // 4. Compute deltas
        const currentNodeKeys = new Set(currentNodes.map(n => `${n.type}:${n.name}`));
        const newNodeKeys = new Set(newNodes.map(n => `${n.type}:${n.name}`));

        const nodesAdded = newNodes.filter(n => !currentNodeKeys.has(`${n.type}:${n.name}`));
        const nodesRemoved = currentNodes.filter(n => !newNodeKeys.has(`${n.type}:${n.name}`));

        // Export changes
        const currentExports = new Set(currentNodes.filter(n => n.isExported).map(n => n.name));
        const newExports = new Set(newNodes.filter(n => n.isExported).map(n => n.name));
        const exportsAdded = [...newExports].filter(e => !currentExports.has(e));
        const exportsRemoved = [...currentExports].filter(e => !newExports.has(e));

        // Modified nodes (same name, different export status)
        const nodesModified: string[] = [];
        for (const nn of newNodes) {
          const old = currentNodes.find(cn => cn.name === nn.name && cn.type === nn.type);
          if (old && old.isExported !== nn.isExported) {
            nodesModified.push(`${nn.name}: export ${old.isExported} → ${nn.isExported}`);
          }
        }

        // CALLS diff
        const currentCallKeys = new Set(currentCalls.map(c => `${c.source}→${c.target}`));
        const newCallKeys = new Set(newCalls.map(c => `${c.source}→${c.target}`));
        const callsAdded = newCalls.filter(c => !currentCallKeys.has(`${c.source}→${c.target}`));
        const callsRemoved = currentCalls.filter(c => !newCallKeys.has(`${c.source}→${c.target}`));

        // Broken callers
        const removedNames = new Set([...nodesRemoved.map(n => n.name), ...exportsRemoved]);
        const brokenCallers = externalCallers.filter(ec => removedNames.has(ec.target));

        // 5. Risk assessment
        let changeScope: string;
        let reason: string;
        const affectedFiles = new Set(brokenCallers.map(bc => bc.callerFile)).size;

        if (brokenCallers.length > 0) {
          changeScope = 'CRITICAL';
          reason = `${brokenCallers.length} external callers will break across ${affectedFiles} files`;
        } else if (exportsRemoved.length > 0) {
          changeScope = 'DANGEROUS';
          reason = `${exportsRemoved.length} exports removed`;
        } else if (nodesRemoved.length > 0 || callsRemoved.length > 5) {
          changeScope = 'CAUTION';
          reason = `${nodesRemoved.length} nodes removed, ${callsRemoved.length} calls removed`;
        } else {
          changeScope = 'SAFE';
          reason = 'No external impact detected';
        }

        const icon = { SAFE: '✅', CAUTION: '⚠️', DANGEROUS: '🔶', CRITICAL: '🔴' }[changeScope] || '❓';

        // 6. Format output
        const lines: string[] = [
          `${icon} EDIT SIMULATION: ${changeScope}`,
          `${reason}`,
          `File: ${filePath}`,
          '',
        ];

        if (nodesAdded.length > 0) {
          lines.push(`ADDED (${nodesAdded.length}):`);
          for (const n of nodesAdded.filter(n => n.type !== 'Parameter' && n.type !== 'SourceFile')) {
            lines.push(`  + ${n.type} ${n.name}${n.isExported ? ' (exported)' : ''}`);
          }
        }

        if (nodesRemoved.length > 0) {
          lines.push(`REMOVED (${nodesRemoved.length}):`);
          for (const n of nodesRemoved.filter(n => n.type !== 'Parameter' && n.type !== 'Import')) {
            lines.push(`  - ${n.type} ${n.name}${n.isExported ? ' (exported)' : ''}`);
          }
        }

        if (nodesModified.length > 0) {
          lines.push(`MODIFIED:`);
          for (const m of nodesModified) {
            lines.push(`  ~ ${m}`);
          }
        }

        if (callsAdded.length > 0) {
          lines.push(`CALLS ADDED (${callsAdded.length}):`);
          for (const c of callsAdded.slice(0, 10)) {
            lines.push(`  + ${c.source} → ${c.target}`);
          }
          if (callsAdded.length > 10) lines.push(`  ... and ${callsAdded.length - 10} more`);
        }

        if (callsRemoved.length > 0) {
          lines.push(`CALLS REMOVED (${callsRemoved.length}):`);
          for (const c of callsRemoved.slice(0, 10)) {
            lines.push(`  - ${c.source} → ${c.target}`);
          }
          if (callsRemoved.length > 10) lines.push(`  ... and ${callsRemoved.length - 10} more`);
        }

        if (exportsAdded.length > 0) lines.push(`EXPORTS ADDED: ${exportsAdded.join(', ')}`);
        if (exportsRemoved.length > 0) lines.push(`EXPORTS REMOVED: ${exportsRemoved.join(', ')}`);

        if (brokenCallers.length > 0) {
          lines.push(`BROKEN CALLERS (${brokenCallers.length}):`);
          for (const bc of brokenCallers) {
            lines.push(`  💥 ${bc.caller} (${bc.callerFile}) → removed ${bc.target}`);
          }
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (error) {
        console.error('Simulate edit error:', error);
        return createErrorResponse(error);
      } finally {
        await neo4jService.close();
      }
    },
  );
};
