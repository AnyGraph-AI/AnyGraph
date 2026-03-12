/**
 * Plan Parser — Parses markdown plan files into graph nodes/edges
 * 
 * Extracts Task, Milestone, Sprint, Decision, and PlanProject nodes
 * from structured markdown files (checkboxes, headers, tables, status lines).
 * 
 * v2: Stable IDs (file:section:ordinal, not text-dependent)
 * v2: Cross-domain enrichment (resolve refs against code graph, auto-detect completion)
 * v2: Upsert-safe (MERGE by stable ID, SET properties — no orphan nodes on re-parse)
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
  SECTION = 'Section',
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
  HAS_CODE_EVIDENCE = 'HAS_CODE_EVIDENCE',
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
  unresolvedRefs: UnresolvedRef[];
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

export interface UnresolvedRef {
  taskId: string;
  taskName: string;
  refType: string;
  refValue: string;
}

// ============================================================================
// REGEX PATTERNS
// ============================================================================

// Checkbox patterns
const CHECKBOX_DONE = /^(\s*)- \[x\]\s+(.+)$/;
const CHECKBOX_PLANNED = /^(\s*)- \[ \]\s+(.+)$/;

// Header patterns
const MILESTONE_HEADER = /^##\s+Milestone\s+(\d+)[\s:]*(.*)$/i;
const SPRINT_HEADER = /^###?\s+Sprint\s+(\d+)[\s:]*(.*)$/i;
const GENERIC_H2 = /^##\s+(.+)$/;

// Status patterns
const STATUS_LINE = /\*\*Status\*\*:\s*(.+)/i;

// Decision table row
const DECISION_ROW = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/;

// Cross-reference patterns — expanded to catch more file types
const FILE_PATH_REF = /(?:`([^`]+\.[a-z]{1,5})`|(\b[\w/.-]+\.(?:ts|js|py|java|go|rs|md|json|csv|sql|toml|yaml|yml|sh)\b))/g;
const FUNCTION_REF = /`(\w+(?:\.\w+)*)\(\)`/g;
const PROJECT_ID_REF = /`?(proj_[a-f0-9]{12})`?/g;
const EFTA_REF = /EFTA\d{8}/g;

// Table task pattern: | Task description | Gap # | LOC | Risk |
const TABLE_TASK_ROW = /^\|\s*(.+?)\s*\|\s*(#?\d+|—|-)\s*\|\s*(\d+|—|-)\s*\|\s*(.+?)\s*\|$/;

// "Files touched:" section pattern
const FILES_TOUCHED = /^###?\s*Files\s+touched:?\s*$/i;

// Dependency directive patterns (plan-agnostic)
// Supports both plain lines and checkbox-prefixed lines:
//   **DEPENDS_ON** Task X
//   - [ ] **DEPENDS_ON** Task X
//   BLOCKS: Task Y
const DEPENDS_ON_PATTERN = /^\s*(?:[-*]\s*\[[ xX]\]\s*)?(?:\*\*\s*)?DEPENDS_ON(?:\s*\*\*)?\s*:?\s+(.+)$/i;
const BLOCKS_PATTERN = /^\s*(?:[-*]\s*\[[ xX]\]\s*)?(?:\*\*\s*)?BLOCKS(?:\s*\*\*)?\s*:?\s+(.+)$/i;

// ============================================================================
// STABLE ID GENERATION
// ============================================================================

/**
 * Generate stable IDs based on structural position, NOT content.
 * 
 * For milestones/sprints: keyed on their number (Milestone 1, Sprint 3)
 * For tasks: keyed on file + parent section + ordinal within that section
 * For decisions: keyed on file + decision table ordinal
 * 
 * This means:
 * - Editing task text → same ID → MERGE updates in place
 * - Checking/unchecking a box → same ID → status updates in place
 * - Reordering tasks within a section → IDs shift (acceptable — task identity IS position)
 * - Adding a task in the middle → downstream ordinals shift (acceptable for plan files)
 */
function stableId(projectId: string, type: string, file: string, sectionKey: string, ordinal: number): string {
  return generateDeterministicId(projectId, type, file, `${sectionKey}#${ordinal}`);
}

// ============================================================================
// PARSER
// ============================================================================

export async function parsePlanDirectory(
  plansRoot: string,
  projectFilter?: string[],
): Promise<ParsedPlan[]> {
  const results: ParsedPlan[] = [];

  const entries = await fs.readdir(plansRoot, { withFileTypes: true });
  const projectDirs = entries
    .filter((e) => e.isDirectory())
    .filter((e) => !projectFilter || projectFilter.includes(e.name));

  for (const dir of projectDirs) {
    const projectPath = path.join(plansRoot, dir.name);
    const projectId = `plan_${dir.name.replace(/-/g, '_')}`;

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
  const unresolvedRefs: UnresolvedRef[] = [];
  const stats = { files: files.length, tasks: 0, milestones: 0, sprints: 0, decisions: 0, crossRefs: 0 };

  // Create PlanProject node
  const projectNodeId = stableId(projectId, PlanNodeType.PLAN_PROJECT, '', 'root', 0);
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
    const ctx: FileContext = { projectId, projectNodeId, projectName, filePath: file.relativePath };
    const result = parseFile(file, ctx);
    nodes.push(...result.fileNodes);
    edges.push(...result.fileEdges);
    unresolvedRefs.push(...result.unresolvedRefs);
    stats.tasks += result.fileStats.tasks;
    stats.milestones += result.fileStats.milestones;
    stats.sprints += result.fileStats.sprints;
    stats.decisions += result.fileStats.decisions;
    stats.crossRefs += result.fileStats.crossRefs;
  }

  return { projectId, projectName, nodes, edges, unresolvedRefs, stats };
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
  unresolvedRefs: UnresolvedRef[];
  fileStats: { tasks: number; milestones: number; sprints: number; decisions: number; crossRefs: number };
}

function parseFile(file: PlanFile, ctx: FileContext): FileParseResult {
  const nodes: PlanNode[] = [];
  const edges: PlanEdge[] = [];
  const unresolvedRefs: UnresolvedRef[] = [];
  const stats = { tasks: 0, milestones: 0, sprints: 0, decisions: 0, crossRefs: 0 };

  const lines = file.content.split('\n');

  // Track current section context
  let currentSectionId: string | null = null;
  let currentSectionKey: string = 'root';
  let taskOrdinalInSection = 0;   // resets per section
  let decisionOrdinal = 0;        // global per file
  let inDecisionTable = false;

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

      const sectionKey = `milestone-${num}`;
      const nodeId = stableId(ctx.projectId, PlanNodeType.MILESTONE, ctx.filePath, sectionKey, 0);
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

      currentSectionId = nodeId;
      currentSectionKey = sectionKey;
      taskOrdinalInSection = 0;
      stats.milestones++;
      inDecisionTable = false;
      continue;
    }

    // --- Sprint headers ---
    const sprintMatch = line.match(SPRINT_HEADER);
    if (sprintMatch) {
      const num = sprintMatch[1];
      const title = sprintMatch[2].trim();

      const sectionKey = `sprint-${num}`;
      const nodeId = stableId(ctx.projectId, PlanNodeType.SPRINT, ctx.filePath, sectionKey, 0);
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

      currentSectionId = nodeId;
      currentSectionKey = sectionKey;
      taskOrdinalInSection = 0;
      stats.sprints++;
      inDecisionTable = false;
      continue;
    }

    // --- Generic H2 (catch sections that aren't milestones/sprints) ---
    const h2Match = line.match(GENERIC_H2);
    if (h2Match && !milestoneMatch && !sprintMatch) {
      const title = h2Match[1].trim();

      // Stable section key from sanitized title
      const sanitized = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').substring(0, 40);
      const sectionKey = `section-${sanitized}`;

      if (title.toLowerCase().includes('decision')) {
        inDecisionTable = true;
      } else {
        inDecisionTable = false;
      }

      const nodeId = stableId(ctx.projectId, PlanNodeType.SECTION, ctx.filePath, sectionKey, 0);
      nodes.push({
        id: nodeId,
        labels: ['CodeNode', PlanNodeType.SECTION],
        properties: {
          projectId: ctx.projectId,
          name: title,
          coreType: PlanNodeType.SECTION,
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
      currentSectionKey = sectionKey;
      taskOrdinalInSection = 0;
      continue;
    }

    // --- "Files touched:" sections — MUST check before H3 handler consumes the line ---
    if (FILES_TOUCHED.test(line)) {
      // Read subsequent lines for file paths until next section or empty line after content
      let hitContent = false;
      for (let j = i + 1; j < lines.length; j++) {
        const fline = lines[j].trim();
        if (fline.startsWith('#')) break;
        if (fline === '') {
          if (hitContent) break;
          continue;
        }
        hitContent = true;
        const fileRefs = extractCrossReferences(fline);
        for (const ref of fileRefs) {
          if (ref.type === 'file_path') {
            if (currentSectionId) {
              unresolvedRefs.push({
                taskId: currentSectionId,
                taskName: `section:${currentSectionKey}:files_touched`,
                refType: ref.type,
                refValue: ref.value,
              });
              stats.crossRefs++;
            }
          }
        }
      }
      continue;
    }

    // --- H3 sub-sections (update section key but don't create separate section nodes) ---
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match && !sprintMatch) {
      const title = h3Match[1].trim();
      const sanitized = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').substring(0, 40);
      // Sub-section key includes parent
      currentSectionKey = `${currentSectionKey}/${sanitized}`;
      taskOrdinalInSection = 0;

      if (title.toLowerCase().includes('decision')) {
        inDecisionTable = true;
      }
      continue;
    }

    // --- Decision table rows ---
    if (inDecisionTable) {
      const rowMatch = line.match(DECISION_ROW);
      if (rowMatch) {
        if (rowMatch[1].includes('---') || rowMatch[2].includes('---')) continue;
        const decision = rowMatch[1].trim();
        const choice = rowMatch[2].trim();
        const rationale = rowMatch[3].trim();

        if (decision.toLowerCase() === 'decision' || decision === '|') continue;
        if (!decision || !choice || decision.startsWith('--')) continue;

        decisionOrdinal++;
        const nodeId = stableId(ctx.projectId, PlanNodeType.DECISION, ctx.filePath, 'decisions', decisionOrdinal);
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
        continue;
      }
    }

    // --- Dependency directives ---
    // Convert markdown directives to unresolved refs for edge materialization later.
    // Use section as source so dependencies are semantic scheduling constraints,
    // not standalone checkbox tasks.
    const dependsDirective = line.match(DEPENDS_ON_PATTERN);
    if (dependsDirective && currentSectionId) {
      stats.crossRefs++;
      unresolvedRefs.push({
        taskId: currentSectionId,
        taskName: `section:${currentSectionKey}`,
        refType: 'depends_on',
        refValue: dependsDirective[1].trim(),
      });
      continue;
    }

    const blocksDirective = line.match(BLOCKS_PATTERN);
    if (blocksDirective && currentSectionId) {
      stats.crossRefs++;
      unresolvedRefs.push({
        taskId: currentSectionId,
        taskName: `section:${currentSectionKey}`,
        refType: 'blocks',
        refValue: blocksDirective[1].trim(),
      });
      continue;
    }

    // --- Table-based tasks (GodSpeed-style: | Task | Gap # | LOC | Risk |) ---
    const tableMatch = line.match(TABLE_TASK_ROW);
    if (tableMatch && currentSectionId) {
      const taskText = tableMatch[1].trim();
      const gapNum = tableMatch[2].trim();
      const loc = tableMatch[3].trim();
      const risk = tableMatch[4].trim();

      // Skip header rows and separators
      if (taskText.toLowerCase() === 'task' || taskText.toLowerCase().startsWith('task') && gapNum.toLowerCase().includes('gap') || taskText.includes('---') || gapNum.includes('---')) continue;

      taskOrdinalInSection++;
      const taskId = stableId(ctx.projectId, PlanNodeType.TASK, ctx.filePath, currentSectionKey, taskOrdinalInSection);

      const crossRefs = extractCrossReferences(taskText);
      stats.crossRefs += crossRefs.length;

      nodes.push({
        id: taskId,
        labels: ['CodeNode', PlanNodeType.TASK],
        properties: {
          projectId: ctx.projectId,
          name: taskText,
          coreType: PlanNodeType.TASK,
          status: TaskStatus.PLANNED,
          isSubTask: false,
          indentLevel: 0,
          filePath: ctx.filePath,
          line: lineNum,
          sectionKey: currentSectionKey,
          ordinal: taskOrdinalInSection,
          format: 'table',
          gapNumber: gapNum !== '—' && gapNum !== '-' ? gapNum : null,
          estimatedLOC: loc !== '—' && loc !== '-' ? parseInt(loc) || null : null,
          risk: risk !== '—' && risk !== '-' ? risk : null,
          crossRefCount: crossRefs.length,
          crossRefs: crossRefs.map((r) => `${r.type}:${r.value}`).join('|'),
          hasCodeEvidence: false,
          codeEvidenceCount: 0,
        },
      });

      const parentId = currentSectionId || ctx.projectNodeId;
      edges.push({
        id: `${taskId}->PART_OF->${parentId}`,
        type: PlanEdgeType.PART_OF,
        source: taskId,
        target: parentId,
        properties: { projectId: ctx.projectId },
      });

      for (const ref of crossRefs) {
        if (ref.type === 'file_path' || ref.type === 'function') {
          unresolvedRefs.push({ taskId, taskName: taskText, refType: ref.type, refValue: ref.value });
        }
      }

      stats.tasks++;
      continue;
    }

    // --- Checkboxes (tasks) ---
    const doneMatch = line.match(CHECKBOX_DONE);
    const plannedMatch = line.match(CHECKBOX_PLANNED);
    const checkboxMatch = doneMatch || plannedMatch;

    if (checkboxMatch) {
      const indent = checkboxMatch[1].length;
      const text = checkboxMatch[2].trim();
      const status = doneMatch ? TaskStatus.DONE : TaskStatus.PLANNED;
      const isSubTask = indent >= 2;

      taskOrdinalInSection++;
      const taskId = stableId(ctx.projectId, PlanNodeType.TASK, ctx.filePath, currentSectionKey, taskOrdinalInSection);

      // Extract cross-references
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
          sectionKey: currentSectionKey,
          ordinal: taskOrdinalInSection,
          crossRefCount: crossRefs.length,
          crossRefs: crossRefs.map((r) => `${r.type}:${r.value}`).join('|'),
          // These get filled by enrichment:
          hasCodeEvidence: false,
          codeEvidenceCount: 0,
        },
      });

      // Link to parent section
      const parentId = currentSectionId || ctx.projectNodeId;
      edges.push({
        id: `${taskId}->PART_OF->${parentId}`,
        type: PlanEdgeType.PART_OF,
        source: taskId,
        target: parentId,
        properties: { projectId: ctx.projectId },
      });

      // Track unresolved refs for cross-domain enrichment
      for (const ref of crossRefs) {
        if (ref.type === 'file_path' || ref.type === 'function') {
          unresolvedRefs.push({
            taskId,
            taskName: text,
            refType: ref.type,
            refValue: ref.value,
          });
        }
      }

      stats.tasks++;
      continue;
    }

  }

  return { fileNodes: nodes, fileEdges: edges, unresolvedRefs, fileStats: stats };
}

// ============================================================================
// CROSS-REFERENCE EXTRACTION
// ============================================================================

function extractCrossReferences(text: string): CrossReference[] {
  const refs: CrossReference[] = [];
  const seen = new Set<string>();

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

  const funcRegex = new RegExp(FUNCTION_REF.source, FUNCTION_REF.flags);
  while ((match = funcRegex.exec(text)) !== null) {
    const key = `func:${match[1]}`;
    if (!seen.has(key)) {
      refs.push({ type: 'function', value: match[1], raw: match[0] });
      seen.add(key);
    }
  }

  const projIdRegex = new RegExp(PROJECT_ID_REF.source, PROJECT_ID_REF.flags);
  while ((match = projIdRegex.exec(text)) !== null) {
    const key = `proj:${match[1]}`;
    if (!seen.has(key)) {
      refs.push({ type: 'project_id', value: match[1], raw: match[0] });
      seen.add(key);
    }
  }

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
// CROSS-DOMAIN ENRICHMENT
// ============================================================================

/**
 * Resolve unresolved references against the code graph.
 * Creates HAS_CODE_EVIDENCE edges from Task nodes to SourceFile/Function nodes.
 * Also updates task properties: hasCodeEvidence, codeEvidenceCount.
 * 
 * This is the key: a task that says "Build plan-parser.ts" gets linked to the
 * actual SourceFile node if it exists. The plan graph can then answer
 * "what's really done?" without relying on anyone checking a box.
 */
export async function enrichCrossDomain(
  parsedPlans: ParsedPlan[],
  neo4jUri: string = 'bolt://localhost:7687',
  neo4jUser: string = 'neo4j',
  neo4jPassword: string = 'codegraph',
): Promise<{ resolved: number; notFound: number; evidenceEdges: number; driftDetected: DriftItem[] }> {
  const neo4j = await import('neo4j-driver');
  const driver = neo4j.default.driver(neo4jUri, neo4j.default.auth.basic(neo4jUser, neo4jPassword));

  let resolved = 0;
  let notFound = 0;
  let evidenceEdges = 0;
  const driftDetected: DriftItem[] = [];

  try {
    // Collect all unresolved refs
    const allRefs = parsedPlans.flatMap((p) => p.unresolvedRefs);

    // Phase 1: Resolve refs and create evidence edges
    {
      const session = driver.session();
      try {
        for (const ref of allRefs) {
          if (ref.refType === 'depends_on' || ref.refType === 'blocks') {
            const sourceProjectId = ref.taskId.split(':')[0];
            const relType = ref.refType === 'depends_on' ? PlanEdgeType.DEPENDS_ON : PlanEdgeType.BLOCKS;

            // Support comma/semicolon-separated dependency tokens.
            const targets = ref.refValue
              .split(/[,;]+|\s+and\s+/i)
              .map((t) => t.replace(/[`*]/g, '').trim())
              .filter(Boolean);

            for (const targetToken of targets) {
              const m = targetToken.match(/^M(\d+)\b/i);
              const milestoneNum = m ? parseInt(m[1], 10) : null;
              const milestoneHint = (targetToken.match(/^M\d+[\-_: ]+(.+)$/i)?.[1] ?? '').trim();

              const result = await session.run(
                `MATCH (target:CodeNode)
                 WHERE target.coreType IN ['Task', 'Milestone', 'Section', 'Sprint', 'Decision', 'PlanProject']
                 AND (
                   target.id = $token
                   OR toLower(target.name) = toLower($token)
                   OR toLower(target.name) CONTAINS toLower($token)
                   OR ($milestoneNum IS NOT NULL AND target.coreType = 'Milestone' AND target.number = toInteger($milestoneNum))
                 )
                 WITH target,
                      CASE WHEN target.id = $token THEN 100 ELSE 0 END +
                      CASE WHEN target.projectId = $sourceProjectId THEN 30 ELSE 0 END +
                      CASE WHEN toLower(target.name) = toLower($token) THEN 20 ELSE 0 END +
                      CASE WHEN $milestoneNum IS NOT NULL AND target.coreType = 'Milestone' AND target.number = toInteger($milestoneNum) THEN 15 ELSE 0 END +
                      CASE WHEN $milestoneHint <> '' AND toLower(target.name) CONTAINS toLower($milestoneHint) THEN 10 ELSE 0 END +
                      CASE WHEN target.projectId STARTS WITH 'plan_' THEN 5 ELSE 0 END AS score
                 WHERE score > 0
                 RETURN target.id AS id
                 ORDER BY score DESC
                 LIMIT 5`,
                {
                  sourceProjectId,
                  token: targetToken,
                  milestoneNum,
                  milestoneHint,
                },
              );

              if (result.records.length > 0) {
                for (const record of result.records) {
                  const targetId = record.get('id');
                  if (targetId === ref.taskId) continue;

                  await session.run(
                    `MATCH (src:CodeNode {id: $srcId}), (dst:CodeNode {id: $dstId})
                     MERGE (src)-[r:${relType}]->(dst)
                     SET r.projectId = $projectId,
                         r.refType = $refType,
                         r.refValue = $refValue,
                         r.resolvedAt = datetime()`,
                    {
                      srcId: ref.taskId,
                      dstId: targetId,
                      projectId: sourceProjectId,
                      refType: ref.refType,
                      refValue: targetToken,
                    },
                  );
                }
                resolved++;
              } else {
                notFound++;
              }
            }
          } else if (ref.refType === 'file_path') {
            const filename = path.basename(ref.refValue);
            const result = await session.run(
              `MATCH (sf:SourceFile)
               WHERE sf.name ENDS WITH $filename OR sf.filePath ENDS WITH $refValue
               RETURN sf.id AS id, sf.name AS name, sf.filePath AS filePath, sf.projectId AS projectId
               LIMIT 5`,
              { filename, refValue: ref.refValue },
            );

            if (result.records.length > 0) {
              resolved++;
              for (const record of result.records) {
                const sfId = record.get('id');
                const sfProjectId = record.get('projectId');

                // Use label-agnostic match — code graph nodes may not have CodeNode label
                await session.run(
                  `MATCH (t {id: $taskId}), (sf {id: $sfId})
                   MERGE (t)-[r:HAS_CODE_EVIDENCE]->(sf)
                   SET r.refType = 'file_path',
                       r.refValue = $refValue,
                       r.codeProjectId = $sfProjectId,
                       r.resolvedAt = datetime()`,
                  { taskId: ref.taskId, sfId, refValue: ref.refValue, sfProjectId },
                );
                evidenceEdges++;
              }

              await session.run(
                `MATCH (t {id: $taskId})
                 SET t.hasCodeEvidence = true,
                     t.codeEvidenceCount = $count`,
                { taskId: ref.taskId, count: result.records.length },
              );
            } else {
              notFound++;
            }
          } else if (ref.refType === 'function') {
            const funcName = ref.refValue.split('.').pop() || ref.refValue;
            const result = await session.run(
              `MATCH (fn)
               WHERE (fn:Function OR fn:Method OR fn:Variable) AND fn.name = $funcName
               RETURN fn.id AS id, fn.name AS name, fn.projectId AS projectId
               LIMIT 5`,
              { funcName },
            );

            if (result.records.length > 0) {
              resolved++;
              for (const record of result.records) {
                const fnId = record.get('id');
                const fnProjectId = record.get('projectId');

                // Use label-agnostic match — code graph nodes may not have CodeNode label
                await session.run(
                  `MATCH (t {id: $taskId}), (fn {id: $fnId})
                   MERGE (t)-[r:HAS_CODE_EVIDENCE]->(fn)
                   SET r.refType = 'function',
                       r.refValue = $refValue,
                       r.codeProjectId = $fnProjectId,
                       r.resolvedAt = datetime()`,
                  { taskId: ref.taskId, fnId, refValue: ref.refValue, fnProjectId },
                );
                evidenceEdges++;
              }

              await session.run(
                `MATCH (t {id: $taskId})
                 SET t.hasCodeEvidence = true,
                     t.codeEvidenceCount = coalesce(t.codeEvidenceCount, 0) + $count`,
                { taskId: ref.taskId, count: result.records.length },
              );
            } else {
              notFound++;
            }
          }
        }
      } finally {
        await session.close();
      }
    }

      // Phase 1b: Check documentation coverage
    // For each project that has a SKILL.md, AGENTS.md, CLAUDE.md, or README.md,
    // verify the doc mentions key code graph elements
    {
      const session = driver.session();
      try {
        // Find projects that have both plan nodes and code nodes
        const projectResult = await session.run(
          `MATCH (pp:PlanProject)
           WITH pp.name AS planName, pp.projectId AS planProjectId
           MATCH (cp:Project)
           WHERE toLower(cp.name) = toLower(planName) AND cp.type IS NULL
           RETURN planProjectId, cp.projectId AS codeProjectId, cp.name AS name`,
        );

        for (const record of projectResult.records) {
          const codeProjectId = record.get('codeProjectId');
          const planProjectId = record.get('planProjectId');
          const name = record.get('name');

          // Count code graph elements
          const codeStats = await session.run(
            `MATCH (n {projectId: $pid})
             WHERE n.coreType IN ['FunctionDeclaration', 'SourceFile', 'ClassDeclaration', 'MethodDeclaration']
             RETURN n.coreType AS type, count(n) AS count`,
            { pid: codeProjectId },
          );

          if (codeStats.records.length > 0) {
            // Update plan project with code coverage stats
            const statsMap: Record<string, number> = {};
            for (const r of codeStats.records) {
              statsMap[r.get('type')] = r.get('count')?.toNumber?.() || r.get('count');
            }
            await session.run(
              `MATCH (pp:PlanProject {projectId: $planPid})
               SET pp.linkedCodeProject = $codePid,
                   pp.codeSourceFiles = $sf,
                   pp.codeFunctions = $fn,
                   pp.codeClasses = $cls`,
              {
                planPid: planProjectId,
                codePid: codeProjectId,
                sf: statsMap['SourceFile'] || 0,
                fn: statsMap['FunctionDeclaration'] || 0,
                cls: statsMap['ClassDeclaration'] || 0,
              },
            );
          }
        }
      } finally {
        await session.close();
      }
    }

    // Phase 1c: Semantic keyword matching — match task descriptions to function names
    // For tasks with no explicit cross-refs, extract keywords and match against functions
    {
      const session = driver.session();
      try {
        // Get plan projects linked to code projects
        const linked = await session.run(
          `MATCH (pp:PlanProject)
           WHERE pp.linkedCodeProject IS NOT NULL
           RETURN pp.projectId AS planPid, pp.linkedCodeProject AS codePid`,
        );

        for (const linkRec of linked.records) {
          const planPid = linkRec.get('planPid');
          const codePid = linkRec.get('codePid');

          // Get project name for context-aware noise filtering
          const projNameResult = await session.run(
            `MATCH (pp:PlanProject {projectId: $planPid}) RETURN pp.name AS name`,
            { planPid },
          );
          const projName = projNameResult.records[0]?.get('name')?.toLowerCase() || '';

          // Project-specific noise: if the project IS a parser, "parser" is noise
          // These are terms so common in the project's domain they match everything
          const projectNoise: Record<string, string[]> = {
            'codegraph': ['parser', 'graph', 'node', 'edge', 'project', 'import', 'code', 'json', 'schema', 'core', 'current', 'land', 'build', 'agent', 'service'],
            'godspeed': ['token', 'user', 'wallet', 'callback'],
            'bible-graph': ['verse', 'node', 'edge', 'book', 'chapter'],
            'plan-graph': ['plan', 'task', 'node', 'edge'],
          };
          const extraNoise = projectNoise[projName] || [];

          // Get tasks without evidence in this plan project
          // Skip tasks already audited as FALSE_POSITIVE — don't re-create bad edges
          const tasks = await session.run(
            `MATCH (t:Task {projectId: $planPid})
             WHERE (t.hasCodeEvidence IS NULL OR t.hasCodeEvidence = false)
             AND (t.auditVerdict IS NULL OR t.auditVerdict <> 'FALSE_POSITIVE')
             RETURN t.id AS id, t.name AS name`,
            { planPid },
          );

          for (const taskRec of tasks.records) {
            const taskId = taskRec.get('id');
            const taskName: string = taskRec.get('name');

            // Extract meaningful keywords from task name (lowercase, > 3 chars, no noise)
            const noise = new Set(['with', 'from', 'that', 'this', 'when', 'than', 'them', 'then',
              'each', 'only', 'show', 'make', 'into', 'card', 'type', 'mode', 'both', 'open',
              'used', 'uses', 'none', 'auto', 'adds', 'also', 'same', 'first', 'after', 'before',
              'button', 'toggle', 'display', 'success', 'default', 'setting', 'settings', 'command',
              'notification', 'position', 'positions', 'order', 'orders', 'field', 'fields', 'input',
              'custom', 'amount', 'number', 'text', 'value', 'build', 'write', 'define', 'create',
              'implement', 'refactor', 'based', 'using', 'existing', 'across', 'enable', 'source',
              ...extraNoise]);
            const keywords = taskName
              .toLowerCase()
              .replace(/[^a-z0-9\s-_]/g, ' ')
              .split(/[\s\-_]+/)
              .filter((w) => w.length > 3 && !noise.has(w));

            if (keywords.length === 0) continue;

            // Build keyword match: function name must contain at least one keyword
            // Require 5+ chars for stronger signal (avoids "core", "land", "json" collisions)
            for (const keyword of keywords) {
              if (keyword.length < 5) continue;
              const result = await session.run(
                `MATCH (f {projectId: $codePid})
                 WHERE f.coreType IN ['FunctionDeclaration', 'ArrowFunction', 'MethodDeclaration']
                 AND toLower(f.name) CONTAINS $keyword
                 RETURN f.id AS id, f.name AS name
                 LIMIT 3`,
                { codePid, keyword },
              );

              if (result.records.length > 0) {
                // Found matching functions — create evidence edge
                for (const funcRec of result.records) {
                  const fnId = funcRec.get('id');
                  await session.run(
                    `MATCH (t {id: $taskId}), (fn {id: $fnId})
                     MERGE (t)-[r:HAS_CODE_EVIDENCE]->(fn)
                     ON CREATE SET r.refType = 'semantic_keyword',
                         r.refValue = $keyword,
                         r.codeProjectId = $codePid,
                         r.resolvedAt = datetime()`,
                    { taskId, fnId, keyword, codePid },
                  );
                  evidenceEdges++;
                }

                await session.run(
                  `MATCH (t {id: $taskId})
                   SET t.hasSemanticEvidence = true,
                       t.semanticEvidenceCount = coalesce(t.semanticEvidenceCount, 0) + $cnt`,
                  { taskId, cnt: result.records.length },
                );
                break; // One keyword match is enough per task
              }
            }
          }
        }
      } finally {
        await session.close();
      }
    }

    // Phase 1d: Recompute task evidence flags (explicit vs semantic)
    // Only explicit refs (file_path/function) count as completion evidence.
    {
      const session = driver.session();
      try {
        const planPids = parsedPlans.map((p) => p.projectId);
        await session.run(
          `MATCH (t:Task)
           WHERE t.projectId IN $planPids
           OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->()
           WITH t,
                sum(CASE WHEN r.refType IN ['file_path', 'function'] THEN 1 ELSE 0 END) AS explicitCount,
                sum(CASE WHEN r.refType = 'semantic_keyword' THEN 1 ELSE 0 END) AS semanticCount
           SET t.hasCodeEvidence = explicitCount > 0,
               t.codeEvidenceCount = explicitCount,
               t.hasSemanticEvidence = semanticCount > 0,
               t.semanticEvidenceCount = semanticCount`,
          { planPids },
        );
      } finally {
        await session.close();
      }
    }

    // Phase 2: Drift detection (separate session)
    {
      const session = driver.session();
      try {
        // Tasks marked 'planned' but with code evidence (forgotten checkboxes)
        const planPids = parsedPlans.map((p) => p.projectId);

        const driftResult = await session.run(
          `MATCH (t:Task {status: 'planned'})
           WHERE t.hasCodeEvidence = true
             AND t.projectId IN $planPids
           RETURN t.id AS id, t.name AS name, t.filePath AS file, t.line AS line, t.projectId AS project`,
          { planPids },
        );

        for (const record of driftResult.records) {
          driftDetected.push({
            taskId: record.get('id'),
            taskName: record.get('name'),
            file: record.get('file'),
            line: record.get('line')?.toNumber?.() || record.get('line'),
            project: record.get('project'),
            reason: 'Task marked planned but code evidence exists — likely done but checkbox not checked',
          });
        }

        // Tasks marked 'done' but referenced code not found
        const revertResult = await session.run(
          `MATCH (t:Task {status: 'done'})
           WHERE t.crossRefCount > 0
             AND (t.hasCodeEvidence IS NULL OR t.hasCodeEvidence = false)
             AND t.projectId IN $planPids
           RETURN t.id AS id, t.name AS name, t.filePath AS file, t.line AS line, t.projectId AS project`,
          { planPids },
        );

        for (const record of revertResult.records) {
          driftDetected.push({
            taskId: record.get('id'),
            taskName: record.get('name'),
            file: record.get('file'),
            line: record.get('line')?.toNumber?.() || record.get('line'),
            project: record.get('project'),
            reason: 'Task marked done but referenced code not found — code may have been deleted or moved',
          });
        }
      } finally {
        await session.close();
      }
    }
  } finally {
    await driver.close();
  }

  return { resolved, notFound, evidenceEdges, driftDetected };
}

export interface DriftItem {
  taskId: string;
  taskName: string;
  file: string;
  line: number;
  project: string;
  reason: string;
}

// ============================================================================
// NEO4J INGEST (UPSERT-SAFE)
// ============================================================================

export async function ingestToNeo4j(
  parsed: ParsedPlan,
  neo4jUri: string = 'bolt://localhost:7687',
  neo4jUser: string = 'neo4j',
  neo4jPassword: string = 'codegraph',
): Promise<{ nodesUpserted: number; edgesCreated: number; staleRemoved: number }> {
  const neo4j = await import('neo4j-driver');
  const driver = neo4j.default.driver(neo4jUri, neo4j.default.auth.basic(neo4jUser, neo4jPassword));
  const session = driver.session();

  let nodesUpserted = 0;
  let edgesCreated = 0;
  let staleRemoved = 0;

  // Collect all current node IDs so we can detect stale ones
  const currentNodeIds = new Set(parsed.nodes.map((n) => n.id));

  try {
    // Phase 1: Remove stale nodes from previous parse that no longer exist
    // This handles: deleted tasks, restructured sections, removed milestones
    const existingResult = await session.run(
      `MATCH (n:CodeNode {projectId: $projectId})
       WHERE n.coreType IN ['Task', 'Milestone', 'Section', 'Sprint', 'Decision', 'PlanProject']
       RETURN n.id AS id`,
      { projectId: parsed.projectId },
    );

    const staleIds: string[] = [];
    for (const record of existingResult.records) {
      const id = record.get('id');
      if (!currentNodeIds.has(id)) {
        staleIds.push(id);
      }
    }

    if (staleIds.length > 0) {
      // Delete stale nodes and their edges
      await session.run(
        `UNWIND $ids AS staleId
         MATCH (n:CodeNode {id: staleId})
         DETACH DELETE n`,
        { ids: staleIds },
      );
      staleRemoved = staleIds.length;
    }

    // Phase 2: Upsert all current nodes
    for (const node of parsed.nodes) {
      const labels = node.labels.join(':');
      await session.run(
        `MERGE (n:${labels} {id: $id}) SET n += $props`,
        { id: node.id, props: { ...node.properties, id: node.id } },
      );
      nodesUpserted++;
    }

    // Phase 3: Recreate structural plan edges
    // Delete prior structural edges emitted by the plan parser for this project,
    // including cross-project targets (e.g., TARGETS -> Project nodes), then rebuild.
    await session.run(
      `MATCH (a:CodeNode {projectId: $projectId})-[r:PART_OF|BLOCKS|DEPENDS_ON|MODIFIES|TARGETS|BASED_ON|SUPERSEDES]->()
       DELETE r`,
      { projectId: parsed.projectId },
    );

    for (const edge of parsed.edges) {
      try {
        await session.run(
          `MATCH (a:CodeNode {id: $source}), (b:CodeNode {id: $target})
           MERGE (a)-[r:${edge.type}]->(b)
           SET r += $props`,
          { source: edge.source, target: edge.target, props: edge.properties },
        );
        edgesCreated++;
      } catch (err: any) {
        // Acceptable — edge target might not exist for cross-project refs
      }
    }

    // Phase 4: Update Project node
    await session.run(
      `MERGE (p:Project:CodeNode {projectId: $projectId})
       SET p.name = $name, p.type = 'plan', p.nodeCount = $nodeCount, p.edgeCount = $edgeCount,
           p.lastParsed = datetime()`,
      {
        projectId: parsed.projectId,
        name: parsed.projectName,
        nodeCount: nodesUpserted,
        edgeCount: edgesCreated,
      },
    );
  } finally {
    await session.close();
    await driver.close();
  }

  return { nodesUpserted, edgesCreated, staleRemoved };
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

export async function main() {
  const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const plansRoot = positionalArgs[0] || path.resolve(process.cwd(), '../plans');
  const filterArg = positionalArgs[1];
  const projectFilter = filterArg ? filterArg.split(',') : undefined;
  const doIngest = process.argv.includes('--ingest');
  const doEnrich = process.argv.includes('--enrich');
  const doJson = process.argv.includes('--json');

  console.log(`\n📋 Plan Parser v2 — parsing ${plansRoot}`);
  if (projectFilter) console.log(`  Filter: ${projectFilter.join(', ')}`);

  const results = await parsePlanDirectory(plansRoot, projectFilter);

  let totalNodes = 0;
  let totalEdges = 0;
  let totalUnresolved = 0;

  for (const parsed of results) {
    const doneCount = parsed.nodes.filter((n) => n.properties.status === 'done').length;
    console.log(`\n  📁 ${parsed.projectName} (${parsed.projectId})`);
    console.log(`     Files: ${parsed.stats.files}`);
    console.log(`     Tasks: ${parsed.stats.tasks} (${doneCount} done)`);
    console.log(`     Milestones: ${parsed.stats.milestones}`);
    console.log(`     Sprints: ${parsed.stats.sprints}`);
    console.log(`     Decisions: ${parsed.stats.decisions}`);
    console.log(`     Cross-refs: ${parsed.stats.crossRefs} (${parsed.unresolvedRefs.length} to resolve)`);
    console.log(`     Total: ${parsed.nodes.length} nodes, ${parsed.edges.length} edges`);

    totalNodes += parsed.nodes.length;
    totalEdges += parsed.edges.length;
    totalUnresolved += parsed.unresolvedRefs.length;
  }

  console.log(`\n  📊 Total: ${totalNodes} nodes, ${totalEdges} edges, ${totalUnresolved} refs to resolve`);

  // Ingest to Neo4j
  if (doIngest) {
    console.log('\n  🔄 Ingesting to Neo4j (upsert-safe)...');
    for (const parsed of results) {
      const result = await ingestToNeo4j(parsed);
      console.log(`     ${parsed.projectName}: ${result.nodesUpserted} upserted, ${result.edgesCreated} edges, ${result.staleRemoved} stale removed`);
    }
    console.log('  ✅ Ingest done.');
  }

  // Cross-domain enrichment
  if (doEnrich || doIngest) {
    if (totalUnresolved > 0) {
      console.log('\n  🔗 Cross-domain enrichment...');
      const enrichResult = await enrichCrossDomain(results);
      console.log(`     Resolved: ${enrichResult.resolved}/${enrichResult.resolved + enrichResult.notFound} refs`);
      console.log(`     Evidence edges: ${enrichResult.evidenceEdges}`);

      if (enrichResult.driftDetected.length > 0) {
        console.log(`\n  ⚠️  DRIFT DETECTED (${enrichResult.driftDetected.length} items):`);
        for (const drift of enrichResult.driftDetected) {
          console.log(`     ${drift.project} ${drift.file}:${drift.line}`);
          console.log(`       ${drift.taskName}`);
          console.log(`       → ${drift.reason}`);
        }
      } else {
        console.log('     No drift detected.');
      }
    }
  }

  // JSON output
  if (doJson) {
    const outPath = path.resolve(process.cwd(), 'plan-graph.json');
    await fs.writeFile(outPath, JSON.stringify(results, null, 2));
    console.log(`  📄 JSON written to ${outPath}`);
  }

  if (!doIngest && !doEnrich) {
    console.log('\n  ℹ️  Run with --ingest to load into Neo4j (includes enrichment)');
  }
}

// Run if executed directly
const isDirectRun = process.argv[1]?.endsWith('plan-parser.js') || process.argv[1]?.endsWith('plan-parser.ts');
if (isDirectRun) {
  main().catch(console.error);
}
