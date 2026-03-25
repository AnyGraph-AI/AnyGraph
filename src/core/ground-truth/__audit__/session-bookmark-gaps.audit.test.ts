// Spec source: _drafts/ground-truth-hook/DESIGN.md
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionBookmarkManager } from '../session-bookmark.js';

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('AUD-TC-11d-08/09: session-bookmark gaps', () => {
  let neo4j: any;
  let mgr: SessionBookmarkManager;

  beforeEach(() => {
    neo4j = createMockNeo4j();
    mgr = new SessionBookmarkManager(neo4j);
  });

  it('completeTask path: transitionTo(completing) sets completing status', async () => {
    neo4j.run
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ b: {
        id: 'bm_1', agentId: 'watson', projectId: 'plan_codegraph', status: 'completing',
        currentTaskId: 'task_1', currentMilestone: 'RF-2', workingSetNodeIds: ['src/a.ts'],
        groundTruthRuns: 1, driftDetected: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      } }]);

    const result = await mgr.transitionTo('watson', 'plan_codegraph', 'completing');
    expect(result.status).toBe('completing');
    expect(result.currentTaskId).toBe('task_1');
  });

  it('heartbeat/lease fields are surfaced and can reflect extension timing', async () => {
    neo4j.run.mockResolvedValueOnce([{ b: {
      id: 'bm_1', agentId: 'watson', projectId: 'plan_codegraph', status: 'in_progress',
      currentTaskId: 'task_1', currentMilestone: 'RF-2', workingSetNodeIds: [],
      leaseExpiresAt: '2026-03-25T20:30:00.000Z', heartbeatAt: '2026-03-25T20:00:00.000Z',
      groundTruthRuns: 1, driftDetected: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } }]);

    const result = await mgr.getBookmark('watson', 'plan_codegraph');
    expect(result).not.toBeNull();
    expect(new Date(result!.leaseExpiresAt!).getTime()).toBeGreaterThan(new Date(result!.heartbeatAt!).getTime());
  });
});
