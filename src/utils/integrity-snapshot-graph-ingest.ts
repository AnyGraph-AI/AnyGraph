import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

export interface SnapshotRow {
  timestamp: string;
  graphEpoch: string;
  projectId: string;
  nodeCount: number;
  edgeCount: number;
  unresolvedLocalCount: number;
  invariantViolationCount: number;
  duplicateSourceSuspicionCount: number;
}

export interface SnapshotGraphIngestResult {
  ok: boolean;
  ran: boolean;
  outPath?: string;
  timestamp?: string;
  graphEpoch?: string;
  rowsIngested: number;
  snapshotNodeCount: number;
  metricNodeCount: number;
  measuredEdgeCount: number;
  error?: string;
}

const DEFAULT_SNAPSHOT_DIR = join(process.cwd(), 'artifacts', 'integrity-snapshots');

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getLatestSnapshotRows(snapshotDir: string): { outPath: string; rows: SnapshotRow[]; latestTimestamp: string } {
  const files = readdirSync(snapshotDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No integrity snapshot artifacts found in ${snapshotDir}`);
  }

  const outPath = join(snapshotDir, files[files.length - 1]);
  const text = readFileSync(outPath, 'utf8').trim();
  if (!text) {
    throw new Error(`Integrity snapshot artifact is empty: ${outPath}`);
  }

  const rows = text
    .split('\n')
    .map((line) => JSON.parse(line) as SnapshotRow)
    .filter((row) => !!row?.projectId && !!row?.timestamp);

  if (rows.length === 0) {
    throw new Error(`No parseable rows in integrity snapshot artifact: ${outPath}`);
  }

  const latestTs = rows
    .map((r) => Date.parse(r.timestamp))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a)[0];

  if (!latestTs) {
    throw new Error(`Could not determine latest snapshot timestamp from ${outPath}`);
  }

  const latestTimestamp = new Date(latestTs).toISOString();
  const latestRows = rows.filter((r) => Date.parse(r.timestamp) === latestTs);

  return { outPath, rows: latestRows, latestTimestamp };
}

const UPSERT_SNAPSHOT_HISTORY = `
UNWIND $rows AS row
MERGE (s:IntegritySnapshot {projectId: row.projectId, timestamp: row.timestamp})
ON CREATE SET
  s.createdAt = datetime(),
  s.source = 'graph-integrity-snapshot'
SET
  s.graphEpoch = row.graphEpoch,
  s.updatedAt = datetime(),
  s.nodeCount = toInteger(row.nodeCount),
  s.edgeCount = toInteger(row.edgeCount),
  s.unresolvedLocalCount = toInteger(row.unresolvedLocalCount),
  s.invariantViolationCount = toInteger(row.invariantViolationCount),
  s.duplicateSourceSuspicionCount = toInteger(row.duplicateSourceSuspicionCount)
WITH s, row
UNWIND [
  {metric: 'nodeCount', value: toInteger(row.nodeCount)},
  {metric: 'edgeCount', value: toInteger(row.edgeCount)},
  {metric: 'unresolvedLocalCount', value: toInteger(row.unresolvedLocalCount)},
  {metric: 'invariantViolationCount', value: toInteger(row.invariantViolationCount)},
  {metric: 'duplicateSourceSuspicionCount', value: toInteger(row.duplicateSourceSuspicionCount)}
] AS metric
MERGE (m:MetricResult {
  projectId: row.projectId,
  metric: metric.metric,
  context: 'integrity_snapshot',
  timestamp: row.timestamp
})
ON CREATE SET m.createdAt = datetime()
SET
  m.value = metric.value,
  m.graphEpoch = row.graphEpoch,
  m.updatedAt = datetime()
MERGE (s)-[me:MEASURED {projectId: row.projectId, metric: metric.metric}]->(m)
ON CREATE SET me.createdAt = datetime()
SET
  me.graphEpoch = row.graphEpoch,
  me.updatedAt = datetime()
RETURN
  count(DISTINCT s) AS snapshotNodeCount,
  count(DISTINCT m) AS metricNodeCount,
  count(DISTINCT me) AS measuredEdgeCount
`;

export async function ingestLatestSnapshotRowsToGraph(options?: {
  snapshotDir?: string;
  neo4j?: Neo4jService;
}): Promise<SnapshotGraphIngestResult> {
  const snapshotDir = options?.snapshotDir ?? DEFAULT_SNAPSHOT_DIR;
  const ownNeo4j = !options?.neo4j;
  const neo4j = options?.neo4j ?? new Neo4jService();

  try {
    const { outPath, rows, latestTimestamp } = getLatestSnapshotRows(snapshotDir);
    const queryRows = rows.map((row) => ({
      ...row,
      nodeCount: Number(row.nodeCount ?? 0),
      edgeCount: Number(row.edgeCount ?? 0),
      unresolvedLocalCount: Number(row.unresolvedLocalCount ?? 0),
      invariantViolationCount: Number(row.invariantViolationCount ?? 0),
      duplicateSourceSuspicionCount: Number(row.duplicateSourceSuspicionCount ?? 0),
    }));

    const resultRows = (await neo4j.run(UPSERT_SNAPSHOT_HISTORY, {
      rows: queryRows,
    })) as Array<Record<string, unknown>>;

    const row = resultRows[0] ?? {};

    return {
      ok: true,
      ran: true,
      outPath,
      timestamp: latestTimestamp,
      graphEpoch: queryRows[0]?.graphEpoch,
      rowsIngested: queryRows.length,
      snapshotNodeCount: toNum(row.snapshotNodeCount),
      metricNodeCount: toNum(row.metricNodeCount),
      measuredEdgeCount: toNum(row.measuredEdgeCount),
    };
  } catch (error) {
    return {
      ok: false,
      ran: true,
      rowsIngested: 0,
      snapshotNodeCount: 0,
      metricNodeCount: 0,
      measuredEdgeCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (ownNeo4j) {
      await neo4j.close();
    }
  }
}

async function main(): Promise<void> {
  const result = await ingestLatestSnapshotRowsToGraph();

  if (!result.ok) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }

  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
}
