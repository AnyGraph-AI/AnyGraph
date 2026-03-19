import neo4j, { Driver } from 'neo4j-driver';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { materializeIrDocument } from '../../../../core/ir/ir-materializer.js';
import { ProjectWriteValidationError } from '../../../../core/guards/project-write-guard.js';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';

const NEO4J_URI = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER ?? 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? 'codegraph';

const PID_UNREGISTERED = '__rf17_live_guard_unregistered__';
const PID_REGISTERED = '__rf17_live_guard_registered__';

let driver: Driver;

const adminRun = async (query: string, params: Record<string, unknown> = {}) => {
  const session = driver.session();
  try {
    return await session.run(query, params);
  } finally {
    await session.close();
  }
};

const resetProject = async (projectId: string): Promise<void> => {
  await adminRun('MATCH (n {projectId: $projectId}) DETACH DELETE n', { projectId });
  await adminRun('MATCH (p:Project {projectId: $projectId}) DETACH DELETE p', { projectId });
};

const registerProject = async (projectId: string): Promise<void> => {
  await adminRun(
    `MERGE (p:Project {projectId: $projectId})
     SET p.name = $projectId,
         p.displayName = $projectId,
         p.registered = true,
         p.updatedAt = toString(datetime())`,
    { projectId },
  );
};

describe('RF-17.1 live-path integration (guard not bypassed in test env)', () => {
  beforeAll(async () => {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
    process.env.PROJECT_WRITE_GUARD_FORCE = 'true';
    await resetProject(PID_UNREGISTERED);
    await resetProject(PID_REGISTERED);
  });

  afterAll(async () => {
    await resetProject(PID_UNREGISTERED);
    await resetProject(PID_REGISTERED);
    delete process.env.PROJECT_WRITE_GUARD_FORCE;
    await driver.close();
  });

  it('blocks Neo4jService.run CREATE for unregistered projectId', async () => {
    const service = new Neo4jService();
    await expect(
      service.run('CREATE (n:CodeNode {id: $id, projectId: $projectId}) RETURN n', {
        id: `${PID_UNREGISTERED}:n1`,
        projectId: PID_UNREGISTERED,
      }),
    ).rejects.toBeInstanceOf(ProjectWriteValidationError);
    await service.close();
  });

  it('allows Neo4jService.run CREATE for registered projectId', async () => {
    await registerProject(PID_REGISTERED);

    const service = new Neo4jService();
    await expect(
      service.run('CREATE (n:CodeNode {id: $id, projectId: $projectId}) RETURN n.id AS id', {
        id: `${PID_REGISTERED}:n1`,
        projectId: PID_REGISTERED,
      }),
    ).resolves.toBeDefined();
    await service.close();

    const verify = await adminRun('MATCH (n {projectId: $projectId}) RETURN count(n) AS c', { projectId: PID_REGISTERED });
    expect(Number(verify.records[0]?.get('c')?.toNumber?.() ?? 0)).toBeGreaterThan(0);
  });

  it('blocks materializeIrDocument for unregistered projectId (critical path)', async () => {
    const doc = {
      version: 'ir.v1' as const,
      projectId: PID_UNREGISTERED,
      sourceKind: 'document' as const,
      nodes: [
        {
          id: `${PID_UNREGISTERED}:node:1`,
          type: 'Artifact' as const,
          kind: 'DocumentNode',
          name: 'doc-1',
          projectId: PID_UNREGISTERED,
          parserTier: 0,
          confidence: 1,
          provenanceKind: 'parser' as const,
          properties: {},
        },
      ],
      edges: [],
      metadata: {},
    };

    await expect(materializeIrDocument(doc)).rejects.toBeInstanceOf(ProjectWriteValidationError);
  });

  it('allows materializeIrDocument for registered projectId', async () => {
    await registerProject(PID_REGISTERED);

    const doc = {
      version: 'ir.v1' as const,
      projectId: PID_REGISTERED,
      sourceKind: 'document' as const,
      nodes: [
        {
          id: `${PID_REGISTERED}:node:2`,
          type: 'Artifact' as const,
          kind: 'DocumentNode',
          name: 'doc-2',
          projectId: PID_REGISTERED,
          parserTier: 0,
          confidence: 1,
          provenanceKind: 'parser' as const,
          properties: {},
        },
      ],
      edges: [],
      metadata: {},
    };

    const result = await materializeIrDocument(doc, { clearProjectFirst: false, batchSize: 100 });
    expect(result.projectId).toBe(PID_REGISTERED);
    expect(result.nodesCreated).toBeGreaterThanOrEqual(1);
  });
});
