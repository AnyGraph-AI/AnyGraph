/**
 * AUD-TC-02 Batch 5C — Behavioral tests for 5 swarm mutation/write MCP tools.
 * B6 Health Witness tests: swarm-claim-task, swarm-complete-task, swarm-post-task,
 * swarm-message, swarm-cleanup.
 *
 * Pattern: capture registered handler, call it, assert on result content text.
 * No Cypher assertions. No source-string tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// vi.hoisted — all mock fns survive hoisting
// ────────────────────────────────────────────────────────────────────────────
const { mockRun, mockClose } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockClose: vi.fn().mockResolvedValue(undefined),
}));

// ────────────────────────────────────────────────────────────────────────────
// Capture registered tool handlers (both registration signatures)
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
// Mocks
// ────────────────────────────────────────────────────────────────────────────

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.close = mockClose;
  }),
}));

// CRITICAL: utils path is ../../utils.js (src/mcp/utils.ts from __tests__ dir)
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

// Mock swarm-constants to get deterministic IDs
vi.mock('../swarm-constants.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    generateTaskId: vi.fn(() => 'task_test_abc123'),
    generateMessageId: vi.fn(() => 'msg_test_def456'),
  };
});

// Mock swarm-message.tool.js (imported by swarm-claim-task for exported query constants)
// IMPORTANT: use importOriginal to preserve the real createSwarmMessageTool function.
// Only override the exported query string constants so swarm-claim-task gets stable values.
vi.mock('../swarm-message.tool.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    // Keep real createSwarmMessageTool so the swarm_message describe block works
    PENDING_MESSAGES_FOR_AGENT_QUERY: actual.PENDING_MESSAGES_FOR_AGENT_QUERY,
    AUTO_ACKNOWLEDGE_QUERY: actual.AUTO_ACKNOWLEDGE_QUERY,
  };
});

// ────────────────────────────────────────────────────────────────────────────
// Imports (after mocks declared)
// ────────────────────────────────────────────────────────────────────────────
import { createSwarmClaimTaskTool } from '../swarm-claim-task.tool.js';
import { createSwarmCompleteTaskTool } from '../swarm-complete-task.tool.js';
import { createSwarmPostTaskTool } from '../swarm-post-task.tool.js';
import { createSwarmMessageTool } from '../swarm-message.tool.js';
import { createSwarmCleanupTool } from '../swarm-cleanup.tool.js';

// ────────────────────────────────────────────────────────────────────────────
// Helper: parse result text
// ────────────────────────────────────────────────────────────────────────────
const parseResult = (result: any) => {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const isErrorResult = (result: any): boolean => {
  const text = result?.content?.[0]?.text ?? '';
  return text.startsWith('Error:') || text.includes('"error"');
};

// ============================================================================
// SWARM CLAIM TASK
// ============================================================================

describe('swarm_claim_task tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReset(); // clear once-queue to prevent cross-test pollution
    registeredTools.clear();
    createSwarmClaimTaskTool(mockServer as any);
  });

  it('registers with server on creation', () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'swarm_claim_task',
      expect.any(Object),
      expect.any(Function),
    );
    expect(registeredTools.has('swarm_claim_task')).toBe(true);
  });

  it('claim_and_start: returns claimed_and_started with task details (no messages)', async () => {
    // First call: CLAIM_NEXT_TASK_QUERY → task row
    // Second call: PENDING_MESSAGES_FOR_AGENT_QUERY → empty (no messages)
    mockRun
      .mockResolvedValueOnce([
        {
          id: 'task_abc',
          title: 'Fix auth bug',
          description: 'Fix the auth token expiry',
          type: 'fix',
          priority: 'high',
          priorityScore: 75,
          status: 'in_progress',
          targetNodeIds: ['node1'],
          targetFilePaths: ['/src/auth.ts'],
          dependencies: [],
          claimedBy: 'agent_1',
          claimedAt: 1000,
          startedAt: 1001,
          createdBy: 'orchestrator',
          metadata: null,
          targets: [],
        },
      ])
      .mockResolvedValueOnce([]); // no pending messages

    const handler = registeredTools.get('swarm_claim_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'claim_and_start',
    });

    const data = parseResult(result);
    expect(data.action).toBe('claimed_and_started');
    expect(data.task.id).toBe('task_abc');
    expect(data.task.title).toBe('Fix auth bug');
    expect(data.messages).toBeUndefined();
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it('claim_and_start: delivers pending messages with the claimed task', async () => {
    mockRun
      .mockResolvedValueOnce([
        {
          id: 'task_xyz',
          title: 'Refactor module',
          description: 'Refactor the auth module',
          type: 'refactor',
          priority: 'normal',
          priorityScore: 50,
          status: 'in_progress',
          targetNodeIds: [],
          targetFilePaths: [],
          dependencies: [],
          claimedBy: 'agent_2',
          claimedAt: 2000,
          startedAt: 2001,
          createdBy: 'orchestrator',
          metadata: null,
          targets: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'msg_1',
          fromAgentId: 'agent_0',
          category: 'alert',
          content: 'CI is broken',
          taskId: null,
          filePaths: [],
          timestamp: Date.now() - 5000,
        },
      ])
      .mockResolvedValueOnce([{ acknowledged: 1 }]); // auto-acknowledge

    const handler = registeredTools.get('swarm_claim_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_2',
      action: 'claim_and_start',
    });

    const data = parseResult(result);
    expect(data.action).toBe('claimed_and_started');
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].category).toBe('alert');
    expect(data.messages[0].content).toBe('CI is broken');
  });

  it('no_tasks: returns no_tasks action when blackboard is empty', async () => {
    // All retries return empty
    mockRun.mockResolvedValue([]);

    const handler = registeredTools.get('swarm_claim_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'claim_and_start',
    });

    const data = parseResult(result);
    expect(data.action).toBe('no_tasks');
    expect(typeof data.retryAttempts).toBe('number');
  });

  it('release: returns released action on success', async () => {
    mockRun.mockResolvedValueOnce([{ id: 'task_abc', title: 'Fix thing', status: 'available' }]);

    const handler = registeredTools.get('swarm_claim_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      taskId: 'task_abc',
      action: 'release',
    });

    const data = parseResult(result);
    expect(data.action).toBe('released');
    expect(data.taskId).toBe('task_abc');
  });

  it('release: errors when taskId is missing', async () => {
    const handler = registeredTools.get('swarm_claim_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'release',
      // no taskId
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/taskId is required/);
  });

  it('abandon: returns abandoned action with count', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', title: 'Fix thing', status: 'available', abandonCount: 2, abandonReason: 'stuck' },
    ]);

    const handler = registeredTools.get('swarm_claim_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      taskId: 'task_abc',
      action: 'abandon',
      releaseReason: 'stuck',
    });

    const data = parseResult(result);
    expect(data.action).toBe('abandoned');
    expect(data.taskId).toBe('task_abc');
    expect(data.abandonCount).toBe(2);
  });

  it('force_start: returns force_started action', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', title: 'Fix thing', status: 'in_progress', claimedBy: 'agent_1', startedAt: 3000, forceStarted: true },
    ]);

    const handler = registeredTools.get('swarm_claim_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      taskId: 'task_abc',
      action: 'force_start',
    });

    const data = parseResult(result);
    expect(data.action).toBe('force_started');
    expect(data.status).toBe('in_progress');
  });

  it('start: returns started action', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', status: 'in_progress', claimedBy: 'agent_1', startedAt: 4000 },
    ]);

    const handler = registeredTools.get('swarm_claim_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      taskId: 'task_abc',
      action: 'start',
    });

    const data = parseResult(result);
    expect(data.action).toBe('started');
    expect(data.status).toBe('in_progress');
  });

  it('propagates project resolution failure', async () => {
    const { resolveProjectIdOrError } = await import('../../utils.js');
    vi.mocked(resolveProjectIdOrError).mockResolvedValueOnce({
      success: false,
      error: { content: [{ type: 'text', text: 'Error: project not found' }] } as any,
    } as any);

    const handler = registeredTools.get('swarm_claim_task')!;
    const result = await handler({
      projectId: 'bad_proj',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'claim_and_start',
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/project not found/);
  });
});

// ============================================================================
// SWARM COMPLETE TASK
// ============================================================================

describe('swarm_complete_task tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReset();
    registeredTools.clear();
    createSwarmCompleteTaskTool(mockServer as any);
  });

  it('registers with server on creation', () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'swarm_complete_task',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('complete: returns completed action with taskId', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', title: 'Fix auth', status: 'completed', completedAt: 5000, summary: 'Done', claimedBy: 'agent_1', unblockedTaskIds: [] },
    ]);

    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'complete',
      summary: 'Fixed the auth bug',
    });

    const data = parseResult(result);
    expect(data.action).toBe('completed');
    expect(data.taskId).toBe('task_abc');
  });

  it('complete: error when summary is missing', async () => {
    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'complete',
      // no summary
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/summary is required/);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('complete: includes unblockedTasks when tasks were unblocked', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', title: 'Fix auth', status: 'completed', completedAt: 5000, summary: 'Done', claimedBy: 'agent_1', unblockedTaskIds: ['task_next1', 'task_next2'] },
    ]);

    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'complete',
      summary: 'Done',
    });

    const data = parseResult(result);
    expect(data.unblockedTasks).toEqual(['task_next1', 'task_next2']);
  });

  it('fail: returns failed action with retryable flag', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', title: 'Fix auth', status: 'failed', failedAt: 6000, failureReason: 'timeout', retryable: true },
    ]);

    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'fail',
      reason: 'Connection timeout',
      retryable: true,
    });

    const data = parseResult(result);
    expect(data.action).toBe('failed');
    expect(data.retryable).toBe(true);
  });

  it('fail: error when reason is missing', async () => {
    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'fail',
      // no reason
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/reason is required/);
  });

  it('request_review: returns review_requested action', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', title: 'Fix auth', status: 'needs_review', reviewRequestedAt: 7000, summary: 'Ready', claimedBy: 'agent_1' },
    ]);

    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'request_review',
      summary: 'Implementation complete, ready for review',
    });

    const data = parseResult(result);
    expect(data.action).toBe('review_requested');
    expect(data.taskId).toBe('task_abc');
  });

  it('approve: returns approved action and unblocked tasks', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', title: 'Fix auth', status: 'completed', completedAt: 8000, approvedBy: 'reviewer_1', unblockedTaskIds: ['task_dep1'] },
    ]);

    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'approve',
      reviewerId: 'reviewer_1',
      notes: 'Looks good',
    });

    const data = parseResult(result);
    expect(data.action).toBe('approved');
    expect(data.unblockedTasks).toEqual(['task_dep1']);
  });

  it('approve: error when reviewerId is missing', async () => {
    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'approve',
      // no reviewerId
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/reviewerId is required/);
  });

  it('reject: returns rejected action with status', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', title: 'Fix auth', status: 'in_progress', claimedBy: 'agent_1', rejectionNotes: 'Missing tests' },
    ]);

    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'reject',
      reviewerId: 'reviewer_1',
      notes: 'Missing tests',
    });

    const data = parseResult(result);
    expect(data.action).toBe('rejected');
    expect(data.status).toBe('in_progress');
  });

  it('retry: returns retried action with available status', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'task_abc', title: 'Fix auth', status: 'available', retryCount: 1 },
    ]);

    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'proj_test',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'retry',
    });

    const data = parseResult(result);
    expect(data.action).toBe('retried');
    expect(data.status).toBe('available');
  });

  it('propagates project resolution failure', async () => {
    const { resolveProjectIdOrError } = await import('../../utils.js');
    vi.mocked(resolveProjectIdOrError).mockResolvedValueOnce({
      success: false,
      error: { content: [{ type: 'text', text: 'Error: project not found' }] } as any,
    } as any);

    const handler = registeredTools.get('swarm_complete_task')!;
    const result = await handler({
      projectId: 'bad_proj',
      taskId: 'task_abc',
      agentId: 'agent_1',
      action: 'complete',
      summary: 'Done',
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/project not found/);
  });
});

// ============================================================================
// SWARM POST TASK
// ============================================================================

describe('swarm_post_task tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReset();
    registeredTools.clear();
    createSwarmPostTaskTool(mockServer as any);
  });

  it('registers with server on creation', () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'swarm_post_task',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('creates task with no dependencies — status available', async () => {
    mockRun.mockResolvedValueOnce([
      {
        id: 'task_test_abc123',
        projectId: 'proj_test',
        swarmId: 'swarm_1',
        title: 'Implement login',
        description: 'Build the login flow',
        type: 'implement',
        priority: 'normal',
        priorityScore: 50,
        status: 'available',
        targetNodeIds: ['node1'],
        targetFilePaths: ['/src/login.ts'],
        dependencies: [],
        createdBy: 'orchestrator',
        createdAt: 9000,
      },
    ]);
    // No dependency check (dependencies=[])

    const handler = registeredTools.get('swarm_post_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      title: 'Implement login',
      description: 'Build the login flow',
      type: 'implement',
      priority: 'normal',
      targetNodeIds: ['node1'],
      targetFilePaths: ['/src/login.ts'],
      dependencies: [],
      createdBy: 'orchestrator',
    });

    const data = parseResult(result);
    expect(data.success).toBe(true);
    expect(data.task.id).toBe('task_test_abc123');
    expect(data.task.status).toBe('available');
    expect(data.dependencyStatus.isBlocked).toBe(false);
    expect(data.message).toMatch(/available for claiming/);
  });

  it('creates task with incomplete dependencies — status blocked', async () => {
    // CREATE_TASK_QUERY
    mockRun.mockResolvedValueOnce([
      {
        id: 'task_test_abc123',
        projectId: 'proj_test',
        swarmId: 'swarm_1',
        title: 'Deploy service',
        description: 'Deploy after auth done',
        type: 'implement',
        priority: 'normal',
        priorityScore: 50,
        status: 'available',
        targetNodeIds: [],
        targetFilePaths: [],
        dependencies: ['task_auth'],
        createdBy: 'orchestrator',
        createdAt: 9000,
      },
    ]);
    // CHECK_DEPENDENCIES_QUERY — 1 incomplete dep
    mockRun.mockResolvedValueOnce([
      {
        totalDeps: 1,
        incompleteDeps: 1,
        blockedBy: [{ id: 'task_auth', title: 'Fix auth', status: 'in_progress' }],
      },
    ]);
    // SET_TASK_BLOCKED_QUERY
    mockRun.mockResolvedValueOnce([{ id: 'task_test_abc123' }]);

    const handler = registeredTools.get('swarm_post_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      title: 'Deploy service',
      description: 'Deploy after auth done',
      dependencies: ['task_auth'],
      createdBy: 'orchestrator',
    });

    const data = parseResult(result);
    expect(data.success).toBe(true);
    expect(data.task.status).toBe('blocked');
    expect(data.dependencyStatus.isBlocked).toBe(true);
    expect(data.dependencyStatus.incompleteDeps).toBe(1);
    expect(data.message).toMatch(/blocked/);
  });

  it('falls back to file node lookup when no nodeIds provided', async () => {
    // GET_NODES_FOR_FILE_QUERY
    mockRun.mockResolvedValueOnce([{ id: 'file_node_1' }, { id: 'file_node_2' }]);
    // CREATE_TASK_QUERY
    mockRun.mockResolvedValueOnce([
      {
        id: 'task_test_abc123',
        projectId: 'proj_test',
        swarmId: 'swarm_1',
        title: 'Fix file',
        description: 'Fix the component',
        type: 'fix',
        priority: 'high',
        priorityScore: 75,
        status: 'available',
        targetNodeIds: ['file_node_1', 'file_node_2'],
        targetFilePaths: ['/src/comp.ts'],
        dependencies: [],
        createdBy: 'agent_1',
        createdAt: 9000,
      },
    ]);

    const handler = registeredTools.get('swarm_post_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      title: 'Fix file',
      description: 'Fix the component',
      type: 'fix',
      priority: 'high',
      targetNodeIds: [], // empty — triggers file fallback
      targetFilePaths: ['/src/comp.ts'],
      dependencies: [],
      createdBy: 'agent_1',
    });

    const data = parseResult(result);
    expect(data.success).toBe(true);
    // File node lookup was called
    const fileNodeCall = mockRun.mock.calls[0];
    expect(fileNodeCall[1]).toMatchObject({ filePath: '/src/comp.ts', projectId: 'proj_test' });
  });

  it('returns error when task creation fails (empty result)', async () => {
    mockRun.mockResolvedValueOnce([]); // CREATE fails

    const handler = registeredTools.get('swarm_post_task')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      title: 'Some task',
      description: 'Description',
      createdBy: 'agent_1',
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/Failed to create task/);
  });

  it('uses generateTaskId to assign unique id', async () => {
    mockRun.mockResolvedValueOnce([
      {
        id: 'task_test_abc123',
        projectId: 'proj_test',
        swarmId: 'swarm_1',
        title: 'Test task',
        description: 'desc',
        type: 'test',
        priority: 'low',
        priorityScore: 25,
        status: 'available',
        targetNodeIds: [],
        targetFilePaths: [],
        dependencies: [],
        createdBy: 'tester',
        createdAt: 9001,
      },
    ]);

    const handler = registeredTools.get('swarm_post_task')!;
    await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      title: 'Test task',
      description: 'desc',
      type: 'test',
      priority: 'low',
      createdBy: 'tester',
    });

    // The CREATE_TASK_QUERY call should include taskId from generateTaskId mock
    const createCall = mockRun.mock.calls.find((c) => c[1]?.taskId !== undefined);
    expect(createCall?.[1].taskId).toBe('task_test_abc123');
  });

  it('propagates project resolution failure', async () => {
    const { resolveProjectIdOrError } = await import('../../utils.js');
    vi.mocked(resolveProjectIdOrError).mockResolvedValueOnce({
      success: false,
      error: { content: [{ type: 'text', text: 'Error: project not found' }] } as any,
    } as any);

    const handler = registeredTools.get('swarm_post_task')!;
    const result = await handler({
      projectId: 'bad',
      swarmId: 'swarm_1',
      title: 'Task',
      description: 'desc',
      createdBy: 'agent',
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/project not found/);
  });
});

// ============================================================================
// SWARM MESSAGE
// ============================================================================

describe('swarm_message tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReset();
    registeredTools.clear();
    createSwarmMessageTool(mockServer as any);
  });

  it('registers with server on creation', () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'swarm_message',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('send: creates message and returns sent action', async () => {
    mockRun.mockResolvedValueOnce([
      {
        id: 'msg_test_def456',
        swarmId: 'swarm_1',
        fromAgentId: 'agent_1',
        toAgentId: 'agent_2',
        category: 'alert',
        timestamp: Date.now(),
        expiresAt: Date.now() + 14400000,
      },
    ]);

    const handler = registeredTools.get('swarm_message')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'send',
      toAgentId: 'agent_2',
      category: 'alert',
      content: 'CI pipeline is failing',
    });

    const data = parseResult(result);
    expect(data.action).toBe('sent');
    expect(data.message.id).toBe('msg_test_def456');
    expect(data.message.category).toBe('alert');
    expect(data.message.to).toBe('agent_2');
  });

  it('send: broadcast when toAgentId omitted — to shows broadcast', async () => {
    mockRun.mockResolvedValueOnce([
      {
        id: 'msg_test_def456',
        swarmId: 'swarm_1',
        fromAgentId: 'agent_1',
        toAgentId: null,
        category: 'finding',
        timestamp: Date.now(),
        expiresAt: Date.now() + 14400000,
      },
    ]);

    const handler = registeredTools.get('swarm_message')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'send',
      category: 'finding',
      content: 'Found a race condition in queue processor',
    });

    const data = parseResult(result);
    expect(data.action).toBe('sent');
    expect(data.message.to).toBe('broadcast');
  });

  it('send: error when category is missing', async () => {
    const handler = registeredTools.get('swarm_message')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'send',
      content: 'Something happened',
      // no category
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/category is required/);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('send: error when content is missing', async () => {
    const handler = registeredTools.get('swarm_message')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'send',
      category: 'blocked',
      // no content
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/content is required/);
  });

  it('read: returns messages for agent', async () => {
    mockRun.mockResolvedValueOnce([
      {
        id: 'msg_1',
        swarmId: 'swarm_1',
        fromAgentId: 'agent_0',
        toAgentId: 'agent_2',
        category: 'handoff',
        content: 'Passing auth work to you',
        taskId: 'task_abc',
        filePaths: ['/src/auth.ts'],
        timestamp: Date.now() - 30000,
        expiresAt: Date.now() + 14000000,
        readBy: [],
        isUnread: true,
      },
    ]);

    const handler = registeredTools.get('swarm_message')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_2',
      action: 'read',
      unreadOnly: true,
    });

    const data = parseResult(result);
    expect(data.action).toBe('read');
    expect(data.count).toBe(1);
    expect(data.messages[0].category).toBe('handoff');
    expect(data.messages[0].isUnread).toBe(true);
  });

  it('acknowledge specific messages: returns acknowledged action', async () => {
    mockRun.mockResolvedValueOnce([
      { id: 'msg_1', category: 'alert' },
      { id: 'msg_2', category: 'finding' },
    ]);

    const handler = registeredTools.get('swarm_message')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_2',
      action: 'acknowledge',
      messageIds: ['msg_1', 'msg_2'],
    });

    const data = parseResult(result);
    expect(data.action).toBe('acknowledged');
    expect(data.count).toBe(2);
    expect(data.messageIds).toContain('msg_1');
    expect(data.messageIds).toContain('msg_2');
  });

  it('acknowledge all: returns acknowledged_all with count', async () => {
    mockRun.mockResolvedValueOnce([{ acknowledged: 5 }]);

    const handler = registeredTools.get('swarm_message')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_2',
      action: 'acknowledge',
      // no messageIds → acknowledge all
    });

    const data = parseResult(result);
    expect(data.action).toBe('acknowledged_all');
    expect(data.count).toBe(5);
  });

  it('cleanup flag also runs expired message cleanup', async () => {
    // cleanup CLEANUP_EXPIRED_QUERY
    mockRun.mockResolvedValueOnce([{ cleaned: 3 }]);
    // SEND_MESSAGE_QUERY
    mockRun.mockResolvedValueOnce([
      {
        id: 'msg_test_def456',
        swarmId: 'swarm_1',
        fromAgentId: 'agent_1',
        toAgentId: null,
        category: 'request',
        timestamp: Date.now(),
        expiresAt: Date.now() + 14400000,
      },
    ]);

    const handler = registeredTools.get('swarm_message')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'send',
      category: 'request',
      content: 'Need help with auth',
      cleanup: true,
    });

    const data = parseResult(result);
    expect(data.expiredCleaned).toBe(3);
    expect(mockRun).toHaveBeenCalledTimes(2); // cleanup + send
  });

  it('propagates project resolution failure', async () => {
    const { resolveProjectIdOrError } = await import('../../utils.js');
    vi.mocked(resolveProjectIdOrError).mockResolvedValueOnce({
      success: false,
      error: { content: [{ type: 'text', text: 'Error: project not found' }] } as any,
    } as any);

    const handler = registeredTools.get('swarm_message')!;
    const result = await handler({
      projectId: 'bad',
      swarmId: 'swarm_1',
      agentId: 'agent_1',
      action: 'read',
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/project not found/);
  });
});

// ============================================================================
// SWARM CLEANUP
// ============================================================================

describe('swarm_cleanup tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockReset();
    registeredTools.clear();
    createSwarmCleanupTool(mockServer as any);
  });

  it('registers with server on creation', () => {
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'swarm_cleanup',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('swarm cleanup: deletes pheromones + tasks + messages by swarmId', async () => {
    // pheromones
    mockRun.mockResolvedValueOnce([{ deleted: 10, agents: ['agent_1'], types: ['modifying', 'exploring'] }]);
    // tasks
    mockRun.mockResolvedValueOnce([{ deleted: 5, statuses: ['completed', 'failed'] }]);
    // messages
    mockRun.mockResolvedValueOnce([{ deleted: 3, categories: ['alert', 'handoff'] }]);

    const handler = registeredTools.get('swarm_cleanup')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      includeTasks: true,
    });

    const data = parseResult(result);
    expect(data.success).toBe(true);
    expect(data.mode).toBe('swarm');
    expect(data.pheromones.deleted).toBe(10);
    expect(data.tasks.deleted).toBe(5);
    expect(data.messages.deleted).toBe(3);
    expect(data.message).toMatch(/10 pheromones/);
    expect(data.message).toMatch(/5 tasks/);
    expect(data.message).toMatch(/3 messages/);
  });

  it('agent cleanup: deletes only pheromones for the agent', async () => {
    mockRun.mockResolvedValueOnce([{ deleted: 7, swarms: ['swarm_1'], types: ['claiming'] }]);

    const handler = registeredTools.get('swarm_cleanup')!;
    const result = await handler({
      projectId: 'proj_test',
      agentId: 'agent_1',
    });

    const data = parseResult(result);
    expect(data.success).toBe(true);
    expect(data.mode).toBe('agent');
    expect(data.pheromones.deleted).toBe(7);
    expect(data.tasks).toBeNull();
    expect(data.messages).toBeNull();
  });

  it('all cleanup: deletes all pheromones in project', async () => {
    mockRun.mockResolvedValueOnce([{ deleted: 42, agents: ['a1', 'a2'], swarms: ['s1'], types: ['exploring', 'modifying', 'claiming'] }]);

    const handler = registeredTools.get('swarm_cleanup')!;
    const result = await handler({
      projectId: 'proj_test',
      all: true,
    });

    const data = parseResult(result);
    expect(data.success).toBe(true);
    expect(data.mode).toBe('all');
    expect(data.pheromones.deleted).toBe(42);
  });

  it('dryRun: previews without deleting', async () => {
    // count pheromones
    mockRun.mockResolvedValueOnce([{ count: 8, agents: ['agent_1'], types: ['modifying'] }]);
    // count tasks
    mockRun.mockResolvedValueOnce([{ count: 4, statuses: ['in_progress'] }]);
    // count messages
    mockRun.mockResolvedValueOnce([{ count: 2, categories: ['alert'] }]);

    const handler = registeredTools.get('swarm_cleanup')!;
    const result = await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      dryRun: true,
    });

    const data = parseResult(result);
    expect(data.success).toBe(true);
    expect(data.dryRun).toBe(true);
    expect(data.pheromones.wouldDelete).toBe(8);
    expect(data.tasks.wouldDelete).toBe(4);
    expect(data.messages.wouldDelete).toBe(2);
    // Ensure no delete queries ran (only count queries)
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  it('error when no swarmId, agentId, or all provided', async () => {
    const handler = registeredTools.get('swarm_cleanup')!;
    const result = await handler({
      projectId: 'proj_test',
      // no swarmId, agentId, or all
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/Must specify one of/);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('keepTypes preserved — warning pheromones excluded from deletion', async () => {
    mockRun.mockResolvedValueOnce([{ deleted: 5, agents: ['agent_1'], types: ['exploring'] }]);
    mockRun.mockResolvedValueOnce([{ deleted: 2, statuses: ['available'] }]);
    mockRun.mockResolvedValueOnce([{ deleted: 0, categories: [] }]);

    const handler = registeredTools.get('swarm_cleanup')!;
    await handler({
      projectId: 'proj_test',
      swarmId: 'swarm_1',
      keepTypes: ['warning', 'proposal'],
    });

    // keepTypes should be passed to the query
    const pheromoneDeleteCall = mockRun.mock.calls[0];
    expect(pheromoneDeleteCall[1].keepTypes).toEqual(['warning', 'proposal']);
  });

  it('propagates project resolution failure', async () => {
    const { resolveProjectIdOrError } = await import('../../utils.js');
    vi.mocked(resolveProjectIdOrError).mockResolvedValueOnce({
      success: false,
      error: { content: [{ type: 'text', text: 'Error: project not found' }] } as any,
    } as any);

    const handler = registeredTools.get('swarm_cleanup')!;
    const result = await handler({
      projectId: 'bad',
      swarmId: 'swarm_1',
    });

    const text = result?.content?.[0]?.text;
    expect(text).toMatch(/project not found/);
  });
});
