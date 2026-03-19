import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cachedQueryMock } = vi.hoisted(() => ({
  cachedQueryMock: vi.fn(),
}));

vi.mock('@/lib/neo4j', () => ({
  cachedQuery: cachedQueryMock,
}));

import * as subgraphRoute from '@/app/api/graph/subgraph/[nodeId]/route';
import * as dangerRoute from '@/app/api/graph/danger-paths/[nodeId]/route';

describe('[UI-5] route helpers coverage', () => {
  beforeEach(() => {
    cachedQueryMock.mockReset();
  });

  it('normalizeSeed decodes + trims for both routes', () => {
    expect(subgraphRoute.normalizeSeed('  ui%2Fsrc%2Fapp%2Fpage.tsx  ')).toBe('ui/src/app/page.tsx');
    expect(dangerRoute.normalizeSeed('  ExplorerGraph%20  ')).toBe('ExplorerGraph');
  });

  it('resolveRootId returns top candidate and uses score-ordered query (subgraph)', async () => {
    cachedQueryMock.mockResolvedValueOnce([{ id: 'best-root' }, { id: 'backup-root' }]);

    const root = await subgraphRoute.resolveRootId('seed-value', 'proj_test');

    expect(root).toBe('best-root');
    expect(cachedQueryMock).toHaveBeenCalledTimes(1);
    const [query, params] = cachedQueryMock.mock.calls[0];
    expect(String(query)).toContain('ORDER BY score DESC');
    expect(String(query)).toContain('coalesce(n.filePath, \'\') ENDS WITH $seed');
    expect(String(query)).toContain('coalesce(n.name, \'\') = $seed');
    expect(params).toEqual({ seed: 'seed-value', projectId: 'proj_test' });
  });

  it('resolveRootId returns null when no candidate exists (danger-paths)', async () => {
    cachedQueryMock.mockResolvedValueOnce([]);

    const root = await dangerRoute.resolveRootId('missing-seed', 'proj_test');

    expect(root).toBeNull();
  });
});

describe('[UI-5] subgraph route GET coverage', () => {
  beforeEach(() => {
    cachedQueryMock.mockReset();
  });

  it('returns 404 when root cannot be resolved', async () => {
    cachedQueryMock.mockResolvedValueOnce([]);

    const req = new Request('http://localhost/api/graph/subgraph/foo');
    const res = await subgraphRoute.GET(req, { params: Promise.resolve({ nodeId: 'foo' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('Root node not found');
  });

  it('returns neighbors payload with depth clamped to max=3 and default projectId', async () => {
    cachedQueryMock
      .mockResolvedValueOnce([{ id: 'root-1' }])
      .mockResolvedValueOnce([
        {
          id: 'root-1',
          name: 'root',
          filePath: '/x.ts',
          labels: ['SourceFile'],
          riskTier: 'LOW',
          projectId: 'proj_c0d3e9a1f200',
        },
      ])
      .mockResolvedValueOnce([
        { source: 'root-1', target: 'fn-1', type: 'CONTAINS' },
      ]);

    const req = new Request('http://localhost/api/graph/subgraph/ui%2Fsrc%2Fapp%2Fpage.tsx?depth=99');
    const res = await subgraphRoute.GET(req, {
      params: Promise.resolve({ nodeId: 'ui%2Fsrc%2Fapp%2Fpage.tsx' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.mode).toBe('neighbors');
    expect(body.data.rootId).toBe('root-1');
    expect(body.data.seed).toBe('ui/src/app/page.tsx');
    expect(body.data.apiNodeCap).toBe(200);
    expect(body.data.absoluteNodeCap).toBe(500);
    expect(body.data.nodeCount).toBe(1);
    expect(body.data.edgeCount).toBe(1);

    const [, nodeQuery, edgeQuery] = cachedQueryMock.mock.calls;
    expect(String(nodeQuery[0])).toContain('[*0..3]');
    expect(nodeQuery[1]).toMatchObject({ projectId: 'proj_c0d3e9a1f200', limit: 200 });
    expect(String(edgeQuery[0])).toContain('MATCH (a {id: id})-[r]-(b)');
    expect(edgeQuery[1]).toMatchObject({ nodeIds: ['root-1'] });
  });

  it('clamps depth to minimum 1', async () => {
    cachedQueryMock
      .mockResolvedValueOnce([{ id: 'root-2' }])
      .mockResolvedValueOnce([]);

    const req = new Request('http://localhost/api/graph/subgraph/foo?depth=0&projectId=proj_custom');
    const res = await subgraphRoute.GET(req, { params: Promise.resolve({ nodeId: 'foo' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.mode).toBe('neighbors');
    const [, nodeQuery] = cachedQueryMock.mock.calls;
    expect(String(nodeQuery[0])).toContain('[*0..1]');
    expect(nodeQuery[1]).toMatchObject({ projectId: 'proj_custom' });
  });

  it('skips edge query when no nodes are returned', async () => {
    cachedQueryMock.mockResolvedValueOnce([{ id: 'root-3' }]).mockResolvedValueOnce([]);

    const req = new Request('http://localhost/api/graph/subgraph/foo');
    const res = await subgraphRoute.GET(req, { params: Promise.resolve({ nodeId: 'foo' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.edges).toEqual([]);
    expect(cachedQueryMock).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when seed decoding fails', async () => {
    const req = new Request('http://localhost/api/graph/subgraph/bad');
    const res = await subgraphRoute.GET(req, {
      params: Promise.resolve({ nodeId: '%E0%A4%A' }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Subgraph API failed');
  });

  it('returns 500 when query execution throws', async () => {
    cachedQueryMock.mockRejectedValueOnce(new Error('neo4j down'));

    const req = new Request('http://localhost/api/graph/subgraph/foo');
    const res = await subgraphRoute.GET(req, { params: Promise.resolve({ nodeId: 'foo' }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Subgraph API failed');
    expect(String(body.message)).toContain('neo4j down');
  });
});

describe('[UI-5] danger-paths route GET coverage', () => {
  beforeEach(() => {
    cachedQueryMock.mockReset();
  });

  it('returns 404 when root cannot be resolved', async () => {
    cachedQueryMock.mockResolvedValueOnce([]);

    const req = new Request('http://localhost/api/graph/danger-paths/foo');
    const res = await dangerRoute.GET(req, { params: Promise.resolve({ nodeId: 'foo' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('Root node not found');
  });

  it('returns danger-paths payload with expected filtering and metadata', async () => {
    cachedQueryMock
      .mockResolvedValueOnce([{ id: 'root-danger' }])
      .mockResolvedValueOnce([
        {
          id: 'root-danger',
          name: 'root danger',
          filePath: '/danger.ts',
          labels: ['SourceFile'],
          riskTier: 'HIGH',
          projectId: 'proj_c0d3e9a1f200',
        },
      ])
      .mockResolvedValueOnce([{ source: 'root-danger', target: 'fn-danger', type: 'CALLS' }]);

    const req = new Request('http://localhost/api/graph/danger-paths/root-danger');
    const res = await dangerRoute.GET(req, { params: Promise.resolve({ nodeId: 'root-danger' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.mode).toBe('danger-paths');
    expect(body.data.rootId).toBe('root-danger');
    expect(body.data.nodeCount).toBe(1);
    expect(body.data.edgeCount).toBe(1);

    const [, nodeQuery, edgeQuery] = cachedQueryMock.mock.calls;
    expect(String(nodeQuery[0])).toContain("IN ['CRITICAL','HIGH']");
    expect(String(edgeQuery[0])).toContain("type(r) IN ['CALLS', 'CONTAINS']");
  });

  it('skips edge query when no nodes are returned', async () => {
    cachedQueryMock.mockResolvedValueOnce([{ id: 'root-danger-2' }]).mockResolvedValueOnce([]);

    const req = new Request('http://localhost/api/graph/danger-paths/root-danger-2');
    const res = await dangerRoute.GET(req, {
      params: Promise.resolve({ nodeId: 'root-danger-2' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.edges).toEqual([]);
    expect(cachedQueryMock).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when query execution throws', async () => {
    cachedQueryMock.mockRejectedValueOnce(new Error('danger query failed'));

    const req = new Request('http://localhost/api/graph/danger-paths/foo');
    const res = await dangerRoute.GET(req, { params: Promise.resolve({ nodeId: 'foo' }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Danger paths API failed');
    expect(String(body.message)).toContain('danger query failed');
  });
});
