import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import dotenv from 'dotenv';

import { IrMaterializer } from '../core/ir/ir-materializer.js';
import type { IrDocument } from '../core/ir/ir-v1.schema.js';
import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

const PILOT_PROJECT_ID = 'proj_vg5_ir_pilot';
const ARTIFACT_DIR = join(process.cwd(), 'artifacts', 'verification-pilot');
const ARTIFACT_PATH = join(ARTIFACT_DIR, 'vg5-ir-module-latest.json');

interface CountSnapshot {
  nodeCount: number;
  edgeCount: number;
}

interface ValidationSummary {
  ok: boolean;
  projectId: string;
  checks: {
    materializationIdempotency: boolean;
    projectScopeIntegrity: boolean;
    originalEdgeTypeFidelity: boolean;
    deterministicRebuildTotals: boolean;
    noOrphanRelationshipWrites: boolean;
  };
  metrics: {
    firstRun: CountSnapshot;
    secondRun: CountSnapshot;
    rebuildRunA: CountSnapshot;
    rebuildRunB: CountSnapshot;
    duplicateNodeIds: number;
    duplicateEdgeIds: number;
    projectScopeViolations: number;
    persistedOriginalEdgeType: string | null;
    orphanEdgeWrites: number;
  };
  generatedAt: string;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'toNumber' in (value as object)) {
    try {
      return Number((value as { toNumber: () => number }).toNumber());
    } catch {
      return Number(value);
    }
  }
  return Number(value ?? 0);
}

function buildPilotDoc(projectId: string): IrDocument {
  return {
    version: 'ir.v1',
    projectId,
    sourceKind: 'code',
    generatedAt: new Date().toISOString(),
    sourceRoot: '/home/jonathan/.openclaw/workspace/codegraph/src/core/ir',
    nodes: [
      {
        id: 'ir-file',
        type: 'Artifact',
        kind: 'SOURCE_FILE',
        name: 'ir-materializer.ts',
        projectId,
        sourcePath: 'src/core/ir/ir-materializer.ts',
        language: 'typescript',
        parserTier: 0,
        confidence: 1,
        provenanceKind: 'manual',
        properties: {
          purpose: 'vg5-pilot',
        },
      },
      {
        id: 'ir-materialize-fn',
        type: 'Symbol',
        kind: 'FUNCTION',
        name: 'materialize',
        projectId,
        sourcePath: 'src/core/ir/ir-materializer.ts',
        language: 'typescript',
        parserTier: 0,
        confidence: 1,
        provenanceKind: 'manual',
        properties: {
          invariant: 'idempotency',
        },
      },
      {
        id: 'ir-map-edge-fn',
        type: 'Symbol',
        kind: 'FUNCTION',
        name: 'mapEdge',
        projectId,
        sourcePath: 'src/core/ir/ir-materializer.ts',
        language: 'typescript',
        parserTier: 0,
        confidence: 1,
        provenanceKind: 'manual',
        properties: {
          invariant: 'originalEdgeType-fidelity',
        },
      },
    ],
    edges: [
      {
        id: 'edge-contains',
        type: 'CONTAINS',
        from: 'ir-file',
        to: 'ir-materialize-fn',
        projectId,
        parserTier: 0,
        confidence: 1,
        provenanceKind: 'manual',
        properties: {},
      },
      {
        id: 'edge-original-type',
        type: 'REFERENCES',
        from: 'ir-materialize-fn',
        to: 'ir-map-edge-fn',
        projectId,
        parserTier: 0,
        confidence: 1,
        provenanceKind: 'manual',
        properties: {
          originalEdgeType: 'READS_STATE',
        },
      },
    ],
    metadata: {
      pilot: 'VG-5',
      module: 'IR materializer',
    },
  };
}

async function clearProject(neo4j: Neo4jService, projectId: string): Promise<void> {
  await neo4j.run('MATCH (n {projectId: $projectId}) DETACH DELETE n', { projectId });
}

async function getCounts(neo4j: Neo4jService, projectId: string): Promise<CountSnapshot> {
  const rows = await neo4j.run(
    `MATCH (n {projectId: $projectId})
     WITH count(n) AS nodeCount
     MATCH ()-[r]->()
     WHERE r.projectId = $projectId
     RETURN nodeCount, count(r) AS edgeCount`,
    { projectId },
  );

  return {
    nodeCount: toNumber(rows[0]?.nodeCount),
    edgeCount: toNumber(rows[0]?.edgeCount),
  };
}

async function getDuplicateNodeIds(neo4j: Neo4jService, projectId: string): Promise<number> {
  const rows = await neo4j.run(
    `MATCH (n {projectId: $projectId})
     WHERE n.id IS NOT NULL
     WITH n.id AS id, count(*) AS c
     WHERE c > 1
     RETURN count(*) AS duplicateIds`,
    { projectId },
  );
  return toNumber(rows[0]?.duplicateIds);
}

async function getDuplicateEdgeIds(neo4j: Neo4jService, projectId: string): Promise<number> {
  const rows = await neo4j.run(
    `MATCH ()-[r]->()
     WHERE r.projectId = $projectId AND r.id IS NOT NULL
     WITH r.id AS id, count(*) AS c
     WHERE c > 1
     RETURN count(*) AS duplicateIds`,
    { projectId },
  );
  return toNumber(rows[0]?.duplicateIds);
}

async function getProjectScopeViolations(neo4j: Neo4jService, projectId: string): Promise<number> {
  const rows = await neo4j.run(
    `MATCH (s)-[r]->(e)
     WHERE r.projectId = $projectId
       AND (coalesce(s.projectId, '') <> $projectId OR coalesce(e.projectId, '') <> $projectId)
     RETURN count(r) AS violations`,
    { projectId },
  );
  return toNumber(rows[0]?.violations);
}

async function getPersistedOriginalEdgeType(neo4j: Neo4jService, projectId: string): Promise<string | null> {
  const rows = await neo4j.run(
    `MATCH ()-[r {projectId: $projectId, id: 'edge-original-type'}]->()
     RETURN type(r) AS edgeType
     LIMIT 1`,
    { projectId },
  );

  return rows[0]?.edgeType ? String(rows[0].edgeType) : null;
}

async function getOrphanEdgeWrites(neo4j: Neo4jService, projectId: string): Promise<number> {
  const rows = await neo4j.run(
    `MATCH ()-[r {projectId: $projectId, id: 'edge-orphan'}]->()
     RETURN count(r) AS orphanWrites`,
    { projectId },
  );
  return toNumber(rows[0]?.orphanWrites);
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();
  const materializer = new IrMaterializer(neo4j);

  try {
    await clearProject(neo4j, PILOT_PROJECT_ID);

    const baseDoc = buildPilotDoc(PILOT_PROJECT_ID);

    await materializer.materialize(baseDoc, { clearProjectFirst: true });
    const firstRun = await getCounts(neo4j, PILOT_PROJECT_ID);

    await materializer.materialize(baseDoc, { clearProjectFirst: false });
    const secondRun = await getCounts(neo4j, PILOT_PROJECT_ID);

    const duplicateNodeIds = await getDuplicateNodeIds(neo4j, PILOT_PROJECT_ID);
    const duplicateEdgeIds = await getDuplicateEdgeIds(neo4j, PILOT_PROJECT_ID);
    const projectScopeViolations = await getProjectScopeViolations(neo4j, PILOT_PROJECT_ID);
    const persistedOriginalEdgeType = await getPersistedOriginalEdgeType(neo4j, PILOT_PROJECT_ID);

    await materializer.materialize(baseDoc, { clearProjectFirst: true });
    const rebuildRunA = await getCounts(neo4j, PILOT_PROJECT_ID);

    await materializer.materialize(baseDoc, { clearProjectFirst: true });
    const rebuildRunB = await getCounts(neo4j, PILOT_PROJECT_ID);

    const orphanDoc: IrDocument = {
      ...baseDoc,
      generatedAt: new Date().toISOString(),
      edges: [
        ...baseDoc.edges,
        {
          id: 'edge-orphan',
          type: 'REFERENCES',
          from: 'missing-start',
          to: 'missing-end',
          projectId: PILOT_PROJECT_ID,
          parserTier: 0,
          confidence: 1,
          provenanceKind: 'manual',
          properties: {
            case: 'orphan-edge-write-check',
          },
        },
      ],
      metadata: {
        ...baseDoc.metadata,
        allowExternalEdgeEndpoints: true,
      },
    };

    await materializer.materialize(orphanDoc, { clearProjectFirst: false });
    const orphanEdgeWrites = await getOrphanEdgeWrites(neo4j, PILOT_PROJECT_ID);

    const checks = {
      materializationIdempotency:
        firstRun.nodeCount === secondRun.nodeCount &&
        firstRun.edgeCount === secondRun.edgeCount &&
        duplicateNodeIds === 0 &&
        duplicateEdgeIds === 0,
      projectScopeIntegrity: projectScopeViolations === 0,
      originalEdgeTypeFidelity: persistedOriginalEdgeType === 'READS_STATE',
      deterministicRebuildTotals:
        rebuildRunA.nodeCount === rebuildRunB.nodeCount && rebuildRunA.edgeCount === rebuildRunB.edgeCount,
      noOrphanRelationshipWrites: orphanEdgeWrites === 0,
    };

    const summary: ValidationSummary = {
      ok: Object.values(checks).every(Boolean),
      projectId: PILOT_PROJECT_ID,
      checks,
      metrics: {
        firstRun,
        secondRun,
        rebuildRunA,
        rebuildRunB,
        duplicateNodeIds,
        duplicateEdgeIds,
        projectScopeViolations,
        persistedOriginalEdgeType,
        orphanEdgeWrites,
      },
      generatedAt: new Date().toISOString(),
    };

    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(ARTIFACT_PATH, JSON.stringify(summary, null, 2));

    await clearProject(neo4j, PILOT_PROJECT_ID);

    if (!summary.ok) {
      console.error(JSON.stringify(summary, null, 2));
      process.exit(1);
    }

    console.log(
      JSON.stringify({
        ok: true,
        artifactPath: ARTIFACT_PATH,
        summary,
      }),
    );
  } finally {
    await neo4j.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
