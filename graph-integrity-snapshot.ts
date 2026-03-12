import { mkdirSync, appendFileSync } from 'fs';
import { dirname, join } from 'path';

import { Neo4jService } from './src/storage/neo4j/neo4j.service.js';

type CountMap = Map<string, number>;

interface SnapshotRow {
  timestamp: string;
  graphEpoch: string;
  projectId: string;
  nodeCount: number;
  edgeCount: number;
  unresolvedLocalCount: number;
  invariantViolationCount: number;
  duplicateSourceSuspicionCount: number;
}

const SNAPSHOT_DIR = join(process.cwd(), 'artifacts', 'integrity-snapshots');

function toCountMap(rows: Array<Record<string, unknown>>, keyField: string, valueField: string): CountMap {
  const out: CountMap = new Map();
  for (const row of rows) {
    const key = String(row[keyField] ?? '').trim();
    if (!key) continue;
    out.set(key, Number(row[valueField] ?? 0));
  }
  return out;
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const timestamp = new Date().toISOString();
    const graphEpoch = process.env.GRAPH_EPOCH ?? timestamp;

    const nodeRows = (await neo4j.run(
    `MATCH (n)
     WHERE n.projectId IS NOT NULL
     RETURN n.projectId AS projectId, count(n) AS nodeCount
     ORDER BY projectId`,
  )) as Array<Record<string, unknown>>;

  const edgeRows = (await neo4j.run(
    `MATCH ()-[r]->()
     WHERE r.projectId IS NOT NULL
     RETURN r.projectId AS projectId, count(r) AS edgeCount
     ORDER BY projectId`,
  )) as Array<Record<string, unknown>>;

  const unresolvedRows = (await neo4j.run(
    `MATCH (u:UnresolvedReference)
     WHERE coalesce(u.reason, '') CONTAINS 'local'
     RETURN u.projectId AS projectId, count(u) AS unresolvedLocalCount
     ORDER BY projectId`,
  )) as Array<Record<string, unknown>>;

  const violationRows = (await neo4j.run(
    `MATCH (a:AuditCheck)
     WHERE a.projectId IS NOT NULL AND a.timestamp IS NOT NULL
     WITH a.projectId AS projectId, max(a.timestamp) AS latestAuditTs
     MATCH (latest:AuditCheck {projectId: projectId, timestamp: latestAuditTs})
     OPTIONAL MATCH (latest)-[:FOUND]->(v:InvariantViolation)
     RETURN projectId, count(v) AS invariantViolationCount
     ORDER BY projectId`,
  )) as Array<Record<string, unknown>>;

  const duplicateRows = (await neo4j.run(
    `MATCH (sf:SourceFile)
     WHERE sf.projectId IS NOT NULL AND sf.filePath IS NOT NULL
     WITH toLower(sf.filePath) AS sourceKey, collect(DISTINCT sf.projectId) AS projectIds
     WHERE size(projectIds) > 1
     UNWIND projectIds AS projectId
     RETURN projectId, count(*) AS duplicateSourceSuspicionCount
     ORDER BY projectId`,
  )) as Array<Record<string, unknown>>;

  const nodeCounts = toCountMap(nodeRows, 'projectId', 'nodeCount');
  const edgeCounts = toCountMap(edgeRows, 'projectId', 'edgeCount');
  const unresolvedCounts = toCountMap(unresolvedRows, 'projectId', 'unresolvedLocalCount');
  const violationCounts = toCountMap(violationRows, 'projectId', 'invariantViolationCount');
  const duplicateCounts = toCountMap(duplicateRows, 'projectId', 'duplicateSourceSuspicionCount');

  const projectIds = new Set<string>([
    ...nodeCounts.keys(),
    ...edgeCounts.keys(),
    ...unresolvedCounts.keys(),
    ...violationCounts.keys(),
    ...duplicateCounts.keys(),
  ]);

  const rows: SnapshotRow[] = Array.from(projectIds)
    .sort()
    .map((projectId) => ({
      timestamp,
      graphEpoch,
      projectId,
      nodeCount: nodeCounts.get(projectId) ?? 0,
      edgeCount: edgeCounts.get(projectId) ?? 0,
      unresolvedLocalCount: unresolvedCounts.get(projectId) ?? 0,
      invariantViolationCount: violationCounts.get(projectId) ?? 0,
      duplicateSourceSuspicionCount: duplicateCounts.get(projectId) ?? 0,
    }));

  const datePart = timestamp.slice(0, 10);
  const outPath = join(SNAPSHOT_DIR, `${datePart}.jsonl`);
  mkdirSync(dirname(outPath), { recursive: true });

  for (const row of rows) {
    appendFileSync(outPath, `${JSON.stringify(row)}\n`, 'utf8');
  }

    console.log(
      JSON.stringify({
        ok: true,
        rows: rows.length,
        outPath,
        timestamp,
      }),
    );
  } finally {
    await neo4j.getDriver().close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
