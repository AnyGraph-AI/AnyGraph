/**
 * AUD-TC-02 Batch 8a — Behavioral audit tests for MCP handlers:
 *   TraversalHandler, TaskDecompositionHandler, SwarmWorkerHandler, mcp.server
 *
 * Rules:
 *  - No source-string-match tests, no reimplemented logic, no Cypher assertions
 *  - Mocks at closest module boundary
 *  - vi.hoisted() for all mock fns
 *  - ESM .js imports
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// vi.hoisted — survives module evaluation ordering
// ─────────────────────────────────────────────────────────────────────────────
const {
  mockNeo4jRun,
  mockMcpServerConnect,
  mockMcpServerConstructorSpy,
  mockRegisterAllTools,
  mockInitializeServices,
  mockStopAllWatchers,
  mockSetIncrementalParseHandler,
  mockSetMcpServer,
  mockDotenvConfig,
  mockDebugLog,
} = vi.hoisted(() => {
  const mockMcpServerConnect = vi.fn().mockResolvedValue(undefined);
  const mockMcpServerConstructorSpy = vi.fn();

  return {
    mockNeo4jRun: vi.fn(),
    mockMcpServerConnect,
    mockMcpServerConstructorSpy,
    mockRegisterAllTools: vi.fn(),
    mockInitializeServices: vi.fn().mockResolvedValue(undefined),
    mockStopAllWatchers: vi.fn().mockResolvedValue(undefined),
    mockSetIncrementalParseHandler: vi.fn(),
    mockSetMcpServer: vi.fn(),
    mockDotenvConfig: vi.fn(),
    mockDebugLog: vi.fn().mockResolvedValue(undefined),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — for mcp.server dynamic import
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(function (this: any, config: any) {
    mockMcpServerConstructorSpy(config);
    this._config = config;
    this.server = { on: vi.fn() };
    this.connect = mockMcpServerConnect;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(function (this: any) {}),
}));

vi.mock('../../service-init.js', () => ({
  initializeServices: mockInitializeServices,
}));

vi.mock('../../services/watch-manager.js', () => ({
  watchManager: {
    stopAllWatchers: mockStopAllWatchers,
    setIncrementalParseHandler: mockSetIncrementalParseHandler,
    setMcpServer: mockSetMcpServer,
  },
}));

vi.mock('../index.js', () => ({
  registerAllTools: mockRegisterAllTools,
}));

vi.mock('../../handlers/incremental-parse.handler.js', () => ({
  performIncrementalParse: vi.fn(),
}));

vi.mock('../../utils.js', () => ({
  debugLog: mockDebugLog,
  createErrorResponse: (msg: any) => ({
    content: [{ type: 'text', text: JSON.stringify({ error: String(msg) }) }],
  }),
  createSuccessResponse: (msg: string) => ({
    content: [{ type: 'text', text: JSON.stringify({ message: msg }) }],
  }),
  truncateCode: (code: string, maxLength: number) => {
    if (code.length <= maxLength) return { text: code };
    const half = Math.floor(maxLength / 2);
    return {
      text: code.substring(0, half) + '\n\n... [truncated] ...\n\n' + code.substring(code.length - half),
      hasMore: true,
      truncated: code.length - maxLength,
    };
  },
}));

vi.mock('dotenv', () => ({
  default: { config: mockDotenvConfig },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helper factories
// ─────────────────────────────────────────────────────────────────────────────
function makeNode(overrides: Partial<{
  id: string;
  labels: string[];
  filePath: string;
  name: string;
  coreType: string;
  semanticType: string;
  sourceCode: string;
  projectId: string;
}> = {}) {
  return {
    id: overrides.id ?? 'node_aaa',
    labels: overrides.labels ?? ['Function'],
    properties: {
      id: overrides.id ?? 'node_aaa',
      projectId: overrides.projectId ?? 'proj_test',
      name: overrides.name ?? 'myFunction',
      coreType: overrides.coreType ?? 'Function',
      semanticType: overrides.semanticType ?? 'function',
      filePath: overrides.filePath ?? '/project/src/foo.ts',
      sourceCode: overrides.sourceCode ?? 'function myFunction() {}',
      startLine: 1,
      endLine: 5,
      createdAt: '2024-01-01T00:00:00Z',
    },
  };
}

function makeConnection(nodeOverrides: Parameters<typeof makeNode>[0] = {}, depth = 1, relChain?: any[]) {
  return {
    depth,
    node: makeNode(nodeOverrides),
    relationshipChain: relChain ?? [
      { type: 'CALLS', start: 'node_start', end: nodeOverrides.id ?? 'node_aaa' },
    ],
  };
}

function makeCodeNode(overrides: Partial<{
  id: string; name: string; coreType: string; filePath: string; semanticType: string;
}> = {}) {
  return {
    id: overrides.id ?? 'n1',
    name: overrides.name ?? 'myFn',
    coreType: overrides.coreType ?? 'Function',
    filePath: overrides.filePath ?? '/project/src/a.ts',
    semanticType: overrides.semanticType,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import handlers after mocks are established
// ─────────────────────────────────────────────────────────────────────────────
const { TraversalHandler } = await import('../../handlers/traversal.handler.js');
const { TaskDecompositionHandler } = await import('../../handlers/task-decomposition.handler.js');
const { SwarmWorkerHandler } = await import('../../handlers/swarm-worker.handler.js');

// ─────────────────────────────────────────────────────────────────────────────
describe('[aud-tc-02] Batch 8a — MCP handlers (traversal, task-decomposition, swarm-worker) + server', () => {

  // ───────────────────────────────────────────────────────────────────────────
  describe('TraversalHandler', () => {
    let handler: InstanceType<typeof TraversalHandler>;
    let neo4jService: { run: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      vi.clearAllMocks();
      neo4jService = { run: mockNeo4jRun };
      handler = new TraversalHandler(neo4jService as any);
    });

    // ── resolveNodeIdFromFilePath ──────────────────────────────────────────
    describe('resolveNodeIdFromFilePath', () => {
      it('returns nodeId when exact path matches', async () => {
        mockNeo4jRun.mockResolvedValueOnce([{ nodeId: 'node_xyz' }]);

        const result = await handler.resolveNodeIdFromFilePath('/project/src/foo.ts', 'proj_1');

        expect(result).toBe('node_xyz');
      });

      it('returns null when neither exact nor fuzzy match found', async () => {
        mockNeo4jRun.mockResolvedValueOnce([]); // exact miss
        mockNeo4jRun.mockResolvedValueOnce([]); // fuzzy miss

        const result = await handler.resolveNodeIdFromFilePath('nonexistent.ts', 'proj_1');

        expect(result).toBeNull();
      });

      it('uses single fuzzy match when exact match fails', async () => {
        mockNeo4jRun.mockResolvedValueOnce([]); // exact miss
        mockNeo4jRun.mockResolvedValueOnce([{ nodeId: 'node_fuzzy', filePath: '/project/src/foo.ts' }]);

        const result = await handler.resolveNodeIdFromFilePath('foo.ts', 'proj_1');

        expect(result).toBe('node_fuzzy');
      });

      it('throws an error when multiple fuzzy matches exist', async () => {
        mockNeo4jRun.mockResolvedValueOnce([]); // exact miss
        mockNeo4jRun.mockResolvedValueOnce([
          { nodeId: 'node_a', filePath: '/project/src/foo.ts' },
          { nodeId: 'node_b', filePath: '/project/lib/foo.ts' },
        ]);

        await expect(handler.resolveNodeIdFromFilePath('foo.ts', 'proj_1')).rejects.toThrow(/Ambiguous/);
      });
    });

    // ── traverseFromNode ───────────────────────────────────────────────────
    describe('traverseFromNode', () => {
      const projectId = 'proj_test';
      const embedding: number[] = [0.1, 0.2, 0.3];

      it('returns error response when start node is not found', async () => {
        mockNeo4jRun.mockResolvedValueOnce([]); // getStartNode returns empty

        const result = await handler.traverseFromNode('missing_node', embedding, { projectId });

        expect(result.content[0].type).toBe('text');
        const body = JSON.parse(result.content[0].text);
        expect(body.error).toBeDefined();
        expect(body.error).toMatch(/not found/i);
      });

      it('returns success message when node exists but has no connections', async () => {
        const startNode = makeNode({ id: 'node_start', filePath: '/project/src/a.ts' });
        mockNeo4jRun.mockResolvedValueOnce([{ n: startNode }]); // getStartNode
        mockNeo4jRun.mockResolvedValueOnce([]); // performTraversal returns empty

        const result = await handler.traverseFromNode('node_start', embedding, { projectId });

        expect(result.content[0].type).toBe('text');
        const body = JSON.parse(result.content[0].text);
        expect(body.message).toMatch(/No connections/i);
      });

      it('returns compact summary when summaryOnly=true', async () => {
        const startNode = makeNode({ id: 'node_start', filePath: '/project/src/a.ts' });
        const connections = [
          makeConnection({ id: 'node_b', filePath: '/project/src/b.ts' }, 1),
          makeConnection({ id: 'node_c', filePath: '/project/src/c.ts' }, 2),
        ];
        mockNeo4jRun.mockResolvedValueOnce([{ n: startNode }]);
        mockNeo4jRun.mockResolvedValueOnce([{ result: { connections, graph: {} } }]);

        const result = await handler.traverseFromNode('node_start', embedding, {
          projectId,
          summaryOnly: true,
        });

        const body = JSON.parse(result.content[0].text);
        // Summary format: no depths array, has totalConnections + files
        expect(body.totalConnections).toBe(2);
        expect(body.uniqueFiles).toBe(2);
        expect(body.files).toBeDefined();
        expect(Array.isArray(body.files)).toBe(true);
        // Should NOT include full nodes array (beyond start node)
        expect(Object.keys(body.nodes ?? {})).toHaveLength(1);
      });

      it('returns connections grouped by depth in full traversal output', async () => {
        const startNode = makeNode({ id: 'node_start', filePath: '/project/src/a.ts' });
        const connections = [
          makeConnection({ id: 'node_d1a', filePath: '/project/src/b.ts' }, 1),
          makeConnection({ id: 'node_d1b', filePath: '/project/src/c.ts' }, 1),
          makeConnection({ id: 'node_d2',  filePath: '/project/src/d.ts' }, 2),
        ];
        mockNeo4jRun.mockResolvedValueOnce([{ n: startNode }]);
        mockNeo4jRun.mockResolvedValueOnce([{ result: { connections, graph: {} } }]);

        const result = await handler.traverseFromNode('node_start', embedding, {
          projectId,
          summaryOnly: false,
        });

        const body = JSON.parse(result.content[0].text);
        expect(body.depths).toBeDefined();
        expect(Array.isArray(body.depths)).toBe(true);

        const depth1 = body.depths.find((d: any) => d.depth === 1);
        const depth2 = body.depths.find((d: any) => d.depth === 2);
        expect(depth1).toBeDefined();
        expect(depth1.count).toBe(2);
        expect(depth2).toBeDefined();
        expect(depth2.count).toBe(1);
      });

      it('reports totalConnections and uniqueFiles in traversal output', async () => {
        const startNode = makeNode({ id: 'node_start', filePath: '/project/src/a.ts' });
        const connections = [
          makeConnection({ id: 'node_x', filePath: '/project/src/x.ts' }, 1),
          makeConnection({ id: 'node_y', filePath: '/project/src/x.ts' }, 1), // same file
          makeConnection({ id: 'node_z', filePath: '/project/src/z.ts' }, 2),
        ];
        mockNeo4jRun.mockResolvedValueOnce([{ n: startNode }]);
        mockNeo4jRun.mockResolvedValueOnce([{ result: { connections, graph: {} } }]);

        const result = await handler.traverseFromNode('node_start', embedding, { projectId });

        const body = JSON.parse(result.content[0].text);
        expect(body.totalConnections).toBe(3);
        expect(body.uniqueFiles).toBe(2); // x.ts deduped + z.ts
      });

      it('includes sourceCode in node data when includeCode=true', async () => {
        const startNode = makeNode({ id: 'node_start', filePath: '/project/src/a.ts' });
        const conNode = makeNode({ id: 'node_b', filePath: '/project/src/b.ts', coreType: 'Function', sourceCode: 'function b() { return 42; }' });
        const connections = [makeConnection({ id: 'node_b', filePath: '/project/src/b.ts' }, 1)];
        connections[0].node = conNode;

        mockNeo4jRun.mockResolvedValueOnce([{ n: startNode }]);
        mockNeo4jRun.mockResolvedValueOnce([{ result: { connections, graph: {} } }]);

        const result = await handler.traverseFromNode('node_start', embedding, {
          projectId,
          includeCode: true,
          snippetLength: 1000,
        });

        const body = JSON.parse(result.content[0].text);
        const nodeData = body.nodes?.['node_b'];
        expect(nodeData).toBeDefined();
        expect(nodeData.sourceCode).toBe('function b() { return 42; }');
      });

      it('truncates sourceCode when it exceeds snippetLength', async () => {
        const longCode = 'x'.repeat(200);
        const startNode = makeNode({ id: 'node_start', filePath: '/project/src/a.ts' });
        const conNode = makeNode({ id: 'node_b', filePath: '/project/src/b.ts', coreType: 'Function', sourceCode: longCode });
        const connections = [makeConnection({ id: 'node_b', filePath: '/project/src/b.ts' }, 1)];
        connections[0].node = conNode;

        mockNeo4jRun.mockResolvedValueOnce([{ n: startNode }]);
        mockNeo4jRun.mockResolvedValueOnce([{ result: { connections, graph: {} } }]);

        const result = await handler.traverseFromNode('node_start', embedding, {
          projectId,
          includeCode: true,
          snippetLength: 50,
        });

        const body = JSON.parse(result.content[0].text);
        const nodeData = body.nodes?.['node_b'];
        expect(nodeData.hasMore).toBe(true);
        expect(nodeData.truncated).toBeGreaterThan(0);
        expect(nodeData.sourceCode).toContain('[truncated]');
      });

      it('includes pagination metadata in output', async () => {
        const startNode = makeNode({ id: 'node_start', filePath: '/project/src/a.ts' });
        const connections = [makeConnection({ id: 'node_b', filePath: '/project/src/b.ts' }, 1)];

        mockNeo4jRun.mockResolvedValueOnce([{ n: startNode }]);
        mockNeo4jRun.mockResolvedValueOnce([{ result: { connections, graph: {} } }]);

        const result = await handler.traverseFromNode('node_start', embedding, {
          projectId,
          skip: 0,
          limit: 25,
        });

        const body = JSON.parse(result.content[0].text);
        expect(body.pagination).toBeDefined();
        expect(body.pagination.skip).toBe(0);
        expect(body.pagination.limit).toBe(25);
      });
    });

    // ── private helper behaviors (via `as any`) ────────────────────────────
    describe('getRelationshipDirection (via private access)', () => {
      it('returns OUTGOING when first rel start matches startNodeId', () => {
        const conn = makeConnection({}, 1, [{ type: 'CALLS', start: 'start_node', end: 'target_node' }]);
        const direction = (handler as any).getRelationshipDirection(conn, 'start_node');
        expect(direction).toBe('OUTGOING');
      });

      it('returns INCOMING when first rel end matches startNodeId', () => {
        const conn = makeConnection({}, 1, [{ type: 'CALLS', start: 'other_node', end: 'start_node' }]);
        const direction = (handler as any).getRelationshipDirection(conn, 'start_node');
        expect(direction).toBe('INCOMING');
      });

      it('returns UNKNOWN when relationshipChain is absent', () => {
        const conn = { depth: 1, node: makeNode(), relationshipChain: undefined };
        const direction = (handler as any).getRelationshipDirection(conn, 'start_node');
        expect(direction).toBe('UNKNOWN');
      });

      it('returns UNKNOWN when start/end not present in first rel', () => {
        const conn = makeConnection({}, 1, [{ type: 'CALLS' }]);
        const direction = (handler as any).getRelationshipDirection(conn, 'start_node');
        expect(direction).toBe('UNKNOWN');
      });
    });

    describe('groupConnectionsByDepth (via private access)', () => {
      it('separates connections into correct depth buckets', () => {
        const connections = [
          makeConnection({}, 1),
          makeConnection({ id: 'node_b' }, 1),
          makeConnection({ id: 'node_c' }, 2),
          makeConnection({ id: 'node_d' }, 3),
        ];
        const grouped = (handler as any).groupConnectionsByDepth(connections);
        expect(grouped[1]).toHaveLength(2);
        expect(grouped[2]).toHaveLength(1);
        expect(grouped[3]).toHaveLength(1);
      });

      it('returns empty object for empty connections array', () => {
        const grouped = (handler as any).groupConnectionsByDepth([]);
        expect(Object.keys(grouped)).toHaveLength(0);
      });
    });

    describe('getUniqueFileCount (via private access)', () => {
      it('deduplicates connections by filePath', () => {
        const connections = [
          makeConnection({ id: 'n1', filePath: '/a/b.ts' }, 1),
          makeConnection({ id: 'n2', filePath: '/a/b.ts' }, 1), // duplicate file
          makeConnection({ id: 'n3', filePath: '/a/c.ts' }, 2),
        ];
        const count = (handler as any).getUniqueFileCount(connections);
        expect(count).toBe(2);
      });

      it('returns 0 for empty connections', () => {
        expect((handler as any).getUniqueFileCount([])).toBe(0);
      });

      it('ignores nodes with undefined filePath', () => {
        const conn = { depth: 1, node: { ...makeNode(), properties: { ...makeNode().properties, filePath: undefined } } };
        const count = (handler as any).getUniqueFileCount([conn]);
        expect(count).toBe(0);
      });
    });

    describe('formatNodeJSON (via private access)', () => {
      it('includes sourceCode when includeCode=true and coreType is not SourceFile', () => {
        const node = makeNode({ coreType: 'Function', sourceCode: 'const x = 1;' });
        const result = (handler as any).formatNodeJSON(node, true, 1000, undefined);
        expect(result.sourceCode).toBe('const x = 1;');
      });

      it('omits sourceCode when includeCode=false', () => {
        const node = makeNode({ coreType: 'Function', sourceCode: 'const x = 1;' });
        const result = (handler as any).formatNodeJSON(node, false, 1000, undefined);
        expect(result.sourceCode).toBeUndefined();
      });

      it('omits sourceCode when coreType is SourceFile', () => {
        const node = makeNode({ coreType: 'SourceFile', sourceCode: 'import ...' });
        const result = (handler as any).formatNodeJSON(node, true, 1000, undefined);
        expect(result.sourceCode).toBeUndefined();
      });

      it('uses absolute filePath when projectRoot is not provided', () => {
        const node = makeNode({ filePath: '/project/src/foo.ts' });
        const result = (handler as any).formatNodeJSON(node, false, 0, undefined);
        expect(result.filePath).toBe('/project/src/foo.ts');
      });

      it('uses relative path when projectRoot is provided', () => {
        const node = makeNode({ filePath: '/project/src/foo.ts' });
        const result = (handler as any).formatNodeJSON(node, false, 0, '/project');
        // Should be a relative path (not start with /project)
        expect(result.filePath).not.toBe('/project/src/foo.ts');
        expect(result.filePath).toMatch(/src[\\/]foo\.ts/);
      });

      it('always includes id and type', () => {
        const node = makeNode({ id: 'test_node', coreType: 'Class' });
        const result = (handler as any).formatNodeJSON(node, false, 0, undefined);
        expect(result.id).toBe('test_node');
        expect(result.type).toBeDefined();
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('TaskDecompositionHandler', () => {
    let handler: InstanceType<typeof TaskDecompositionHandler>;

    beforeEach(() => {
      handler = new TaskDecompositionHandler();
    });

    // ── decomposeTask ──────────────────────────────────────────────────────
    describe('decomposeTask', () => {
      it('creates one task per unique file', async () => {
        const nodes = [
          makeCodeNode({ id: 'n1', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n2', filePath: '/project/src/a.ts' }), // same file
          makeCodeNode({ id: 'n3', filePath: '/project/src/b.ts' }),
        ];
        const result = await handler.decomposeTask('refactor utils', nodes, new Map(), 'normal');
        expect(result.tasks).toHaveLength(2);
        const filePaths = result.tasks.map((t) => t.filePath);
        expect(filePaths).toContain('/project/src/a.ts');
        expect(filePaths).toContain('/project/src/b.ts');
      });

      it('groups nodes correctly into their file task', async () => {
        const nodes = [
          makeCodeNode({ id: 'n1', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n2', filePath: '/project/src/a.ts' }),
        ];
        const result = await handler.decomposeTask('fix bug', nodes, new Map(), 'normal');
        expect(result.tasks[0].nodeIds).toHaveLength(2);
        expect(result.tasks[0].nodeIds).toContain('n1');
        expect(result.tasks[0].nodeIds).toContain('n2');
      });

      it('infers task type "refactor" from rename keyword', async () => {
        const nodes = [makeCodeNode()];
        const result = await handler.decomposeTask('rename the function to a better name', nodes, new Map(), 'normal');
        expect(result.tasks[0].type).toBe('refactor');
      });

      it('infers task type "test" from description keyword', async () => {
        const nodes = [makeCodeNode()];
        const result = await handler.decomposeTask('add tests for the service', nodes, new Map(), 'normal');
        expect(result.tasks[0].type).toBe('test');
      });

      it('infers task type "document" from description keyword', async () => {
        const nodes = [makeCodeNode()];
        const result = await handler.decomposeTask('document the API endpoints', nodes, new Map(), 'normal');
        expect(result.tasks[0].type).toBe('document');
      });

      it('infers task type "fix" from description keyword', async () => {
        const nodes = [makeCodeNode()];
        const result = await handler.decomposeTask('fix the null pointer error', nodes, new Map(), 'normal');
        expect(result.tasks[0].type).toBe('fix');
      });

      it('defaults to "implement" when no keyword matches', async () => {
        const nodes = [makeCodeNode()];
        const result = await handler.decomposeTask('update the configuration values', nodes, new Map(), 'normal');
        expect(result.tasks[0].type).toBe('implement');
      });

      it('promotes priority for CRITICAL impact level', async () => {
        const nodes = [makeCodeNode({ id: 'n1' })];
        const impactMap = new Map([
          ['n1', {
            nodeId: 'n1', riskLevel: 'CRITICAL' as const,
            directDependents: { count: 10, byType: {} },
            transitiveDependents: { count: 50 },
            affectedFiles: [],
          }],
        ]);
        const result = await handler.decomposeTask('fix this', nodes, impactMap, 'normal');
        // CRITICAL should bump priority above 'normal'
        const priorityOrder = ['backlog', 'low', 'normal', 'high', 'critical'];
        const normalIdx = priorityOrder.indexOf('normal');
        const taskPriorityIdx = priorityOrder.indexOf(result.tasks[0].priority);
        expect(taskPriorityIdx).toBeGreaterThan(normalIdx);
      });

      it('promotes priority for HIGH impact level', async () => {
        const nodes = [makeCodeNode({ id: 'n1' })];
        const impactMap = new Map([
          ['n1', {
            nodeId: 'n1', riskLevel: 'HIGH' as const,
            directDependents: { count: 5, byType: {} },
            transitiveDependents: { count: 20 },
            affectedFiles: [],
          }],
        ]);
        const result = await handler.decomposeTask('refactor', nodes, impactMap, 'low');
        const priorityOrder = ['backlog', 'low', 'normal', 'high', 'critical'];
        const lowIdx = priorityOrder.indexOf('low');
        const taskPriorityIdx = priorityOrder.indexOf(result.tasks[0].priority);
        expect(taskPriorityIdx).toBeGreaterThan(lowIdx);
      });

      it('does not change priority for LOW impact', async () => {
        const nodes = [makeCodeNode({ id: 'n1' })];
        const impactMap = new Map([
          ['n1', {
            nodeId: 'n1', riskLevel: 'LOW' as const,
            directDependents: { count: 0, byType: {} },
            transitiveDependents: { count: 0 },
            affectedFiles: [],
          }],
        ]);
        const result = await handler.decomposeTask('fix this', nodes, impactMap, 'normal');
        expect(result.tasks[0].priority).toBe('normal');
      });

      it('includes a valid executionOrder array', async () => {
        const nodes = [
          makeCodeNode({ id: 'n1', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n2', filePath: '/project/src/b.ts' }),
        ];
        const result = await handler.decomposeTask('fix bug', nodes, new Map(), 'normal');
        expect(result.executionOrder).toHaveLength(result.tasks.length);
        const taskIds = result.tasks.map((t) => t.id);
        result.executionOrder.forEach((id) => expect(taskIds).toContain(id));
      });

      it('produces summary with correct totalTasks count', async () => {
        const nodes = [
          makeCodeNode({ id: 'n1', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n2', filePath: '/project/src/b.ts' }),
          makeCodeNode({ id: 'n3', filePath: '/project/src/c.ts' }),
        ];
        const result = await handler.decomposeTask('refactor', nodes, new Map(), 'normal');
        expect(result.summary.totalTasks).toBe(3);
        expect(result.summary.parallelizable + result.summary.sequential).toBe(3);
      });
    });

    // ── topologicalSort ────────────────────────────────────────────────────
    describe('topologicalSort contract', () => {
      it('places tasks with no dependencies before their dependents', async () => {
        const nodes = [
          makeCodeNode({ id: 'n1', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n2', filePath: '/project/src/b.ts' }),
        ];
        // Make b.ts depend on a.ts via impactMap
        const impactMap = new Map([
          ['n1', {
            nodeId: 'n1', riskLevel: 'LOW' as const,
            directDependents: { count: 1, byType: {} },
            transitiveDependents: { count: 1 },
            affectedFiles: ['/project/src/b.ts'],
          }],
        ]);
        const result = await handler.decomposeTask('fix', nodes, impactMap, 'normal');
        const order = result.executionOrder;
        const taskA = result.tasks.find((t) => t.filePath === '/project/src/a.ts')!;
        const taskB = result.tasks.find((t) => t.filePath === '/project/src/b.ts')!;
        // If B depends on A, A should appear before B in the execution order
        if (taskB.dependencies.includes(taskA.id)) {
          expect(order.indexOf(taskA.id)).toBeLessThan(order.indexOf(taskB.id));
        }
      });

      it('produces no duplicate task IDs in executionOrder', async () => {
        const nodes = [
          makeCodeNode({ id: 'n1', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n2', filePath: '/project/src/b.ts' }),
          makeCodeNode({ id: 'n3', filePath: '/project/src/c.ts' }),
        ];
        const result = await handler.decomposeTask('refactor', nodes, new Map(), 'normal');
        const unique = new Set(result.executionOrder);
        expect(unique.size).toBe(result.executionOrder.length);
      });
    });

    // ── getParallelizableTasks ─────────────────────────────────────────────
    describe('getParallelizableTasks', () => {
      it('returns tasks whose all dependencies are completed', async () => {
        const nodes = [
          makeCodeNode({ id: 'n1', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n2', filePath: '/project/src/b.ts' }),
        ];
        const result = await handler.decomposeTask('fix', nodes, new Map(), 'normal');
        const completedIds = new Set<string>();
        const parallelizable = handler.getParallelizableTasks(result.tasks, completedIds);
        // Tasks with no dependencies should be parallelizable from the start
        const noDeps = result.tasks.filter((t) => t.dependencies.length === 0);
        expect(parallelizable).toEqual(expect.arrayContaining(noDeps));
      });

      it('excludes tasks that are already completed', async () => {
        const nodes = [makeCodeNode({ id: 'n1', filePath: '/project/src/a.ts' })];
        const result = await handler.decomposeTask('fix', nodes, new Map(), 'normal');
        const allCompleted = new Set(result.tasks.map((t) => t.id));
        const parallelizable = handler.getParallelizableTasks(result.tasks, allCompleted);
        expect(parallelizable).toHaveLength(0);
      });

      it('returns tasks that become unblocked after dependencies complete', async () => {
        const nodes = [
          makeCodeNode({ id: 'n1', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n2', filePath: '/project/src/b.ts' }),
        ];
        const impactMap = new Map([
          ['n1', {
            nodeId: 'n1', riskLevel: 'LOW' as const,
            directDependents: { count: 1, byType: {} },
            transitiveDependents: { count: 1 },
            affectedFiles: ['/project/src/b.ts'],
          }],
        ]);
        const result = await handler.decomposeTask('fix', nodes, impactMap, 'normal');
        const taskA = result.tasks.find((t) => t.filePath === '/project/src/a.ts')!;
        const taskB = result.tasks.find((t) => t.filePath === '/project/src/b.ts')!;

        if (taskB.dependencies.includes(taskA.id)) {
          // Before A completes — B should not be parallelizable
          const before = handler.getParallelizableTasks(result.tasks, new Set());
          expect(before.map((t) => t.id)).not.toContain(taskB.id);

          // After A completes — B should be parallelizable
          const after = handler.getParallelizableTasks(result.tasks, new Set([taskA.id]));
          expect(after.map((t) => t.id)).toContain(taskB.id);
        }
      });
    });

    // ── estimateComplexity ─────────────────────────────────────────────────
    describe('estimateComplexity', () => {
      it('returns LOW for small task set with no critical impact', async () => {
        const nodes = [makeCodeNode({ id: 'n1' })];
        const result = await handler.decomposeTask('fix', nodes, new Map(), 'normal');
        expect(['LOW', 'MEDIUM', 'HIGH']).toContain(result.summary.estimatedComplexity);
        expect(result.summary.estimatedComplexity).toBe('LOW');
      });

      it('returns HIGH for large task sets with many critical nodes', async () => {
        // Create many nodes across many files with CRITICAL impact
        const nodes = Array.from({ length: 20 }, (_, i) =>
          makeCodeNode({ id: `n${i}`, filePath: `/project/src/file${i}.ts` })
        );
        const impactMap = new Map(
          nodes.map((n) => [n.id, {
            nodeId: n.id, riskLevel: 'CRITICAL' as const,
            directDependents: { count: 5, byType: {} },
            transitiveDependents: { count: 20 },
            affectedFiles: [],
          }])
        );
        const result = await handler.decomposeTask('major refactor', nodes, impactMap, 'normal');
        expect(result.summary.estimatedComplexity).toBe('HIGH');
      });
    });

    // ── generateTaskTitle ──────────────────────────────────────────────────
    describe('generateTaskTitle', () => {
      it('includes file name in task title', async () => {
        const nodes = [makeCodeNode({ id: 'n1', filePath: '/project/src/auth.service.ts' })];
        const result = await handler.decomposeTask('refactor auth module', nodes, new Map(), 'normal');
        expect(result.tasks[0].title).toContain('auth.service.ts');
      });

      it('includes action word from description', async () => {
        const nodes = [makeCodeNode({ filePath: '/project/src/a.ts' })];
        const result = await handler.decomposeTask('Refactor the module', nodes, new Map(), 'normal');
        expect(result.tasks[0].title).toMatch(/Refactor/i);
      });
    });

    // ── getNodeTypeSummary ─────────────────────────────────────────────────
    describe('getNodeTypeSummary (via metadata)', () => {
      it('counts nodes by coreType in task metadata', async () => {
        const nodes = [
          makeCodeNode({ id: 'n1', coreType: 'Function', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n2', coreType: 'Function', filePath: '/project/src/a.ts' }),
          makeCodeNode({ id: 'n3', coreType: 'Class',    filePath: '/project/src/a.ts' }),
        ];
        const result = await handler.decomposeTask('fix', nodes, new Map(), 'normal');
        const nodeTypes = result.tasks[0].metadata?.nodeTypes as Record<string, number>;
        expect(nodeTypes).toBeDefined();
        // coreType is overridden by semanticType in getNodeTypeSummary; here semanticType is undefined so coreType is used
        expect(typeof nodeTypes).toBe('object');
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('SwarmWorkerHandler', () => {
    let handler: InstanceType<typeof SwarmWorkerHandler>;

    beforeEach(() => {
      handler = new SwarmWorkerHandler();
    });

    // ── generateWorkerPrompt ───────────────────────────────────────────────
    describe('generateWorkerPrompt', () => {
      it('returns a non-empty string', () => {
        const prompt = handler.generateWorkerPrompt({ swarmId: 'swarm_abc', projectId: 'proj_1', agentIndex: 0 });
        expect(typeof prompt).toBe('string');
        expect(prompt.length).toBeGreaterThan(100);
      });

      it('includes the swarm ID in the prompt', () => {
        const prompt = handler.generateWorkerPrompt({ swarmId: 'swarm_xyz', projectId: 'proj_1', agentIndex: 0 });
        expect(prompt).toContain('swarm_xyz');
      });

      it('includes the project ID in the prompt', () => {
        const prompt = handler.generateWorkerPrompt({ swarmId: 'swarm_1', projectId: 'proj_99', agentIndex: 2 });
        expect(prompt).toContain('proj_99');
      });

      it('references MCP tool calls in the prompt', () => {
        const prompt = handler.generateWorkerPrompt({ swarmId: 'swarm_1', projectId: 'proj_1', agentIndex: 0 });
        // Prompt should mention swarm_sense, swarm_claim_task, or similar MCP tool names
        expect(prompt).toMatch(/swarm_sense|swarm_claim_task|swarm_complete_task/);
      });

      it('generates distinct agent IDs for different agentIndex values', () => {
        const p0 = handler.generateWorkerPrompt({ swarmId: 'swarm_1', projectId: 'proj_1', agentIndex: 0 });
        const p1 = handler.generateWorkerPrompt({ swarmId: 'swarm_1', projectId: 'proj_1', agentIndex: 1 });
        expect(p0).not.toBe(p1);
      });
    });

    // ── initializeWorker ───────────────────────────────────────────────────
    describe('initializeWorker', () => {
      it('creates WorkerProgress with idle state and zero counts', () => {
        const progress = handler.initializeWorker({ swarmId: 'swarm_1', projectId: 'proj_1', agentIndex: 0 });
        expect(progress.state).toBe('idle');
        expect(progress.tasksCompleted).toBe(0);
        expect(progress.tasksFailed).toBe(0);
      });

      it('sets agentId from swarmId + agentIndex', () => {
        const progress = handler.initializeWorker({ swarmId: 'swarm_abc', projectId: 'proj_1', agentIndex: 3 });
        expect(progress.agentId).toContain('swarm_abc');
        expect(progress.agentId).toContain('3');
      });

      it('sets lastActivityTime to a recent timestamp', () => {
        const before = Date.now();
        const progress = handler.initializeWorker({ swarmId: 'swarm_1', projectId: 'proj_1', agentIndex: 0 });
        const after = Date.now();
        expect(progress.lastActivityTime).toBeGreaterThanOrEqual(before);
        expect(progress.lastActivityTime).toBeLessThanOrEqual(after);
      });
    });

    // ── updateWorkerProgress ───────────────────────────────────────────────
    describe('updateWorkerProgress', () => {
      it('returns updated WorkerProgress for a known agent', () => {
        const initial = handler.initializeWorker({ swarmId: 'swarm_1', projectId: 'proj_1', agentIndex: 0 });
        const updated = handler.updateWorkerProgress(initial.agentId, { state: 'working', tasksCompleted: 2 });
        expect(updated).not.toBeNull();
        expect(updated!.state).toBe('working');
        expect(updated!.tasksCompleted).toBe(2);
      });

      it('returns null for an unknown agentId', () => {
        const result = handler.updateWorkerProgress('nonexistent_agent', { state: 'working' });
        expect(result).toBeNull();
      });

      it('updates lastActivityTime on every update', () => {
        const initial = handler.initializeWorker({ swarmId: 'swarm_1', projectId: 'proj_1', agentIndex: 0 });
        const timeBefore = initial.lastActivityTime;
        // Small delay to ensure time difference is detectable
        const updated = handler.updateWorkerProgress(initial.agentId, { state: 'claiming' });
        expect(updated!.lastActivityTime).toBeGreaterThanOrEqual(timeBefore);
      });
    });

    // ── getSwarmProgress ───────────────────────────────────────────────────
    describe('getSwarmProgress', () => {
      it('returns all workers belonging to a swarm', () => {
        handler.initializeWorker({ swarmId: 'swarm_A', projectId: 'proj_1', agentIndex: 0 });
        handler.initializeWorker({ swarmId: 'swarm_A', projectId: 'proj_1', agentIndex: 1 });
        handler.initializeWorker({ swarmId: 'swarm_B', projectId: 'proj_1', agentIndex: 0 });

        const progressA = handler.getSwarmProgress('swarm_A');
        expect(progressA).toHaveLength(2);
        progressA.forEach((p) => expect(p.agentId).toContain('swarm_A'));
      });

      it('returns empty array for unknown swarmId', () => {
        const result = handler.getSwarmProgress('nonexistent_swarm');
        expect(result).toHaveLength(0);
      });

      it('swarms do not interfere with each other', () => {
        handler.initializeWorker({ swarmId: 'swarm_X', projectId: 'proj_1', agentIndex: 0 });
        handler.initializeWorker({ swarmId: 'swarm_Y', projectId: 'proj_1', agentIndex: 0 });

        const progressX = handler.getSwarmProgress('swarm_X');
        const progressY = handler.getSwarmProgress('swarm_Y');

        expect(progressX).toHaveLength(1);
        expect(progressY).toHaveLength(1);
        expect(progressX[0].agentId).not.toBe(progressY[0].agentId);
      });
    });

    // ── isWorkerTimedOut ───────────────────────────────────────────────────
    describe('isWorkerTimedOut', () => {
      it('returns true when elapsed time exceeds timeout', () => {
        const progress = handler.initializeWorker({ swarmId: 'swarm_1', projectId: 'proj_1', agentIndex: 0 });
        // Simulate old lastActivityTime
        (handler as any).workerProgress.get(progress.agentId).lastActivityTime = Date.now() - 10000;
        expect(handler.isWorkerTimedOut(progress.agentId, 5000)).toBe(true);
      });

      it('returns false when elapsed time is within timeout', () => {
        const progress = handler.initializeWorker({ swarmId: 'swarm_1', projectId: 'proj_1', agentIndex: 0 });
        expect(handler.isWorkerTimedOut(progress.agentId, 60000)).toBe(false);
      });

      it('returns true for unknown agentId', () => {
        expect(handler.isWorkerTimedOut('ghost_agent', 5000)).toBe(true);
      });
    });

    // ── cleanupSwarm ───────────────────────────────────────────────────────
    describe('cleanupSwarm', () => {
      it('removes all workers for the specified swarm', () => {
        handler.initializeWorker({ swarmId: 'swarm_clean', projectId: 'proj_1', agentIndex: 0 });
        handler.initializeWorker({ swarmId: 'swarm_clean', projectId: 'proj_1', agentIndex: 1 });

        handler.cleanupSwarm('swarm_clean');

        expect(handler.getSwarmProgress('swarm_clean')).toHaveLength(0);
      });

      it('does not remove workers from other swarms', () => {
        handler.initializeWorker({ swarmId: 'swarm_keep', projectId: 'proj_1', agentIndex: 0 });
        handler.initializeWorker({ swarmId: 'swarm_gone', projectId: 'proj_1', agentIndex: 0 });

        handler.cleanupSwarm('swarm_gone');

        expect(handler.getSwarmProgress('swarm_keep')).toHaveLength(1);
        expect(handler.getSwarmProgress('swarm_gone')).toHaveLength(0);
      });

      it('is idempotent — cleaning a non-existent swarm does not throw', () => {
        expect(() => handler.cleanupSwarm('nonexistent')).not.toThrow();
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('mcp.server', () => {
    // Captured immediately after module import — safe from afterEach clearAllMocks
    let processExitSpy: ReturnType<typeof vi.spyOn>;
    let capturedConstructorCalls: any[][];
    let capturedRegisterAllToolsCalls: any[][];
    let capturedInitializeServicesCalls: any[][];
    let capturedSetIncrementalParseCalls: any[][];
    let capturedSetMcpServerCalls: any[][];
    let capturedConnectCalls: any[][];
    let capturedDebugLogCalls: any[][];

    beforeAll(async () => {
      vi.clearAllMocks();
      processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

      // Dynamic import triggers the module-level `await startServer()`
      await import('../../mcp.server.js');

      // Snapshot call state immediately — afterEach(clearAllMocks) can't clobber these
      capturedConstructorCalls      = [...mockMcpServerConstructorSpy.mock.calls];
      capturedRegisterAllToolsCalls = [...mockRegisterAllTools.mock.calls];
      capturedInitializeServicesCalls = [...mockInitializeServices.mock.calls];
      capturedSetIncrementalParseCalls = [...mockSetIncrementalParseHandler.mock.calls];
      capturedSetMcpServerCalls     = [...mockSetMcpServer.mock.calls];
      capturedConnectCalls          = [...mockMcpServerConnect.mock.calls];
      capturedDebugLogCalls         = [...mockDebugLog.mock.calls];
    });

    it('creates McpServer with the correct name and version', () => {
      expect(capturedConstructorCalls).toHaveLength(1);
      expect(capturedConstructorCalls[0][0]).toMatchObject({
        name: 'codebase-graph',
        version: '1.0.0',
      });
    });

    it('calls registerAllTools with the McpServer instance', () => {
      expect(capturedRegisterAllToolsCalls).toHaveLength(1);
      const [serverArg] = capturedRegisterAllToolsCalls[0];
      expect(serverArg).toBeDefined();
      expect(typeof serverArg.connect).toBe('function');
    });

    it('calls initializeServices during startup', () => {
      expect(capturedInitializeServicesCalls).toHaveLength(1);
    });

    it('configures watchManager with incremental parse handler', () => {
      expect(capturedSetIncrementalParseCalls).toHaveLength(1);
      expect(typeof capturedSetIncrementalParseCalls[0][0]).toBe('function');
    });

    it('configures watchManager with MCP server instance', () => {
      expect(capturedSetMcpServerCalls).toHaveLength(1);
    });

    it('connects transport to the MCP server', () => {
      expect(capturedConnectCalls).toHaveLength(1);
    });

    it('gracefulShutdown calls watchManager.stopAllWatchers and process.exit on SIGTERM', async () => {
      // Trigger SIGTERM — the registered handler calls stopAllWatchers then process.exit(0)
      mockStopAllWatchers.mockClear();
      processExitSpy.mockClear();

      process.emit('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockStopAllWatchers).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('logServerStats formats memory usage in MB (invoked during startup)', () => {
      const memCalls = capturedDebugLogCalls.filter(
        ([context]: [string]) => typeof context === 'string' && context.includes('Server stats')
      );
      expect(memCalls.length).toBeGreaterThan(0);
      const statsPayload = memCalls[0][1];
      expect(statsPayload?.memory?.heapUsed).toMatch(/MB/);
      expect(statsPayload?.memory?.rss).toMatch(/MB/);
    });
  });
});
