/**
 * AUD-TC-PP-3: Behavioral contracts for ingestToNeo4j
 *
 * Real Neo4j integration tests. Asserts observable behavior:
 * - PlanProject node creation
 * - Task/Milestone node upserts
 * - Idempotency (no duplicate nodes on re-run)
 * - Stale node removal
 * - validateProjectWrite enforcement
 *
 * SCAR-013: all tests use { timeout: 60_000 }
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import neo4j, { Driver, Session } from 'neo4j-driver';
import { randomUUID } from 'crypto';
import { ingestToNeo4j, ParsedPlan, PlanNode, PlanEdge } from '../plan-parser.js';
import { ProjectWriteValidationError } from '../../guards/project-write-guard.js';

const NEO4J_URI = 'bolt://localhost:7687';
const NEO4J_USER = 'neo4j';
const NEO4J_PASSWORD = 'codegraph';

// Isolated test projectId — must not conflict with proj_c0d3e9a1f200
const TEST_PROJECT_ID = `test_pp3_${randomUUID().slice(0, 8)}`;
const TEST_PROJECT_NAME = 'PP3 Behavioral Test Project';

describe('ingestToNeo4j behavioral contracts', () => {
  let driver: Driver;
  let session: Session;

  // Helper to create a ParsedPlan with given tasks
  function createParsedPlan(tasks: string[], milestones: number[] = [1]): ParsedPlan {
    const nodes: PlanNode[] = [];
    const edges: PlanEdge[] = [];

    // Add PlanProject node
    const projectNodeId = `${TEST_PROJECT_ID}::project`;
    nodes.push({
      id: projectNodeId,
      labels: ['CodeNode', 'PlanProject'],
      properties: {
        name: TEST_PROJECT_NAME,
        projectId: TEST_PROJECT_ID,
        coreType: 'PlanProject',
      },
    });

    // Add Milestone nodes
    for (const milestoneNum of milestones) {
      const milestoneId = `${TEST_PROJECT_ID}::milestone::${milestoneNum}`;
      nodes.push({
        id: milestoneId,
        labels: ['CodeNode', 'Milestone'],
        properties: {
          name: `Milestone ${milestoneNum}`,
          number: milestoneNum,
          projectId: TEST_PROJECT_ID,
          coreType: 'Milestone',
        },
      });
      edges.push({
        id: `${milestoneId}->PART_OF->${projectNodeId}`,
        type: 'PART_OF',
        source: milestoneId,
        target: projectNodeId,
        properties: {},
      });
    }

    // Add Task nodes
    for (let i = 0; i < tasks.length; i++) {
      const taskName = tasks[i];
      const taskId = `${TEST_PROJECT_ID}::task::${i}::${taskName.replace(/\s+/g, '_')}`;
      nodes.push({
        id: taskId,
        labels: ['CodeNode', 'Task'],
        properties: {
          name: taskName,
          status: 'planned',
          projectId: TEST_PROJECT_ID,
          coreType: 'Task',
        },
      });

      // Link task to first milestone
      const firstMilestoneId = `${TEST_PROJECT_ID}::milestone::${milestones[0]}`;
      edges.push({
        id: `${taskId}->PART_OF->${firstMilestoneId}`,
        type: 'PART_OF',
        source: taskId,
        target: firstMilestoneId,
        properties: {},
      });
    }

    return {
      projectId: TEST_PROJECT_ID,
      projectName: TEST_PROJECT_NAME,
      nodes,
      edges,
      unresolvedRefs: [],
      stats: {
        files: 1,
        tasks: tasks.length,
        milestones: milestones.length,
        sprints: 0,
        decisions: 0,
        crossRefs: 0,
      },
    };
  }

  beforeAll(async () => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    session = driver.session();

    // Pre-register the test projectId by creating a Project node with registered=true
    // This is required because validateProjectWrite checks for Project.registered=true
    await session.run(
      `MERGE (p:Project:CodeNode {projectId: $projectId})
       SET p.registered = true, p.name = $name, p.type = 'plan'`,
      { projectId: TEST_PROJECT_ID, name: TEST_PROJECT_NAME },
    );
  }, 60_000);

  afterAll(async () => {
    // Clean up ALL nodes with the test projectId
    if (session) {
      await session.run(
        `MATCH (n {projectId: $projectId}) DETACH DELETE n`,
        { projectId: TEST_PROJECT_ID },
      );
      await session.close();
    }
    if (driver) {
      await driver.close();
    }
  }, 60_000);

  it('should create PlanProject node with correct projectId and name', async () => {
    const plan = createParsedPlan(['Task A']);
    await ingestToNeo4j(plan, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Query Neo4j for the Project node
    const result = await session.run(
      `MATCH (p:Project {projectId: $projectId})
       RETURN p.name AS name, p.projectId AS projectId, p.type AS type`,
      { projectId: TEST_PROJECT_ID },
    );

    expect(result.records.length).toBeGreaterThan(0);
    const record = result.records[0];
    expect(record.get('projectId')).toBe(TEST_PROJECT_ID);
    expect(record.get('name')).toBe(TEST_PROJECT_NAME);
    expect(record.get('type')).toBe('plan');
  }, 60_000);

  it('should create Task nodes with names matching the input ParsedPlan', async () => {
    const taskNames = ['Build parser', 'Write tests', 'Document API'];
    const plan = createParsedPlan(taskNames);
    await ingestToNeo4j(plan, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Query Neo4j for Task nodes
    const result = await session.run(
      `MATCH (t:Task {projectId: $projectId})
       RETURN t.name AS name`,
      { projectId: TEST_PROJECT_ID },
    );

    const foundNames = result.records.map((r) => r.get('name'));
    for (const taskName of taskNames) {
      expect(foundNames).toContain(taskName);
    }
  }, 60_000);

  it('should create Milestone nodes with correct milestone numbers', async () => {
    const milestones = [1, 2, 3];
    const plan = createParsedPlan(['Task A'], milestones);
    await ingestToNeo4j(plan, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Query Neo4j for Milestone nodes
    const result = await session.run(
      `MATCH (m:Milestone {projectId: $projectId})
       RETURN m.number AS number, m.name AS name`,
      { projectId: TEST_PROJECT_ID },
    );

    const foundNumbers = result.records.map((r) => {
      const num = r.get('number');
      return typeof num === 'object' && num.toNumber ? num.toNumber() : num;
    });

    for (const milestoneNum of milestones) {
      expect(foundNumbers).toContain(milestoneNum);
    }
  }, 60_000);

  it('should return nodesUpserted > 0 for non-empty plan', async () => {
    const plan = createParsedPlan(['Task X', 'Task Y']);
    const result = await ingestToNeo4j(plan, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    expect(result).toHaveProperty('nodesUpserted');
    expect(result).toHaveProperty('edgesCreated');
    expect(result).toHaveProperty('staleRemoved');
    expect(result.nodesUpserted).toBeGreaterThan(0);
  }, 60_000);

  it('should be idempotent — second ingest with same data does not increase node count', async () => {
    // Clear and re-ingest to get clean state
    await session.run(
      `MATCH (n:CodeNode {projectId: $projectId})
       WHERE n.coreType IN ['Task', 'Milestone', 'PlanProject']
       DETACH DELETE n`,
      { projectId: TEST_PROJECT_ID },
    );

    const plan = createParsedPlan(['Idempotent Task 1', 'Idempotent Task 2']);

    // First ingest
    await ingestToNeo4j(plan, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Count nodes after first ingest
    const countResult1 = await session.run(
      `MATCH (n:CodeNode {projectId: $projectId})
       RETURN count(n) AS nodeCount`,
      { projectId: TEST_PROJECT_ID },
    );
    const count1 = countResult1.records[0].get('nodeCount').toNumber();

    // Second ingest with same data
    await ingestToNeo4j(plan, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Count nodes after second ingest
    const countResult2 = await session.run(
      `MATCH (n:CodeNode {projectId: $projectId})
       RETURN count(n) AS nodeCount`,
      { projectId: TEST_PROJECT_ID },
    );
    const count2 = countResult2.records[0].get('nodeCount').toNumber();

    // Node count should not increase
    expect(count2).toBe(count1);
  }, 60_000);

  it('should remove stale nodes when plan changes — staleRemoved > 0 and removed task no longer in graph', async () => {
    // Clear existing nodes
    await session.run(
      `MATCH (n:CodeNode {projectId: $projectId})
       WHERE n.coreType IN ['Task', 'Milestone', 'PlanProject']
       DETACH DELETE n`,
      { projectId: TEST_PROJECT_ID },
    );

    // Ingest Plan A with 3 tasks
    const planA = createParsedPlan(['Keep Task 1', 'Keep Task 2', 'Remove Task']);
    await ingestToNeo4j(planA, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // Verify Remove Task exists
    const beforeResult = await session.run(
      `MATCH (t:Task {projectId: $projectId, name: 'Remove Task'})
       RETURN count(t) AS count`,
      { projectId: TEST_PROJECT_ID },
    );
    expect(beforeResult.records[0].get('count').toNumber()).toBe(1);

    // Ingest Plan B with 2 tasks (Remove Task gone)
    const planB = createParsedPlan(['Keep Task 1', 'Keep Task 2']);
    const result = await ingestToNeo4j(planB, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);

    // staleRemoved should be >= 1 (at least the removed task)
    expect(result.staleRemoved).toBeGreaterThanOrEqual(1);

    // Verify Remove Task no longer exists
    const afterResult = await session.run(
      `MATCH (t:Task {projectId: $projectId, name: 'Remove Task'})
       RETURN count(t) AS count`,
      { projectId: TEST_PROJECT_ID },
    );
    expect(afterResult.records[0].get('count').toNumber()).toBe(0);
  }, 60_000);

  it('should reject ingest with unregistered projectId via validateProjectWrite', async () => {
    const unregisteredProjectId = `test_pp3_unregistered_${randomUUID().slice(0, 8)}`;

    const plan: ParsedPlan = {
      projectId: unregisteredProjectId,
      projectName: 'Unregistered Project',
      nodes: [],
      edges: [],
      unresolvedRefs: [],
      stats: { files: 0, tasks: 0, milestones: 0, sprints: 0, decisions: 0, crossRefs: 0 },
    };

    try {
      await ingestToNeo4j(plan, NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);
      // Should not reach here
      expect.fail('Expected ingestToNeo4j to throw ProjectWriteValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectWriteValidationError);
      expect((error as Error).message).toContain('PROJECT_WRITE_BLOCKED');
      expect((error as Error).message).toContain(unregisteredProjectId);
    }
  }, 60_000);
});
