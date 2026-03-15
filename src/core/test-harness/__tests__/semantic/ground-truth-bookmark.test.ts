/**
 * GTH-4: SessionBookmark Extension + Agent State Tests
 *
 * Tests lifecycle transitions, conflict detection, GC, working set tracking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionBookmarkManager } from '../../../ground-truth/session-bookmark.js';

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('GTH-4: SessionBookmark Manager', () => {
  let neo4j: any;
  let mgr: SessionBookmarkManager;

  beforeEach(() => {
    neo4j = createMockNeo4j();
    mgr = new SessionBookmarkManager(neo4j);
  });

  describe('getBookmark', () => {
    it('returns null when no bookmark exists', async () => {
      const result = await mgr.getBookmark('watson', 'plan_codegraph');
      expect(result).toBeNull();
    });

    it('returns bookmark from Neo4j row', async () => {
      neo4j.run.mockResolvedValueOnce([{
        b: {
          id: 'bm_watson_1',
          agentId: 'watson',
          projectId: 'plan_codegraph',
          status: 'in_progress',
          currentTaskId: 'task_1',
          currentMilestone: 'RF-1',
          taskContext: 'Add view typing',
          claimedAt: '2026-03-14T19:00:00Z',
          workingSetNodeIds: ['src/foo.ts'],
          targetCommit: 'feat: view typing',
          expectedTests: 5,
          groundTruthRuns: 3,
          driftDetected: 1,
          createdAt: '2026-03-14T18:00:00Z',
          updatedAt: '2026-03-14T19:30:00Z',
        },
      }]);

      const result = await mgr.getBookmark('watson', 'plan_codegraph');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('in_progress');
      expect(result!.currentTaskId).toBe('task_1');
      expect(result!.workingSetNodeIds).toEqual(['src/foo.ts']);
    });
  });

  describe('claimTask', () => {
    it('detects task-already-done conflict (hard stop)', async () => {
      // Single-transaction: MERGE returns empty when task is done (WHERE doneTask IS NULL fails)
      neo4j.run
        .mockResolvedValueOnce([])                       // MERGE returned nothing (task was done)
        .mockResolvedValueOnce([])                       // duplicate claim check
        .mockResolvedValueOnce([]);                      // getBookmark

      const result = await mgr.claimTask({
        agentId: 'watson',
        projectId: 'plan_codegraph',
        taskId: 'task_done',
        milestone: 'N1',
        taskContext: 'Already completed',
      });

      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe('task_already_done');
      expect(result.conflicts[0].severity).toBe('hard_stop');
    });

    it('detects duplicate claim (advisory)', async () => {
      neo4j.run
        .mockResolvedValueOnce([{ b: {} }])                  // MERGE succeeded
        .mockResolvedValueOnce([{ agent: 'codex-worker' }])  // duplicate claim check
        .mockResolvedValueOnce([]);                          // getBookmark

      const result = await mgr.claimTask({
        agentId: 'watson',
        projectId: 'plan_codegraph',
        taskId: 'task_1',
        milestone: 'RF-2',
        taskContext: 'Temporal fields',
      });

      const advisory = result.conflicts.find(c => c.type === 'duplicate_claim');
      expect(advisory).toBeDefined();
      expect(advisory!.severity).toBe('advisory');
      expect(advisory!.conflictingAgent).toBe('codex-worker');
    });

    it('creates bookmark on clean claim', async () => {
      neo4j.run
        .mockResolvedValueOnce([{ b: {} }])  // MERGE succeeded
        .mockResolvedValueOnce([])            // duplicate claim check
        .mockResolvedValueOnce([{             // getBookmark
          b: {
            id: 'bm_watson_1',
            agentId: 'watson',
            projectId: 'plan_codegraph',
            status: 'claimed',
            currentTaskId: 'task_1',
            currentMilestone: 'RF-2',
            taskContext: 'Add temporal fields',
            claimedAt: new Date().toISOString(),
            workingSetNodeIds: [],
            groundTruthRuns: 0,
            driftDetected: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }]);

      const result = await mgr.claimTask({
        agentId: 'watson',
        projectId: 'plan_codegraph',
        taskId: 'task_1',
        milestone: 'RF-2',
        taskContext: 'Add temporal fields',
      });

      expect(result.conflicts).toHaveLength(0);
      expect(result.bookmark.status).toBe('claimed');
    });
  });

  describe('lifecycle transitions', () => {
    it('transitions to in_progress preserving fields', async () => {
      neo4j.run
        .mockResolvedValueOnce([])    // transition SET
        .mockResolvedValueOnce([{     // getBookmark
          b: {
            id: 'bm_watson_1',
            agentId: 'watson',
            projectId: 'plan_codegraph',
            status: 'in_progress',
            currentTaskId: 'task_1',
            currentMilestone: 'RF-2',
            workingSetNodeIds: ['src/foo.ts'],
            groundTruthRuns: 0,
            driftDetected: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }]);

      const result = await mgr.transitionTo('watson', 'plan_codegraph', 'in_progress');
      expect(result.status).toBe('in_progress');
    });

    it('transitions to idle clearing task fields', async () => {
      neo4j.run
        .mockResolvedValueOnce([])    // transition SET
        .mockResolvedValueOnce([{     // getBookmark
          b: {
            id: 'bm_watson_1',
            agentId: 'watson',
            projectId: 'plan_codegraph',
            status: 'idle',
            currentTaskId: null,
            currentMilestone: null,
            workingSetNodeIds: [],
            groundTruthRuns: 1,
            driftDetected: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }]);

      const result = await mgr.transitionTo('watson', 'plan_codegraph', 'idle');
      expect(result.status).toBe('idle');
      expect(result.currentTaskId).toBeNull();
    });
  });

  describe('working set tracking', () => {
    it('adds file to working set', async () => {
      await mgr.addToWorkingSet('watson', 'plan_codegraph', 'src/new-file.ts');
      expect(neo4j.run).toHaveBeenCalledWith(
        expect.stringContaining('workingSetNodeIds'),
        expect.objectContaining({ filePath: 'src/new-file.ts' }),
      );
    });
  });

  describe('governance recording', () => {
    it('records governance result', async () => {
      await mgr.recordGovernanceResult('watson', 'plan_codegraph', 'PASS', 'abc123');
      expect(neo4j.run).toHaveBeenCalledWith(
        expect.stringContaining('lastGovernanceVerdict'),
        expect.objectContaining({ verdict: 'PASS', commit: 'abc123' }),
      );
    });

    it('records ground truth run with drift', async () => {
      await mgr.recordGroundTruthRun('watson', 'plan_codegraph', true);
      expect(neo4j.run).toHaveBeenCalledWith(
        expect.stringContaining('groundTruthRuns'),
        expect.objectContaining({ drift: true }),
      );
    });
  });

  describe('garbage collection', () => {
    it('calls delete query for old bookmarks', async () => {
      neo4j.run.mockResolvedValueOnce([{ deleted: 5 }]);
      const deleted = await mgr.gc('watson');
      expect(deleted).toBe(5);
    });
  });
});
