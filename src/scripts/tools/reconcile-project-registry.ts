import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';
import { CONTRACT_QUERY_Q14_PROJECT_COUNTS } from '../../../src/utils/query-contract.js';

interface ProjectCountRow {
  projectId: string;
  nodeCount: number;
  edgeCount: number;
}

interface ExistingProjectRow {
  projectId: string;
  displayName?: string;
  projectType?: string;
  sourceKind?: string;
  status?: string;
}

export function inferProjectType(projectId: string, current?: string): string {
  const normalized = (current ?? '').trim();
  if (normalized) return normalized;
  if (projectId.startsWith('plan_')) return 'plan';
  if (
    projectId === 'proj_bible_kjv' ||
    projectId === 'proj_deuterocanon' ||
    projectId === 'proj_pseudepigrapha' ||
    projectId === 'proj_early_contested' ||
    projectId === 'proj_quran'
  ) {
    return 'corpus';
  }
  return 'code';
}

export function inferSourceKind(projectId: string, current?: string): string {
  const normalized = (current ?? '').trim();
  if (normalized) return normalized;
  if (projectId.startsWith('plan_')) return 'plan-ingest';
  if (
    projectId === 'proj_bible_kjv' ||
    projectId === 'proj_deuterocanon' ||
    projectId === 'proj_pseudepigrapha' ||
    projectId === 'proj_early_contested' ||
    projectId === 'proj_quran'
  ) {
    return 'corpus-ingest';
  }
  return 'parser';
}

export function inferStatus(current?: string): string {
  const normalized = (current ?? '').trim().toLowerCase();
  if (!normalized) return 'active';
  if (normalized === 'complete') return 'active';
  if (normalized === 'active' || normalized === 'paused' || normalized === 'archived' || normalized === 'error') {
    return normalized;
  }
  return 'active';
}

export async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(CONTRACT_QUERY_Q14_PROJECT_COUNTS)) as ProjectCountRow[];

    const existingRows = (await neo4j.run(
      `MATCH (p:Project)
       WHERE p.projectId IS NOT NULL
       RETURN p.projectId AS projectId,
              p.displayName AS displayName,
              p.projectType AS projectType,
              p.sourceKind AS sourceKind,
              p.status AS status`,
    )) as ExistingProjectRow[];

    const existingMap = new Map(existingRows.map((row) => [row.projectId, row]));

    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const existing = existingMap.get(row.projectId);
      const exists = Boolean(existing);

      await neo4j.run(
        `MERGE (p:Project {projectId: $projectId})
         ON CREATE SET
           p.name = $name
         SET
           p.displayName = $displayName,
           p.projectType = $projectType,
           p.sourceKind = $sourceKind,
           p.status = $status,
           p.nodeCount = $nodeCount,
           p.edgeCount = $edgeCount,
           p.updatedAt = toString(datetime())`,
        {
          projectId: row.projectId,
          nodeCount: Number(row.nodeCount ?? 0),
          edgeCount: Number(row.edgeCount ?? 0),
          name: row.projectId,
          displayName: (existing?.displayName ?? '').trim() || row.projectId,
          projectType: inferProjectType(row.projectId, existing?.projectType),
          sourceKind: inferSourceKind(row.projectId, existing?.sourceKind),
          status: inferStatus(existing?.status),
        },
      );

      if (exists) updated += 1;
      else created += 1;
    }

    await neo4j.run(
      `MATCH (p:Project)
       WHERE p.projectId IS NOT NULL
       OPTIONAL MATCH (n {projectId: p.projectId})
       WITH p, count(n) AS nodeCount
       OPTIONAL MATCH ()-[r]->()
       WHERE r.projectId = p.projectId
       WITH p, nodeCount, count(r) AS edgeCount
       SET p.nodeCount = nodeCount,
           p.edgeCount = edgeCount,
           p.updatedAt = toString(datetime())`,
    );

    console.log(
      JSON.stringify({
        ok: true,
        projectsSeen: rows.length,
        created,
        updated,
      }),
    );
  } finally {
    await neo4j.getDriver().close();
  }
}

// Guard: only run when executed directly (not imported by tests)
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
