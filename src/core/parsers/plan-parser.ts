/**
 * Plan Parser — Parses markdown plan files into graph nodes/edges
 * 
 * Extracts Task, Milestone, Sprint, Decision, and PlanProject nodes
 * from structured markdown files (checkboxes, headers, tables, status lines).
 * 
 * Output format matches the existing Neo4j ingest pipeline (Neo4jNode/Neo4jEdge arrays).
 * 
 * This is the simplest parser in CodeGraph — designed to be the first test case
 * for the IR layer when it ships.
 */

import fs from 'fs/promises';
import path from 'node:path';

import { glob } from 'glob';

import { generateDeterministicId } from '../utils/graph-factory.js';

// ============================================================================
// PLAN GRAPH SCHEMA
// ============================================================================

export enum PlanNodeType {
  PLAN_PROJECT = 'PlanProject',
  MILESTONE = 'Milestone',
  SPRINT = 'Sprint',
  TASK = 'Task',
  DECISION = 'Decision',
}

export enum PlanEdgeType {
  PART_OF = 'PART_OF',
  BLOCKS = 'BLOCKS',
  DEPENDS_ON = 'DEPENDS_ON',
  MODIFIES = 'MODIFIES',
  TARGETS = 'TARGETS',
  BASED_ON = 'BASED_ON',
  SUPERSEDES = 'SUPERSEDES',
}

export enum TaskStatus {
  DONE = 'done',
  PLANNED = 'planned',
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked',
}

// ============================================================================
// INTERFACES
// ============================================================================

export interface PlanNode {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

export interface PlanEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  properties: Record<string, any>;
}

export interface ParsedPlan {
  projectId: string;
  projectName: string;
  nodes: PlanNode[];
  edges: PlanEdge[];
  stats: {
    files: number;
    tasks: number;
    milestones: number;
    sprints: number;
    decisions: number;
    crossRefs: number;
  };
}

interface PlanFile {
  path: string;
  relativePath: string;
  content: string;
}

interface CrossReference {
  type: 'file_path' | 'function' | 'project_id' | 'efta' | 'project_name';
  value: string;
  raw: string;
}

// ============================================================================
// REGEX PATTERNS
// ============================================================================

// Checkbox patterns
const CHECKBOX_DONE = /^(\s*)- \[x\]\s+(.+)$/;
const CHECKBOX_PLANNED = /^(\s*)- \[ \]\s+(.+)$/;

// Header patterns
const MILESTONE_HEADER = /^##\s+Milestone\s+(\d+)[\s:]*(.*)$/i;
const SPRINT_HEADER = /^##\s+Sprint\s+(\d+)[\s:]*(.*)$/i;
const GENERIC_H2 = /^##\s+(.+)$/;
const GENERIC_H3 = /^###\s+(.+)$/;

// Status patterns
const STATUS_LINE = /\*\*Status\*\*:\s*(.+)/i;
const PROJECT_LINE = /\*\*Project\*\*:\s*(.+)/i;

// Decision table row
const DECISION_ROW = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/;

// Cross-reference patterns
const FILE_PATH_REF = /(?:`([^`]+\.[a-z]{1,4})`|(\b\w+[\w-]*\.(?:ts|js|py|java|go|rs|md|json|csv)\b))/g;
const FUNCTION_REF = /`(\w+(?:\.\w+)*)\(\)`/g;
const PROJECT_ID_REF = /`?(proj_[a-f0-9]{12})`?/g;
const EFTA_REF = /EFTA\d{8}/g;
const PROJECT_NAME_REF = /\b(codegraph|godspeed|bible-graph|plan-graph)\b/gi;

// Cross-project dependency patterns
const DEPENDS_ON_PATTERN = /\*\*DEPENDS_ON\*\*\s+(.+)/i;
const BLOCKS_PATTERN = /\*\*BLOCKS\*\*\s+(.+)/i;

// ============================================================================
// PARSER
// ============================================================================

export async function parsePlanDirectory(
  plansRoot: string,
  projectFilter?: string[],
): Promise<ParsedPlan[]> {
  const results: ParsedPlan[] = [];

  // Discover project directories
  const entries = await fs.readdir(plansRoot, { withFileTypes: true });
  const projectDirs = entries
    .filter((e) => e.isDirectory())
    .filter((e) => !projectFilter || projectFilter.includes(e.name));

  for (const dir of projectDirs) {
    const projectPath = path.join(plansRoot, dir.name);
    const projectId = `plan_${dir.name.replace(/-/g, '_')}`;

    // Find all markdown files
    const mdFiles = await glob('**/*.md', { cwd: projectPath });

    if (mdFiles.length === 0) continue;

    const planFiles: PlanFile[] = [];
    for (const relPath of mdFiles) {
      const fullPath = path.join(projectPath, relPath);
      const content = await fs.readFile(fullPath, 'utf-8');
      planFiles.push({ path: fullPath, relativePath: relPath, content });
    }

    const parsed = parsePlanProject(projectId, dir.name, planFiles);
    results.push(parsed);
  }

  return results;
}

export function parsePlanProject(
  projectId: string,
  projectName: string,
  files: PlanFile[],
): ParsedPlan {
  const nodes: PlanNode[] = [];
  const edges: PlanEdge[] = [];
  const stats = { files: files.length, tasks: 0, milestones: 0, sprints: 0, decisions: 0, crossRefs: 0 };

  // Create PlanProject node
  const projectNodeId = generateDeterministicId(projectId, PlanNodeType.PLAN_PROJECT, '', projectName);
  nodes.push({
    id: projectNodeId,
    labels: ['CodeNode', PlanNodeType.PLAN_PROJECT],
    properties: {
      projectId,
      name: projectName,
      coreType: PlanNodeType.PLAN_PROJECT,
      fileCount: files.length,
    },
  });

  for (const file of files) {
    const fileContext = {
      projectId,
      projectNodeId,
      projectName,
      filePath: file.relativePath,
    };

    const { fileNodes, fileEdges, fileStats } = parseFile(file, fileContext);
    nodes.push(...fileNodes);
    edges.push(...fileEdges);
    stats.tasks += fileStats.tasks;
    stats.milestones += fileStats.milestones;
    stats.sprints += fileStats.sprints;
    stats.decisions += fileStats.decisions;
    stats.crossRefs += fileStats.crossRefs;
  }

  return { projectId, projectName, nodes, edges, stats };
}

interface FileContext {
  projectId: string;
  projectNodeId: string;
  projectName: string;
  filePath: string;
}

interface FileParseResult {
  fileNodes: PlanNode[];
  fileEdges: PlanEdge[];
  fileStats: { tasks: number; milestones: number; sprints: number; decisions: number; crossRefs: number };
}

function parseFile(file: PlanFile, ctx: FileContext): FileParseResult {
  const nodes: PlanNode[] = [];
  const edges: PlanEdge[] = [];
  const stats = { tasks: 0, milestones: 0, sprints: 0, decisions: 0, crossRefs: 0 };

  const lines = file.content.split('\n');

  // Extract file-level metadata
  let fileStatus = 'unknown';
  let fileProjectName = ctx.projectName;

  for (const line of lines) {
    const statusMatch = line.match(STATUS_LINE);
    if (statusMatch) fileStatus = statusMatch[1].trim();
    const projMatch = line.match(PROJECT_LINE);
    if (projMatch) fileProjectName = projMatch[1].trim();
  }

  // Track current section context
  let currentMilestoneId: string | null = null;
  let currentSprintId: string | null = null;
  let currentSectionId: string | null = null;
  let inDecisionTable = false;
  let decisionTableHeaderSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // --- Milestone headers ---
    const milestoneMatch = line.match(MILESTONE_HEADER);
    if (milestoneMatch) {
      const num = milestoneMatch[1];
      const title = milestoneMatch[2].trim().replace(/[✅🔜❌🟡🟢⬜]/g, '').trim();
      const isDone = line.includes('✅');
      const isNext = line.includes('🔜');

      const nodeId = generateDeterministicId(ctx.projectId, PlanNodeType.MILESTONE, ctx.filePath, `milestone-${num}`);
      nodes.push({
        id: nodeId,
        labels: ['CodeNode', PlanNodeType.MILESTONE],
        properties: {
          projectId: ctx.projectId,
          name: `Milestone ${num}: ${title}`,
          number: parseInt(num),
          coreType: PlanNodeType.MILESTONE,
          status: isDone ? TaskStatus.DONE : isNext ? TaskStatus.IN_PROGRESS : TaskStatus.PLANNED,
          filePath: ctx.filePath,
          line: lineNum,
        },
      });

      edges.push({
        id: `${nodeId}->PART_OF->${ctx.projectNodeId}`,
        type: PlanEdgeType.PART_OF,
        source: nodeId,
        target: ctx.projectNodeId,
        properties: { projectId: ctx.projectId },
      });

      currentMilestoneId = nodeId;
      currentSectionId = nodeId;
      currentSprintId = null;
      stats.milestones++;
      inDecisionTable = false;
      continue;
    }

    // --- Sprint headers ---
    const sprintMatch = line.match(SPRINT_HEADER);
    if (sprintMatch) {
      const num = sprintMatch[1];
      const title = sprintMatch[2].trim();

      const nodeId = generateDeterministicId(ctx.projectId, PlanNodeType.SPRINT, ctx.filePath, `sprint-${num}`);
      nodes.push({
        id: nodeId,
        labels: ['CodeNode', PlanNodeType.SPRINT],
        properties: {
          projectId: ctx.projectId,
          name: `Sprint ${num}: ${title}`,
          number: parseInt(num),
          coreType: PlanNodeType.SPRINT,
          status: TaskStatus.PLANNED,
          filePath: ctx.filePath,
          line: lineNum,
        },
      });

      edges.push({
        id: `${nodeId}->PART_OF->${ctx.projectNodeId}`,
        type: PlanEdgeType.PART_OF,
        source: nodeId,
        target: ctx.projectNodeId,
        properties: { projectId: ctx.projectId },
      });

      currentSprintId = nodeId;
      currentSectionId = nodeId;
      currentMilestoneId = null;
      stats.sprints++;
      inDecisionTable = false;
      continue;
    }

    // --- Generic H2 (catch sections that aren't milestones/sprints) ---
    const h2Match = line.match(GENERIC_H2);
    if (h2Match && !milestoneMatch && !sprintMatch) {
      const title = h2Match[1].trim();

      // Check if this is a decision table section
      if (title.toLowerCase().includes('decision')) {
        inDecisionTable = true;
        decisionTableHeaderSeen = false;
      } else {
        inDecisionTable = false;
      }

      // Create a milestone-like node for non-standard sections
      const nodeId = generateDeterministicId(ctx.projectId, PlanNodeType.MILESTONE, ctx.filePath, `section-${lineNum}`);
      nodes.push({
        id: nodeId,
        labels: ['CodeNode', PlanNodeType.MILESTONE],
        properties: {
          projectId: ctx.projectId,
          name: title,
          coreType: PlanNodeType.MILESTONE,
          status: TaskStatus.PLANNED,
          filePath: ctx.filePath,
          line: lineNum,
          isSection: true,
        },
      });

      edges.push({
        id: `${nodeId}->PART_OF->${ctx.projectNodeId}`,
        type: PlanEdgeType.PART_OF,
        source: nodeId,
        target: ctx.projectNodeId,
        properties: { projectId: ctx.projectId },
      });

      currentSectionId = nodeId;
      currentMilestoneId = nodeId;
      currentSprintId = null;
      continue;
    }

    // --- Decision table rows ---
    if (inDecisionTable) {
      const rowMatch = line.match(DECISION_ROW);
      if (rowMatch) {
        // Skip header row and separator
        if (rowMatch[1].includes('---') || rowMatch[2].includes('---')) continue;
        if (rowMatch[1].toLowerCase().trim() === 'decision' || rowMatch[1].toLowerCase().trim() === '|') {
          decisionTableHeaderSeen = true;
          continue;
        }

        const decision = rowMatch[1].trim();
        const choice = rowMatch[2].trim();
        const rationale = rowMatch[3].trim();

        if (decision && choice && !decision.startsWith('--')) {
          const nodeId = generateDeterministicId(ctx.projectId, PlanNodeType.DECISION, ctx.filePath, `decision-${decision.substring(0, 40)}`);
          nodes.push({
            id: nodeId,
            labels: ['CodeNode', PlanNodeType.DECISION],
            properties: {
              projectId: ctx.projectId,
              name: decision,
              choice,
              rationale,
              coreType: PlanNodeType.DECISION,
              filePath: ctx.filePath,
              line: lineNum,
            },
          });

          edges.push({
            id: `${nodeId}->PART_OF->${ctx.projectNodeId}`,
            type: PlanEdgeType.PART_OF,
            source: nodeId,
            target: ctx.projectNodeId,
            properties: { projectId: ctx.projectId },
          });

          stats.decisions++;
        }
        continue;
      }
    }

    // --- Checkboxes (tasks) ---
    const doneMatch = line.match(CHECKBOX_DONE);
    const plannedMatch = line.match(CHECKBOX_PLANNED);
    const checkboxMatch = doneMatch || plannedMatch;

    if (checkboxMatch) {
      const indent = checkboxMatch[1].length;
      const text = checkboxMatch[2].trim();
      const status = doneMatch ? TaskStatus.DONE : TaskStatus.PLANNED;

      // Determine if sub-task (indented)
      const isSubTask = indent >= 2;

      const taskId = generateDeterministicId(ctx.projectId, PlanNodeType.TASK, ctx.filePath, `task-${lineNum}-${text.substring(0, 50)}`);

      // Extract cross-references from task text
      const crossRefs = extractCrossReferences(text);
      stats.crossRefs += crossRefs.length;

      nodes.push({
        id: taskId,
        labels: ['CodeNode', PlanNodeType.TASK],
        properties: {
          projectId: ctx.projectId,
          name: text,
          coreType: PlanNodeType.TASK,
          status,
          isSubTask,
          indentLevel: indent,
          filePath: ctx.filePath,
          line: lineNum,
          crossRefCount: crossRefs.length,
          crossRefs: crossRefs.map((r) => `${r.type}:${r.value}`).join('|'),
        },
      });

      // Link to parent section
      const parentId = currentSprintId || currentMilestoneId || currentSectionId || ctx.projectNodeId;
      edges.push({
        id: `${taskId}->PART_OF->${parentId}`,
        type: PlanEdgeType.PART_OF,
        source: taskId,
        target: parentId,
        properties: { projectId: ctx.projectId },
      });

      // Create MODIFIES edges for file path cross-references
      for (const ref of crossRefs) {
        if (ref.type === 'file_path' || ref.type === 'function') {
          // Store as properties — actual cross-domain linking happens in enrichment
          // For now we record the reference so the graph knows about it
          edges.push({
            id: `${taskId}->MODIFIES->${ref.type}:${ref.value}`,
            type: PlanEdgeType.MODIFIES,
            source: taskId,
            target: `__UNRESOLVED__:${ref.type}:${ref.value}`,
            properties: {
              projectId: ctx.projectId,
              refType: ref.type,
              refValue: ref.value,
              rawText: ref.raw,
              resolved: false,
            },
          });
        }
      }

      stats.tasks++;
      continue;
    }

    // --- Cross-project dependency lines ---
    const dependsMatch = line.match(DEPENDS_ON_PATTERN);
    if (dependsMatch && currentSectionId) {
      edges.push({
        id: `${currentSectionId}->DEPENDS_ON->__UNRESOLVED__:${dependsMatch[1].trim()}`,
        type: PlanEdgeType.DEPENDS_ON,
        source: currentSectionId,
        target: `__UNRESOLVED__:dep:${dependsMatch[1].trim()}`,
        properties: {
          projectId: ctx.projectId,
          description: dependsMatch[1].trim(),
          resolved: false,
        },
      });
    }

    const blocksMatch = line.match(BLOCKS_PATTERN);
    if (blocksMatch && currentSectionId) {
      edges.push({
        id: `${currentSectionId}->BLOCKS->__UNRESOLVED__:${blocksMatch[1].trim()}`,
        type: PlanEdgeType.BLOCKS,
        source: currentSectionId,
        target: `__UNRESOLVED__:block:${blocksMatch[1].trim()}`,
        properties: {
          projectId: ctx.projectId,
          description: blocksMatch[1].trim(),
          resolved: false,
        },
      });
    }
  }

  return { fileNodes: nodes, fileEdges: edges, fileStats: stats };
}

// ============================================================================
// CROSS-REFERENCE EXTRACTION
// ============================================================================

function extractCrossReferences(text: string): CrossReference[] {
  const refs: CrossReference[] = [];
  const seen = new Set<string>();

  // File paths
  let match: RegExpExecArray | null;
  const filePathRegex = new RegExp(FILE_PATH_REF.source, FILE_PATH_REF.flags);
  while ((match = filePathRegex.exec(text)) !== null) {
    const value = match[1] || match[2];
    const key = `file:${value}`;
    if (!seen.has(key)) {
      refs.push({ type: 'file_path', value, raw: match[0] });
      seen.add(key);
    }
  }

  // Function references
  const funcRegex = new RegExp(FUNCTION_REF.source, FUNCTION_REF.flags);
  while ((match = funcRegex.exec(text)) !== null) {
    const key = `func:${match[1]}`;
    if (!seen.has(key)) {
      refs.push({ type: 'function', value: match[1], raw: match[0] });
      seen.add(key);
    }
  }

  // Project IDs
  const projIdRegex = new RegExp(PROJECT_ID_REF.source, PROJECT_ID_REF.flags);
  while ((match = projIdRegex.exec(text)) !== null) {
    const key = `proj:${match[1]}`;
    if (!seen.has(key)) {
      refs.push({ type: 'project_id', value: match[1], raw: match[0] });
      seen.add(key);
    }
  }

  // EFTA numbers
  const eftaRegex = new RegExp(EFTA_REF.source, EFTA_REF.flags);
  while ((match = eftaRegex.exec(text)) !== null) {
    const key = `efta:${match[0]}`;
    if (!seen.has(key)) {
      refs.push({ type: 'efta', value: match[0], raw: match[0] });
      seen.add(key);
    }
  }

  return refs;
}

// ============================================================================
// NEO4J INGEST
// ============================================================================

export function generateCypherStatements(parsed: ParsedPlan): string[] {
  const statements: string[] = [];

  // Create constraint if not exists
  statements.push(
    `CREATE CONSTRAINT IF NOT EXISTS FOR (n:CodeNode) REQUIRE n.id IS UNIQUE`,
  );

  // Batch create nodes
  for (const node of parsed.nodes) {
    const labels = node.labels.join(':');
    const props = { ...node.properties, id: node.id };
    statements.push(
      `MERGE (n:${labels} {id: $id}) SET n += $props`,
    );
  }

  // Batch create edges (skip unresolved targets for now)
  for (const edge of parsed.edges) {
    if (edge.target.startsWith('__UNRESOLVED__')) {
      // Store as pending edge — cross-domain resolution happens later
      continue;
    }
    statements.push(
      `MATCH (a:CodeNode {id: $source}), (b:CodeNode {id: $target}) MERGE (a)-[r:${edge.type}]->(b) SET r += $props`,
    );
  }

  return statements;
}

export async function ingestToNeo4j(
  parsed: ParsedPlan,
  neo4jUri: string = 'bolt://localhost:7687',
  neo4jUser: string = 'neo4j',
  neo4jPassword: string = 'codegraph',
): Promise<{ nodesCreated: number; edgesCreated: number; unresolvedEdges: number }> {
  // Dynamic import to avoid hard dependency
  const neo4j = await import('neo4j-driver');
  const driver = neo4j.default.driver(neo4jUri, neo4j.default.auth.basic(neo4jUser, neo4jPassword));
  const session = driver.session();

  let nodesCreated = 0;
  let edgesCreated = 0;
  let unresolvedEdges = 0;

  try {
    // Index already exists from code graph setup — skip constraint creation
    // The existing index on :CodeNode {id} handles uniqueness

    // Ingest nodes in batches
    const nodeBatchSize = 100;
    for (let i = 0; i < parsed.nodes.length; i += nodeBatchSize) {
      const batch = parsed.nodes.slice(i, i + nodeBatchSize);
      for (const node of batch) {
        const labels = node.labels.join(':');
        await session.run(
          `MERGE (n:${labels} {id: $id}) SET n += $props`,
          { id: node.id, props: { ...node.properties, id: node.id } },
        );
        nodesCreated++;
      }
    }

    // Ingest resolved edges
    for (const edge of parsed.edges) {
      if (edge.target.startsWith('__UNRESOLVED__')) {
        unresolvedEdges++;
        continue;
      }
      try {
        await session.run(
          `MATCH (a:CodeNode {id: $source}), (b:CodeNode {id: $target})
           MERGE (a)-[r:${edge.type}]->(b)
           SET r += $props`,
          { source: edge.source, target: edge.target, props: edge.properties },
        );
        edgesCreated++;
      } catch (err: any) {
        // Edge target might not exist yet — that's expected for cross-project refs
        console.warn(`Edge skipped (${edge.type}): ${edge.source} -> ${edge.target}: ${err.message}`);
      }
    }

    // Create Project node if it doesn't exist (for linking to code graph projects)
    await session.run(
      `MERGE (p:Project:CodeNode {projectId: $projectId})
       SET p.name = $name, p.type = 'plan', p.nodeCount = $nodeCount, p.edgeCount = $edgeCount`,
      {
        projectId: parsed.projectId,
        name: parsed.projectName,
        nodeCount: nodesCreated,
        edgeCount: edgesCreated,
      },
    );
  } finally {
    await session.close();
    await driver.close();
  }

  return { nodesCreated, edgesCreated, unresolvedEdges };
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

export async function main() {
  const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const plansRoot = positionalArgs[0] || path.resolve(process.cwd(), '../plans');
  const filterArg = positionalArgs[1]; // optional: "codegraph,godspeed"
  const projectFilter = filterArg ? filterArg.split(',') : undefined;

  console.log(`\n📋 Plan Parser — parsing ${plansRoot}`);
  if (projectFilter) console.log(`  Filter: ${projectFilter.join(', ')}`);

  const results = await parsePlanDirectory(plansRoot, projectFilter);

  let totalNodes = 0;
  let totalEdges = 0;

  for (const parsed of results) {
    console.log(`\n  📁 ${parsed.projectName} (${parsed.projectId})`);
    console.log(`     Files: ${parsed.stats.files}`);
    console.log(`     Tasks: ${parsed.stats.tasks} (${parsed.nodes.filter((n) => n.properties.status === 'done').length} done)`);
    console.log(`     Milestones: ${parsed.stats.milestones}`);
    console.log(`     Sprints: ${parsed.stats.sprints}`);
    console.log(`     Decisions: ${parsed.stats.decisions}`);
    console.log(`     Cross-refs: ${parsed.stats.crossRefs}`);
    console.log(`     Total: ${parsed.nodes.length} nodes, ${parsed.edges.length} edges`);

    totalNodes += parsed.nodes.length;
    totalEdges += parsed.edges.length;
  }

  console.log(`\n  📊 Total: ${totalNodes} nodes, ${totalEdges} edges across ${results.length} projects`);

  // Ingest to Neo4j if --ingest flag
  if (process.argv.includes('--ingest')) {
    console.log('\n  🔄 Ingesting to Neo4j...');
    for (const parsed of results) {
      const result = await ingestToNeo4j(parsed);
      console.log(`     ${parsed.projectName}: ${result.nodesCreated} nodes, ${result.edgesCreated} edges, ${result.unresolvedEdges} unresolved`);
    }
    console.log('  ✅ Done.');
  } else {
    console.log('\n  ℹ️  Run with --ingest to load into Neo4j');
  }

  // Write JSON output if --json flag
  if (process.argv.includes('--json')) {
    const outPath = path.resolve(process.cwd(), 'plan-graph.json');
    await fs.writeFile(outPath, JSON.stringify(results, null, 2));
    console.log(`  📄 JSON written to ${outPath}`);
  }
}

// Run if executed directly
const isDirectRun = process.argv[1]?.endsWith('plan-parser.js') || process.argv[1]?.endsWith('plan-parser.ts');
if (isDirectRun) {
  main().catch(console.error);
}
