/**
 * Ground Truth Hook — WARN Enforcement (GTH-5)
 *
 * Produces advisory warnings for MCP tools (pre_edit_check, simulate_edit).
 * Warnings are non-blocking — they inform, never gate.
 *
 * Warns if:
 * - Agent calls pre_edit_check with no claimed task
 * - SessionBookmark hasn't been updated in >30 minutes
 * - currentTaskId references a task that's already done
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

export interface BookmarkWarning {
  code: string;
  message: string;
  severity: 'warn' | 'info';
}

export async function checkBookmarkWarnings(
  neo4j: Neo4jService,
  agentId?: string,
): Promise<BookmarkWarning[]> {
  if (!agentId) {
    return [{
      code: 'NO_AGENT_ID',
      message: 'No agentId provided — SessionBookmark tracking inactive. Consider setting agentId for drift detection.',
      severity: 'info',
    }];
  }

  const warnings: BookmarkWarning[] = [];

  try {
    const rows = await neo4j.run(
      `MATCH (b:SessionBookmark {agentId: $agentId})
       WHERE b.status IN ['claimed', 'in_progress', 'completing']
       RETURN b.status AS status, b.currentTaskId AS taskId,
              b.updatedAt AS updatedAt, b.projectId AS projectId
       ORDER BY b.updatedAt DESC LIMIT 1`,
      { agentId },
    );

    if (rows.length === 0) {
      warnings.push({
        code: 'NO_CLAIMED_TASK',
        message: 'No active SessionBookmark — editing without a claimed task. Consider claiming a task first.',
        severity: 'warn',
      });
      return warnings;
    }

    const bm = rows[0];

    // Stale bookmark (>30 min)
    if (bm.updatedAt) {
      const ageMs = Date.now() - new Date(String(bm.updatedAt)).getTime();
      const ageMin = ageMs / (1000 * 60);
      if (ageMin > 30) {
        warnings.push({
          code: 'STALE_BOOKMARK',
          message: `SessionBookmark last updated ${Math.round(ageMin)} minutes ago. Consider refreshing.`,
          severity: 'warn',
        });
      }
    }

    // Task already done
    if (bm.taskId) {
      const doneRows = await neo4j.run(
        `MATCH (t:Task {projectId: $projectId})
         WHERE (t.id = $taskId OR t.name = $taskId) AND t.status = 'done'
         RETURN t.name AS name`,
        { taskId: String(bm.taskId), projectId: String(bm.projectId) },
      );
      if (doneRows.length > 0) {
        warnings.push({
          code: 'TASK_ALREADY_DONE',
          message: `Claimed task "${bm.taskId}" is already marked done in the graph.`,
          severity: 'warn',
        });
      }
    }
  } catch (err) {
    // Non-fatal — if Neo4j is down or schema doesn't exist yet, don't block
    if (process.env.GTH_DEBUG) console.error('[GTH] checkBookmarkWarnings:', (err as Error).message ?? err);
  }

  return warnings;
}
