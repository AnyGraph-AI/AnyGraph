/**
 * Claim Layer MCP Tools
 * 
 * claim_status — Overview of claims by domain and type
 * evidence_for — Supporting/contradicting evidence for a claim or topic
 * contradictions — Claims with high contradiction weight
 * hypotheses — Auto-generated investigation targets from evidence gaps
 * claim_generate — Trigger claim generation pipeline
 * claim_chain_path — Visualize cross-domain claim chain paths (code → plan → document)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import neo4j from 'neo4j-driver';

import { ClaimEngine } from '../../core/claims/claim-engine.js';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';

function num(val: any): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  if (val.toNumber) return val.toNumber();
  return Number(val) || 0;
}

function str(val: any): string {
  if (val == null) return '';
  return String(val);
}

// ============================================================================
// claim_status — Overview
// ============================================================================

export function createClaimStatusTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'claim_status',
    'Overview of all claims in the graph — counts by domain, type, status, and confidence distribution. ' +
    'Shows how many claims are supported vs contested vs refuted.',
    {
      domain: z.enum(['code', 'plan', 'corpus', 'document', 'all']).optional()
        .describe('Filter by domain (default: all)'),
    },
    async (args) => {
      try {
        const domainFilter = args.domain && args.domain !== 'all'
          ? 'WHERE c.domain = $domain'
          : '';
        const params: Record<string, any> = args.domain && args.domain !== 'all'
          ? { domain: args.domain }
          : {};

        const lines: string[] = ['# 🧠 Claim Layer Status\n'];

        // Summary by domain
        const byDomain = await neo4jService.run(
          `MATCH (c:Claim) ${domainFilter}
           RETURN c.domain AS domain,
                  count(c) AS total,
                  count(CASE WHEN c.status = 'supported' THEN 1 END) AS supported,
                  count(CASE WHEN c.status = 'contested' THEN 1 END) AS contested,
                  count(CASE WHEN c.status = 'asserted' THEN 1 END) AS asserted,
                  count(CASE WHEN c.status = 'refuted' THEN 1 END) AS refuted,
                  round(avg(c.confidence) * 100) / 100.0 AS avgConf
           ORDER BY domain`,
          params,
        );

        for (const row of byDomain) {
          const domain = str(row.domain);
          const emoji = domain === 'code' ? '💻' : domain === 'plan' ? '📋' : domain === 'corpus' ? '📚' : '📄';
          lines.push(`## ${emoji} ${domain}`);
          lines.push(`Total: ${num(row.total)} claims (avg confidence: ${num(row.avgConf)})`);
          lines.push(`  ✅ Supported: ${num(row.supported)} | ⚠️ Contested: ${num(row.contested)} | 📝 Asserted: ${num(row.asserted)} | ❌ Refuted: ${num(row.refuted)}`);
          lines.push('');
        }

        // By claim type
        const byType = await neo4jService.run(
          `MATCH (c:Claim) ${domainFilter}
           RETURN c.claimType AS type, count(c) AS cnt, round(avg(c.confidence) * 100) / 100.0 AS avgConf
           ORDER BY cnt DESC`,
          params,
        );

        lines.push('## By Type');
        for (const row of byType) {
          lines.push(`- **${str(row.type)}**: ${num(row.cnt)} claims (avg conf: ${num(row.avgConf)})`);
        }
        lines.push('');

        // Evidence + hypothesis counts
        const counts = await neo4jService.run(
          `OPTIONAL MATCH (e:Evidence)
           WITH count(e) AS evCount
           OPTIONAL MATCH (h:Hypothesis)
           RETURN evCount, count(h) AS hypCount`,
        );
        if (counts.length > 0) {
          lines.push(`📊 Evidence nodes: ${num(counts[0].evCount)}`);
          lines.push(`💡 Hypotheses: ${num(counts[0].hypCount)}`);
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

// ============================================================================
// evidence_for — Evidence for a claim or topic
// ============================================================================

export function createEvidenceForTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'evidence_for',
    'Find supporting and contradicting evidence for a specific claim or search by topic. ' +
    'Returns evidence nodes with grades (A1/A2/A3), weights, and relationship type.',
    {
      query: z.string().describe('Claim ID, or text to search claim statements for'),
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
    async (args) => {
      try {
        const limit = neo4j.int(args.limit || 20);
        const lines: string[] = ['# 🔍 Evidence Report\n'];

        // Try exact claim ID first, then text search
        const claims = await neo4jService.run(
          `MATCH (c:Claim)
           WHERE c.id = $q OR toLower(c.statement) CONTAINS toLower($q)
           RETURN c.id AS id, c.statement AS statement, c.confidence AS conf, c.domain AS domain, c.status AS status
           LIMIT $limit`,
          { q: args.query, limit },
        );

        if (claims.length === 0) {
          lines.push(`No claims found matching "${args.query}"`);
          return createSuccessResponse(lines.join('\n'));
        }

        for (const claim of claims) {
          const id = str(claim.id);
          const conf = num(claim.conf);
          const statusEmoji = claim.status === 'supported' ? '✅' : claim.status === 'contested' ? '⚠️' : '📝';
          lines.push(`## ${statusEmoji} ${str(claim.statement)}`);
          lines.push(`Confidence: ${conf} | Domain: ${str(claim.domain)} | Status: ${str(claim.status)}\n`);

          // Supporting evidence
          const supports = await neo4jService.run(
            `MATCH (c:Claim {id: $id})-[r:SUPPORTED_BY]->(e:Evidence)
             RETURN e.source AS source, e.grade AS grade, r.weight AS weight, e.description AS desc
             ORDER BY r.weight DESC`,
            { id },
          );
          if (supports.length > 0) {
            lines.push('### ✅ Supporting Evidence');
            for (const ev of supports) {
              lines.push(`- [${str(ev.grade)}] (w=${num(ev.weight)}) ${str(ev.description)}`);
            }
            lines.push('');
          }

          // Contradicting evidence
          const contradicts = await neo4jService.run(
            `MATCH (c:Claim {id: $id})-[r:CONTRADICTED_BY]->(e:Evidence)
             RETURN e.source AS source, e.grade AS grade, r.weight AS weight, e.description AS desc
             ORDER BY r.weight DESC`,
            { id },
          );
          if (contradicts.length > 0) {
            lines.push('### ❌ Contradicting Evidence');
            for (const ev of contradicts) {
              lines.push(`- [${str(ev.grade)}] (w=${num(ev.weight)}) ${str(ev.description)}`);
            }
            lines.push('');
          }
          lines.push('---');
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

// ============================================================================
// contradictions — Most contested claims
// ============================================================================

export function createContradictionsTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'contradictions',
    'Find the most contested claims — those with the highest contradiction evidence weight. ' +
    'These are the areas where evidence disagrees and need human attention.',
    {
      domain: z.enum(['code', 'plan', 'corpus', 'document', 'all']).optional()
        .describe('Filter by domain (default: all)'),
      limit: z.number().optional().describe('Max results (default: 20)'),
    },
    async (args) => {
      try {
        const limit = neo4j.int(args.limit || 20);
        const domainFilter = args.domain && args.domain !== 'all'
          ? 'AND c.domain = $domain'
          : '';
        const params: Record<string, any> = { limit };
        if (args.domain && args.domain !== 'all') params.domain = args.domain;

        const lines: string[] = ['# ⚔️ Contested Claims\n'];

        const contested = await neo4jService.run(
          `MATCH (c:Claim)-[r:CONTRADICTED_BY]->(e:Evidence)
           WHERE c.status IN ['contested', 'asserted'] ${domainFilter}
           WITH c, sum(r.weight) AS contradictWeight,
                count(e) AS contradictCount
           OPTIONAL MATCH (c)-[s:SUPPORTED_BY]->(se:Evidence)
           WITH c, contradictWeight, contradictCount,
                sum(s.weight) AS supportWeight, count(se) AS supportCount
           RETURN c.statement AS statement, c.confidence AS conf, c.domain AS domain,
                  c.status AS status, contradictWeight, contradictCount,
                  supportWeight, supportCount
           ORDER BY contradictWeight DESC
           LIMIT $limit`,
          params,
        );

        if (contested.length === 0) {
          lines.push('✅ No contested claims. All evidence is in agreement.');
          return createSuccessResponse(lines.join('\n'));
        }

        for (const row of contested) {
          const sw = num(row.supportWeight);
          const cw = num(row.contradictWeight);
          lines.push(`### ⚠️ ${str(row.statement)}`);
          lines.push(`Conf: ${num(row.conf)} | ${str(row.domain)} | Status: ${str(row.status)}`);
          lines.push(`Support: ${sw.toFixed(2)} (${num(row.supportCount)} items) vs Contradict: ${cw.toFixed(2)} (${num(row.contradictCount)} items)\n`);
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

// ============================================================================
// hypotheses — Auto-generated investigation targets
// ============================================================================

export function createHypothesesTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'hypotheses',
    'List auto-generated hypotheses — investigation targets derived from evidence gaps. ' +
    'These are things the system has identified as needing attention based on missing evidence.',
    {
      domain: z.enum(['code', 'plan', 'corpus', 'all']).optional()
        .describe('Filter by domain (default: all)'),
      status: z.enum(['open', 'supported', 'refuted', 'all']).optional()
        .describe('Filter by status (default: open)'),
      limit: z.number().optional().describe('Max results (default: 30)'),
    },
    async (args) => {
      try {
        const limit = neo4j.int(args.limit || 30);
        const status = args.status || 'open';
        const clauses: string[] = [];
        const params: Record<string, any> = { limit };

        if (args.domain && args.domain !== 'all') {
          clauses.push('h.domain = $domain');
          params.domain = args.domain;
        }
        if (status !== 'all') {
          clauses.push('h.status = $status');
          params.status = status;
        }

        const whereClause = clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';

        const lines: string[] = ['# 💡 Hypotheses — Investigation Targets\n'];

        const hypotheses = await neo4jService.run(
          `MATCH (h:Hypothesis) ${whereClause}
           RETURN h.name AS name, h.domain AS domain, h.status AS status,
                  h.generatedFrom AS source, h.projectId AS project,
                  h.parentSection AS section
           ORDER BY h.domain, h.projectId, h.name
           LIMIT $limit`,
          params,
        );

        if (hypotheses.length === 0) {
          lines.push('✅ No open hypotheses. All known gaps are resolved.');
          return createSuccessResponse(lines.join('\n'));
        }

        // Group by domain
        const grouped: Record<string, any[]> = {};
        for (const row of hypotheses) {
          const domain = str(row.domain) || 'unknown';
          if (!grouped[domain]) grouped[domain] = [];
          grouped[domain].push(row);
        }

        for (const [domain, items] of Object.entries(grouped)) {
          const emoji = domain === 'code' ? '💻' : domain === 'plan' ? '📋' : domain === 'corpus' ? '📚' : '📄';
          lines.push(`## ${emoji} ${domain} (${items.length} hypotheses)\n`);

          // Sub-group by project
          const byProject: Record<string, any[]> = {};
          for (const item of items) {
            const proj = str(item.project) || 'global';
            if (!byProject[proj]) byProject[proj] = [];
            byProject[proj].push(item);
          }

          for (const [proj, projItems] of Object.entries(byProject)) {
            lines.push(`### ${proj}`);
            for (const item of projItems) {
              const section = str(item.section);
              lines.push(`- ${str(item.name)}${section ? ` [${section}]` : ''}`);
            }
            lines.push('');
          }
        }

        lines.push(`**Total: ${hypotheses.length} hypotheses shown (limit: ${limit})**`);
        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

// ============================================================================
// claim_generate — Trigger claim pipeline
// ============================================================================

export function createClaimChainPathTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'claim_chain_path',
    'Visualize cross-domain claim chains from code claims through plan claims to document/corpus/cross claims. ' +
      'Use this to see traceable impact paths and chain bottlenecks.',
    {
      projectId: z.string().optional().describe('Project id filter (e.g., plan_codegraph)') ,
      limit: z.number().optional().describe('Max paths to return (default 20)'),
    },
    async (args) => {
      try {
        const limit = neo4j.int(args.limit || 20);
        const params: Record<string, any> = { limit };
        let projectClause = '';

        if (args.projectId) {
          projectClause = 'AND coalesce(plan.projectId, code.projectId, doc.projectId) = $projectId';
          params.projectId = args.projectId;
        }

        const rows = await neo4jService.run(
          `MATCH (plan:Claim {domain: 'plan'})-[:DEPENDS_ON]->(code:Claim {domain: 'code'})
           OPTIONAL MATCH (doc:Claim)-[:DEPENDS_ON]->(plan)
           WHERE doc.domain IN ['document', 'corpus', 'cross']
           WITH code, plan, doc
           WHERE true ${projectClause}
           RETURN
             code.id AS codeId,
             code.claimType AS codeType,
             code.statement AS codeStatement,
             plan.id AS planId,
             plan.claimType AS planType,
             plan.statement AS planStatement,
             doc.id AS docId,
             doc.claimType AS docType,
             doc.statement AS docStatement,
             coalesce(plan.projectId, code.projectId, doc.projectId) AS projectId
           ORDER BY projectId, codeId, planId
           LIMIT $limit`,
          params,
        );

        const lines: string[] = ['# 🔗 Claim Chain Paths\n'];

        if (rows.length === 0) {
          lines.push('No code → plan → document claim chains found for current filters.');
          return createSuccessResponse(lines.join('\n'));
        }

        for (const row of rows) {
          lines.push(`## ${str(row.projectId)} | ${str(row.codeType)} → ${str(row.planType)}${row.docId ? ` → ${str(row.docType)}` : ''}`);
          lines.push(`- 💻 code: ${str(row.codeStatement)}`);
          lines.push(`- 📋 plan: ${str(row.planStatement)}`);
          if (row.docId) lines.push(`- 📄 doc/corpus: ${str(row.docStatement)}`);
          lines.push('');
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

export function createClaimGenerateTool(server: McpServer) {
  server.tool(
    'claim_generate',
    'Run the full claim generation pipeline — creates Claim, Evidence, and Hypothesis nodes ' +
    'from plan task completion, code risk analysis, and corpus entity resolution. ' +
    'Then recomputes confidence scores. Idempotent (MERGE-based).',
    {
      domain: z.enum(['plan', 'code', 'corpus', 'all']).optional()
        .describe('Which domain to generate claims for (default: all)'),
    },
    async (args) => {
      const engine = new ClaimEngine();
      try {
        const domain = args.domain || 'all';
        const lines: string[] = ['# 🧠 Claim Generation Results\n'];

        await engine.ensureSchema();

        if (domain === 'all' || domain === 'plan') {
          const plan = await engine.generatePlanClaims();
          lines.push(`📋 Plan: ${plan.claims} claims, ${plan.evidence} evidence, ${plan.hypotheses} hypotheses`);
        }

        if (domain === 'all' || domain === 'code') {
          const code1 = await engine.generateCodeClaims('proj_60d5feed0001');
          const code2 = await engine.generateCodeClaims('proj_c0d3e9a1f200');
          lines.push(`💻 Code: ${code1.claims + code2.claims} claims, ${code1.evidence + code2.evidence} evidence, ${code1.hypotheses + code2.hypotheses} hypotheses`);
        }

        if (domain === 'all' || domain === 'corpus') {
          const corpus = await engine.generateCorpusClaims();
          lines.push(`📚 Corpus: ${corpus.claims} claims, ${corpus.evidence} evidence`);
        }

        const updated = await engine.recomputeConfidence();
        lines.push(`\n🔄 Confidence recomputed on ${updated} claims`);

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      } finally {
        await engine.close();
      }
    },
  );
}
