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

function main(): void {
  const staleHours = Number(process.env.INTEGRITY_STALE_HOURS ?? 30);
  const maxInvariantViolations = Number(process.env.MAX_INVARIANT_VIOLATIONS ?? 0);
  // Transitional default: allow a small unresolved-local budget while known blind spots are burned down.
  const maxUnresolvedLocal = Number(process.env.MAX_UNRESOLVED_LOCAL ?? 10);

  const latestFile = getLatestSnapshotFile();
  const rows = parseRows(latestFile);

  const newestTs = rows.reduce((acc, row) => Math.max(acc, Date.parse(row.timestamp)), 0);
  if (!newestTs) {
    fail('Could not determine snapshot timestamp.');
  }

  const latestRows = rows.filter((r) => Date.parse(r.timestamp) === newestTs);
  const ageHours = (Date.now() - newestTs) / (1000 * 60 * 60);
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
      },
    }),
  );
}

main();
