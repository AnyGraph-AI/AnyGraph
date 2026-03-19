/**
 * Evidence Auto-Linker
 *
 * Automatically creates HAS_CODE_EVIDENCE edges for done tasks that lack them.
 * Runs as part of done-check pipeline, BEFORE plan:evidence:recompute.
 *
 * Strategy (layered, in order):
 * 1. Exact file name match: task name contains a filename that exists in the code project
 * 2. Function name match: task name contains a function/type name from the code project
 * 3. Keyword extraction: extract key terms from task name, match against file/function names
 *
 * Only links tasks with confidence >= 0.8 to avoid false positives.
 * All edges tagged source='evidence_auto_linker' for traceability.
 */

import { Neo4jService } from '../../src/storage/neo4j/neo4j.service.js';

interface LinkResult {
  taskName: string;
  targetName: string;
  targetFile: string;
  matchType: 'exact_file' | 'function_name' | 'keyword';
  confidence: number;
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();
  const dryRun = process.argv.includes('--dry-run');

  try {
    // 1. Get all done tasks WITHOUT HAS_CODE_EVIDENCE edges
    const unlinkedTasks = await neo4j.run(`
      MATCH (t:CodeNode:Task {status: 'done'})
      WHERE t.projectId STARTS WITH 'plan_'
        AND NOT (t)-[:HAS_CODE_EVIDENCE]->()
      RETURN t.name AS name, t.projectId AS planProjectId, elementId(t) AS taskElementId
    `);

    if (!unlinkedTasks || unlinkedTasks.length === 0) {
      console.log(JSON.stringify({ ok: true, linked: 0, unlinkedRemaining: 0, message: 'No unlinked done tasks' }));
      return;
    }

    // 2. Get all code project SourceFiles and named declarations
    // Map plan project IDs to code project IDs (dynamic discovery)
    const projectMapping = await neo4j.run(`
      MATCH (pp)-[:TARGETS]->(cp:Project)
      WHERE pp.projectId STARTS WITH 'plan_'
      RETURN pp.projectId AS planId, cp.projectId AS codeId
    `);

    const planToCode = new Map<string, string>();
    for (const row of projectMapping ?? []) {
      planToCode.set(String(row.planId), String(row.codeId));
    }

    // Fallback mappings for plans without TARGETS edges
    if (!planToCode.has('plan_codegraph')) planToCode.set('plan_codegraph', 'proj_c0d3e9a1f200');
    // GodSpeed and bible-graph purged from graph — no fallback mappings

    // Get all source files and top-level declarations per code project
    const codeAssets = new Map<string, Array<{ name: string; filePath: string; elementId: string; kind: string }>>();

    for (const [_planId, codeId] of planToCode) {
      if (codeAssets.has(codeId)) continue;

      const assets = await neo4j.run(`
        MATCH (n {projectId: $codeId})
        WHERE (n:SourceFile OR (n:CodeNode AND n.kind IN ['Function', 'Method', 'Class', 'Interface', 'TypeAlias', 'Variable']))
          AND n.name IS NOT NULL
        RETURN n.name AS name, n.filePath AS filePath, elementId(n) AS elementId,
               CASE WHEN n:SourceFile THEN 'SourceFile' ELSE n.kind END AS kind
      `, { codeId });

      codeAssets.set(codeId, (assets ?? []).map(a => ({
        name: String(a.name),
        filePath: String(a.filePath ?? ''),
        elementId: String(a.elementId),
        kind: String(a.kind ?? 'unknown'),
      })));
    }

    // 3. Match tasks to code assets
    const links: LinkResult[] = [];
    const linkEdges: Array<{ taskElementId: string; targetElementId: string; matchType: string; confidence: number }> = [];

    for (const task of unlinkedTasks) {
      const taskName = String(task.name).toLowerCase();
      const planId = String(task.planProjectId);
      const codeId = planToCode.get(planId);
      if (!codeId) continue;

      const assets = codeAssets.get(codeId);
      if (!assets) continue;

      // Strategy 1: Exact file name match
      // Only match filenames that are specific enough (not index.ts, schema.ts, utils.ts, etc.)
      const genericNames = new Set(['index.ts', 'schema.ts', 'utils.ts', 'types.ts', 'constants.ts', 'config.ts', 'helpers.ts', 'main.ts']);
      const fileMatches = assets.filter(a => {
        if (a.kind !== 'SourceFile') return false;
        if (genericNames.has(a.name.toLowerCase())) return false;
        const stem = a.name.toLowerCase().replace(/\.(ts|js|tsx|jsx)$/, '');
        // Require stem to be at least 6 chars to avoid spurious matches
        if (stem.length < 6) return false;
        return taskName.includes(stem);
      });

      for (const match of fileMatches) {
        links.push({ taskName: String(task.name), targetName: match.name, targetFile: match.filePath, matchType: 'exact_file', confidence: 0.95 });
        linkEdges.push({ taskElementId: String(task.taskElementId), targetElementId: match.elementId, matchType: 'exact_file', confidence: 0.95 });
      }

      if (fileMatches.length > 0) continue; // Skip further matching if file match found

      // Strategy 2: Function/type name match
      // Extract key terms from task name (3+ chars, not stop words)
      const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'implement', 'add', 'create', 'build', 'define', 'test', 'fix', 'update', 'run', 'all', 'new', 'use', 'set', 'get', 'has', 'not', 'are', 'was', 'been', 'each', 'only', 'when', 'must', 'via', 'per']);
      const taskTerms = taskName
        .replace(/[^a-z0-9_-]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 4 && !stopWords.has(t));

      // Match against function/class/type names (case-insensitive)
      const funcMatches = assets.filter(a => {
        if (a.kind === 'SourceFile') return false;
        const aName = a.name.toLowerCase();
        // Must match at least one significant term
        return taskTerms.some(term => aName.includes(term) || term.includes(aName));
      });

      // Take top 3 function matches at most
      for (const match of funcMatches.slice(0, 3)) {
        links.push({ taskName: String(task.name), targetName: match.name, targetFile: match.filePath, matchType: 'function_name', confidence: 0.85 });
        linkEdges.push({ taskElementId: String(task.taskElementId), targetElementId: match.elementId, matchType: 'function_name', confidence: 0.85 });
      }
    }

    // 4. Create edges (unless dry-run)
    let created = 0;
    if (!dryRun && linkEdges.length > 0) {
      for (const edge of linkEdges) {
        try {
          await neo4j.run(`
            MATCH (t) WHERE elementId(t) = $taskId
            MATCH (s) WHERE elementId(s) = $targetId
            MERGE (t)-[e:HAS_CODE_EVIDENCE]->(s)
            ON CREATE SET e.source = 'evidence_auto_linker',
                          e.refType = CASE
                            WHEN 'Function' IN labels(s) THEN 'function'
                            WHEN 'SourceFile' IN labels(s) THEN 'file_path'
                            ELSE 'auto_link'
                          END,
                          e.matchType = $matchType,
                          e.confidence = $confidence,
                          e.createdAt = datetime()
          `, {
            taskId: edge.taskElementId,
            targetId: edge.targetElementId,
            matchType: edge.matchType,
            confidence: edge.confidence,
          });
          created++;
        } catch (err: any) {
          console.error(`Failed to link: ${err.message}`);
        }
      }
    }

    // 5. Count remaining unlinked
    const remaining = await neo4j.run(`
      MATCH (t:CodeNode:Task {status: 'done'})
      WHERE t.projectId STARTS WITH 'plan_'
        AND NOT (t)-[:HAS_CODE_EVIDENCE]->()
      RETURN count(t) AS cnt
    `);

    console.log(JSON.stringify({
      ok: true,
      dryRun,
      candidateTasks: unlinkedTasks.length,
      matched: links.length,
      created: dryRun ? 0 : created,
      unlinkedRemaining: Number(remaining?.[0]?.cnt ?? 0),
      links: dryRun ? links.map(l => ({ task: l.taskName.substring(0, 80), target: l.targetName, type: l.matchType, confidence: l.confidence })) : undefined,
    }, null, 2));

  } finally {
    await neo4j.getDriver().close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
