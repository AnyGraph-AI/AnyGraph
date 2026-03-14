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

function fail(message: string): never {
  console.error(`INTEGRITY_SNAPSHOT_FIELDS_FAILED: ${message}`);
  process.exit(1);
}

function isFiniteNumber(value: unknown): boolean {
  return Number.isFinite(Number(value));
}

function main(): void {
  const dir = join(process.cwd(), 'artifacts', 'integrity-snapshots');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  if (files.length === 0) {
    fail(`No snapshot files found in ${dir}`);
  }

  const latestPath = join(dir, files[files.length - 1]);
  const rows = readFileSync(latestPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as SnapshotRow);

  if (rows.length === 0) {
    fail(`Latest snapshot file is empty: ${latestPath}`);
  }

  const latestTs = rows
    .map((r) => Date.parse(r.timestamp))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a)[0];

  if (!latestTs) {
    fail(`Could not determine latest timestamp group from ${latestPath}`);
  }

  const latestRows = rows.filter((r) => Date.parse(r.timestamp) === latestTs);

  let invalid = 0;
  const invalidReasons: string[] = [];

  for (const row of latestRows) {
    const bad: string[] = [];
    if (!row.projectId) bad.push('missing projectId');
    if (!row.timestamp || !Number.isFinite(Date.parse(row.timestamp))) bad.push('invalid timestamp');
    if (!row.graphEpoch) bad.push('missing graphEpoch');
    if (!isFiniteNumber(row.nodeCount)) bad.push('invalid nodeCount');
    if (!isFiniteNumber(row.edgeCount)) bad.push('invalid edgeCount');
    if (!isFiniteNumber(row.unresolvedLocalCount)) bad.push('invalid unresolvedLocalCount');
    if (!isFiniteNumber(row.invariantViolationCount)) bad.push('invalid invariantViolationCount');
    if (!isFiniteNumber(row.duplicateSourceSuspicionCount)) bad.push('invalid duplicateSourceSuspicionCount');

    if (bad.length > 0) {
      invalid += 1;
      invalidReasons.push(`${row.projectId || '<unknown>'}: ${bad.join(', ')}`);
    }
  }

  if (invalid > 0) {
    fail(`Found ${invalid} invalid snapshot row(s): ${invalidReasons.slice(0, 20).join('; ')}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      latestPath,
      latestTimestamp: new Date(latestTs).toISOString(),
      projects: latestRows.length,
      requiredFields: [
        'projectId',
        'timestamp',
        'graphEpoch',
        'nodeCount',
        'edgeCount',
        'unresolvedLocalCount',
        'invariantViolationCount',
        'duplicateSourceSuspicionCount',
      ],
    }),
  );
}

main();
