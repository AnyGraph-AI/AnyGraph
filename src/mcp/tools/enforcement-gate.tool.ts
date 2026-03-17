/**
 * RF-2: Enforcement Gate MCP Tool
 *
 * MCP tool: enforceEdit
 * Takes file paths (from git diff or agent edit), resolves affected nodes
 * from the graph, evaluates the enforcement gate, returns decision.
 *
 * Pattern from: simulate-edit.tool.ts, pre-edit-check.tool.ts
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import {
  evaluateEnforcementGate,
  DEFAULT_CONFIG,
  type EnforcementGateConfig,
  type GateMode,
} from '../../core/enforcement/enforcement-gate.js';
import { resolveAffectedNodes, resolveBlastRadius } from '../../core/enforcement/graph-resolver.js';

const inputSchema = z.object({
  filePaths: z.array(z.string()).describe('File paths being edited (absolute or relative to project root)'),
  projectId: z.string().optional().describe('Project ID (auto-detected if omitted)'),
  mode: z.enum(['advisory', 'assisted', 'enforced']).optional().describe('Gate mode (default: from config)'),
  includeBlastRadius: z.boolean().optional().describe('Include downstream impact analysis (default: false)'),
  maxBlastDepth: z.number().optional().describe('Max CALLS depth for blast radius (default: 3)'),
});

export const createEnforcementGateTool = (server: McpServer, defaultProjectId?: string) => {
  server.tool(
    'enforceEdit',
    'RF-2 Enforcement Gate: evaluate whether file edits should be allowed, require approval, or be blocked based on graph risk analysis. Returns ALLOW/REQUIRE_APPROVAL/BLOCK with affected CRITICAL functions and test coverage status.',
    inputSchema.shape,
    async (args) => {
      const { filePaths, mode, includeBlastRadius, maxBlastDepth } = args;
      const projectId = (args.projectId as string) || defaultProjectId || 'proj_c0d3e9a1f200';

      const neo4j = new Neo4jService();
      try {
        // 1. Resolve affected nodes from graph
        const affectedNodes = await resolveAffectedNodes(neo4j, filePaths as string[], projectId);

        // 2. Optional blast radius
        let blastRadiusNodes: Awaited<ReturnType<typeof resolveBlastRadius>> = [];
        if (includeBlastRadius) {
          const functionIds = affectedNodes.map(n => n.id);
          blastRadiusNodes = await resolveBlastRadius(
            neo4j,
            functionIds,
            projectId,
            (maxBlastDepth as number) || 3,
          );
        }

        // 3. Build config
        const config: EnforcementGateConfig = {
          ...DEFAULT_CONFIG,
          mode: (mode as GateMode) || DEFAULT_CONFIG.mode,
        };

        // 4. Evaluate gate
        const result = evaluateEnforcementGate(config, affectedNodes);

        // 5. Format response
        const lines: string[] = [];
        lines.push(`## Enforcement Gate Result: ${result.decision}`);
        lines.push('');
        lines.push(`**Mode:** ${config.mode}`);
        lines.push(`**Reason:** ${result.reason}`);
        lines.push(`**Decision Hash:** ${result.decisionHash}`);
        lines.push('');

        // Risk summary
        lines.push('### Risk Summary');
        lines.push(`- Total affected functions: ${result.riskSummary.totalAffected}`);
        lines.push(`- CRITICAL: ${result.riskSummary.criticalCount}`);
        lines.push(`- HIGH: ${result.riskSummary.highCount}`);
        lines.push(`- Untested CRITICAL: ${result.riskSummary.untestedCriticalCount}`);
        lines.push(`- Max composite risk: ${result.riskSummary.maxCompositeRisk.toFixed(3)}`);
        lines.push('');

        // Affected nodes
        if (affectedNodes.length > 0) {
          lines.push('### Affected Functions');
          for (const node of affectedNodes) {
            const testIcon = node.hasTests ? '✅' : '⚠️';
            lines.push(`- ${testIcon} **${node.name}** (${node.riskTier}, ${node.compositeRisk.toFixed(3)}) — ${node.filePath}`);
          }
          lines.push('');
        }

        // Approval requirement
        if (result.approvalRequired) {
          lines.push('### Approval Required');
          lines.push(`- **Approver:** ${result.approvalRequired.requiredApprover}`);
          lines.push(`- **Critical functions:** ${result.approvalRequired.affectedCriticalNodes.join(', ')}`);
          if (result.approvalRequired.expiresAt) {
            lines.push(`- **Expires:** ${result.approvalRequired.expiresAt}`);
          }
          lines.push('');
        }

        // Blast radius
        if (blastRadiusNodes.length > 0) {
          lines.push('### Blast Radius (downstream impact)');
          lines.push(`${blastRadiusNodes.length} additional functions affected via CALLS edges:`);
          for (const node of blastRadiusNodes.slice(0, 20)) {
            lines.push(`- **${node.name}** (${node.riskTier}, ${node.compositeRisk.toFixed(3)})`);
          }
          if (blastRadiusNodes.length > 20) {
            lines.push(`- ... and ${blastRadiusNodes.length - 20} more`);
          }
          lines.push('');
        }

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n'),
          }],
        };
      } finally {
        await neo4j.close();
      }
    },
  );
};
