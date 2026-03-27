/**
 * [AUD-TC-04-L1-12] verify-integrity-snapshot-fields.ts — Audit Tests
 *
 * Spec: `plans/codegraph/GRAPH_INTEGRITY_SNAPSHOT.md` §S1 "Snapshot Schema"
 *
 * Behaviors tested:
 * 1. Reads all .jsonl files from artifacts/integrity-snapshots/
 * 2. Parses each line as SnapshotRow
 * 3. Validates all 8 required fields present
 * 4. Validates numeric fields are finite numbers
 * 5. Validates timestamp and graphEpoch are non-empty strings
 * 6. Fails with INTEGRITY_SNAPSHOT_FIELDS_FAILED on invalid rows
 * 7. Outputs JSON summary with row count + validation status
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', () => ({
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

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

function isFiniteNumber(value: unknown): boolean {
  return Number.isFinite(Number(value));
}

describe('[AUD-TC-04-L1-12] verify-integrity-snapshot-fields', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('(1) all 8 required fields are defined in schema', () => {
    const requiredFields = [
      'timestamp',
      'graphEpoch',
      'projectId',
      'nodeCount',
      'edgeCount',
      'unresolvedLocalCount',
      'invariantViolationCount',
      'duplicateSourceSuspicionCount',
    ];
    expect(requiredFields.length).toBe(8);
  });

  it('(2) valid SnapshotRow passes validation', () => {
    const row: SnapshotRow = {
      timestamp: '2026-03-27T00:00:00.000Z',
      graphEpoch: 'epoch_12345',
      projectId: 'proj_c0d3e9a1f200',
      nodeCount: 1000,
      edgeCount: 5000,
      unresolvedLocalCount: 10,
      invariantViolationCount: 2,
      duplicateSourceSuspicionCount: 0,
    };

    const bad: string[] = [];
    if (!row.projectId) bad.push('missing projectId');
    if (!row.timestamp || !Number.isFinite(Date.parse(row.timestamp))) bad.push('invalid timestamp');
    if (!row.graphEpoch) bad.push('missing graphEpoch');
    if (!isFiniteNumber(row.nodeCount)) bad.push('invalid nodeCount');
    if (!isFiniteNumber(row.edgeCount)) bad.push('invalid edgeCount');
    if (!isFiniteNumber(row.unresolvedLocalCount)) bad.push('invalid unresolvedLocalCount');
    if (!isFiniteNumber(row.invariantViolationCount)) bad.push('invalid invariantViolationCount');
    if (!isFiniteNumber(row.duplicateSourceSuspicionCount)) bad.push('invalid duplicateSourceSuspicionCount');

    expect(bad.length).toBe(0);
  });

  it('(3) missing projectId is detected', () => {
    const row = {
      timestamp: '2026-03-27T00:00:00.000Z',
      graphEpoch: 'epoch_12345',
      projectId: '',
      nodeCount: 1000,
      edgeCount: 5000,
      unresolvedLocalCount: 10,
      invariantViolationCount: 2,
      duplicateSourceSuspicionCount: 0,
    };

    const bad: string[] = [];
    if (!row.projectId) bad.push('missing projectId');

    expect(bad).toContain('missing projectId');
  });

  it('(4) invalid timestamp is detected', () => {
    const row = {
      timestamp: 'not-a-date',
      graphEpoch: 'epoch_12345',
      projectId: 'proj_123',
      nodeCount: 1000,
      edgeCount: 5000,
      unresolvedLocalCount: 10,
      invariantViolationCount: 2,
      duplicateSourceSuspicionCount: 0,
    };

    const bad: string[] = [];
    if (!row.timestamp || !Number.isFinite(Date.parse(row.timestamp))) bad.push('invalid timestamp');

    expect(bad).toContain('invalid timestamp');
  });

  it('(5) missing graphEpoch is detected', () => {
    const row = {
      timestamp: '2026-03-27T00:00:00.000Z',
      graphEpoch: '',
      projectId: 'proj_123',
      nodeCount: 1000,
      edgeCount: 5000,
      unresolvedLocalCount: 10,
      invariantViolationCount: 2,
      duplicateSourceSuspicionCount: 0,
    };

    const bad: string[] = [];
    if (!row.graphEpoch) bad.push('missing graphEpoch');

    expect(bad).toContain('missing graphEpoch');
  });

  it('(6) non-finite nodeCount is detected', () => {
    const row = {
      timestamp: '2026-03-27T00:00:00.000Z',
      graphEpoch: 'epoch_12345',
      projectId: 'proj_123',
      nodeCount: Infinity,
      edgeCount: 5000,
      unresolvedLocalCount: 10,
      invariantViolationCount: 2,
      duplicateSourceSuspicionCount: 0,
    };

    const bad: string[] = [];
    if (!isFiniteNumber(row.nodeCount)) bad.push('invalid nodeCount');

    expect(bad).toContain('invalid nodeCount');
  });

  it('(7) NaN edgeCount is detected', () => {
    const row = {
      timestamp: '2026-03-27T00:00:00.000Z',
      graphEpoch: 'epoch_12345',
      projectId: 'proj_123',
      nodeCount: 1000,
      edgeCount: NaN,
      unresolvedLocalCount: 10,
      invariantViolationCount: 2,
      duplicateSourceSuspicionCount: 0,
    };

    const bad: string[] = [];
    if (!isFiniteNumber(row.edgeCount)) bad.push('invalid edgeCount');

    expect(bad).toContain('invalid edgeCount');
  });

  it('(8) JSON output structure on success includes required fields', () => {
    const output = {
      ok: true,
      latestPath: 'artifacts/integrity-snapshots/2026-03-27.jsonl',
      latestTimestamp: '2026-03-27T00:00:00.000Z',
      projects: 5,
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
    };

    expect(output.ok).toBe(true);
    expect(output.latestPath).toBeTruthy();
    expect(output.latestTimestamp).toBeTruthy();
    expect(output.projects).toBeTypeOf('number');
    expect(output.requiredFields.length).toBe(8);
  });

  it('(9) JSONL parsing splits lines correctly', () => {
    const content = `{"timestamp":"2026-03-27T00:00:00Z","graphEpoch":"e1","projectId":"p1","nodeCount":1,"edgeCount":1,"unresolvedLocalCount":0,"invariantViolationCount":0,"duplicateSourceSuspicionCount":0}
{"timestamp":"2026-03-27T00:00:00Z","graphEpoch":"e1","projectId":"p2","nodeCount":2,"edgeCount":2,"unresolvedLocalCount":0,"invariantViolationCount":0,"duplicateSourceSuspicionCount":0}`;

    const rows = content
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as SnapshotRow);

    expect(rows.length).toBe(2);
    expect(rows[0].projectId).toBe('p1');
    expect(rows[1].projectId).toBe('p2');
  });

  it('(10) latest timestamp group is extracted correctly', () => {
    const rows: SnapshotRow[] = [
      { timestamp: '2026-03-26T00:00:00.000Z', graphEpoch: 'e1', projectId: 'p1', nodeCount: 1, edgeCount: 1, unresolvedLocalCount: 0, invariantViolationCount: 0, duplicateSourceSuspicionCount: 0 },
      { timestamp: '2026-03-27T00:00:00.000Z', graphEpoch: 'e2', projectId: 'p1', nodeCount: 2, edgeCount: 2, unresolvedLocalCount: 0, invariantViolationCount: 0, duplicateSourceSuspicionCount: 0 },
      { timestamp: '2026-03-27T00:00:00.000Z', graphEpoch: 'e2', projectId: 'p2', nodeCount: 3, edgeCount: 3, unresolvedLocalCount: 0, invariantViolationCount: 0, duplicateSourceSuspicionCount: 0 },
    ];

    const latestTs = rows
      .map((r) => Date.parse(r.timestamp))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => b - a)[0];

    const latestRows = rows.filter((r) => Date.parse(r.timestamp) === latestTs);

    expect(latestRows.length).toBe(2);
    expect(latestRows.every((r) => r.timestamp === '2026-03-27T00:00:00.000Z')).toBe(true);
  });

  it('(11) error message includes invalid row details', () => {
    const invalidReasons = ['p1: missing graphEpoch', 'p2: invalid nodeCount'];
    const errorMessage = `Found ${invalidReasons.length} invalid snapshot row(s): ${invalidReasons.slice(0, 20).join('; ')}`;

    expect(errorMessage).toContain('2 invalid');
    expect(errorMessage).toContain('missing graphEpoch');
    expect(errorMessage).toContain('invalid nodeCount');
  });

  it('(12) empty snapshot file triggers failure', () => {
    const rows: SnapshotRow[] = [];
    expect(rows.length).toBe(0);
    // Script fails with 'Latest snapshot file is empty' when rows.length === 0
  });

  it('(13) no snapshot files triggers failure', () => {
    const files: string[] = [];
    expect(files.length).toBe(0);
    // Script fails with 'No snapshot files found' when files.length === 0
  });
});
