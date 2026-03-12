/**
 * Plan Graph MCP Tools
 * 
 * plan_status — Overview of all plan projects: tasks, completion, evidence
 * plan_drift — Tasks where plan status doesn't match code reality
 * plan_gaps — Tasks with no code evidence backing
 * plan_query — Flexible Cypher queries against plan nodes
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import neo4j from 'neo4j-driver';
import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import { createErrorResponse, createSuccessResponse } from '../utils.js';

// Helper to extract number from Neo4j integer or plain number
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

function planProjectId(filter: string): string {
  return 'plan_' + filter.replace(/-/g, '_');
}

// ============================================================================
// plan_status — Full status overview
// ============================================================================

export function createPlanStatusTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'plan_status',
    'Get status overview of all plan projects — task counts, completion rates, ' +
    'milestones, decisions, code evidence, and cross-project linkage. ' +
    'Use without arguments for all projects, or pass projectFilter for one project.',
    {
      projectFilter: z.string().optional().describe(
        'Filter to a specific plan project (e.g., "codegraph", "godspeed", "plan-graph", "bible-graph"). Omit for all.',
      ),
    },
    async (args) => {
      try {
        const filterClause = args.projectFilter
          ? 'WHERE pp.name = $filter OR pp.projectId = $ppid'
          : '';
        const params: Record<string, any> = args.projectFilter
          ? { filter: args.projectFilter, ppid: planProjectId(args.projectFilter) }
          : {};

        const projects = await neo4jService.run(
          `MATCH (pp:PlanProject)
           ${filterClause}
           OPTIONAL MATCH (t:Task {projectId: pp.projectId})
           WITH pp,
                count(t) AS totalTasks,
                count(CASE WHEN t.status = 'done' THEN 1 END) AS doneTasks,
                count(CASE WHEN t.status = 'planned' THEN 1 END) AS plannedTasks,
                count(CASE WHEN t.hasCodeEvidence = true THEN 1 END) AS withEvidence
           OPTIONAL MATCH (m:Milestone {projectId: pp.projectId})
           WHERE m.isSection IS NULL OR m.isSection = false
           WITH pp, totalTasks, doneTasks, plannedTasks, withEvidence,
                count(m) AS milestoneCount,
                count(CASE WHEN m.status = 'done' THEN 1 END) AS doneMilestones
           OPTIONAL MATCH (d:Decision {projectId: pp.projectId})
           WITH pp, totalTasks, doneTasks, plannedTasks, withEvidence,
                milestoneCount, doneMilestones, count(d) AS decisionCount
           OPTIONAL MATCH (s:Sprint {projectId: pp.projectId})
           RETURN pp.name AS project,
                  pp.projectId AS projectId,
                  pp.linkedCodeProject AS codeProject,
                  pp.codeSourceFiles AS sourceFiles,
                  pp.codeFunctions AS functions,
                  totalTasks, doneTasks, plannedTasks, withEvidence,
                  milestoneCount, doneMilestones, decisionCount, count(s) AS sprintCount,
                  CASE WHEN totalTasks > 0 
                    THEN round(toFloat(doneTasks) / totalTasks * 100) 
                    ELSE 0 END AS completionPct
           ORDER BY project`,
          params,
        );

        const lines: string[] = ['# 📋 Plan Graph Status\n'];

        for (const row of projects) {
          const name = str(row.project);
          const pct = num(row.completionPct);
          const total = num(row.totalTasks);
          const done = num(row.doneTasks);
          const planned = num(row.plannedTasks);
          const evidence = num(row.withEvidence);
          const milestones = num(row.milestoneCount);
          const doneMilestones = num(row.doneMilestones);
          const decisions = num(row.decisionCount);
          const sprints = num(row.sprintCount);
          const codeProj = str(row.codeProject);
          const sf = num(row.sourceFiles);
          const fn = num(row.functions);

          const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
          lines.push(`## ${name} [${bar}] ${pct}%`);
          lines.push(`Tasks: ${done}/${total} done, ${planned} remaining`);
          lines.push(`Evidence: ${evidence}/${total} tasks have code backing`);
          if (milestones > 0) lines.push(`Milestones: ${doneMilestones}/${milestones}`);
          if (sprints > 0) lines.push(`Sprints: ${sprints}`);
          if (decisions > 0) lines.push(`Decisions: ${decisions}`);
          if (codeProj) lines.push(`Linked code: ${codeProj} (${sf} files, ${fn} functions)`);
          lines.push('');
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

// ============================================================================
// plan_drift — Plan/code mismatches
// ============================================================================

export function createPlanDriftTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'plan_drift',
    'Detect drift between plan status and code reality. ' +
    'Finds: (1) tasks marked "planned" but code evidence exists (forgotten checkboxes), ' +
    '(2) tasks marked "done" but referenced code is missing (reverted/deleted). ' +
    'Critical for agents to know what\'s ACTUALLY done vs what the plan SAYS is done.',
    {
      projectFilter: z.string().optional().describe('Filter to a specific plan project'),
    },
    async (args) => {
      try {
        const filterClause = args.projectFilter
          ? 'AND t.projectId = $ppid'
          : '';
        const params: Record<string, any> = args.projectFilter
          ? { ppid: planProjectId(args.projectFilter) }
          : {};

        const lines: string[] = ['# ⚠️ Plan Drift Report\n'];

        // Forgotten checkboxes
        const forgotten = await neo4jService.run(
          `MATCH (t:Task {status: 'planned'})
           WHERE t.hasCodeEvidence = true ${filterClause}
           OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->(sf)
           RETURN t.name AS task, t.projectId AS project, t.filePath AS file, t.line AS line,
                  collect(sf.name) AS codeFiles
           ORDER BY t.projectId, t.line`,
          params,
        );

        if (forgotten.length > 0) {
          lines.push(`## 🟡 Likely Done (${forgotten.length} items)`);
          lines.push('Tasks marked "planned" but matching code exists:\n');
          for (const row of forgotten) {
            lines.push(`- **${str(row.task)}**`);
            lines.push(`  ${str(row.project)} ${str(row.file)}:${num(row.line)}`);
            if (row.codeFiles?.length) lines.push(`  Code evidence: ${row.codeFiles.join(', ')}`);
          }
          lines.push('');
        }

        // Phantom completions
        const phantom = await neo4jService.run(
          `MATCH (t:Task {status: 'done'})
           WHERE t.crossRefCount > 0 AND (t.hasCodeEvidence IS NULL OR t.hasCodeEvidence = false) ${filterClause}
           RETURN t.name AS task, t.projectId AS project, t.filePath AS file, t.line AS line, t.crossRefs AS refs
           ORDER BY t.projectId, t.line`,
          params,
        );

        if (phantom.length > 0) {
          lines.push(`## 🔴 Possibly Reverted (${phantom.length} items)`);
          lines.push('Tasks marked "done" but referenced code not found:\n');
          for (const row of phantom) {
            lines.push(`- **${str(row.task)}**`);
            lines.push(`  ${str(row.project)} ${str(row.file)}:${num(row.line)}`);
            if (row.refs) lines.push(`  Expected: ${str(row.refs)}`);
          }
          lines.push('');
        }

        if (forgotten.length === 0 && phantom.length === 0) {
          lines.push('✅ No drift detected. Plans match code reality.');
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

// ============================================================================
// plan_gaps — Tasks with no evidence
// ============================================================================

export function createPlanGapsTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'plan_gaps',
    'Find planned tasks with no code evidence — work items that haven\'t started yet. ' +
    'Groups by section/milestone/sprint for prioritization. ' +
    'Use to answer: "What still needs to be built?"',
    {
      projectFilter: z.string().optional().describe('Filter to a specific plan project'),
    },
    async (args) => {
      try {
        const filterClause = args.projectFilter
          ? 'AND t.projectId = $ppid'
          : '';
        const params: Record<string, any> = args.projectFilter
          ? { ppid: planProjectId(args.projectFilter) }
          : {};

        const lines: string[] = ['# 📭 Plan Gaps — Unstarted Work\n'];

        const gaps = await neo4jService.run(
          `MATCH (t:Task {status: 'planned'})
           WHERE (t.hasCodeEvidence IS NULL OR t.hasCodeEvidence = false) ${filterClause}
           OPTIONAL MATCH (t)-[:PART_OF]->(parent)
           RETURN t.name AS task, t.projectId AS project, t.filePath AS file,
                  t.sectionKey AS section, t.line AS line,
                  parent.name AS parentName,
                  t.estimatedLOC AS loc, t.risk AS risk
           ORDER BY t.projectId, t.sectionKey, t.line`,
          params,
        );

        if (gaps.length === 0) {
          lines.push('✅ No gaps — all planned tasks have code evidence.');
          return createSuccessResponse(lines.join('\n'));
        }

        // Group by project then parent
        const grouped: Record<string, Record<string, any[]>> = {};
        for (const row of gaps) {
          const project = str(row.project) || 'unknown';
          const section = str(row.parentName) || str(row.section) || 'ungrouped';
          if (!grouped[project]) grouped[project] = {};
          if (!grouped[project][section]) grouped[project][section] = [];
          grouped[project][section].push({
            task: str(row.task),
            loc: num(row.loc) || null,
            risk: str(row.risk) || null,
          });
        }

        for (const [project, sections] of Object.entries(grouped)) {
          const totalInProject = Object.values(sections).reduce((sum, tasks) => sum + tasks.length, 0);
          lines.push(`## ${project} (${totalInProject} gaps)\n`);
          for (const [section, tasks] of Object.entries(sections)) {
            lines.push(`### ${section} (${tasks.length})`);
            for (const t of tasks) {
              let line = `- ${t.task}`;
              if (t.loc) line += ` (~${t.loc} LOC)`;
              if (t.risk && t.risk !== 'None') line += ` [${t.risk}]`;
              lines.push(line);
            }
            lines.push('');
          }
        }

        lines.push(`**Total: ${gaps.length} unstarted tasks**`);
        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

// ============================================================================
// plan_query — Flexible plan graph queries
// ============================================================================

export function createPlanQueryTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'plan_query',
    'Query the plan graph with presets or custom Cypher. ' +
    'Presets: "decisions" (all decisions), "milestones" (milestone status), ' +
    '"evidence" (tasks with code evidence), "summary" (one-line per project). ' +
    'Or pass preset="custom" with cypher parameter.',
    {
      preset: z.enum(['decisions', 'milestones', 'evidence', 'summary', 'custom']).describe(
        'Query preset or "custom" for raw Cypher',
      ),
      projectFilter: z.string().optional().describe('Filter to a specific plan project'),
      cypher: z.string().optional().describe('Custom Cypher query (only used when preset="custom")'),
    },
    async (args) => {
      try {
        const params: Record<string, any> = args.projectFilter
          ? { ppid: planProjectId(args.projectFilter) }
          : {};
        const hasFilter = !!args.projectFilter;

        let query: string;
        const lines: string[] = [];

        switch (args.preset) {
          case 'decisions':
            query = `MATCH (d:Decision)
                     ${hasFilter ? 'WHERE d.projectId = $ppid' : ''}
                     RETURN d.projectId AS project, d.name AS decision, d.choice AS choice, d.rationale AS rationale
                     ORDER BY d.projectId, d.line`;
            lines.push('# 📐 Decisions\n');
            break;

          case 'milestones':
            query = `MATCH (m:Milestone)
                     WHERE (m.isSection IS NULL OR m.isSection = false)
                     ${hasFilter ? 'AND m.projectId = $ppid' : ''}
                     RETURN m.projectId AS project, m.name AS milestone, m.status AS status, m.number AS num
                     ORDER BY m.projectId, m.number`;
            lines.push('# 🏁 Milestones\n');
            break;

          case 'evidence':
            query = `MATCH (t:Task)-[r:HAS_CODE_EVIDENCE]->(sf)
                     ${hasFilter ? 'WHERE t.projectId = $ppid' : ''}
                     RETURN t.projectId AS project, t.name AS task, sf.name AS codeFile, r.codeProjectId AS codeProject
                     ORDER BY t.projectId, t.line`;
            lines.push('# 🔗 Tasks with Code Evidence\n');
            break;

          case 'summary':
            query = `MATCH (pp:PlanProject)
                     ${hasFilter ? 'WHERE pp.projectId = $ppid' : ''}
                     OPTIONAL MATCH (t:Task {projectId: pp.projectId})
                     WITH pp, count(t) AS total, count(CASE WHEN t.status = 'done' THEN 1 END) AS done
                     RETURN pp.name AS project, total, done,
                            CASE WHEN total > 0 THEN round(toFloat(done)/total*100) ELSE 0 END AS pct
                     ORDER BY pp.name`;
            lines.push('# 📊 Summary\n');
            break;

          case 'custom':
            if (!args.cypher) {
              return createErrorResponse('Custom preset requires a cypher parameter');
            }
            query = args.cypher;
            lines.push('# Custom Query Results\n');
            break;

          default:
            return createErrorResponse(`Unknown preset: ${args.preset}`);
        }

        const results = await neo4jService.run(query, params);

        if (results.length === 0) {
          lines.push('No results.');
          return createSuccessResponse(lines.join('\n'));
        }

        // Format results
        const keys = Object.keys(results[0]);
        for (const row of results) {
          const parts = keys.map((k) => {
            const val = row[k];
            const display = val?.toNumber?.() ?? val;
            return `${k}: ${display}`;
          });
          lines.push(`- ${parts.join(' | ')}`);
        }

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

// ============================================================================
// plan_priority — Dynamic priority ranking: what to build next
// ============================================================================

export function createPlanPriorityTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'plan_priority',
    'Dynamic priority ranking of planned tasks. Scores based on downstream impact: ' +
    'tasks in milestones that BLOCK other milestones score higher. ' +
    'Priority recomputes dynamically as tasks are completed. ' +
    'Use this to answer "what should I work on next?"',
    {
      projectFilter: z.string().optional().describe(
        'Filter to a specific plan project (e.g., "codegraph"). Omit for all.',
      ),
      limit: z.number().optional().describe(
        'Max tasks to return (default 20)',
      ),
    },
    async (args) => {
      try {
        const filterClause = args.projectFilter
          ? `AND t.projectId = '${planProjectId(args.projectFilter)}'`
          : '';
        const limit = args.limit ?? 20;

        const results = await neo4jService.run(
          `MATCH (t:Task {status: 'planned'})
           WHERE true ${filterClause}
           MATCH (t)-[:PART_OF]->(m:Milestone)
           OPTIONAL MATCH (m)-[:BLOCKS*1..3]->(downstream:Milestone)
           OPTIONAL MATCH (downstream)<-[:PART_OF]-(dt:Task {status: 'planned'})
           WITH t, m,
                count(DISTINCT downstream) AS downstreamMilestones,
                count(DISTINCT dt) AS downstreamTasks,
                CASE WHEN t.hasCodeEvidence = true THEN 2 ELSE 0 END AS evidenceBoost
           WITH t, m, downstreamMilestones, downstreamTasks, evidenceBoost,
                (downstreamMilestones * 10 + downstreamTasks + evidenceBoost) AS priority
           RETURN t.name AS task, m.name AS milestone, t.projectId AS project,
                  priority, downstreamMilestones AS unblocksMilestones,
                  downstreamTasks AS unblocksDownstreamTasks,
                  t.hasCodeEvidence AS hasEvidence
           ORDER BY priority DESC, t.name
           LIMIT ${limit}`,
        );

        const lines: string[] = ['# What To Build Next (Dynamic Priority)\n'];
        let currentMilestone = '';

        for (const row of results) {
          const task = str(row.task);
          const milestone = str(row.milestone);
          const project = str(row.project).replace('plan_', '');
          const pts = num(row.priority);
          const unblockMs = num(row.unblocksMilestones);
          const unblockTs = num(row.unblocksDownstreamTasks);
          const hasEv = row.hasEvidence ? '⚡' : '';

          if (milestone !== currentMilestone) {
            currentMilestone = milestone;
            lines.push(`\n## ${milestone} [${project}]`);
            if (unblockMs > 0) {
              lines.push(`   Unblocks ${unblockMs} milestone(s), ${unblockTs} downstream task(s)\n`);
            }
          }
          lines.push(`- [${pts}pts] ${hasEv} ${task}`);
        }

        if (results.length === 0) {
          lines.push('No planned tasks found.');
        }

        lines.push(`\n---`);
        lines.push(`Priority = (downstream_milestones × 10) + downstream_tasks + evidence_boost`);
        lines.push(`Higher score = unblocks more work. Build these first.`);

        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}

// ============================================================================
// plan_next_tasks — Dependency-aware next tasks (graph-wide)
// ============================================================================

export function createPlanNextTasksTool(server: McpServer) {
  const neo4jService = new Neo4jService();

  server.tool(
    'plan_next_tasks',
    'Returns dependency-aware next tasks. Prioritizes tasks with no open DEPENDS_ON blockers. ' +
    'Works across all plan projects or a single filtered plan project.',
    {
      projectFilter: z.string().optional().describe(
        'Filter to a specific plan project (e.g., "codegraph", "godspeed", "runtime-graph"). Omit for all.',
      ),
      limit: z.number().optional().describe('Max tasks to return (default 15)'),
    },
    async (args) => {
      try {
        const limit = args.limit ?? 15;
        const filterClause = args.projectFilter
          ? `AND t.projectId = '${planProjectId(args.projectFilter)}'`
          : '';

        const rows = await neo4jService.run(
          `MATCH (t:Task {status: 'planned'})
           WHERE true ${filterClause}
           OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep:Task)
           WITH t,
                count(dep) AS totalDeps,
                count(CASE WHEN dep.status = 'planned' THEN 1 END) AS openDeps,
                collect(dep.name)[..5] AS depNames
           OPTIONAL MATCH (t)-[:PART_OF]->(parent)
           OPTIONAL MATCH (t)-[:BLOCKS]->(blocked)
           WITH t, totalDeps, openDeps, depNames, parent, count(blocked) AS blocksCount
           RETURN t.projectId AS project,
                  parent.name AS parent,
                  t.name AS task,
                  t.line AS line,
                  totalDeps,
                  openDeps,
                  depNames,
                  blocksCount,
                  CASE WHEN openDeps = 0 THEN true ELSE false END AS ready
           ORDER BY ready DESC, blocksCount DESC, openDeps ASC, t.projectId ASC, line ASC
           LIMIT ${limit}`,
        );

        const lines: string[] = ['# 🧭 Next Tasks (Dependency-Aware)\n'];

        if (rows.length === 0) {
          lines.push('No planned tasks found.');
          return createSuccessResponse(lines.join('\n'));
        }

        for (const row of rows) {
          const project = str(row.project).replace(/^plan_/, '');
          const parent = str(row.parent) || '(no parent)';
          const task = str(row.task);
          const line = num(row.line);
          const totalDeps = num(row.totalDeps);
          const openDeps = num(row.openDeps);
          const blocksCount = num(row.blocksCount);
          const ready = Boolean(row.ready);
          const depNames = (row.depNames as string[] | undefined) ?? [];

          const icon = ready ? '✅' : '⛔';
          lines.push(`- ${icon} [${project}] ${task} (${parent} @ line ${line})`);
          lines.push(`  deps: ${openDeps}/${totalDeps} open | blocks: ${blocksCount}`);
          if (!ready && depNames.length > 0) {
            lines.push(`  waiting on: ${depNames.join(', ')}`);
          }
        }

        lines.push('\nLegend: ✅ ready (no open deps) | ⛔ blocked');
        return createSuccessResponse(lines.join('\n'));
      } catch (err: any) {
        return createErrorResponse(err.message || String(err));
      }
    },
  );
}
