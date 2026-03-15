/**
 * GTH-5/6: WARN Enforcement + Observed-Change Event Emitters Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkBookmarkWarnings } from '../../../ground-truth/warn-enforcement.js';
import {
  emitTouched,
  emitReferenced,
  emitCommitReferencesTask,
  emitVerifiedByRun,
} from '../../../ground-truth/observed-events.js';

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('GTH-5: WARN Enforcement', () => {
  let neo4j: any;

  beforeEach(() => {
    neo4j = createMockNeo4j();
  });

  it('returns NO_AGENT_ID when no agentId provided', async () => {
    const warnings = await checkBookmarkWarnings(neo4j);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('NO_AGENT_ID');
  });

  it('returns NO_CLAIMED_TASK when no active bookmark', async () => {
    neo4j.run.mockResolvedValueOnce([]);
    const warnings = await checkBookmarkWarnings(neo4j, 'watson');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('NO_CLAIMED_TASK');
  });

  it('detects stale bookmark (>30min)', async () => {
    const old = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    neo4j.run.mockResolvedValueOnce([{
      status: 'in_progress',
      taskId: 'task_1',
      updatedAt: old,
      projectId: 'plan_codegraph',
    }]);

    const warnings = await checkBookmarkWarnings(neo4j, 'watson');
    const stale = warnings.find(w => w.code === 'STALE_BOOKMARK');
    expect(stale).toBeDefined();
    expect(stale!.severity).toBe('warn');
  });

  it('detects task-already-done', async () => {
    neo4j.run
      .mockResolvedValueOnce([{
        status: 'in_progress',
        taskId: 'done_task',
        updatedAt: new Date().toISOString(),
        projectId: 'plan_codegraph',
      }])
      .mockResolvedValueOnce([{ name: 'Done Task' }]);

    const warnings = await checkBookmarkWarnings(neo4j, 'watson');
    const done = warnings.find(w => w.code === 'TASK_ALREADY_DONE');
    expect(done).toBeDefined();
  });

  it('returns empty when bookmark is healthy', async () => {
    neo4j.run
      .mockResolvedValueOnce([{
        status: 'in_progress',
        taskId: 'active_task',
        updatedAt: new Date().toISOString(),
        projectId: 'plan_codegraph',
      }])
      .mockResolvedValueOnce([]); // task not done

    const warnings = await checkBookmarkWarnings(neo4j, 'watson');
    expect(warnings).toHaveLength(0);
  });
});

describe('GTH-6: Observed-Change Event Emitters', () => {
  let neo4j: any;

  beforeEach(() => {
    neo4j = createMockNeo4j();
  });

  describe('emitTouched', () => {
    it('creates TOUCHED edge via MERGE', async () => {
      await emitTouched(neo4j, 'src/foo.ts', { agentId: 'watson', projectId: 'proj_test' });
      expect(neo4j.run).toHaveBeenCalledWith(
        expect.stringContaining('TOUCHED'),
        expect.objectContaining({ filePath: 'src/foo.ts', agentId: 'watson' }),
      );
    });

    it('survives Neo4j errors silently', async () => {
      neo4j.run.mockRejectedValueOnce(new Error('Connection refused'));
      // Should not throw
      await emitTouched(neo4j, 'src/foo.ts', { agentId: 'watson', projectId: 'proj_test' });
    });
  });

  describe('emitReferenced', () => {
    it('creates REFERENCED edges for multiple files', async () => {
      await emitReferenced(neo4j, ['a.ts', 'b.ts'], { agentId: 'watson', projectId: 'proj_test' });
      expect(neo4j.run).toHaveBeenCalledWith(
        expect.stringContaining('REFERENCED'),
        expect.objectContaining({ files: ['a.ts', 'b.ts'] }),
      );
    });

    it('skips empty file list', async () => {
      await emitReferenced(neo4j, [], { agentId: 'watson', projectId: 'proj_test' });
      expect(neo4j.run).not.toHaveBeenCalled();
    });
  });

  describe('emitCommitReferencesTask', () => {
    it('extracts GTH-N references from commit messages', async () => {
      neo4j.run.mockResolvedValue([{ name: 'GTH-1 task' }]);

      const matched = await emitCommitReferencesTask(
        neo4j,
        'abc123',
        'feat(GTH-1): core runtime + pack interface',
        'plan_codegraph',
      );

      expect(matched.length).toBeGreaterThan(0);
    });

    it('extracts parenthesized references', async () => {
      neo4j.run.mockResolvedValue([{ name: 'RF-2 task' }]);

      const matched = await emitCommitReferencesTask(
        neo4j,
        'def456',
        'feat: temporal enforcement (RF-2)',
        'plan_codegraph',
      );

      expect(matched.length).toBeGreaterThan(0);
    });

    it('returns empty for commits with no task references', async () => {
      const matched = await emitCommitReferencesTask(
        neo4j,
        'ghi789',
        'chore: fix typo in readme',
        'plan_codegraph',
      );

      expect(matched).toEqual([]);
      expect(neo4j.run).not.toHaveBeenCalled();
    });
  });

  describe('emitVerifiedByRun', () => {
    it('creates VerificationRun node and VERIFIED_BY_RUN edges', async () => {
      await emitVerifiedByRun(neo4j, 'run_1', 'PASS', 'proj_test', ['src/a.ts']);
      expect(neo4j.run).toHaveBeenCalledTimes(2);
      expect(neo4j.run).toHaveBeenCalledWith(
        expect.stringContaining('VerificationRun'),
        expect.objectContaining({ runId: 'run_1', verdict: 'PASS' }),
      );
    });

    it('skips file linking when no paths provided', async () => {
      await emitVerifiedByRun(neo4j, 'run_2', 'PASS', 'proj_test');
      expect(neo4j.run).toHaveBeenCalledTimes(1); // only the MERGE, no file link
    });
  });
});
