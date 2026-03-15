/**
 * Ground Truth Hook MCP Tool (GTH-5)
 *
 * Three-panel mirror: Graph State | Agent State | Delta
 * Agents call this on boot, after compaction, and periodically.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { GroundTruthRuntime } from '../../core/ground-truth/runtime.js';
import { SoftwareGovernancePack } from '../../core/ground-truth/packs/software.js';
import { generateRecoveryAppendix } from '../../core/ground-truth/delta.js';
import { TOOL_NAMES, TOOL_METADATA } from '../constants.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';
import type { CheckTier, GroundTruthOutput } from '../../core/ground-truth/types.js';

const inputSchema = z.object({
  projectId: z.string().describe('Project ID (e.g., proj_c0d3e9a1f200)'),
  depth: z.enum(['fast', 'medium', 'full']).optional().describe('Check depth (default: fast)'),
  agentId: z.string().optional().describe('Agent ID for SessionBookmark lookup'),
  currentTaskId: z.string().optional().describe('Task currently being worked on'),
  filesTouched: z.array(z.string()).optional().describe('Files modified in current work'),
});

export const createGroundTruthTool = (server: McpServer): void => {
  server.registerTool(
    TOOL_NAMES.groundTruth,
    {
      title: TOOL_METADATA[TOOL_NAMES.groundTruth].title,
      description: TOOL_METADATA[TOOL_NAMES.groundTruth].description,
      inputSchema: inputSchema.shape,
    },
    async (args: z.infer<typeof inputSchema>) => {
      const neo4j = new Neo4jService();
      const pack = new SoftwareGovernancePack(neo4j);
      const runtime = new GroundTruthRuntime(pack, neo4j);

      try {
        const depth: CheckTier = args.depth === 'full' ? 'heavy' : (args.depth as CheckTier) ?? 'fast';

        const output = await runtime.run({
          projectId: args.projectId,
          depth,
          agentId: args.agentId,
          currentTaskId: args.currentTaskId,
          filesTouched: args.filesTouched,
        });

        return createSuccessResponse(formatOutput(output));
      } catch (error) {
        console.error('Ground truth hook error:', error);
        return createErrorResponse(error);
      } finally {
        await neo4j.close();
      }
    },
  );
};

function formatOutput(output: GroundTruthOutput): string {
  const { panel1, panel2, panel3, meta } = output;
  const lines: string[] = [];

  lines.push(`═══ GROUND TRUTH HOOK — ${meta.projectId} ═══`);
  lines.push(`Depth: ${meta.depth} | ${meta.durationMs}ms | ${meta.runAt}`);
  lines.push('');

  // Panel 1A
  lines.push('── Panel 1A: Graph State ──');
  for (const obs of panel1.planStatus) {
    const v = obs.value as any;
    if (obs.source === 'Task') {
      lines.push(`Plan: ${v.done ?? '?'}/${v.total ?? '?'} done (${v.pct ?? '?'}%)`);
    } else if (obs.source === 'Milestone') {
      const milestones = v as any[];
      const done = milestones.filter((m: any) => m.done === m.total);
      const remaining = milestones.filter((m: any) => m.done < m.total);
      lines.push(`Milestones: ${done.length} done, ${remaining.length} remaining`);
    } else if (obs.source === 'DEPENDS_ON') {
      const tasks = v as any[];
      lines.push(`Unblocked: ${tasks.length} tasks`);
      for (const t of tasks.slice(0, 5)) {
        lines.push(`  [${t.milestone}] ${t.task}`);
      }
      if (tasks.length > 5) lines.push(`  ... +${tasks.length - 5} more`);
    }
  }

  for (const obs of panel1.governanceHealth) {
    const v = obs.value as any;
    const icon = obs.freshnessState === 'fresh' ? '✅' : '⚠️';
    if (v.error) {
      lines.push(`Governance: ${icon} ${v.error}`);
    } else {
      lines.push(`Governance: ${icon} ${v.verificationRuns ?? 0} runs, ${v.gateFailures ?? 0} failures`);
    }
  }

  for (const obs of panel1.evidenceCoverage) {
    const v = obs.value as any;
    lines.push(`Evidence: ${v.withEvidence}/${v.total} done tasks (${v.pct}%)`);
  }

  // GTH-9: Contradictions
  if (panel1.contradictions && panel1.contradictions.length > 0) {
    lines.push('');
    lines.push('── Contradictions (current milestone) ──');
    for (const obs of panel1.contradictions) {
      const v = obs.value as any;
      lines.push(`  ⚡ ${v.statement} — contra: ${v.contradiction}`);
    }
  }

  // GTH-9: Open Hypotheses
  if (panel1.openHypotheses && panel1.openHypotheses.length > 0) {
    lines.push('');
    lines.push('── Open Hypotheses (current milestone) ──');
    for (const obs of panel1.openHypotheses) {
      const v = obs.value as any;
      const sev = v.severity === 'critical' ? '🔴' : v.severity === 'warning' ? '🟡' : 'ℹ️';
      lines.push(`  ${sev} [${v.domain}] ${v.name}`);
    }
  }

  // Panel 1B
  lines.push('');
  lines.push('── Panel 1B: Integrity ──');
  const { integrity } = panel1;
  lines.push(`${integrity.summary.passed}/${integrity.summary.totalChecks} checks pass`);

  const failures = [...integrity.core, ...integrity.domain].filter(f => !f.pass);
  for (const f of failures) {
    const icon = f.severity === 'critical' ? '🔴' : f.severity === 'warning' ? '🟡' : 'ℹ️';
    lines.push(`${icon} [${f.surface}] ${f.description} (${f.observedValue})`);
  }

  // Panel 2
  lines.push('');
  lines.push('── Panel 2: Agent State ──');
  lines.push(`Agent: ${panel2.agentId} | Status: ${panel2.status}`);
  if (panel2.currentTaskId) {
    lines.push(`Task: ${panel2.currentTaskId}`);
    lines.push(`Milestone: ${panel2.currentMilestone ?? '(none)'}`);
  }

  // Panel 3
  lines.push('');
  lines.push('── Panel 3: Delta ──');
  if (panel3.deltas.length === 0) {
    lines.push('No deltas detected');
  } else {
    for (const d of panel3.deltas) {
      const icon = d.severity === 'critical' ? '🔴' : d.severity === 'warning' ? '🟡' : 'ℹ️';
      lines.push(`${icon} [${d.tier}] ${d.description}`);
    }
  }

  // Recovery appendix
  const appendix = generateRecoveryAppendix(panel3.deltas);
  if (appendix.length > 0) {
    lines.push('');
    lines.push('── Recovery References ──');
    for (const ref of appendix) {
      lines.push(`  ${ref}`);
    }
  }

  return lines.join('\n');
}
