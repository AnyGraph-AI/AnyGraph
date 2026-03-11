/**
 * MCP Tool: self_audit — The graph audits itself
 * 
 * Queries drift items (tasks with code evidence but unchecked boxes),
 * generates audit questions, and accepts verdicts to update the graph.
 * 
 * Actions:
 *   - summary: Show audit status across all projects
 *   - questions: Generate audit questions for a project (or all)
 *   - verdict: Apply an audit verdict to a specific task
 */

import { z } from 'zod';
import { SelfAuditEngine, AuditVerdictRecord } from '../../core/claims/self-audit.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function createSelfAuditTool(server: McpServer): void {
  server.tool(
    'self_audit',
    'Graph self-audit: query drift items, generate verification questions, apply verdicts. ' +
    'Use action="summary" for overview, "questions" to get audit tasks for agents, ' +
    '"verdict" to record a verification result.',
    {
      action: z.enum(['summary', 'questions', 'verdict']).describe(
        'summary = audit status overview; questions = generate agent prompts; verdict = apply a verification result'
      ),
      projectName: z.string().optional().describe('Filter to specific project (e.g., "codegraph", "godspeed")'),
      // For verdict action:
      taskId: z.string().optional().describe('Task ID for verdict'),
      verdictType: z.enum(['CONFIRMED', 'FALSE_POSITIVE', 'PARTIAL']).optional(),
      confidence: z.number().min(0).max(1).optional().describe('Confidence in verdict (0.0-1.0)'),
      reasoning: z.string().optional().describe('Why this verdict'),
      missingParts: z.array(z.string()).optional().describe('For PARTIAL: what aspects are missing'),
      implementedBy: z.array(z.string()).optional().describe('Function names that implement the task'),
    },
    async (args) => {
      const engine = new SelfAuditEngine();
      
      try {
        if (args.action === 'summary') {
          const summary = await engine.getAuditSummary();
          let text = `🔍 Self-Audit: ${summary.total} drift items\n\n`;
          
          for (const [proj, stats] of Object.entries(summary.byProject)) {
            const audited = stats.audited > 0 
              ? `${stats.audited} audited (${stats.confirmed}✅ ${stats.falsePositive}❌ ${stats.partial}⚠️)`
              : 'not yet audited';
            text += `${proj}: ${stats.drift} drift — ${audited}\n`;
          }
          
          return { content: [{ type: 'text', text }] };
          
        } else if (args.action === 'questions') {
          // Map projectName to planProjectId
          let planProjectId: string | undefined;
          if (args.projectName) {
            planProjectId = `plan_${args.projectName.replace(/-/g, '_')}`;
          }
          
          const { questions } = await engine.generateAgentPrompts(planProjectId);
          
          if (questions.length === 0) {
            return { content: [{ type: 'text', text: 'No drift items to audit.' }] };
          }
          
          let text = `📋 ${questions.length} audit questions generated\n\n`;
          for (const q of questions) {
            text += `---\n**Task**: ${q.driftItem.taskName}\n`;
            text += `**ID**: ${q.driftItem.taskId}\n`;
            text += `**Project**: ${q.driftItem.projectName}\n`;
            text += `**Matched functions**: ${q.driftItem.matchedFunctions.map(f => f.name).join(', ')}\n`;
            text += `**Files to read**: ${q.filesToRead.join(', ')}\n`;
            text += `**Match type**: ${q.driftItem.matchedFunctions[0]?.refType || 'unknown'}\n\n`;
          }
          
          return { content: [{ type: 'text', text }] };
          
        } else if (args.action === 'verdict') {
          if (!args.taskId || !args.verdictType || !args.reasoning) {
            return { content: [{ type: 'text', text: 'Error: verdict requires taskId, verdictType, and reasoning' }] };
          }
          
          const verdict: AuditVerdictRecord = {
            taskId: args.taskId,
            verdict: args.verdictType,
            confidence: args.confidence ?? 0.8,
            reasoning: args.reasoning,
            missingParts: args.missingParts,
            implementedBy: args.implementedBy,
          };
          
          await engine.applyVerdict(verdict);
          
          const emoji = verdict.verdict === 'CONFIRMED' ? '✅' : verdict.verdict === 'FALSE_POSITIVE' ? '❌' : '⚠️';
          return { content: [{ type: 'text', text: `${emoji} Verdict applied: ${verdict.verdict} for task ${args.taskId}\n${args.reasoning}` }] };
        }
        
        return { content: [{ type: 'text', text: 'Unknown action' }] };
      } finally {
        await engine.close();
      }
    }
  );
}
