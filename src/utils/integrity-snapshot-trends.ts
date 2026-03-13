import dotenv from 'dotenv';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

dotenv.config();

interface SnapshotPoint {
  timestamp: string;
  nodeCount: number;
  edgeCount: number;
  unresolvedLocalCount: number;
  invariantViolationCount: number;
}

interface MetricTrend {
  first: number;
  last: number;
  delta: number;
  deltaPct: number;
  slopePerSnapshot: number;
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toMetricTrend(points: SnapshotPoint[], metric: keyof SnapshotPoint): MetricTrend {
  const values = points.map((p) => toNum(p[metric]));
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;
  const delta = last - first;
  const base = Math.max(1, first);
  const deltaPct = delta / base;
  const slopePerSnapshot = values.length > 1 ? delta / (values.length - 1) : 0;

  return {
    first,
    last,
    delta,
    deltaPct: Number(deltaPct.toFixed(4)),
    slopePerSnapshot: Number(slopePerSnapshot.toFixed(4)),
  };
}

async function main(): Promise<void> {
  const projectIdFilter = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : undefined;
  const windowArg = process.argv.find((arg) => arg.startsWith('--window='))?.split('=')[1];
  const windowSize = Math.max(1, Number(windowArg ?? process.env.INTEGRITY_TREND_WINDOW ?? 10));

  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (s:IntegritySnapshot)
       WHERE $projectId IS NULL OR s.projectId = $projectId
       RETURN
         s.projectId AS projectId,
         s.timestamp AS timestamp,
         s.nodeCount AS nodeCount,
         s.edgeCount AS edgeCount,
         s.unresolvedLocalCount AS unresolvedLocalCount,
         s.invariantViolationCount AS invariantViolationCount
       ORDER BY projectId, timestamp`,
      { projectId: projectIdFilter ?? null },
    )) as Array<Record<string, unknown>>;

    const byProject = new Map<string, SnapshotPoint[]>();
    for (const row of rows) {
      const projectId = String(row.projectId ?? '').trim();
      const timestamp = String(row.timestamp ?? '').trim();
      if (!projectId || !timestamp) continue;

      const existing = byProject.get(projectId) ?? [];
      existing.push({
        timestamp,
        nodeCount: toNum(row.nodeCount),
        edgeCount: toNum(row.edgeCount),
        unresolvedLocalCount: toNum(row.unresolvedLocalCount),
        invariantViolationCount: toNum(row.invariantViolationCount),
      });
      byProject.set(projectId, existing);
    }

    const projects = Array.from(byProject.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([projectId, points]) => {
        const ordered = points.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
        const windowed = ordered.slice(Math.max(0, ordered.length - windowSize));

        return {
          projectId,
          sampleCount: windowed.length,
          startTimestamp: windowed[0]?.timestamp,
          endTimestamp: windowed[windowed.length - 1]?.timestamp,
          nodeCount: toMetricTrend(windowed, 'nodeCount'),
          edgeCount: toMetricTrend(windowed, 'edgeCount'),
          unresolvedLocalCount: toMetricTrend(windowed, 'unresolvedLocalCount'),
          invariantViolationCount: toMetricTrend(windowed, 'invariantViolationCount'),
        };
      });

    console.log(
      JSON.stringify({
        ok: true,
        windowSize,
        projectIdFilter,
        projectCount: projects.length,
        projects,
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
