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

type BaselineSelector = 'previous' | 'latest' | `release:${string}`;

function fail(message: string): never {
  console.error(`INTEGRITY_CHECK_FAILED: ${message}`);
  process.exit(1);
}

function getSnapshotFiles(): string[] {
  const files = readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  if (files.length === 0) {
    fail(`No snapshot files found in ${SNAPSHOT_DIR}`);
  }

  return files.map((file) => join(SNAPSHOT_DIR, file));
}

function parseRows(paths: string[]): SnapshotRow[] {
  const rows: SnapshotRow[] = [];

  for (const path of paths) {
    const text = readFileSync(path, 'utf8').trim();
    if (!text) continue;

    const fileRows = text
      .split('\n')
      .map((line) => JSON.parse(line) as SnapshotRow)
      .filter(Boolean);

    rows.push(...fileRows);
  }

  if (rows.length === 0) {
    fail(`Snapshot files are empty in ${SNAPSHOT_DIR}`);
  }

  return rows;
}

function normalizeSelector(raw: string): BaselineSelector {
  const value = raw.trim();
  if (value === 'previous' || value === 'latest') return value;
  if (value.startsWith('release:') && value.slice('release:'.length).trim().length > 0) {
    return value as BaselineSelector;
  }
  fail(`Invalid baseline selector "${raw}". Use one of: previous | latest | release:<tag|sha>`);
}

function latestTimestamp(rows: SnapshotRow[]): number {
  const ts = rows
    .map((r) => Date.parse(r.timestamp))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a)[0];

  if (!ts) {
    fail('Could not determine snapshot timestamp.');
  }

  return ts;
}

function resolveBaseline(rows: SnapshotRow[], selector: BaselineSelector, latestTs: number): {
  baselineRows: SnapshotRow[];
  baselineRef: string;
  baselineTimestamp?: string;
} {
  if (selector === 'latest') {
    return {
      baselineRows: rows.filter((r) => Date.parse(r.timestamp) === latestTs),
      baselineRef: 'latest',
      baselineTimestamp: new Date(latestTs).toISOString(),
    };
  }

  if (selector === 'previous') {
    const tsValues = Array.from(
      new Set(
        rows
          .map((r) => Date.parse(r.timestamp))
          .filter((v) => Number.isFinite(v)),
      ),
    ).sort((a, b) => b - a);

    const previousTs = tsValues[1];
    if (!previousTs) {
      return {
        baselineRows: [],
        baselineRef: 'previous:none',
      };
    }

    return {
      baselineRows: rows.filter((r) => Date.parse(r.timestamp) === previousTs),
      baselineRef: 'previous',
      baselineTimestamp: new Date(previousTs).toISOString(),
    };
  }

  const releaseRef = selector.slice('release:'.length).trim();
  const releaseRows = rows.filter((r) => String(r.graphEpoch ?? '').trim() === releaseRef);
  if (releaseRows.length === 0) {
    fail(`No snapshot rows found for baseline release ref "${releaseRef}" (matched against graphEpoch).`);
  }

  const baselineTs = releaseRows
    .map((r) => Date.parse(r.timestamp))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a)[0];

  if (!baselineTs) {
    fail(`Snapshot rows for release ref "${releaseRef}" have invalid timestamps.`);
  }

  return {
    baselineRows: releaseRows.filter((r) => Date.parse(r.timestamp) === baselineTs),
    baselineRef: `release:${releaseRef}`,
    baselineTimestamp: new Date(baselineTs).toISOString(),
  };
}

function computeDriftAlarms(
  latestRows: SnapshotRow[],
  baselineRows: SnapshotRow[],
  cfg: {
    nodeAbs: number;
    edgeAbs: number;
    nodePct: number;
    edgePct: number;
  },
): DriftAlarm[] {
  const baselineByProject = new Map(baselineRows.map((r) => [r.projectId, r]));

  const alarms: DriftAlarm[] = [];
  for (const row of latestRows) {
    const baseline = baselineByProject.get(row.projectId);
    if (!baseline) continue;

    const nodeDelta = Number(row.nodeCount) - Number(baseline.nodeCount);
    const edgeDelta = Number(row.edgeCount) - Number(baseline.edgeCount);

    const nodeBase = Math.max(1, Number(baseline.nodeCount));
    const edgeBase = Math.max(1, Number(baseline.edgeCount));

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

  // Baseline selector (S6)
  const baselineSelector = normalizeSelector(process.argv[2] ?? process.env.INTEGRITY_BASELINE_SELECTOR ?? 'previous');

  const files = getSnapshotFiles();
  const latestFile = files[files.length - 1];
  const rows = parseRows(files);

  const latestTs = latestTimestamp(rows);
  const latestRows = rows.filter((r) => Date.parse(r.timestamp) === latestTs);

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

  const { baselineRows, baselineRef, baselineTimestamp } = resolveBaseline(rows, baselineSelector, latestTs);

  const driftAlarms = computeDriftAlarms(latestRows, baselineRows, {
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
      baselineSelector,
      baselineRef,
      baselineTimestamp,
      baselineProjectCount: baselineRows.length,
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
