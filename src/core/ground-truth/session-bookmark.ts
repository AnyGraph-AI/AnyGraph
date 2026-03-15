/**
 * SessionBookmark — Agent State Persistence (GTH-4)
 *
 * Tracks agent state in Neo4j as SessionBookmark nodes.
 * Lifecycle: IDLE → CLAIMED → IN_PROGRESS → COMPLETING → IDLE
 * Abandonment sets status to IDLE with reason logged.
 *
 * Multi-agent: advisory duplicate claim detection, hard stop on task-already-done.
 * GC: keeps last 20 completed, 10 abandoned per agent.
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

export type BookmarkStatus = 'idle' | 'claimed' | 'in_progress' | 'completing';

export interface SessionBookmark {
  id: string;
  agentId: string;
  projectId: string;
  status: BookmarkStatus;
  currentTaskId: string | null;
  currentMilestone: string | null;
  taskContext: string | null;
  claimedAt: string | null;
  workingSetNodeIds: string[];
  targetCommit: string | null;
  expectedTests: number | null;
  // Governance
  lastGroundTruth: string | null;
  lastGovernanceTimestamp: string | null;
  lastGovernanceVerdict: string | null;
  lastGovernanceCommit: string | null;
  // Metrics
  groundTruthRuns: number;
  driftDetected: number;
  // Lease (NULL until multi-agent)
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface ClaimTaskOptions {
  agentId: string;
  projectId: string;
  taskId: string;
  milestone: string;
  taskContext: string;
  targetCommit?: string;
  expectedTests?: number;
}

export interface MultiAgentConflict {
  type: 'duplicate_claim' | 'task_already_done';
  severity: 'advisory' | 'hard_stop';
  message: string;
  conflictingAgent?: string;
}

export class SessionBookmarkManager {
  private neo4j: Neo4jService;

  constructor(neo4j?: Neo4jService) {
    this.neo4j = neo4j ?? new Neo4jService();
  }

  // ─── Read ───────────────────────────────────────────────────────

  async getBookmark(agentId: string, projectId: string): Promise<SessionBookmark | null> {
    const rows = await this.neo4j.run(
      `MATCH (b:SessionBookmark {agentId: $agentId, projectId: $projectId})
       RETURN b ORDER BY
         CASE WHEN b.status <> 'idle' THEN 0 ELSE 1 END,
         b.updatedAt DESC
       LIMIT 1`,
      { agentId, projectId },
    );

    if (rows.length === 0) return null;
    return this.rowToBookmark(rows[0]);
  }

  async getActiveBookmark(agentId: string): Promise<SessionBookmark | null> {
    const rows = await this.neo4j.run(
      `MATCH (b:SessionBookmark {agentId: $agentId})
       WHERE b.status IN ['claimed', 'in_progress', 'completing']
       RETURN b ORDER BY b.updatedAt DESC LIMIT 1`,
      { agentId },
    );

    if (rows.length === 0) return null;
    return this.rowToBookmark(rows[0]);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async claimTask(opts: ClaimTaskOptions): Promise<{ bookmark: SessionBookmark; conflicts: MultiAgentConflict[] }> {
    const now = new Date().toISOString();
    const bookmarkId = `bm_${opts.agentId}_${Date.now()}`;

    // ℹ️-4: Single transaction — fold done check + active guard into MERGE to eliminate TOCTOU race.
    // If task is done, the WHERE doneTask IS NULL fails and MERGE never runs.
    // C3: If agent has an active (in_progress/completing) bookmark, the WHERE activeBm IS NULL fails.
    const claimRows = await this.neo4j.run(
      `OPTIONAL MATCH (t:Task {projectId: $projectId})
       WHERE (t.id = $taskId OR t.name = $taskId) AND t.status = 'done'
       WITH t AS doneTask
       OPTIONAL MATCH (existingBm:SessionBookmark {agentId: $agentId, projectId: $projectId})
       WHERE existingBm.status IN ['in_progress', 'completing']
       WITH doneTask, existingBm
       WHERE doneTask IS NULL AND existingBm IS NULL
       MERGE (b:SessionBookmark {agentId: $agentId, projectId: $projectId})
       ON CREATE SET
         b.id = $bookmarkId,
         b.status = 'claimed',
         b.currentTaskId = $taskId,
         b.currentMilestone = $milestone,
         b.taskContext = $taskContext,
         b.claimedAt = $now,
         b.workingSetNodeIds = [],
         b.targetCommit = $targetCommit,
         b.expectedTests = $expectedTests,
         b.groundTruthRuns = 0,
         b.driftDetected = 0,
         b.createdAt = $now,
         b.updatedAt = $now
       ON MATCH SET
         b.status = 'claimed',
         b.currentTaskId = $taskId,
         b.currentMilestone = $milestone,
         b.taskContext = $taskContext,
         b.claimedAt = $now,
         b.workingSetNodeIds = [],
         b.targetCommit = $targetCommit,
         b.expectedTests = $expectedTests,
         b.updatedAt = $now
       RETURN b`,
      {
        agentId: opts.agentId,
        projectId: opts.projectId,
        bookmarkId,
        taskId: opts.taskId,
        milestone: opts.milestone,
        taskContext: opts.taskContext,
        targetCommit: opts.targetCommit ?? null,
        expectedTests: opts.expectedTests ?? null,
        now,
      },
    );

    const conflicts: MultiAgentConflict[] = [];

    // If MERGE didn't run (claimRows empty), either task was done or agent has active bookmark
    if (claimRows.length === 0) {
      // Distinguish the two failure cases with a quick check
      const activeCheck = await this.neo4j.run(
        `OPTIONAL MATCH (bm:SessionBookmark {agentId: $agentId, projectId: $projectId})
         WHERE bm.status IN ['in_progress', 'completing']
         RETURN bm.currentTaskId AS activeTask`,
        { agentId: opts.agentId, projectId: opts.projectId },
      );
      if (activeCheck.length > 0 && activeCheck[0].activeTask != null) {
        conflicts.push({
          type: 'duplicate_claim',
          severity: 'hard_stop',
          message: `Agent "${opts.agentId}" has an active task "${activeCheck[0].activeTask}" in project "${opts.projectId}" — transition to idle first`,
        });
      } else {
        conflicts.push({
          type: 'task_already_done',
          severity: 'hard_stop',
          message: `Task "${opts.taskId}" is already done in the graph`,
        });
      }
    }

    // Advisory: check for duplicate claims (separate query — advisory only)
    const claimedRows = await this.neo4j.run(
      `MATCH (b:SessionBookmark)
       WHERE b.currentTaskId = $taskId AND b.agentId <> $agentId
             AND b.status IN ['claimed', 'in_progress', 'completing']
       RETURN b.agentId AS agent`,
      { taskId: opts.taskId, agentId: opts.agentId },
    );
    if (claimedRows.length > 0) {
      conflicts.push({
        type: 'duplicate_claim',
        severity: 'advisory',
        message: `Task "${opts.taskId}" is already claimed by agent "${claimedRows[0].agent}"`,
        conflictingAgent: String(claimedRows[0].agent),
      });
    }

    const bookmark = await this.getBookmark(opts.agentId, opts.projectId);
    return {
      bookmark: bookmark ?? this.createDefaultBookmark(opts.agentId, opts.projectId),
      conflicts,
    };
  }

  async transitionTo(agentId: string, projectId: string, status: BookmarkStatus, reason?: string): Promise<SessionBookmark> {
    const now = new Date().toISOString();
    const setClause = status === 'idle'
      ? `b.status = 'idle', b.currentTaskId = null, b.currentMilestone = null, b.taskContext = null, b.claimedAt = null, b.workingSetNodeIds = [], b.updatedAt = $now`
      : `b.status = $status, b.updatedAt = $now`;

    await this.neo4j.run(
      `MATCH (b:SessionBookmark {agentId: $agentId, projectId: $projectId})
       SET ${setClause}
       RETURN b`,
      { agentId, projectId, status, now },
    );

    const bookmark = await this.getBookmark(agentId, projectId);
    return bookmark ?? this.createDefaultBookmark(agentId, projectId);
  }

  async addToWorkingSet(agentId: string, projectId: string, filePath: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (b:SessionBookmark {agentId: $agentId, projectId: $projectId})
       WHERE NOT $filePath IN b.workingSetNodeIds
       SET b.workingSetNodeIds = b.workingSetNodeIds + $filePath,
           b.updatedAt = $now`,
      { agentId, projectId, filePath, now: new Date().toISOString() },
    );
  }

  async recordGovernanceResult(agentId: string, projectId: string, verdict: string, commit: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (b:SessionBookmark {agentId: $agentId, projectId: $projectId})
       SET b.lastGovernanceTimestamp = $now,
           b.lastGovernanceVerdict = $verdict,
           b.lastGovernanceCommit = $commit,
           b.updatedAt = $now`,
      { agentId, projectId, verdict, commit, now: new Date().toISOString() },
    );
  }

  async recordGroundTruthRun(agentId: string, projectId: string, driftFound: boolean): Promise<void> {
    await this.neo4j.run(
      `MATCH (b:SessionBookmark {agentId: $agentId, projectId: $projectId})
       SET b.lastGroundTruth = $now,
           b.groundTruthRuns = coalesce(b.groundTruthRuns, 0) + 1,
           b.driftDetected = CASE WHEN $drift THEN coalesce(b.driftDetected, 0) + 1 ELSE b.driftDetected END,
           b.updatedAt = $now`,
      { agentId, projectId, now: new Date().toISOString(), drift: driftFound },
    );
  }

  // ─── Multi-Agent Conflict Detection ─────────────────────────────

  async detectConflicts(taskId: string, agentId: string, projectId: string): Promise<MultiAgentConflict[]> {
    const conflicts: MultiAgentConflict[] = [];

    // Hard stop: task already done in graph
    const doneRows = await this.neo4j.run(
      `MATCH (t:Task {projectId: $projectId})
       WHERE (t.id = $taskId OR t.name = $taskId) AND t.status = 'done'
       RETURN t.name AS name`,
      { taskId, projectId },
    );
    if (doneRows.length > 0) {
      conflicts.push({
        type: 'task_already_done',
        severity: 'hard_stop',
        message: `Task "${doneRows[0].name}" is already done in the graph`,
      });
    }

    // Advisory: another agent has this task claimed
    const claimedRows = await this.neo4j.run(
      `MATCH (b:SessionBookmark)
       WHERE b.currentTaskId = $taskId AND b.agentId <> $agentId
             AND b.status IN ['claimed', 'in_progress', 'completing']
       RETURN b.agentId AS agent`,
      { taskId, agentId },
    );
    if (claimedRows.length > 0) {
      conflicts.push({
        type: 'duplicate_claim',
        severity: 'advisory',
        message: `Task "${taskId}" is already claimed by agent "${claimedRows[0].agent}"`,
        conflictingAgent: String(claimedRows[0].agent),
      });
    }

    return conflicts;
  }

  // ─── Garbage Collection ─────────────────────────────────────────

  async gc(agentId: string): Promise<number> {
    // Keep last 20 idle bookmarks PER PROJECT, delete older (E6: prevents cross-project over-pruning)
    const result = await this.neo4j.run(
      `MATCH (b:SessionBookmark {agentId: $agentId, status: 'idle'})
       WITH b.projectId AS pid, b ORDER BY b.updatedAt DESC
       WITH pid, collect(b) AS bookmarks
       UNWIND bookmarks[20..] AS old
       DETACH DELETE old
       RETURN count(old) AS deleted`,
      { agentId },
    );
    return Number(result[0]?.deleted ?? 0);
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private rowToBookmark(row: Record<string, unknown>): SessionBookmark {
    // row is either a flat object or has a 'b' property
    const b = (row.b ?? row) as Record<string, unknown>;
    return {
      id: String(b.id ?? ''),
      agentId: String(b.agentId ?? ''),
      projectId: String(b.projectId ?? ''),
      status: (b.status as BookmarkStatus) ?? 'idle',
      currentTaskId: b.currentTaskId as string | null,
      currentMilestone: b.currentMilestone as string | null,
      taskContext: b.taskContext as string | null,
      claimedAt: b.claimedAt as string | null,
      workingSetNodeIds: (b.workingSetNodeIds as string[]) ?? [],
      targetCommit: b.targetCommit as string | null,
      expectedTests: b.expectedTests as number | null,
      lastGroundTruth: b.lastGroundTruth as string | null,
      lastGovernanceTimestamp: b.lastGovernanceTimestamp as string | null,
      lastGovernanceVerdict: b.lastGovernanceVerdict as string | null,
      lastGovernanceCommit: b.lastGovernanceCommit as string | null,
      groundTruthRuns: Number(b.groundTruthRuns ?? 0),
      driftDetected: Number(b.driftDetected ?? 0),
      leaseExpiresAt: b.leaseExpiresAt as string | null,
      heartbeatAt: b.heartbeatAt as string | null,
      createdAt: String(b.createdAt ?? ''),
      updatedAt: String(b.updatedAt ?? ''),
    };
  }

  private createDefaultBookmark(agentId: string, projectId: string): SessionBookmark {
    const now = new Date().toISOString();
    return {
      id: `bm_${agentId}_default`,
      agentId,
      projectId,
      status: 'idle',
      currentTaskId: null,
      currentMilestone: null,
      taskContext: null,
      claimedAt: null,
      workingSetNodeIds: [],
      targetCommit: null,
      expectedTests: null,
      lastGroundTruth: null,
      lastGovernanceTimestamp: null,
      lastGovernanceVerdict: null,
      lastGovernanceCommit: null,
      groundTruthRuns: 0,
      driftDetected: 0,
      leaseExpiresAt: null,
      heartbeatAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async close(): Promise<void> {
    await this.neo4j.close();
  }
}
