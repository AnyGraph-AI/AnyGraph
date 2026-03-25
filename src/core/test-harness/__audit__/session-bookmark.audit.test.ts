/**
 * AUD-TC-11c-L2-09: ground-truth/session-bookmark.ts — Supplementary Audit Tests
 *
 * Existing coverage: SHALLOW. Gaps: completing transition, lease fields.
 * Also strengthens: BookmarkStatus enum completeness, field preservation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionBookmarkManager } from '../../ground-truth/session-bookmark.js';
import type { BookmarkStatus } from '../../ground-truth/session-bookmark.js';

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('AUD-TC-11c-L2-09: session-bookmark.ts supplementary', () => {
  let neo4j: ReturnType<typeof createMockNeo4j>;
  let mgr: SessionBookmarkManager;

  beforeEach(() => {
    neo4j = createMockNeo4j();
    mgr = new SessionBookmarkManager(neo4j);
  });

  // ─── Gap B5: completing transition ──────────────────────────────

  describe('B5: completeTask transitions to completing status', () => {
    it('transitionTo completing sets status without clearing fields', async () => {
      neo4j.run
        .mockResolvedValueOnce([])    // transition SET
        .mockResolvedValueOnce([{     // getBookmark
          b: {
            id: 'bm_watson_1',
            agentId: 'watson',
            projectId: 'plan_codegraph',
            status: 'completing',
            currentTaskId: 'task_1',
            currentMilestone: 'RF-2',
            taskContext: 'Temporal fields',
            claimedAt: '2026-03-14T19:00:00Z',
            workingSetNodeIds: ['src/a.ts', 'src/b.ts'],
            groundTruthRuns: 5,
            driftDetected: 1,
            createdAt: '2026-03-14T18:00:00Z',
            updatedAt: new Date().toISOString(),
          },
        }]);

      const result = await mgr.transitionTo('watson', 'plan_codegraph', 'completing');

      expect(result.status).toBe('completing');
      // Unlike idle, completing preserves task fields
      expect(result.currentTaskId).toBe('task_1');
      expect(result.currentMilestone).toBe('RF-2');
      expect(result.workingSetNodeIds).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('completing → idle clears all task fields', async () => {
      // First transition to completing
      neo4j.run
        .mockResolvedValueOnce([])    // transition SET (completing)
        .mockResolvedValueOnce([{     // getBookmark
          b: {
            id: 'bm_watson_1',
            agentId: 'watson',
            projectId: 'plan_codegraph',
            status: 'completing',
            currentTaskId: 'task_1',
            currentMilestone: 'RF-2',
            workingSetNodeIds: ['src/a.ts'],
            groundTruthRuns: 5,
            driftDetected: 1,
            createdAt: '2026-03-14T18:00:00Z',
            updatedAt: new Date().toISOString(),
          },
        }]);

      const completing = await mgr.transitionTo('watson', 'plan_codegraph', 'completing');
      expect(completing.status).toBe('completing');

      // Then transition to idle
      neo4j.run
        .mockResolvedValueOnce([])    // transition SET (idle)
        .mockResolvedValueOnce([{     // getBookmark
          b: {
            id: 'bm_watson_1',
            agentId: 'watson',
            projectId: 'plan_codegraph',
            status: 'idle',
            currentTaskId: null,
            currentMilestone: null,
            taskContext: null,
            claimedAt: null,
            workingSetNodeIds: [],
            groundTruthRuns: 6,
            driftDetected: 1,
            createdAt: '2026-03-14T18:00:00Z',
            updatedAt: new Date().toISOString(),
          },
        }]);

      const idle = await mgr.transitionTo('watson', 'plan_codegraph', 'idle');
      expect(idle.status).toBe('idle');
      expect(idle.currentTaskId).toBeNull();
      expect(idle.currentMilestone).toBeNull();
      expect(idle.workingSetNodeIds).toEqual([]);
    });
  });

  // ─── Gap B11: Lease extension fields ────────────────────────────

  describe('B11: Lease extension fields present in bookmark', () => {
    it('getBookmark returns leaseExpiresAt and heartbeatAt fields', async () => {
      neo4j.run.mockResolvedValueOnce([{
        b: {
          id: 'bm_watson_1',
          agentId: 'watson',
          projectId: 'plan_codegraph',
          status: 'in_progress',
          currentTaskId: 'task_1',
          currentMilestone: 'RF-2',
          workingSetNodeIds: [],
          groundTruthRuns: 0,
          driftDetected: 0,
          leaseExpiresAt: '2026-03-14T20:00:00Z',
          heartbeatAt: '2026-03-14T19:45:00Z',
          createdAt: '2026-03-14T19:00:00Z',
          updatedAt: '2026-03-14T19:45:00Z',
        },
      }]);

      const bm = await mgr.getBookmark('watson', 'plan_codegraph');
      expect(bm).not.toBeNull();
      expect(bm!.leaseExpiresAt).toBe('2026-03-14T20:00:00Z');
      expect(bm!.heartbeatAt).toBe('2026-03-14T19:45:00Z');
    });

    it('leaseExpiresAt and heartbeatAt are null when not set', async () => {
      neo4j.run.mockResolvedValueOnce([{
        b: {
          id: 'bm_watson_1',
          agentId: 'watson',
          projectId: 'plan_codegraph',
          status: 'idle',
          currentTaskId: null,
          workingSetNodeIds: [],
          groundTruthRuns: 0,
          driftDetected: 0,
          leaseExpiresAt: null,
          heartbeatAt: null,
          createdAt: '2026-03-14T19:00:00Z',
          updatedAt: '2026-03-14T19:00:00Z',
        },
      }]);

      const bm = await mgr.getBookmark('watson', 'plan_codegraph');
      expect(bm).not.toBeNull();
      expect(bm!.leaseExpiresAt).toBeNull();
      expect(bm!.heartbeatAt).toBeNull();
    });
  });

  // ─── BookmarkStatus completeness ────────────────────────────────

  describe('BookmarkStatus union covers all 4 values', () => {
    it('all status values are accepted by transitionTo', async () => {
      const statuses: BookmarkStatus[] = ['idle', 'claimed', 'in_progress', 'completing'];

      for (const status of statuses) {
        const n = createMockNeo4j();
        const m = new SessionBookmarkManager(n);

        n.run
          .mockResolvedValueOnce([])    // transition SET
          .mockResolvedValueOnce([{     // getBookmark
            b: {
              id: 'bm_test',
              agentId: 'watson',
              projectId: 'plan_codegraph',
              status,
              currentTaskId: status === 'idle' ? null : 'task_1',
              currentMilestone: status === 'idle' ? null : 'RF-1',
              workingSetNodeIds: [],
              groundTruthRuns: 0,
              driftDetected: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          }]);

        const result = await m.transitionTo('watson', 'plan_codegraph', status);
        expect(result.status).toBe(status);
      }
    });
  });

  // ─── detectConflicts standalone (not via claimTask) ─────────────

  describe('detectConflicts returns both conflict types', () => {
    it('detects task_already_done via detectConflicts', async () => {
      neo4j.run
        .mockResolvedValueOnce([{ name: 'Completed task' }])  // done check
        .mockResolvedValueOnce([]);                             // duplicate check

      const conflicts = await mgr.detectConflicts('task_done', 'watson', 'plan_codegraph');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('task_already_done');
      expect(conflicts[0].severity).toBe('hard_stop');
    });

    it('detects duplicate_claim via detectConflicts', async () => {
      neo4j.run
        .mockResolvedValueOnce([])                              // done check (not done)
        .mockResolvedValueOnce([{ agent: 'codex-worker-1' }]); // duplicate check

      const conflicts = await mgr.detectConflicts('task_1', 'watson', 'plan_codegraph');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe('duplicate_claim');
      expect(conflicts[0].severity).toBe('advisory');
      expect(conflicts[0].conflictingAgent).toBe('codex-worker-1');
    });

    it('returns empty when no conflicts', async () => {
      neo4j.run
        .mockResolvedValueOnce([])   // done check
        .mockResolvedValueOnce([]);  // duplicate check

      const conflicts = await mgr.detectConflicts('task_1', 'watson', 'plan_codegraph');
      expect(conflicts).toHaveLength(0);
    });
  });

  // ─── getActiveBookmark ──────────────────────────────────────────

  describe('getActiveBookmark filters non-idle statuses', () => {
    it('returns active bookmark when in_progress', async () => {
      neo4j.run.mockResolvedValueOnce([{
        b: {
          id: 'bm_watson_1',
          agentId: 'watson',
          projectId: 'plan_codegraph',
          status: 'in_progress',
          currentTaskId: 'task_1',
          currentMilestone: 'RF-1',
          workingSetNodeIds: ['src/x.ts'],
          groundTruthRuns: 3,
          driftDetected: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }]);

      const bm = await mgr.getActiveBookmark('watson');
      expect(bm).not.toBeNull();
      expect(bm!.status).toBe('in_progress');
    });

    it('returns null when only idle bookmarks exist', async () => {
      neo4j.run.mockResolvedValueOnce([]);
      const bm = await mgr.getActiveBookmark('watson');
      expect(bm).toBeNull();
    });
  });
});
