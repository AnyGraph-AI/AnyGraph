/**
 * AUD-TC-10 Batch C: API Route Handler Tests
 *
 * Tests for:
 * - L1-12: explorer-default/route.ts (5 behaviors)
 * - L1-13: probes/route.ts (4 behaviors)
 * - L1-14: query/route.ts (7 behaviors)
 *
 * Environment: Node (no DOM)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock for runProbes to avoid initialization order issues
const { mockRunProbes } = vi.hoisted(() => ({
  mockRunProbes: vi.fn(),
}));

// Mock @/lib/neo4j
vi.mock('@/lib/neo4j', () => ({
  cachedQuery: vi.fn(),
  isConnected: vi.fn(),
}));

// Mock probe-architecture using the exact path as used in the route file
vi.mock(
  '/home/jonathan/.openclaw/workspace/codegraph/src/scripts/entry/probe-architecture',
  () => ({
    runProbes: mockRunProbes,
  }),
);

// Mock @/lib/queries
vi.mock('@/lib/queries', () => ({
  QUERIES: {
    painHeatmap: 'MATCH (sf:SourceFile) RETURN sf',
    godFiles: 'MATCH (sf:SourceFile) RETURN sf',
    riskDistribution: 'MATCH (f:Function) RETURN f',
  },
}));

import { cachedQuery, isConnected } from '@/lib/neo4j';

// Import route handlers
import { GET as explorerDefaultGET } from '../app/api/graph/explorer-default/route';
import { GET as probesGET } from '../app/api/graph/probes/route';
import { GET as queryGET, POST as queryPOST } from '../app/api/graph/query/route';

// Helper to create mock Request objects
function createMockRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options);
}

describe('[AUD-TC-10-L1-12] explorer-default/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts projectId param with default fallback', async () => {
    const mockCachedQuery = vi.mocked(cachedQuery);
    mockCachedQuery.mockResolvedValueOnce([]);

    // Without projectId param - should use default
    const reqWithoutParam = createMockRequest('http://localhost/api/graph/explorer-default');
    await explorerDefaultGET(reqWithoutParam);

    expect(mockCachedQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockCachedQuery.mock.calls[0];
    expect(params).toEqual({ projectId: 'proj_c0d3e9a1f200' });
  });

  it('uses provided projectId param when specified', async () => {
    const mockCachedQuery = vi.mocked(cachedQuery);
    mockCachedQuery.mockResolvedValueOnce([]);

    const reqWithParam = createMockRequest(
      'http://localhost/api/graph/explorer-default?projectId=custom_project',
    );
    await explorerDefaultGET(reqWithParam);

    expect(mockCachedQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockCachedQuery.mock.calls[0];
    expect(params).toEqual({ projectId: 'custom_project' });
  });

  it('queries SourceFile by adjustedPain DESC', async () => {
    const mockCachedQuery = vi.mocked(cachedQuery);
    mockCachedQuery.mockResolvedValueOnce([]);

    const req = createMockRequest('http://localhost/api/graph/explorer-default');
    await explorerDefaultGET(req);

    const [query] = mockCachedQuery.mock.calls[0];
    expect(query).toContain('ORDER BY coalesce(sf.adjustedPain, 0) DESC');
    expect(query).toContain(':SourceFile');
    expect(query).toContain('LIMIT 1');
  });

  it('returns focus data shape when SourceFile found', async () => {
    const mockCachedQuery = vi.mocked(cachedQuery);
    mockCachedQuery.mockResolvedValueOnce([
      {
        id: 'node123',
        filePath: '/src/core/index.ts',
        name: 'index.ts',
        adjustedPain: 0.85,
      },
    ]);

    const req = createMockRequest('http://localhost/api/graph/explorer-default');
    const response = await explorerDefaultGET(req);
    const json = await response.json();

    expect(json.data).toEqual({
      focus: '/src/core/index.ts',
      focusType: 'file',
      filePath: '/src/core/index.ts',
      sourceNodeId: 'node123',
      adjustedPain: 0.85,
    });
  });

  it('returns null with reason when no SourceFile nodes exist', async () => {
    const mockCachedQuery = vi.mocked(cachedQuery);
    mockCachedQuery.mockResolvedValueOnce([]);

    const req = createMockRequest('http://localhost/api/graph/explorer-default');
    const response = await explorerDefaultGET(req);
    const json = await response.json();

    expect(json.data).toBeNull();
    expect(json.reason).toBe('no_source_files');
  });

  it('returns 500 with error on query failure', async () => {
    const mockCachedQuery = vi.mocked(cachedQuery);
    mockCachedQuery.mockRejectedValueOnce(new Error('Connection refused'));

    const req = createMockRequest('http://localhost/api/graph/explorer-default');
    const response = await explorerDefaultGET(req);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe('Explorer default API failed');
    expect(json.message).toContain('Connection refused');
  });
});

describe('[AUD-TC-10-L1-13] probes/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runProbes() from backend', async () => {
    mockRunProbes.mockResolvedValueOnce([]);

    await probesGET();

    expect(mockRunProbes).toHaveBeenCalledTimes(1);
  });

  it('computes summary counts from probe statuses', async () => {
    mockRunProbes.mockResolvedValueOnce([
      { id: 'probe1', status: 'pass', name: 'Test1', rows: [] },
      { id: 'probe2', status: 'pass', name: 'Test2', rows: [] },
      { id: 'probe3', status: 'warn', name: 'Test3', rows: [] },
      { id: 'probe4', status: 'info', name: 'Test4', rows: [] },
      { id: 'probe5', status: 'fail', name: 'Test5', rows: [] },
    ]);

    const response = await probesGET();
    const json = await response.json();

    expect(json.summary).toEqual({
      total: 5,
      healthy: 2,
      warning: 1,
      info: 1,
    });
  });

  it('returns { data: probes, summary } on success', async () => {
    const mockProbes = [{ id: 'probe1', status: 'pass', name: 'Health Check', rows: [] }];
    mockRunProbes.mockResolvedValueOnce(mockProbes);

    const response = await probesGET();
    const json = await response.json();

    expect(json.data).toEqual(mockProbes);
    expect(json.summary).toBeDefined();
    expect(json.summary.total).toBe(1);
    expect(json.summary.healthy).toBe(1);
  });

  it('returns 500 with error message on failure', async () => {
    mockRunProbes.mockRejectedValueOnce(new Error('Probe execution failed'));

    const response = await probesGET();
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe('Probe API failed');
    expect(json.message).toContain('Probe execution failed');
  });
});

describe('[AUD-TC-10-L1-14] query/route.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST parses { query, params } from request body', async () => {
    const mockCachedQuery = vi.mocked(cachedQuery);
    mockCachedQuery.mockResolvedValueOnce([{ count: 42 }]);

    const req = createMockRequest('http://localhost/api/graph/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'MATCH (n) RETURN count(n) AS count',
        params: { projectId: 'test_proj' },
      }),
    });

    await queryPOST(req);

    expect(mockCachedQuery).toHaveBeenCalledWith('MATCH (n) RETURN count(n) AS count', {
      projectId: 'test_proj',
    });
  });

  it('returns 400 when query is missing', async () => {
    const req = createMockRequest('http://localhost/api/graph/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: {} }),
    });

    const response = await queryPOST(req);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Missing query');
  });

  it('isReadOnly blocks write keywords (MERGE/CREATE/DELETE/SET/REMOVE/DETACH/DROP)', async () => {
    const writeQueries = [
      'MERGE (n:Node) RETURN n',
      'CREATE (n:Node) RETURN n',
      'MATCH (n) DELETE n',
      'MATCH (n) SET n.prop = 1 RETURN n',
      'MATCH (n) REMOVE n.prop RETURN n',
      'MATCH (n) DETACH DELETE n',
      'DROP CONSTRAINT abc',
    ];

    for (const query of writeQueries) {
      const req = createMockRequest('http://localhost/api/graph/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const response = await queryPOST(req);
      expect(response.status).toBe(403);
    }
  });

  it('returns 403 for write queries with proper error message', async () => {
    const req = createMockRequest('http://localhost/api/graph/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'CREATE (n:Node) RETURN n' }),
    });

    const response = await queryPOST(req);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('Write queries not allowed');
  });

  it('calls cachedQuery for valid read queries and returns { data, count }', async () => {
    const mockCachedQuery = vi.mocked(cachedQuery);
    const mockRows = [{ id: '1' }, { id: '2' }, { id: '3' }];
    mockCachedQuery.mockResolvedValueOnce(mockRows);

    const req = createMockRequest('http://localhost/api/graph/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'MATCH (n) RETURN n.id AS id LIMIT 3' }),
    });

    const response = await queryPOST(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toEqual(mockRows);
    expect(json.count).toBe(3);
  });

  it('returns 500 on query execution error', async () => {
    const mockCachedQuery = vi.mocked(cachedQuery);
    mockCachedQuery.mockRejectedValueOnce(new Error('Syntax error in Cypher'));

    const req = createMockRequest('http://localhost/api/graph/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'MATCH (n) RETRUN n' }),
    });

    const response = await queryPOST(req);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toContain('Syntax error');
  });

  it('GET returns { connected, availableQueries }', async () => {
    const mockIsConnected = vi.mocked(isConnected);
    mockIsConnected.mockResolvedValueOnce(true);

    const response = await queryGET();
    const json = await response.json();

    expect(json.connected).toBe(true);
    expect(Array.isArray(json.availableQueries)).toBe(true);
    expect(json.availableQueries).toContain('painHeatmap');
    expect(json.availableQueries).toContain('godFiles');
    expect(json.availableQueries).toContain('riskDistribution');
  });

  it('GET returns connected=false when Neo4j is disconnected', async () => {
    const mockIsConnected = vi.mocked(isConnected);
    mockIsConnected.mockResolvedValueOnce(false);

    const response = await queryGET();
    const json = await response.json();

    expect(json.connected).toBe(false);
    expect(json.availableQueries).toBeDefined();
  });
});
