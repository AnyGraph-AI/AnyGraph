import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createVerificationDashboardTools(server: McpServer) {
  const neo4j = new Neo4jService();

  // 1. Verification Dashboard — unified view of advisory gate + anti-gaming + calibration + debt
  server.tool(
    'verification_dashboard',
    `Unified verification layer dashboard. Shows advisory gate decisions, anti-gaming status, calibration metrics (Brier/ECE), confidence debt, and source family distribution. Single tool for complete trust/confidence overview.`,
    {
      projectId: z.string().optional().describe('Project ID (default: proj_c0d3e9a1f200)'),
    },
    async (args) => {
      try {
        const pid = args.projectId ?? 'proj_c0d3e9a1f200';
        const lines: string[] = [];
        lines.push('# 🔍 Verification Dashboard\n');
        lines.push(`**Project:** ${pid}\n`);

        // Advisory gate summary
        const gateRows = await neo4j.run(
          `MATCH (d:AdvisoryGateDecision {projectId: $pid})
           RETURN d.outcome AS outcome, count(d) AS cnt ORDER BY cnt DESC`,
          { pid },
        );
        lines.push('## Advisory Gate');
        if (gateRows.length === 0) {
          lines.push('- No gate decisions found');
        } else {
          const total = gateRows.reduce((s, r) => s + toNum(r.cnt), 0);
          for (const r of gateRows) {
            lines.push(`- ${r.outcome}: ${toNum(r.cnt)} (${((toNum(r.cnt) / total) * 100).toFixed(1)}%)`);
          }
          lines.push(`- Total: ${total}`);
        }

        // Source family distribution
        const familyRows = await neo4j.run(
          `MATCH (vr:VerificationRun {projectId: $pid})
           WHERE vr.tool IS NOT NULL
           RETURN vr.tool AS tool, vr.status AS status, count(vr) AS cnt,
                  avg(CASE WHEN vr.confidence IS NOT NULL THEN vr.confidence ELSE null END) AS avgConf
           ORDER BY cnt DESC`,
          { pid },
        );
        lines.push('\n## Source Families');
        if (familyRows.length === 0) {
          lines.push('- No verification runs found');
        } else {
          for (const r of familyRows) {
            const conf = r.avgConf !== null ? ` (avg confidence: ${toNum(r.avgConf).toFixed(3)})` : '';
            lines.push(`- ${r.tool} [${r.status}]: ${toNum(r.cnt)}${conf}`);
          }
        }

        // Anti-gaming: source family cap status
        const capRows = await neo4j.run(
          `MATCH (vr:VerificationRun {projectId: $pid})
           WHERE vr.sourceFamilyCapped IS NOT NULL
           RETURN vr.sourceFamilyCapped AS capped, count(vr) AS cnt`,
          { pid },
        );
        lines.push('\n## Anti-Gaming');
        if (capRows.length === 0) {
          lines.push('- No cap data (sourceFamilyCapped not stamped)');
        } else {
          for (const r of capRows) {
            lines.push(`- Capped=${r.capped}: ${toNum(r.cnt)}`);
          }
        }

        // Calibration metrics
        const calRows = await neo4j.run(
          `MATCH (mr:MetricResult)
           WHERE mr.metric IN ['brierScore', 'ece', 'calibrationEligible']
           RETURN mr.metric AS metric, mr.value AS value ORDER BY mr.metric`,
          {},
        );
        lines.push('\n## Calibration');
        if (calRows.length === 0) {
          lines.push('- No calibration metrics found');
        } else {
          for (const r of calRows) {
            lines.push(`- ${r.metric}: ${toNum(r.value).toFixed(4)}`);
          }
        }

        // Confidence debt
        const debtRows = await neo4j.run(
          `MATCH (vr:VerificationRun {projectId: $pid})
           WHERE vr.confidenceDebt IS NOT NULL AND vr.confidenceDebt > 0
           RETURN count(vr) AS withDebt, avg(vr.confidenceDebt) AS avgDebt, max(vr.confidenceDebt) AS maxDebt`,
          { pid },
        );
        lines.push('\n## Confidence Debt');
        if (debtRows.length === 0 || toNum(debtRows[0].withDebt) === 0) {
          lines.push('- No confidence debt detected');
        } else {
          const r = debtRows[0];
          lines.push(`- Runs with debt: ${toNum(r.withDebt)}`);
          lines.push(`- Avg debt: ${toNum(r.avgDebt).toFixed(4)}`);
          lines.push(`- Max debt: ${toNum(r.maxDebt).toFixed(4)}`);
        }

        // TC coverage
        const tcRows = await neo4j.run(
          `MATCH (vr:VerificationRun {projectId: $pid})
           RETURN count(vr) AS total,
                  sum(CASE WHEN vr.timeConsistencyFactor IS NOT NULL THEN 1 ELSE 0 END) AS withTCF`,
          { pid },
        );
        lines.push('\n## Temporal Confidence');
        if (tcRows.length > 0) {
          lines.push(`- TC coverage: ${toNum(tcRows[0].withTCF)}/${toNum(tcRows[0].total)}`);
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err) {
        return createErrorResponse(`Verification dashboard error: ${err}`);
      }
    },
  );

  // 2. Explainability paths — discover and query influence paths
  server.tool(
    'explainability_paths',
    `Discover and query explainability/influence paths for a verification run or claim. Shows how evidence supports or contradicts findings.`,
    {
      projectId: z.string().optional().describe('Project ID (default: proj_c0d3e9a1f200)'),
      targetId: z.string().optional().describe('Specific VerificationRun or Claim ID to explain'),
      limit: z.number().int().positive().max(50).optional().describe('Max paths to return (default: 10)'),
    },
    async (args) => {
      try {
        const pid = args.projectId ?? 'proj_c0d3e9a1f200';
        const limit = args.limit ?? 10;
        const lines: string[] = [];
        lines.push('# 🔗 Explainability Paths\n');

        if (args.targetId) {
          const paths = await neo4j.run(
            `MATCH (ip:InfluencePath {projectId: $pid})
             WHERE ip.targetId = $targetId
             RETURN ip.pathHash AS hash, ip.pathWeight AS weight, ip.rank AS rank,
                    ip.sourceId AS source, ip.targetId AS target, ip.pathType AS type
             ORDER BY ip.rank LIMIT $limit`,
            { pid, targetId: args.targetId, limit },
          );
          lines.push(`**Target:** ${args.targetId}`);
          lines.push(`**Paths found:** ${paths.length}\n`);
          for (const p of paths) {
            lines.push(`- Rank ${toNum(p.rank)}: ${p.type ?? 'unknown'} (weight: ${toNum(p.weight).toFixed(4)}) ${p.source} → ${p.target}`);
          }
        } else {
          // Summary: path statistics
          const stats = await neo4j.run(
            `MATCH (ip:InfluencePath {projectId: $pid})
             RETURN count(ip) AS total, avg(ip.pathWeight) AS avgWeight,
                    collect(DISTINCT ip.pathType) AS types`,
            { pid },
          );
          if (stats.length > 0) {
            lines.push(`- Total paths: ${toNum(stats[0].total)}`);
            lines.push(`- Avg weight: ${toNum(stats[0].avgWeight).toFixed(4)}`);
            lines.push(`- Path types: ${(stats[0].types as string[])?.join(', ') ?? 'none'}`);
          } else {
            lines.push('- No influence paths found');
          }
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err) {
        return createErrorResponse(`Explainability paths error: ${err}`);
      }
    },
  );

  // 3. Confidence debt dashboard
  server.tool(
    'confidence_debt_dashboard',
    `Shows confidence debt breakdown by source family, tool, and severity. Highlights findings that need more evidence to reach required confidence levels.`,
    {
      projectId: z.string().optional().describe('Project ID (default: proj_c0d3e9a1f200)'),
    },
    async (args) => {
      try {
        const pid = args.projectId ?? 'proj_c0d3e9a1f200';
        const lines: string[] = [];
        lines.push('# 📊 Confidence Debt Dashboard\n');

        const rows = await neo4j.run(
          `MATCH (vr:VerificationRun {projectId: $pid})
           WHERE vr.effectiveConfidence IS NOT NULL
           WITH vr.tool AS tool, vr.status AS status,
                avg(vr.effectiveConfidence) AS avgEC,
                min(vr.effectiveConfidence) AS minEC,
                max(vr.effectiveConfidence) AS maxEC,
                count(vr) AS cnt,
                sum(CASE WHEN vr.effectiveConfidence < 0.5 THEN 1 ELSE 0 END) AS lowConf
           RETURN tool, status, avgEC, minEC, maxEC, cnt, lowConf
           ORDER BY avgEC ASC`,
          { pid },
        );

        if (rows.length === 0) {
          lines.push('- No confidence data found');
        } else {
          for (const r of rows) {
            lines.push(`## ${r.tool} [${r.status}]`);
            lines.push(`- Count: ${toNum(r.cnt)}`);
            lines.push(`- Effective Confidence: avg=${toNum(r.avgEC).toFixed(4)}, min=${toNum(r.minEC).toFixed(4)}, max=${toNum(r.maxEC).toFixed(4)}`);
            lines.push(`- Low confidence (<0.5): ${toNum(r.lowConf)}`);
            lines.push('');
          }
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err) {
        return createErrorResponse(`Confidence debt dashboard error: ${err}`);
      }
    },
  );

  // 4. SARIF import tool
  server.tool(
    'import_sarif',
    `Import SARIF (Static Analysis Results Interchange Format) files from CodeQL, Semgrep, ESLint, or other tools into the verification graph. Creates VerificationRun and finding nodes.`,
    {
      filePath: z.string().describe('Path to .sarif or .sarif.json file'),
      projectId: z.string().optional().describe('Project ID (default: proj_c0d3e9a1f200)'),
      tool: z.string().optional().describe('Override tool name (auto-detected from SARIF if omitted)'),
    },
    async (args) => {
      try {
        const { importSarifToVerificationBundle } = await import('../../core/verification/sarif-importer.js');
        const { ingestVerificationFoundation } = await import('../../core/verification/verification-ingest.js');
        const svc = new Neo4jService();
        try {
          const toolFilter = (args.tool === 'semgrep' ? 'semgrep' : args.tool === 'codeql' ? 'codeql' : 'any') as 'codeql' | 'semgrep' | 'any';
          const bundle = await importSarifToVerificationBundle({
            sarifPath: args.filePath,
            projectId: args.projectId ?? 'proj_c0d3e9a1f200',
            toolFilter,
          });
          const ingestResult = await ingestVerificationFoundation(bundle);
          return createSuccessResponse(
            `# SARIF Import Complete\n\n` +
            `- File: ${args.filePath}\n` +
            `- Verification Runs: ${bundle.verificationRuns.length}\n` +
            `- Analysis Scopes: ${bundle.analysisScopes.length}\n` +
            `- Adjudications: ${bundle.adjudications.length}\n` +
            `- Ingested: ${JSON.stringify(ingestResult)}\n`,
          );
        } finally {
          await svc.close();
        }
      } catch (err) {
        return createErrorResponse(`SARIF import error: ${err}`);
      }
    },
  );
}
