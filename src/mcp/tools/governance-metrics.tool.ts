import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import {
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST,
  CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND,
} from '../../utils/query-contract.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStr(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function createGovernanceMetricsStatusTool(server: McpServer) {
  const neo4j = new Neo4jService();

  server.tool(
    'governance_metrics_status',
    'Shows latest governance metric snapshot (and optional trend) including interception rate and regression interception counters.',
    {
      projectId: z.string().optional().describe('Runtime project id (default: proj_c0d3e9a1f200)'),
      mode: z.enum(['latest', 'trend']).optional().describe('latest = one snapshot, trend = series'),
      limit: z.number().int().positive().max(200).optional().describe('For trend mode, return the last N points (default: 20)'),
    },
    async (args) => {
      try {
        const projectId = args.projectId ?? 'proj_c0d3e9a1f200';
        const mode = args.mode ?? 'latest';

        if (mode === 'trend') {
          const rows = await neo4j.run(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND, { projectId });
          const limit = args.limit ?? 20;
          const sliced = rows.slice(Math.max(0, rows.length - limit));

          const lines: string[] = [];
          lines.push('# 📈 Governance Metrics Trend\n');
          lines.push(`- Project: ${projectId}`);
          lines.push(`- Points returned: ${sliced.length}/${rows.length}`);

          if (sliced.length === 0) {
            lines.push('\n- No metric snapshots found.');
            return createSuccessResponse(lines.join('\n'));
          }

          lines.push('\n## Series');
          for (const row of sliced as Array<Record<string, unknown>>) {
            lines.push(
              `- ${toStr(row.timestamp)} | interception=${toNum(row.interceptionRate).toFixed(4)} | gateFailures=${toNum(row.gateFailures)} | resolvedBeforeCommit=${toNum(row.failuresResolvedBeforeCommit)} | regressionsAfterMerge=${toNum(row.regressionsAfterMerge)} | meanRecoveryRuns=${toNum(row.meanRecoveryRuns).toFixed(2)}`,
            );
          }

          return createSuccessResponse(lines.join('\n'));
        }

        const rows = await neo4j.run(CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST, { projectId });
        const row = rows[0] as Record<string, unknown> | undefined;

        if (!row) {
          return createErrorResponse(`No GovernanceMetricSnapshot found for project ${projectId}.`);
        }

        const lines: string[] = [];
        lines.push('# 🧭 Governance Metrics (Latest)\n');
        lines.push(`- Project: ${projectId}`);
        lines.push(`- Snapshot: ${toStr(row.id)}`);
        lines.push(`- Timestamp: ${toStr(row.timestamp)}`);
        lines.push(`- Window: ${toStr(row.snapshotWindow)}`);
        lines.push(`- Schema: ${toStr(row.schemaVersion)}`);

        lines.push('\n## Interception');
        lines.push(`- verificationRuns: ${toNum(row.verificationRuns)}`);
        lines.push(`- gateFailures: ${toNum(row.gateFailures)}`);
        lines.push(`- failuresResolvedBeforeCommit: ${toNum(row.failuresResolvedBeforeCommit)}`);
        lines.push(`- regressionsAfterMerge: ${toNum(row.regressionsAfterMerge)}`);
        lines.push(`- interceptionRate: ${toNum(row.interceptionRate).toFixed(6)}`);

        lines.push('\n## Quality Signals');
        lines.push(`- invariantViolations: ${toNum(row.invariantViolations)}`);
        lines.push(`- falseCompletionEvents: ${toNum(row.falseCompletionEvents)}`);
        lines.push(`- meanRecoveryRuns: ${toNum(row.meanRecoveryRuns).toFixed(4)}`);

        return createSuccessResponse(lines.join('\n'));
      } catch (error) {
        return createErrorResponse(error instanceof Error ? error.message : String(error));
      }
    },
  );
}
