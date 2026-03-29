/**
 * AUD-TC-02 Batch 5B — Behavioral tests for 5 swarm tools (B6 Health Witness pass).
 * Tools: swarm-sense, swarm-pheromone, swarm-get-tasks, swarm-graph-refresh, swarm-constants.
 * NO Cypher assertions. Tests handler return values and mock call arguments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// vi.hoisted — mock fns that survive hoisting
// ────────────────────────────────────────────────────────────────────────────
const { mockRun, mockClose, mockPerformIncrementalParse } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockPerformIncrementalParse: vi.fn(),
}));

// ────────────────────────────────────────────────────────────────────────────
// Capture registered handlers for both registration patterns
// ────────────────────────────────────────────────────────────────────────────
const registeredTools = new Map<string, Function>();
const mockServer = {
  registerTool: vi.fn((name: string, _meta: any, handler: Function) => {
    registeredTools.set(name, handler);
  }),
  tool: vi.fn((name: string, _desc: any, _schema: any, handler: Function) => {
    registeredTools.set(name, handler);
  }),
};

// ────────────────────────────────────────────────────────────────────────────
// Module mocks
// ────────────────────────────────────────────────────────────────────────────

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.close = mockClose;
  }),
}));

// CRITICAL: utils.js path is ../../utils.js (from __tests__/ up two levels to src/mcp/)
vi.mock('../../utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    debugLog: vi.fn(),
    resolveProjectIdOrError: vi.fn(async (projectId: string) => ({
      success: true,
      projectId,
    })),
  };
});

vi.mock('../../../mcp/handlers/incremental-parse.handler.js', () => ({
  performIncrementalParse: mockPerformIncrementalParse,
}));

// ────────────────────────────────────────────────────────────────────────────
// Imports (after mocks)
// ────────────────────────────────────────────────────────────────────────────
import { createSwarmSenseTool } from '../swarm-sense.tool.js';
import { createSwarmPheromoneTool } from '../swarm-pheromone.tool.js';
import { createSwarmGetTasksTool } from '../swarm-get-tasks.tool.js';
import { createSwarmGraphRefreshTool } from '../swarm-graph-refresh.tool.js';
import {
  generateTaskId,
  generateMessageId,
  generateSwarmId,
  generateAgentId,
  getHalfLife,
  PHEROMONE_TYPES,
  PHEROMONE_CONFIG,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_TYPES,
  WORKFLOW_STATES,
  FLAG_TYPES,
} from '../swarm-constants.js';

// ────────────────────────────────────────────────────────────────────────────
// Helper
// ────────────────────────────────────────────────────────────────────────────
function textOf(result: any): string {
  return result?.content?.[0]?.text ?? '';
}

function jsonOf(result: any): any {
  return JSON.parse(textOf(result));
}

// ════════════════════════════════════════════════════════════════════════════
// swarm-constants.ts — pure function tests
// ════════════════════════════════════════════════════════════════════════════
describe('swarm-constants — pure exports', () => {
  describe('generateTaskId()', () => {
    it('returns a string starting with "task_"', () => {
      expect(generateTaskId()).toMatch(/^task_/);
    });

    it('returns unique values on successive calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateTaskId()));
      expect(ids.size).toBe(20);
    });

    it('has the expected format: task_<timestamp>_<random>', () => {
      expect(generateTaskId()).toMatch(/^task_[0-9a-z]+_[0-9a-z]+$/);
    });
  });

  describe('generateMessageId()', () => {
    it('returns a string starting with "msg_"', () => {
      expect(generateMessageId()).toMatch(/^msg_/);
    });

    it('returns unique values on successive calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateMessageId()));
      expect(ids.size).toBe(20);
    });
  });

  describe('generateSwarmId()', () => {
    it('returns a string starting with "swarm_"', () => {
      expect(generateSwarmId()).toMatch(/^swarm_/);
    });

    it('returns unique values on successive calls', () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateSwarmId()));
      expect(ids.size).toBe(20);
    });
  });

  describe('generateAgentId()', () => {
    it('combines swarmId and index into expected format', () => {
      expect(generateAgentId('swarm_abc', 3)).toBe('swarm_abc_agent_3');
    });

    it('handles index 0 correctly', () => {
      expect(generateAgentId('swarm_xyz', 0)).toBe('swarm_xyz_agent_0');
    });
  });

  describe('getHalfLife()', () => {
    it('returns 2 minutes (120000ms) for "exploring"', () => {
      expect(getHalfLife('exploring')).toBe(2 * 60 * 1000);
    });

    it('returns 10 minutes for "modifying"', () => {
      expect(getHalfLife('modifying')).toBe(10 * 60 * 1000);
    });

    it('returns -1 for "warning" (never decays)', () => {
      expect(getHalfLife('warning')).toBe(-1);
    });

    it('returns 24 hours for "completed"', () => {
      expect(getHalfLife('completed')).toBe(24 * 60 * 60 * 1000);
    });

    it('returns 8 hours for "session_context"', () => {
      expect(getHalfLife('session_context')).toBe(8 * 60 * 60 * 1000);
    });
  });

  describe('PHEROMONE_TYPES array', () => {
    it('contains all expected types', () => {
      expect(PHEROMONE_TYPES).toContain('exploring');
      expect(PHEROMONE_TYPES).toContain('modifying');
      expect(PHEROMONE_TYPES).toContain('warning');
      expect(PHEROMONE_TYPES).toContain('completed');
      expect(PHEROMONE_TYPES).toContain('session_context');
    });

    it('matches the keys of PHEROMONE_CONFIG', () => {
      const configKeys = Object.keys(PHEROMONE_CONFIG).sort();
      expect([...PHEROMONE_TYPES].sort()).toEqual(configKeys);
    });
  });

  describe('TASK_STATUSES / TASK_PRIORITIES / TASK_TYPES exports', () => {
    it('TASK_STATUSES includes expected statuses', () => {
      expect(TASK_STATUSES).toContain('available');
      expect(TASK_STATUSES).toContain('in_progress');
      expect(TASK_STATUSES).toContain('completed');
      expect(TASK_STATUSES).toContain('failed');
    });

    it('TASK_PRIORITIES maps to numeric scores', () => {
      expect(TASK_PRIORITIES.critical).toBe(100);
      expect(TASK_PRIORITIES.high).toBe(75);
      expect(TASK_PRIORITIES.normal).toBe(50);
      expect(TASK_PRIORITIES.low).toBe(25);
      expect(TASK_PRIORITIES.backlog).toBe(0);
    });

    it('TASK_TYPES includes expected types', () => {
      expect(TASK_TYPES).toContain('implement');
      expect(TASK_TYPES).toContain('fix');
      expect(TASK_TYPES).toContain('test');
      expect(TASK_TYPES).toContain('review');
    });

    it('WORKFLOW_STATES are a subset of PHEROMONE_TYPES', () => {
      for (const state of WORKFLOW_STATES) {
        expect(PHEROMONE_TYPES).toContain(state);
      }
    });

    it('FLAG_TYPES are a subset of PHEROMONE_TYPES', () => {
      for (const flag of FLAG_TYPES) {
        expect(PHEROMONE_TYPES).toContain(flag);
      }
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// swarm-sense.tool.ts — query pheromones
// ════════════════════════════════════════════════════════════════════════════
describe('createSwarmSenseTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.clear();
    createSwarmSenseTool(mockServer as any);
  });

  it('registers the handler under swarm_sense', () => {
    expect(registeredTools.has('swarm_sense')).toBe(true);
  });

  it('returns pheromone list on happy path', async () => {
    const fakePheromone = {
      id: 'ph_001',
      projectId: 'proj_test',
      nodeId: 'node_abc',
      type: 'exploring',
      currentIntensity: 0.8,
      originalIntensity: 1.0,
      agentId: 'agent_1',
      swarmId: 'swarm_1',
      timestamp: 1700000000000,
      data: null,
      halfLifeMs: 120000,
      sessionId: null,
      targetType: null,
      targetName: null,
      targetFilePath: null,
    };
    mockRun.mockResolvedValue([fakePheromone]);

    const handler = registeredTools.get('swarm_sense')!;
    const result = await handler({ projectId: 'proj_test', minIntensity: 0.3, limit: 50 });
    const parsed = jsonOf(result);

    expect(parsed.pheromones).toHaveLength(1);
    expect(parsed.pheromones[0].id).toBe('ph_001');
    expect(parsed.pheromones[0].type).toBe('exploring');
  });

  it('returns empty pheromone list when graph has none', async () => {
    mockRun.mockResolvedValue([]);

    const handler = registeredTools.get('swarm_sense')!;
    const result = await handler({ projectId: 'proj_test', minIntensity: 0.3, limit: 50 });
    const parsed = jsonOf(result);

    expect(parsed.pheromones).toHaveLength(0);
    expect(parsed.projectId).toBe('proj_test');
  });

  it('runs cleanup query when cleanup=true', async () => {
    mockRun.mockResolvedValueOnce([{ cleaned: 3 }]); // cleanup query
    mockRun.mockResolvedValueOnce([]); // sense query

    const handler = registeredTools.get('swarm_sense')!;
    const result = await handler({ projectId: 'proj_test', cleanup: true, minIntensity: 0.1, limit: 50 });
    const parsed = jsonOf(result);

    expect(parsed.cleaned).toBe(3);
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it('includes stats when includeStats=true', async () => {
    mockRun.mockResolvedValueOnce([]); // sense query
    mockRun.mockResolvedValueOnce([
      { type: 'exploring', count: 5, avgIntensity: 0.75, agents: ['agent_1'] },
    ]); // stats query

    const handler = registeredTools.get('swarm_sense')!;
    const result = await handler({
      projectId: 'proj_test',
      includeStats: true,
      minIntensity: 0.1,
      limit: 50,
    });
    const parsed = jsonOf(result);

    expect(parsed.stats).toBeDefined();
    expect(parsed.stats[0].type).toBe('exploring');
    expect(parsed.stats[0].count).toBe(5);
  });

  it('passes swarmId and agentIds filters to neo4j run', async () => {
    mockRun.mockResolvedValue([]);

    const handler = registeredTools.get('swarm_sense')!;
    await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_xyz',
      agentIds: ['agent_1', 'agent_2'],
      minIntensity: 0.3,
      limit: 10,
    });

    const callArgs = mockRun.mock.calls[0][1];
    expect(callArgs.swarmId).toBe('swarm_xyz');
    expect(callArgs.agentIds).toEqual(['agent_1', 'agent_2']);
    expect(callArgs.limit).toBe(10);
  });

  it('closes neo4j connection after error', async () => {
    mockRun.mockRejectedValue(new Error('DB exploded'));

    const handler = registeredTools.get('swarm_sense')!;
    const result = await handler({ projectId: 'proj_test', minIntensity: 0.3, limit: 50 });

    expect(textOf(result)).toContain('DB exploded');
    expect(mockClose).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// swarm-pheromone.tool.ts — deposit pheromones
// ════════════════════════════════════════════════════════════════════════════
describe('createSwarmPheromoneTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.clear();
    createSwarmPheromoneTool(mockServer as any);
  });

  it('registers the handler under swarm_pheromone', () => {
    expect(registeredTools.has('swarm_pheromone')).toBe(true);
  });

  it('creates a pheromone and returns success with id', async () => {
    // Use session_context (flag type) so no cleanup query runs before create
    mockRun.mockResolvedValueOnce([
      {
        id: 'ph_new',
        projectId: 'proj_test',
        nodeId: 'node_abc',
        type: 'session_context',
        intensity: 1.0,
        agentId: 'agent_1',
        swarmId: 'swarm_1',
        timestamp: 1700000000000,
        linkedToNode: true,
      },
    ]);

    const handler = registeredTools.get('swarm_pheromone')!;
    const result = await handler({
      projectId: 'proj_test',
      nodeId: 'node_abc',
      type: 'session_context',
      intensity: 1.0,
      agentId: 'agent_1',
      swarmId: 'swarm_1',
    });
    const parsed = jsonOf(result);

    expect(parsed.success).toBe(true);
    expect(parsed.pheromone.id).toBe('ph_new');
    expect(parsed.pheromone.type).toBe('session_context');
    expect(parsed.pheromone.linkedToNode).toBe(true);
  });

  it('cleans up workflow states before setting a new workflow state', async () => {
    mockRun
      .mockResolvedValueOnce([{ cleaned: 1 }]) // cleanup query
      .mockResolvedValueOnce([
        {
          id: 'ph_x',
          projectId: 'proj_test',
          nodeId: 'node_abc',
          type: 'claiming',
          intensity: 1.0,
          agentId: 'agent_1',
          swarmId: 'swarm_1',
          timestamp: 1700000000000,
          linkedToNode: true,
        },
      ]); // create query

    const handler = registeredTools.get('swarm_pheromone')!;
    const result = await handler({
      projectId: 'proj_test',
      nodeId: 'node_abc',
      type: 'claiming', // workflow state
      agentId: 'agent_1',
      swarmId: 'swarm_1',
    });
    const parsed = jsonOf(result);

    // Two queries: cleanup + create
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(parsed.action).toBe('transitioned');
    expect(parsed.previousStatesRemoved).toBe(1);
  });

  it('does NOT run cleanup for flag types (warning, proposal, needs_review)', async () => {
    mockRun.mockResolvedValueOnce([
      {
        id: 'ph_w',
        projectId: 'proj_test',
        nodeId: 'node_abc',
        type: 'warning',
        intensity: 1.0,
        agentId: 'agent_1',
        swarmId: 'swarm_1',
        timestamp: 1700000000000,
        linkedToNode: false,
      },
    ]);

    const handler = registeredTools.get('swarm_pheromone')!;
    const result = await handler({
      projectId: 'proj_test',
      nodeId: 'node_abc',
      type: 'warning', // flag type — no cleanup
      agentId: 'agent_1',
      swarmId: 'swarm_1',
    });
    const parsed = jsonOf(result);

    // Only one query: create (no cleanup for flags)
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(parsed.success).toBe(true);
  });

  it('removes a pheromone when remove=true and pheromone exists', async () => {
    mockRun.mockResolvedValue([{ deleted: 1 }]);

    const handler = registeredTools.get('swarm_pheromone')!;
    const result = await handler({
      projectId: 'proj_test',
      nodeId: 'node_abc',
      type: 'exploring',
      agentId: 'agent_1',
      swarmId: 'swarm_1',
      remove: true,
    });
    const parsed = jsonOf(result);

    expect(parsed.success).toBe(true);
    expect(parsed.action).toBe('removed');
  });

  it('returns not_found when remove=true but pheromone missing', async () => {
    mockRun.mockResolvedValue([{ deleted: 0 }]);

    const handler = registeredTools.get('swarm_pheromone')!;
    const result = await handler({
      projectId: 'proj_test',
      nodeId: 'node_missing',
      type: 'exploring',
      agentId: 'agent_1',
      swarmId: 'swarm_1',
      remove: true,
    });
    const parsed = jsonOf(result);

    expect(parsed.success).toBe(true);
    expect(parsed.action).toBe('not_found');
  });

  it('returns error when create returns empty result (node not in graph)', async () => {
    mockRun.mockResolvedValue([]); // empty = node doesn't exist

    const handler = registeredTools.get('swarm_pheromone')!;
    const result = await handler({
      projectId: 'proj_test',
      nodeId: 'node_ghost',
      type: 'exploring',
      agentId: 'agent_1',
      swarmId: 'swarm_1',
    });
    const text = textOf(result);

    expect(text).toContain('node_ghost');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// swarm-get-tasks.tool.ts — query task board
// ════════════════════════════════════════════════════════════════════════════
describe('createSwarmGetTasksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.clear();
    createSwarmGetTasksTool(mockServer as any);
  });

  it('registers the handler under swarm_get_tasks', () => {
    expect(registeredTools.has('swarm_get_tasks')).toBe(true);
  });

  it('returns task list with pagination metadata', async () => {
    const fakeTask = {
      id: 'task_001',
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      title: 'Write tests',
      description: 'Cover all tools',
      type: 'test',
      priority: 'high',
      priorityScore: 75,
      status: 'available',
      targetNodeIds: [],
      targetFilePaths: [],
      claimedBy: null,
      claimedAt: null,
      startedAt: null,
      completedAt: null,
      createdBy: 'orchestrator',
      createdAt: 1700000000000,
      summary: null,
      metadata: null,
      dependencies: [],
      blockedTasks: [],
      targets: [],
    };
    mockRun.mockResolvedValue([fakeTask]);

    const handler = registeredTools.get('swarm_get_tasks')!;
    const result = await handler({ projectId: 'proj_test', limit: 20, skip: 0 });
    const parsed = jsonOf(result);

    expect(parsed.success).toBe(true);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].id).toBe('task_001');
    expect(parsed.pagination.returned).toBe(1);
    expect(parsed.pagination.skip).toBe(0);
  });

  it('returns single task by ID when taskId is provided', async () => {
    const fakeTask = {
      id: 'task_xyz',
      title: 'Specific task',
      status: 'in_progress',
      metadata: null,
      artifacts: null,
      createdAt: 1700000000000,
      updatedAt: null,
      claimedAt: null,
      startedAt: null,
      completedAt: null,
      dependencies: [],
      blockedTasks: [],
      targets: [],
    };
    mockRun.mockResolvedValue([{ task: fakeTask }]);

    const handler = registeredTools.get('swarm_get_tasks')!;
    const result = await handler({ projectId: 'proj_test', taskId: 'task_xyz' });
    const parsed = jsonOf(result);

    expect(parsed.success).toBe(true);
    expect(parsed.task.id).toBe('task_xyz');
    expect(parsed.task.title).toBe('Specific task');
  });

  it('returns error when task not found by ID', async () => {
    mockRun.mockResolvedValue([]);

    const handler = registeredTools.get('swarm_get_tasks')!;
    const result = await handler({ projectId: 'proj_test', taskId: 'task_nope' });
    const text = textOf(result);

    expect(text).toContain('task_nope');
  });

  it('includes stats when includeStats=true', async () => {
    mockRun
      .mockResolvedValueOnce([]) // main tasks query
      .mockResolvedValueOnce([
        { status: 'available', type: 'implement', priority: 'high', agent: null, count: 3 },
        { status: 'completed', type: 'fix', priority: 'normal', agent: 'agent_1', count: 2 },
      ]) // stats query
      .mockResolvedValueOnce([]); // active workers query

    const handler = registeredTools.get('swarm_get_tasks')!;
    const result = await handler({
      projectId: 'proj_test',
      includeStats: true,
      limit: 20,
      skip: 0,
    });
    const parsed = jsonOf(result);

    expect(parsed.stats).toBeDefined();
    expect(parsed.progress).toBeDefined();
    expect(parsed.stats.byStatus['available']).toBe(3);
    expect(parsed.stats.byStatus['completed']).toBe(2);
  });

  it('includes dependency graph when includeDependencyGraph=true', async () => {
    mockRun
      .mockResolvedValueOnce([]) // tasks
      .mockResolvedValueOnce([
        {
          nodes: [{ id: 'task_a', title: 'Task A', status: 'available', priority: 'high', type: 'implement', claimedBy: null }],
          edges: [{ from: 'task_b', to: 'task_a' }],
        },
      ]); // dep graph

    const handler = registeredTools.get('swarm_get_tasks')!;
    const result = await handler({
      projectId: 'proj_test',
      includeDependencyGraph: true,
      limit: 20,
      skip: 0,
    });
    const parsed = jsonOf(result);

    expect(parsed.dependencyGraph).toBeDefined();
    expect(parsed.dependencyGraph.nodes).toHaveLength(1);
    expect(parsed.dependencyGraph.edges).toHaveLength(1);
  });

  it('closes neo4j connection on error', async () => {
    mockRun.mockRejectedValue(new Error('connection lost'));

    const handler = registeredTools.get('swarm_get_tasks')!;
    const result = await handler({ projectId: 'proj_test', limit: 20, skip: 0 });

    expect(textOf(result)).toContain('connection lost');
    expect(mockClose).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// swarm-graph-refresh.tool.ts — trigger graph refresh
// ════════════════════════════════════════════════════════════════════════════
describe('createSwarmGraphRefreshTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredTools.clear();
    createSwarmGraphRefreshTool(mockServer as any);
  });

  it('registers the handler under swarm_graph_refresh', () => {
    expect(registeredTools.has('swarm_graph_refresh')).toBe(true);
  });

  it('runs incremental parse and returns refresh summary', async () => {
    mockRun.mockResolvedValue([{ path: '/repo/proj' }]);
    mockPerformIncrementalParse.mockResolvedValue({
      filesReparsed: 3,
      filesDeleted: 1,
      nodesUpdated: 42,
      edgesUpdated: 18,
    });

    const handler = registeredTools.get('swarm_graph_refresh')!;
    const result = await handler({ projectId: 'proj_test' });
    const text = textOf(result);

    expect(text).toContain('Files reparsed: 3');
    expect(text).toContain('Files deleted: 1');
    expect(text).toContain('Nodes updated: 42');
    expect(text).toContain('Edges updated: 18');
  });

  it('reports no changes when filesReparsed and filesDeleted are 0', async () => {
    mockRun.mockResolvedValue([{ path: '/repo/proj' }]);
    mockPerformIncrementalParse.mockResolvedValue({
      filesReparsed: 0,
      filesDeleted: 0,
      nodesUpdated: 0,
      edgesUpdated: 0,
    });

    const handler = registeredTools.get('swarm_graph_refresh')!;
    const result = await handler({ projectId: 'proj_test' });
    const text = textOf(result);

    expect(text).toContain('No changes detected');
  });

  it('returns error when project path is not found', async () => {
    mockRun.mockResolvedValue([{ path: null }]);

    const handler = registeredTools.get('swarm_graph_refresh')!;
    const result = await handler({ projectId: 'proj_test' });
    const text = textOf(result);

    expect(text).toContain('proj_test');
  });

  it('returns error when project record is missing entirely', async () => {
    mockRun.mockResolvedValue([]); // empty = project not found

    const handler = registeredTools.get('swarm_graph_refresh')!;
    const result = await handler({ projectId: 'proj_missing' });
    const text = textOf(result);

    expect(text).toContain('proj_missing');
  });

  it('propagates incremental parse errors as error response', async () => {
    mockRun.mockResolvedValue([{ path: '/repo/proj' }]);
    mockPerformIncrementalParse.mockRejectedValue(new Error('parse pipeline failed'));

    const handler = registeredTools.get('swarm_graph_refresh')!;
    const result = await handler({ projectId: 'proj_test' });
    const text = textOf(result);

    expect(text).toContain('parse pipeline failed');
  });

  it('calls performIncrementalParse with the resolved project path and id', async () => {
    mockRun.mockResolvedValue([{ path: '/repo/my-project' }]);
    mockPerformIncrementalParse.mockResolvedValue({
      filesReparsed: 1,
      filesDeleted: 0,
      nodesUpdated: 5,
      edgesUpdated: 2,
    });

    const handler = registeredTools.get('swarm_graph_refresh')!;
    await handler({ projectId: 'proj_test' });

    expect(mockPerformIncrementalParse).toHaveBeenCalledWith(
      '/repo/my-project',
      'proj_test',
      'tsconfig.json',
    );
  });
});
