import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cachedQueryMock } = vi.hoisted(() => ({
  cachedQueryMock: vi.fn(),
}));

vi.mock('@/lib/neo4j', () => ({
  cachedQuery: cachedQueryMock,
}));

import { QUERIES } from '@/lib/queries';
import { GET } from '@/app/api/graph/active-context/route';

describe('[UI-8] active-context route', () => {
  beforeEach(() => {
    cachedQueryMock.mockReset();
  });

  it('returns grouped active context payload and calls activeContext query', async () => {
    cachedQueryMock.mockResolvedValueOnce([
      {
        kind: 'in_progress_task',
        taskId: 't1',
        taskName: 'Implement API',
        milestoneName: 'UI-8',
        filePath: '/a.ts',
        fileName: 'a.ts',
        blockerNames: [],
        blockerCount: 0,
        gateStatus: '',
        criticalCount: 0,
        tested: false,
      },
      {
        kind: 'blocked_task',
        taskId: 't2',
        taskName: 'Wire panel',
        milestoneName: 'UI-8',
        filePath: '/b.ts',
        fileName: 'b.ts',
        blockerNames: ['Task A'],
        blockerCount: 1,
        gateStatus: '',
        criticalCount: 0,
        tested: false,
      },
      {
        kind: 'gate_file',
        taskId: '',
        taskName: '',
        milestoneName: '',
        filePath: '/critical-untested.ts',
        fileName: 'critical-untested.ts',
        blockerNames: [],
        blockerCount: 0,
        gateStatus: 'BLOCK',
        criticalCount: 2,
        tested: false,
      },
      {
        kind: 'gate_file',
        taskId: '',
        taskName: '',
        milestoneName: '',
        filePath: '/critical-tested.ts',
        fileName: 'critical-tested.ts',
        blockerNames: [],
        blockerCount: 0,
        gateStatus: 'REQUIRE_APPROVAL',
        criticalCount: 1,
        tested: true,
      },
    ]);

    const req = new Request('http://localhost/api/graph/active-context?projectId=proj_x&planProjectPrefix=plan_codegraph&limit=10');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.inProgressTasks).toHaveLength(1);
    expect(body.data.blockedTasks).toHaveLength(1);
    expect(body.data.gateBlocked).toHaveLength(1);
    expect(body.data.gateRequireApproval).toHaveLength(1);
    expect(body.data.summary).toEqual({
      inProgressTaskCount: 1,
      blockedTaskCount: 1,
      blockedFileCount: 1,
      requireApprovalFileCount: 1,
    });

    expect(cachedQueryMock).toHaveBeenCalledTimes(1);
    expect(cachedQueryMock).toHaveBeenCalledWith(QUERIES.activeContext, {
      projectId: 'proj_x',
      planProjectPrefix: 'plan_codegraph',
      limit: 10,
    });
  });

  it('deduplicates task rows and clamps limit to 100 max', async () => {
    cachedQueryMock.mockResolvedValueOnce([
      {
        kind: 'blocked_task',
        taskId: 't2',
        taskName: 'Wire panel',
        milestoneName: 'UI-8',
        filePath: '/b.ts',
        fileName: 'b.ts',
        blockerNames: ['Task A'],
        blockerCount: 1,
        gateStatus: '',
        criticalCount: 0,
        tested: false,
      },
      {
        kind: 'blocked_task',
        taskId: 't2',
        taskName: 'Wire panel',
        milestoneName: 'UI-8',
        filePath: '/c.ts',
        fileName: 'c.ts',
        blockerNames: ['Task B'],
        blockerCount: 1,
        gateStatus: '',
        criticalCount: 0,
        tested: false,
      },
    ]);

    const req = new Request('http://localhost/api/graph/active-context?limit=500');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.blockedTasks).toHaveLength(1);
    expect(body.data.blockedTasks[0].filePaths).toEqual(['/b.ts', '/c.ts']);
    expect(body.data.blockedTasks[0].blockerNames).toEqual(['Task A', 'Task B']);

    expect(cachedQueryMock).toHaveBeenCalledWith(QUERIES.activeContext, {
      projectId: 'proj_c0d3e9a1f200',
      planProjectPrefix: 'plan_codegraph',
      limit: 100,
    });
  });

  it('returns 500 when query throws', async () => {
    cachedQueryMock.mockRejectedValueOnce(new Error('neo4j unavailable'));

    const req = new Request('http://localhost/api/graph/active-context');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Active context API failed');
    expect(String(body.message)).toContain('neo4j unavailable');
  });
});
