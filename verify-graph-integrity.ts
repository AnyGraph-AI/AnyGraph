import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

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

interface DriftAlarm {
  projectId: string;
  nodeDelta: number;
  edgeDelta: number;
  nodeDeltaPct: number;
  edgeDeltaPct: number;
}

const SNAPSHOT_DIR = join(process.cwd(), 'artifacts', 'integrity-snapshots');

function fail(message: string): never {
  console.error(`INTEGRITY_CHECK_FAILED: ${message}`);
  process.exit(1);
}

function getLatestSnapshotFile(): string {
  const files = readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  if (files.length === 0) {
    fail(`No snapshot files found in ${SNAPSHOT_DIR}`);
  }

  return join(SNAPSHOT_DIR, files[files.length - 1]);
}

function parseRows(path: string): SnapshotRow[] {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) {
    fail(`Latest snapshot file is empty: ${path}`);
  }

  return text
    .split('\n')
    .map((line) => JSON.parse(line) as SnapshotRow)
    .filter(Boolean);
}

function latestAndPrevious(rows: SnapshotRow[]): { latestRows: SnapshotRow[]; previousRows: SnapshotRow[]; latestTs: number } {
  const tsValues = Array.from(
    new Set(
      rows
        .map((r) => Date.parse(r.timestamp))
        .filter((v) => Number.isFinite(v)),
    ),
  ).sort((a, b) => b - a);

  const latestTs = tsValues[0] ?? 0;
  const previousTs = tsValues[1] ?? 0;

  return {
    latestTs,
    latestRows: rows.filter((r) => Date.parse(r.timestamp) === latestTs),
    previousRows: previousTs ? rows.filter((r) => Date.parse(r.timestamp) === previousTs) : [],
  };
}

function computeDriftAlarms(
  latestRows: SnapshotRow[],
  previousRows: SnapshotRow[],
  cfg: {
    nodeAbs: number;
    edgeAbs: number;
    nodePct: number;
    edgePct: number;
  },
): DriftAlarm[] {
  const prevByProject = new Map(previousRows.map((r) => [r.projectId, r]));

  const alarms: DriftAlarm[] = [];
  for (const row of latestRows) {
    const prev = prevByProject.get(row.projectId);
    if (!prev) continue;

    const nodeDelta = Number(row.nodeCount) - Number(prev.nodeCount);
    const edgeDelta = Number(row.edgeCount) - Number(prev.edgeCount);

    const nodeBase = Math.max(1, Number(prev.nodeCount));
    const edgeBase = Math.max(1, Number(prev.edgeCount));

    const nodeDeltaPct = nodeDelta / nodeBase;
    const edgeDeltaPct = edgeDelta / edgeBase;

    const suspicious =
      Math.abs(nodeDelta) > cfg.nodeAbs ||
      Math.abs(edgeDelta) > cfg.edgeAbs ||
      Math.abs(nodeDeltaPct) > cfg.nodePct ||
      Math.abs(edgeDeltaPct) > cfg.edgePct;

    if (suspicious) {
      alarms.push({
        projectId: row.projectId,
        nodeDelta,
        edgeDelta,
        nodeDeltaPct: Number(nodeDeltaPct.toFixed(4)),
        edgeDeltaPct: Number(edgeDeltaPct.toFixed(4)),
      });
    }
  }

  return alarms;
}

function main(): void {
  const staleHours = Number(process.env.INTEGRITY_STALE_HOURS ?? 30);
  const maxInvariantViolations = Number(process.env.MAX_INVARIANT_VIOLATIONS ?? 0);
  const maxUnresolvedLocal = Number(process.env.MAX_UNRESOLVED_LOCAL ?? 0);

  // Drift alarm thresholds (S3)
  const driftNodeDeltaAbsMax = Number(process.env.DRIFT_NODE_DELTA_ABS_MAX ?? 5000);
  const driftEdgeDeltaAbsMax = Number(process.env.DRIFT_EDGE_DELTA_ABS_MAX ?? 50000);
  const driftNodeDeltaPctMax = Number(process.env.DRIFT_NODE_DELTA_PCT_MAX ?? 0.5);
  const driftEdgeDeltaPctMax = Number(process.env.DRIFT_EDGE_DELTA_PCT_MAX ?? 0.5);
  const failOnDriftAlarm = String(process.env.FAIL_ON_DRIFT_ALARM ?? 'false').toLowerCase() === 'true';

  const latestFile = getLatestSnapshotFile();
  const rows = parseRows(latestFile);

  const { latestTs, latestRows, previousRows } = latestAndPrevious(rows);
  if (!latestTs) {
    fail('Could not determine snapshot timestamp.');
  }

  const ageHours = (Date.now() - latestTs) / (1000 * 60 * 60);
  if (ageHours > staleHours) {
    fail(`Snapshot is stale (${ageHours.toFixed(2)}h > ${staleHours}h)`);
  }

  const violationRows = latestRows.filter((r) => Number(r.invariantViolationCount) > maxInvariantViolations);
  if (violationRows.length > 0) {
    fail(
      `Invariant violations exceed threshold (${maxInvariantViolations}) for projects: ${violationRows
        .map((r) => `${r.projectId}:${r.invariantViolationCount}`)
        .join(', ')}`,
    );
  }

  const unresolvedRows = latestRows.filter((r) => Number(r.unresolvedLocalCount) > maxUnresolvedLocal);
  if (unresolvedRows.length > 0) {
    fail(
      `Unresolved local references exceed threshold (${maxUnresolvedLocal}) for projects: ${unresolvedRows
        .map((r) => `${r.projectId}:${r.unresolvedLocalCount}`)
        .join(', ')}`,
    );
  }

  const driftAlarms = computeDriftAlarms(latestRows, previousRows, {
    nodeAbs: driftNodeDeltaAbsMax,
    edgeAbs: driftEdgeDeltaAbsMax,
    nodePct: driftNodeDeltaPctMax,
    edgePct: driftEdgeDeltaPctMax,
  });

  if (failOnDriftAlarm && driftAlarms.length > 0) {
    fail(
      `Suspicious graph drift detected (${driftAlarms.length} projects): ${driftAlarms
        .map((a) => `${a.projectId}(nodeDelta=${a.nodeDelta},edgeDelta=${a.edgeDelta})`)
        .join(', ')}`,
    );
  }

  console.log(
    JSON.stringify({
      ok: true,
      latestFile,
      projects: latestRows.length,
      snapshotAgeHours: Number(ageHours.toFixed(3)),
      thresholds: {
        staleHours,
        maxInvariantViolations,
        maxUnresolvedLocal,
        driftNodeDeltaAbsMax,
        driftEdgeDeltaAbsMax,
        driftNodeDeltaPctMax,
        driftEdgeDeltaPctMax,
        failOnDriftAlarm,
      },
      driftAlarmCount: driftAlarms.length,
      driftAlarms,
    }),
  );
}

main();
