import { describe, expect, it } from 'vitest';

import { GET as getSubgraph } from '@/app/api/graph/subgraph/[nodeId]/route';
import { GET as getDangerPaths } from '@/app/api/graph/danger-paths/[nodeId]/route';

const LIVE_SEED = 'ui/src/app/page.tsx';

describe('[UI-5] live route integration coverage', () => {
  it('subgraph route resolves a real source-file seed and returns neighbors payload', async () => {
    const req = new Request(
      `http://localhost/api/graph/subgraph/${encodeURIComponent(LIVE_SEED)}?depth=2&projectId=proj_c0d3e9a1f200`,
    );

    const res = await getSubgraph(req, {
      params: Promise.resolve({ nodeId: encodeURIComponent(LIVE_SEED) }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.mode).toBe('neighbors');
    expect(typeof body.data.rootId).toBe('string');
    expect(body.data.rootId.length).toBeGreaterThan(0);
    expect(body.data.seed).toBe(LIVE_SEED);
    expect(body.data.nodeCount).toBeGreaterThan(0);
    expect(body.data.nodeCount).toBeLessThanOrEqual(200);
    expect(body.data.absoluteNodeCap).toBe(500);
    expect(Array.isArray(body.data.nodes)).toBe(true);
    expect(Array.isArray(body.data.edges)).toBe(true);
  });

  it('danger-paths route resolves a real source-file seed and returns danger payload', async () => {
    const req = new Request(
      `http://localhost/api/graph/danger-paths/${encodeURIComponent(LIVE_SEED)}?projectId=proj_c0d3e9a1f200`,
    );

    const res = await getDangerPaths(req, {
      params: Promise.resolve({ nodeId: encodeURIComponent(LIVE_SEED) }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.mode).toBe('danger-paths');
    expect(typeof body.data.rootId).toBe('string');
    expect(body.data.rootId.length).toBeGreaterThan(0);
    expect(body.data.seed).toBe(LIVE_SEED);
    expect(body.data.nodeCount).toBeGreaterThan(0);
    expect(body.data.nodeCount).toBeLessThanOrEqual(200);
    expect(body.data.absoluteNodeCap).toBe(500);
    expect(Array.isArray(body.data.nodes)).toBe(true);
    expect(Array.isArray(body.data.edges)).toBe(true);
  });

  it('both routes return 404 for a guaranteed-missing seed in live graph', async () => {
    const missing = `missing-${Date.now()}-ui5-seed`;

    const subReq = new Request(`http://localhost/api/graph/subgraph/${missing}?projectId=proj_c0d3e9a1f200`);
    const subRes = await getSubgraph(subReq, { params: Promise.resolve({ nodeId: missing }) });
    const subBody = await subRes.json();

    const dangerReq = new Request(
      `http://localhost/api/graph/danger-paths/${missing}?projectId=proj_c0d3e9a1f200`,
    );
    const dangerRes = await getDangerPaths(dangerReq, {
      params: Promise.resolve({ nodeId: missing }),
    });
    const dangerBody = await dangerRes.json();

    expect(subRes.status).toBe(404);
    expect(dangerRes.status).toBe(404);
    expect(String(subBody.error)).toContain('Root node not found');
    expect(String(dangerBody.error)).toContain('Root node not found');
  });
});
