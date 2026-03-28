/**
 * AUD-TC-PP-4: Behavioral contracts for enrichCrossDomain
 *
 * CRITICAL tier function, HIGH_TEMPORAL_COUPLING, 39 commits.
 * Tests use real Neo4j connection per SCAR-010 (behavioral contracts).
 * All tests use { timeout: 60_000 } per SCAR-013.
 *
 * Pre-seeds:
 * - SourceFile node with known filePath for file_path ref resolution
 * - Task nodes (CodeNode with coreType=Task) for depends_on ref resolution
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import neo4j, { Driver } from 'neo4j-driver';
import { v4 as uuidv4 } from 'uuid';
import {
  parsePlanProject,
  enrichCrossDomain,
  type ParsedPlan,
} from '../plan-parser.js';

// Isolated projectId for this test suite
const TEST_PROJECT_ID = `test_pp4_${uuidv4()}`;
const TEST_CODE_PROJECT_ID = `test_code_pp4_${uuidv4()}`;

// Neo4j connection
const NEO4J_URI = 'bolt://localhost:7687';
const NEO4J_USER = 'neo4j';
const NEO4J_PASSWORD = 'codegraph';

let driver: Driver;

// Seeded node IDs for verification
const SEEDED_SOURCE_FILE_ID = `${TEST_CODE_PROJECT_ID}:sf:test-target`;
const SEEDED_SOURCE_FILE_PATH = 'src/fake/test-target.ts';

const SEEDED_TASK_A_ID = `${TEST_PROJECT_ID}:task:task-a`;
const SEEDED_TASK_B_ID = `${TEST_PROJECT_ID}:task:task-b`;
const SEEDED_TASK_C_ID = `${TEST_PROJECT_ID}:task:task-c`;

beforeAll(async () => {
  driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session();

  try {
    // Clean up any existing test data
    await session.run(
      `MATCH (n)
       WHERE n.projectId IN [$testProjectId, $codeProjectId]
          OR n.id STARTS WITH $testProjectId
          OR n.id STARTS WITH $codeProjectId
       DETACH DELETE n`,
      { testProjectId: TEST_PROJECT_ID, codeProjectId: TEST_CODE_PROJECT_ID },
    );

    // Seed a SourceFile node for file_path ref resolution
    await session.run(
      `CREATE (sf:SourceFile:CodeNode {
         id: $id,
         projectId: $projectId,
         name: 'test-target.ts',
         filePath: $filePath,
         coreType: 'SourceFile'
       })`,
      {
        id: SEEDED_SOURCE_FILE_ID,
        projectId: TEST_CODE_PROJECT_ID,
        filePath: SEEDED_SOURCE_FILE_PATH,
      },
    );

    // Seed Task nodes (as CodeNode with coreType=Task) for depends_on ref resolution
    await session.run(
      `CREATE (t:Task:CodeNode {
         id: $id,
         projectId: $projectId,
         name: 'Task A',
         coreType: 'Task',
         status: 'done'
       })`,
      { id: SEEDED_TASK_A_ID, projectId: TEST_PROJECT_ID },
    );

    await session.run(
      `CREATE (t:Task:CodeNode {
         id: $id,
         projectId: $projectId,
         name: 'Task B',
         coreType: 'Task',
         status: 'planned'
       })`,
      { id: SEEDED_TASK_B_ID, projectId: TEST_PROJECT_ID },
    );

    await session.run(
      `CREATE (t:Task:CodeNode {
         id: $id,
         projectId: $projectId,
         name: 'Task C',
         coreType: 'Task',
         status: 'planned'
       })`,
      { id: SEEDED_TASK_C_ID, projectId: TEST_PROJECT_ID },
    );

    // Seed a PlanProject node (required for plan↔code project mapping edge creation)
    await session.run(
      `CREATE (pp:PlanProject:CodeNode {
         id: $id,
         projectId: $projectId,
         name: 'Test Plan Project',
         coreType: 'PlanProject'
       })`,
      { id: `${TEST_PROJECT_ID}:project`, projectId: TEST_PROJECT_ID },
    );
  } finally {
    await session.close();
  }
}, 60_000);

afterAll(async () => {
  const session = driver.session();
  try {
    // Clean up all test data
    await session.run(
      `MATCH (n)
       WHERE n.projectId IN [$testProjectId, $codeProjectId]
          OR n.id STARTS WITH $testProjectId
          OR n.id STARTS WITH $codeProjectId
       DETACH DELETE n`,
      { testProjectId: TEST_PROJECT_ID, codeProjectId: TEST_CODE_PROJECT_ID },
    );
  } finally {
    await session.close();
    await driver.close();
  }
}, 60_000);

// Helper to create a ParsedPlan with controlled unresolvedRefs
function createParsedPlanWithRefs(
  unresolvedRefs: Array<{ taskId: string; taskName: string; refType: string; refValue: string }>,
): ParsedPlan {
  return {
    projectId: TEST_PROJECT_ID,
    projectName: 'Test Plan',
    nodes: [],
    edges: [],
    unresolvedRefs,
    stats: {
      files: 1,
      tasks: unresolvedRefs.length,
      milestones: 0,
      sprints: 0,
      decisions: 0,
      crossRefs: unresolvedRefs.length,
    },
  };
}

// Helper to clean up edges created by a specific test
async function cleanupTestEdges(): Promise<void> {
  const session = driver.session();
  try {
    await session.run(
      `MATCH (src)-[r:HAS_CODE_EVIDENCE|DEPENDS_ON]->(dst)
       WHERE src.projectId = $projectId OR r.projectId = $projectId
       DELETE r`,
      { projectId: TEST_PROJECT_ID },
    );
  } finally {
    await session.close();
  }
}

describe('AUD-TC-PP-4: enrichCrossDomain behavioral contracts', () => {
  // Test 1: Return shape
  it('returns { resolved, notFound, evidenceEdges, driftDetected } with correct types', async () => {
    const parsedPlan = createParsedPlanWithRefs([]);
    const result = await enrichCrossDomain([parsedPlan], NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // All fields present
    expect(result).toHaveProperty('resolved');
    expect(result).toHaveProperty('notFound');
    expect(result).toHaveProperty('evidenceEdges');
    expect(result).toHaveProperty('driftDetected');

    // Correct types
    expect(typeof result.resolved).toBe('number');
    expect(typeof result.notFound).toBe('number');
    expect(typeof result.evidenceEdges).toBe('number');
    expect(Array.isArray(result.driftDetected)).toBe(true);
  }, 60_000);

  // Test 2: file_path ref matching seeded SourceFile → resolved increments, HAS_CODE_EVIDENCE edge created
  it('file_path ref matching seeded SourceFile creates HAS_CODE_EVIDENCE edge and increments resolved', async () => {
    await cleanupTestEdges();

    const parsedPlan = createParsedPlanWithRefs([
      {
        taskId: SEEDED_TASK_A_ID,
        taskName: 'Task A',
        refType: 'file_path',
        refValue: SEEDED_SOURCE_FILE_PATH,
      },
    ]);

    const result = await enrichCrossDomain([parsedPlan], NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // resolved should increment for the matching file_path ref
    expect(result.resolved).toBeGreaterThanOrEqual(1);

    // Verify HAS_CODE_EVIDENCE edge exists via Cypher
    const session = driver.session();
    try {
      const edgeResult = await session.run(
        `MATCH (t:Task {id: $taskId})-[r:HAS_CODE_EVIDENCE]->(sf:SourceFile {id: $sfId})
         RETURN r.refType AS refType, r.refValue AS refValue`,
        { taskId: SEEDED_TASK_A_ID, sfId: SEEDED_SOURCE_FILE_ID },
      );

      expect(edgeResult.records.length).toBe(1);
      expect(edgeResult.records[0].get('refType')).toBe('file_path');
      expect(edgeResult.records[0].get('refValue')).toBe(SEEDED_SOURCE_FILE_PATH);
    } finally {
      await session.close();
    }
  }, 60_000);

  // Test 3: file_path ref with no matching SourceFile → notFound increments, no edge created
  it('file_path ref with no matching SourceFile increments notFound and creates no edge', async () => {
    await cleanupTestEdges();

    const nonExistentPath = 'src/does/not/exist/nonexistent-file.ts';
    const parsedPlan = createParsedPlanWithRefs([
      {
        taskId: SEEDED_TASK_A_ID,
        taskName: 'Task A',
        refType: 'file_path',
        refValue: nonExistentPath,
      },
    ]);

    const result = await enrichCrossDomain([parsedPlan], NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // notFound should increment for the non-matching file_path ref
    expect(result.notFound).toBeGreaterThanOrEqual(1);

    // Verify no HAS_CODE_EVIDENCE edge was created for this ref
    const session = driver.session();
    try {
      const edgeResult = await session.run(
        `MATCH (t:Task {id: $taskId})-[r:HAS_CODE_EVIDENCE]->(sf)
         WHERE r.refValue = $refValue
         RETURN count(r) AS edgeCount`,
        { taskId: SEEDED_TASK_A_ID, refValue: nonExistentPath },
      );

      expect(edgeResult.records[0].get('edgeCount').toNumber()).toBe(0);
    } finally {
      await session.close();
    }
  }, 60_000);

  // Test 4: depends_on ref between two seeded Task nodes → DEPENDS_ON edge created
  it('depends_on ref between seeded Task nodes creates DEPENDS_ON edge', async () => {
    await cleanupTestEdges();

    const parsedPlan = createParsedPlanWithRefs([
      {
        taskId: SEEDED_TASK_A_ID,
        taskName: 'Task A',
        refType: 'depends_on',
        refValue: 'Task B',
      },
    ]);

    const result = await enrichCrossDomain([parsedPlan], NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // resolved should increment
    expect(result.resolved).toBeGreaterThanOrEqual(1);

    // Verify DEPENDS_ON edge exists via Cypher
    const session = driver.session();
    try {
      const edgeResult = await session.run(
        `MATCH (src:Task {id: $srcId})-[r:DEPENDS_ON]->(dst:Task {id: $dstId})
         RETURN r.refType AS refType, r.refValue AS refValue`,
        { srcId: SEEDED_TASK_A_ID, dstId: SEEDED_TASK_B_ID },
      );

      expect(edgeResult.records.length).toBe(1);
      expect(edgeResult.records[0].get('refType')).toBe('depends_on');
    } finally {
      await session.close();
    }
  }, 60_000);

  // Test 5: Idempotency — second call with same data produces no duplicate edges
  it('second call with same data is idempotent — no duplicate HAS_CODE_EVIDENCE edges', async () => {
    await cleanupTestEdges();

    const parsedPlan = createParsedPlanWithRefs([
      {
        taskId: SEEDED_TASK_A_ID,
        taskName: 'Task A',
        refType: 'file_path',
        refValue: SEEDED_SOURCE_FILE_PATH,
      },
    ]);

    // First call
    const result1 = await enrichCrossDomain([parsedPlan], NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Count edges after first call
    const session = driver.session();
    let edgeCountAfterFirst: number;
    try {
      const countResult = await session.run(
        `MATCH (t:Task {id: $taskId})-[r:HAS_CODE_EVIDENCE]->(sf:SourceFile {id: $sfId})
         RETURN count(r) AS edgeCount`,
        { taskId: SEEDED_TASK_A_ID, sfId: SEEDED_SOURCE_FILE_ID },
      );
      edgeCountAfterFirst = countResult.records[0].get('edgeCount').toNumber();
    } finally {
      await session.close();
    }

    // Second call with identical data
    const result2 = await enrichCrossDomain([parsedPlan], NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Count edges after second call
    const session2 = driver.session();
    try {
      const countResult = await session2.run(
        `MATCH (t:Task {id: $taskId})-[r:HAS_CODE_EVIDENCE]->(sf:SourceFile {id: $sfId})
         RETURN count(r) AS edgeCount`,
        { taskId: SEEDED_TASK_A_ID, sfId: SEEDED_SOURCE_FILE_ID },
      );
      const edgeCountAfterSecond = countResult.records[0].get('edgeCount').toNumber();

      // No duplicate edges (MERGE semantics)
      expect(edgeCountAfterSecond).toBe(edgeCountAfterFirst);
      expect(edgeCountAfterSecond).toBe(1);
    } finally {
      await session2.close();
    }

    // Both calls should report same resolved count
    expect(result1.resolved).toBe(result2.resolved);
  }, 60_000);

  // Test 6: Empty parsedPlans array → returns zeros
  it('empty parsedPlans array returns { resolved: 0, notFound: 0, evidenceEdges: 0, driftDetected: [] }', async () => {
    const result = await enrichCrossDomain([], NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    expect(result.resolved).toBe(0);
    expect(result.notFound).toBe(0);
    expect(result.evidenceEdges).toBe(0);
    expect(result.driftDetected).toEqual([]);
  }, 60_000);

  // Test 7: Phase 1 DELETE cleanup — old DEPENDS_ON edges removed when deps change
  it('Phase 1 DELETE cleanup removes old DEPENDS_ON edges when deps change', async () => {
    await cleanupTestEdges();

    // First run: Task A depends on Task B
    const parsedPlan1 = createParsedPlanWithRefs([
      {
        taskId: SEEDED_TASK_A_ID,
        taskName: 'Task A',
        refType: 'depends_on',
        refValue: 'Task B',
      },
    ]);

    await enrichCrossDomain([parsedPlan1], NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Verify A→B edge exists
    const session1 = driver.session();
    try {
      const abResult = await session1.run(
        `MATCH (src:Task {id: $srcId})-[r:DEPENDS_ON]->(dst:Task {id: $dstId})
         RETURN count(r) AS edgeCount`,
        { srcId: SEEDED_TASK_A_ID, dstId: SEEDED_TASK_B_ID },
      );
      expect(abResult.records[0].get('edgeCount').toNumber()).toBe(1);
    } finally {
      await session1.close();
    }

    // Second run: Task A now depends on Task C (not B)
    const parsedPlan2 = createParsedPlanWithRefs([
      {
        taskId: SEEDED_TASK_A_ID,
        taskName: 'Task A',
        refType: 'depends_on',
        refValue: 'Task C',
      },
    ]);

    await enrichCrossDomain([parsedPlan2], NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Verify: A→B edge should be GONE, A→C edge should exist
    const session2 = driver.session();
    try {
      const abResult = await session2.run(
        `MATCH (src:Task {id: $srcId})-[r:DEPENDS_ON]->(dst:Task {id: $dstId})
         RETURN count(r) AS edgeCount`,
        { srcId: SEEDED_TASK_A_ID, dstId: SEEDED_TASK_B_ID },
      );
      expect(abResult.records[0].get('edgeCount').toNumber()).toBe(0);

      const acResult = await session2.run(
        `MATCH (src:Task {id: $srcId})-[r:DEPENDS_ON]->(dst:Task {id: $dstId})
         RETURN count(r) AS edgeCount`,
        { srcId: SEEDED_TASK_A_ID, dstId: SEEDED_TASK_C_ID },
      );
      expect(acResult.records[0].get('edgeCount').toNumber()).toBe(1);
    } finally {
      await session2.close();
    }
  }, 60_000);
});
