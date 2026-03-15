/**
 * Observed-Change Event Emitters (GTH-6)
 *
 * Emits real-time observation edges in Neo4j as agents interact with the graph.
 * These edges build a provenance trail without requiring agent discipline.
 *
 * Edge types:
 * - TOUCHED: agent edited or will edit a file (from pre_edit_check)
 * - REFERENCED: agent queried a file (from search_codebase, impact_analysis)
 * - COMMIT_REFERENCES_TASK: git commit message references a task
 * - VERIFIED_BY_RUN: governance pipeline run verified a file/task
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

export interface ObservedEdgeOptions {
  agentId: string;
  projectId: string;
  timestamp?: string;
}

/**
 * Emit a TOUCHED edge from SessionBookmark to a SourceFile.
 * Called as automatic side effect of pre_edit_check.
 */
export async function emitTouched(
  neo4j: Neo4jService,
  filePath: string,
  opts: ObservedEdgeOptions,
): Promise<void> {
  const now = opts.timestamp ?? new Date().toISOString();
  try {
    await neo4j.run(
      `MATCH (b:SessionBookmark {agentId: $agentId, projectId: $projectId})
       WHERE b.status IN ['claimed', 'in_progress', 'completing']
       MATCH (sf:SourceFile) WHERE sf.filePath ENDS WITH $filePath AND sf.projectId = $projectId
       MERGE (b)-[t:TOUCHED]->(sf)
       ON CREATE SET t.firstSeen = $now, t.lastSeen = $now, t.count = 1
       ON MATCH SET t.lastSeen = $now, t.count = t.count + 1`,
      { agentId: opts.agentId, filePath, projectId: opts.projectId, now },
    );
  } catch (err) {
    // Non-fatal — observation failure must never block agent work
    if (process.env.GTH_DEBUG) console.error('[GTH] emitTouched:', (err as Error).message ?? err);
  }
}

/**
 * Emit a REFERENCED edge from SessionBookmark to a SourceFile.
 * Called as automatic side effect of search_codebase and impact_analysis.
 */
export async function emitReferenced(
  neo4j: Neo4jService,
  filePaths: string[],
  opts: ObservedEdgeOptions,
): Promise<void> {
  if (filePaths.length === 0) return;
  const now = opts.timestamp ?? new Date().toISOString();
  try {
    await neo4j.run(
      `UNWIND $files AS fp
       MATCH (b:SessionBookmark {agentId: $agentId, projectId: $projectId})
       WHERE b.status IN ['claimed', 'in_progress', 'completing']
       MATCH (sf:SourceFile) WHERE sf.filePath ENDS WITH fp AND sf.projectId = $projectId
       MERGE (b)-[r:REFERENCED]->(sf)
       ON CREATE SET r.firstSeen = $now, r.lastSeen = $now, r.count = 1
       ON MATCH SET r.lastSeen = $now, r.count = r.count + 1`,
      { agentId: opts.agentId, files: filePaths, projectId: opts.projectId, now },
    );
  } catch (err) {
    // Non-fatal
    if (process.env.GTH_DEBUG) console.error('[GTH] emitReferenced:', (err as Error).message ?? err);
  }
}

/**
 * Parse git commit message for task references and emit COMMIT_REFERENCES_TASK edges.
 * Patterns: "GTH-1", "RF-2", task names in parentheses like "(GTH-1)"
 */
export async function emitCommitReferencesTask(
  neo4j: Neo4jService,
  commitHash: string,
  commitMessage: string,
  projectId: string,
): Promise<string[]> {
  // Extract task/milestone references from commit message
  const patterns = [
    /\b(GTH-\d+|RF-\d+|TC-\d+|N\d+|X\d+|L\d+|DF)\b/gi,
    /\(([A-Z]+-\d+(?:\/\d+)?)\)/g, // parenthesized task refs only (e.g., (RF-2), (GTH-1/3))
  ];

  const refs = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(commitMessage)) !== null) {
      refs.add(match[1]);
    }
  }

  if (refs.size === 0) return [];

  const now = new Date().toISOString();
  const refArray = [...refs];

  try {
    const rows = await neo4j.run(
      `UNWIND $refs AS ref
       MATCH (t:Task {projectId: $projectId})
       WHERE t.name CONTAINS ref OR t.id CONTAINS ref
       WITH ref, t LIMIT 1
       MERGE (c:Commit {hash: $hash})
       ON CREATE SET c.message = $message, c.timestamp = $now
       MERGE (c)-[r:COMMIT_REFERENCES_TASK]->(t)
       ON CREATE SET r.timestamp = $now
       RETURN t.name AS name`,
      { projectId, refs: refArray, hash: commitHash, message: commitMessage, now },
    );
    return rows.map(r => String(r.name));
  } catch (err) {
    // Non-fatal
    if (process.env.GTH_DEBUG) console.error('[GTH] emitCommitReferencesTask:', (err as Error).message ?? err);
    return [];
  }
}

/**
 * Emit VERIFIED_BY_RUN edge from a governance/verification run to affected files/tasks.
 */
export async function emitVerifiedByRun(
  neo4j: Neo4jService,
  runId: string,
  verdict: string,
  projectId: string,
  affectedPaths?: string[],
): Promise<void> {
  const now = new Date().toISOString();
  try {
    // Create or update the run node
    await neo4j.run(
      `MERGE (r:VerificationRun {id: $runId, projectId: $projectId})
       ON CREATE SET r.timestamp = $now, r.verdict = $verdict
       ON MATCH SET r.timestamp = $now, r.verdict = $verdict`,
      { runId, now, verdict, projectId },
    );

    // Link to affected files if provided
    if (affectedPaths && affectedPaths.length > 0) {
      await neo4j.run(
        `UNWIND $paths AS fp
         MATCH (r:VerificationRun {id: $runId})
         MATCH (sf:SourceFile) WHERE sf.filePath ENDS WITH fp AND sf.projectId = $projectId
         MERGE (sf)-[v:VERIFIED_BY_RUN]->(r)
         ON CREATE SET v.timestamp = $now`,
        { runId, paths: affectedPaths, projectId, now },
      );
    }
  } catch (err) {
    // Non-fatal
    if (process.env.GTH_DEBUG) console.error('[GTH] emitVerifiedByRun:', (err as Error).message ?? err);
  }
}
