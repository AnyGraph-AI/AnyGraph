/**
 * AUD-TC-03-L1b-18: verify-governance-metrics-integrity.ts audit tests
 *
 * Spec: plans/codegraph/GOVERNANCE_HARDENING.md governance metric integrity
 *
 * Behaviors:
 *   (1) queries governance metric snapshots for integrity checks
 *   (2) optionally enforces strict mode via GOVERNANCE_METRICS_ENFORCE env var
 *   (3) writes integrity report artifact to disk
 *   (4) reports pass/fail with detailed metrics
 *   (5) exits with code 1 in strict mode when violations found
 *   (6) toNum helper handles Neo4j Integer safely
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ──

const { mockRun, mockClose, mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockRun: vi.fn().mockResolvedValue([]),
  mockClose: vi.fn().mockResolvedValue(undefined),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4jService {
    run = mockRun;
    close = mockClose;
  },
}));

vi.mock('node:fs', () => ({
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;
let savedEnv: Record<string, string | undefined>;

function coverageRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    gateDecisions: 10,
    affectsCommitEdges: 10,
    metricSnapshots: 5,
    regressionEvents: 3,
    preventedRuns: 2,
    preventedEdgesDiagnostic: 2,
    ...overrides,
  };
}

function latestRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    timestamp: '2026-03-20T10:00:00Z',
    interceptionRate: 0.8,
    meanRecoveryRuns: 1.5,
    metricHash: 'sha256:abc123',
    ...overrides,
  };
}

function previousRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    timestamp: '2026-03-19T10:00:00Z',
    interceptionRate: 0.85,
    meanRecoveryRuns: 1.3,
    metricHash: 'sha256:def456',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  mockRun.mockReset().mockResolvedValue([]);
  mockClose.mockReset().mockResolvedValue(undefined);
  mockMkdirSync.mockReset();
  mockWriteFileSync.mockReset();
  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  savedEnv = {
    GOVERNANCE_METRICS_ENFORCE: process.env.GOVERNANCE_METRICS_ENFORCE,
    GOVERNANCE_METRICS_MAX_INTERCEPTION_DROP: process.env.GOVERNANCE_METRICS_MAX_INTERCEPTION_DROP,
    GOVERNANCE_METRICS_MAX_RECOVERY_INCREASE: process.env.GOVERNANCE_METRICS_MAX_RECOVERY_INCREASE,
  };
});

afterEach(() => {
  mockExit.mockRestore();
  mockConsoleLog.mockRestore();
  mockConsoleError.mockRestore();
  // restore env
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function setupHealthyResponses(): void {
  // First call: coverage query
  mockRun.mockResolvedValueOnce([coverageRow()]);
  // Second call: latest 2 snapshots
  mockRun.mockResolvedValueOnce([latestRow(), previousRow()]);
}

async function runModule(argv2?: string): Promise<void> {
  const origArgv = process.argv;
  process.argv = argv2 ? ['node', 'script', argv2] : ['node', 'script'];
  try {
    await import('../../../utils/verify-governance-metrics-integrity.js');
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.argv = origArgv;
  }
}

describe('verify-governance-metrics-integrity audit tests', () => {
  // ─── Behavior 1: queries governance metric snapshots for integrity checks ───
  describe('B1: queries metric snapshots', () => {
    it('runs two queries — coverage aggregate and latest snapshots', async () => {
      setupHealthyResponses();

      await runModule();

      expect(mockRun).toHaveBeenCalledTimes(2);
      const coverageCypher = mockRun.mock.calls[0][0] as string;
      expect(coverageCypher).toContain('GateDecision');
      expect(coverageCypher).toContain('GovernanceMetricSnapshot');

      const latestCypher = mockRun.mock.calls[1][0] as string;
      expect(latestCypher).toContain('GovernanceMetricSnapshot');
      expect(latestCypher).toContain('ORDER BY');
      expect(latestCypher).toContain('LIMIT 2');
    });
  });

  // ─── Behavior 2: enforces strict mode via env var ───
  describe('B2: GOVERNANCE_METRICS_ENFORCE env var', () => {
    it('in non-strict (default), does NOT exit 1 when advisoryOk is false', async () => {
      delete process.env.GOVERNANCE_METRICS_ENFORCE;
      // No snapshots → advisoryOk false
      mockRun.mockResolvedValueOnce([coverageRow({ metricSnapshots: 0, gateDecisions: 0 })]);
      mockRun.mockResolvedValueOnce([]);

      await runModule();

      expect(mockExit).not.toHaveBeenCalledWith(1);
    });

    it('in strict mode, exits 1 when advisoryOk is false', async () => {
      process.env.GOVERNANCE_METRICS_ENFORCE = 'true';
      // No snapshots → advisoryOk false
      mockRun.mockResolvedValueOnce([coverageRow({ metricSnapshots: 0, gateDecisions: 0 })]);
      mockRun.mockResolvedValueOnce([]);

      await runModule();

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ─── Behavior 3: writes integrity report artifact to disk ───
  describe('B3: writes artifact files', () => {
    it('creates directory and writes timestamped + latest artifacts', async () => {
      setupHealthyResponses();

      await runModule();

      expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('governance-metric-integrity'), { recursive: true });
      // Should write two files: timestamped and latest.json
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      const latestWriteCall = mockWriteFileSync.mock.calls.find(
        (c: any[]) => String(c[0]).endsWith('latest.json'),
      );
      expect(latestWriteCall).toBeDefined();
    });
  });

  // ─── Behavior 4: reports pass/fail with detailed metrics ───
  describe('B4: detailed metric reporting', () => {
    it('outputs JSON with all integrity fields', async () => {
      setupHealthyResponses();

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);

      expect(parsed.ok).toBe(true);
      expect(parsed).toHaveProperty('metricSnapshots');
      expect(parsed).toHaveProperty('gateDecisions');
      expect(parsed).toHaveProperty('attributionCoverage');
      expect(parsed).toHaveProperty('preventionCoverage');
      expect(parsed).toHaveProperty('driftAlarm');
      expect(parsed).toHaveProperty('advisoryOk');
    });

    it('detects drift alarm when interception drops too much', async () => {
      // Big drop in interception rate
      mockRun.mockResolvedValueOnce([coverageRow()]);
      mockRun.mockResolvedValueOnce([
        latestRow({ interceptionRate: 0.3 }),
        previousRow({ interceptionRate: 0.8 }),
      ]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.driftAlarm).toBe(true);
      expect(parsed.advisoryOk).toBe(false);
    });

    it('detects drift alarm when recovery increases too much', async () => {
      mockRun.mockResolvedValueOnce([coverageRow()]);
      mockRun.mockResolvedValueOnce([
        latestRow({ meanRecoveryRuns: 5 }),
        previousRow({ meanRecoveryRuns: 1 }),
      ]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.driftAlarm).toBe(true);
    });
  });

  // ─── Behavior 5: exits code 1 in strict mode on violations ───
  describe('B5: strict mode exit behavior', () => {
    it('strict mode + advisory pass → no exit 1', async () => {
      process.env.GOVERNANCE_METRICS_ENFORCE = 'true';
      setupHealthyResponses();

      await runModule();

      expect(mockExit).not.toHaveBeenCalledWith(1);
    });

    it('strict mode + low attribution coverage → exit 1', async () => {
      process.env.GOVERNANCE_METRICS_ENFORCE = 'true';
      // affectsCommitEdges much less than gateDecisions → low attribution
      mockRun.mockResolvedValueOnce([coverageRow({ gateDecisions: 100, affectsCommitEdges: 10 })]);
      mockRun.mockResolvedValueOnce([latestRow(), previousRow()]);

      await runModule();

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ─── Behavior 6: toNum handles Neo4j Integer safely ───
  describe('B6: toNum handles Neo4j Integer objects', () => {
    it('handles Neo4j Integer objects with .toNumber()', async () => {
      const neo4jInt = { toNumber: () => 42 };
      mockRun.mockResolvedValueOnce([
        coverageRow({
          gateDecisions: neo4jInt,
          affectsCommitEdges: neo4jInt,
          metricSnapshots: neo4jInt,
          regressionEvents: neo4jInt,
          preventedRuns: neo4jInt,
          preventedEdgesDiagnostic: neo4jInt,
        }),
      ]);
      mockRun.mockResolvedValueOnce([latestRow(), previousRow()]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.gateDecisions).toBe(42);
      expect(parsed.metricSnapshots).toBe(42);
    });

    it('handles null/undefined values gracefully', async () => {
      mockRun.mockResolvedValueOnce([
        coverageRow({
          gateDecisions: null,
          affectsCommitEdges: undefined,
          metricSnapshots: 1,
        }),
      ]);
      mockRun.mockResolvedValueOnce([latestRow()]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.gateDecisions).toBe(0);
      expect(parsed.affectsCommitEdges).toBe(0);
    });
  });

  // SPEC-GAP: maxInterceptionDrop (0.2) and maxRecoveryIncrease (2) thresholds not in governance hardening spec — they are implementation defaults
  // SPEC-GAP: hasMetricHash check (sha256: prefix) is not mentioned in the spec — implementation detail for integrity
  // SPEC-GAP: attributionCoverage >= 0.95 threshold not explicitly in spec

  describe('cleanup: always closes Neo4j', () => {
    it('closes Neo4jService on success', async () => {
      setupHealthyResponses();
      await runModule();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
