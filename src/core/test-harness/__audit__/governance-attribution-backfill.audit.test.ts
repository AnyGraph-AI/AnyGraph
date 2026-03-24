/**
 * AUD-TC-03-L1b-33: governance-attribution-backfill.ts audit tests
 *
 * Spec: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §GM-2
 * governance metric materialization + attribution backfill
 *
 * Behaviors:
 *   (1) queries VerificationRun rows with associated gate decisions and commit snapshots
 *   (2) creates/verifies attribution edges between run artifacts
 *   (3) reports backfill counts
 *   (4) toStr helper handles null/undefined safely
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ──

const { mockRun, mockClose } = vi.hoisted(() => ({
  mockRun: vi.fn().mockResolvedValue([]),
  mockClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4jService {
    run = mockRun;
    close = mockClose;
  },
}));

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  mockRun.mockReset().mockResolvedValue([]);
  mockClose.mockReset().mockResolvedValue(undefined);
  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mockExit.mockRestore();
  mockConsoleLog.mockRestore();
  mockConsoleError.mockRestore();
});

function runRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    runId: 'run-001',
    ranAt: '2026-03-20T10:00:00Z',
    result: 'pass',
    headSha: 'abc123',
    gateDecisionId: 'gd-001',
    commitSnapshotId: 'cs-001',
    ...overrides,
  };
}

async function runModule(argv2?: string): Promise<void> {
  const origArgv = process.argv;
  process.argv = argv2 ? ['node', 'script', argv2] : ['node', 'script'];
  try {
    await import('../../../utils/governance-attribution-backfill.js');
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.argv = origArgv;
  }
}

describe('governance-attribution-backfill audit tests', () => {
  // ─── Behavior 1: queries VerificationRun rows ───
  describe('B1: queries run rows with gate decisions and commit snapshots', () => {
    it('issues a query joining VerificationRun, GateDecision, CommitSnapshot', async () => {
      mockRun.mockResolvedValueOnce([runRow()]);
      // Subsequent calls for MERGE operations
      mockRun.mockResolvedValue([]);

      await runModule();

      const firstCall = mockRun.mock.calls[0];
      const cypher = firstCall[0] as string;
      expect(cypher).toContain('VerificationRun');
      expect(cypher).toContain('GateDecision');
      expect(cypher).toContain('CommitSnapshot');
      expect(cypher).toContain('EMITS_GATE_DECISION');
      expect(cypher).toContain('CAPTURED_COMMIT');
    });

    it('passes projectId parameter to query', async () => {
      mockRun.mockResolvedValueOnce([]);

      await runModule('proj_test123');

      const params = mockRun.mock.calls[0][1] as Record<string, unknown>;
      expect(params.projectId).toBe('proj_test123');
    });
  });

  // ─── Behavior 2: creates attribution edges ───
  describe('B2: creates/verifies attribution edges', () => {
    it('creates AFFECTS_COMMIT edge between GateDecision and CommitSnapshot', async () => {
      mockRun.mockResolvedValueOnce([runRow()]);
      mockRun.mockResolvedValue([]); // subsequent MERGE calls

      await runModule();

      // After initial query, should have MERGE calls for AFFECTS_COMMIT
      const mergeCalls = mockRun.mock.calls.slice(1);
      const affectsCommitCall = mergeCalls.find(
        (c: any[]) => String(c[0]).includes('AFFECTS_COMMIT'),
      );
      expect(affectsCommitCall).toBeDefined();
    });

    it('creates RegressionEvent for failed runs', async () => {
      mockRun.mockResolvedValueOnce([runRow({ result: 'fail' })]);
      mockRun.mockResolvedValue([]);

      await runModule();

      const mergeCalls = mockRun.mock.calls.slice(1);
      const regressionCall = mergeCalls.find(
        (c: any[]) => String(c[0]).includes('RegressionEvent'),
      );
      expect(regressionCall).toBeDefined();
    });

    it('creates DETECTED edge from VerificationRun to RegressionEvent', async () => {
      mockRun.mockResolvedValueOnce([runRow({ result: 'fail' })]);
      mockRun.mockResolvedValue([]);

      await runModule();

      const mergeCalls = mockRun.mock.calls.slice(1);
      const detectedCall = mergeCalls.find(
        (c: any[]) => String(c[0]).includes('DETECTED'),
      );
      expect(detectedCall).toBeDefined();
    });

    it('creates PREVENTED edge when a fail run is resolved by a later pass on same sha', async () => {
      mockRun.mockResolvedValueOnce([
        runRow({ runId: 'run-fail', result: 'fail', headSha: 'sha1' }),
        runRow({ runId: 'run-pass', result: 'pass', headSha: 'sha1', gateDecisionId: 'gd-002', commitSnapshotId: 'cs-002' }),
      ]);
      mockRun.mockResolvedValue([]);

      await runModule();

      const mergeCalls = mockRun.mock.calls.slice(1);
      const preventedCall = mergeCalls.find(
        (c: any[]) => String(c[0]).includes('PREVENTED'),
      );
      expect(preventedCall).toBeDefined();
    });

    it('does NOT create PREVENTED edge when fail has no subsequent pass on same sha', async () => {
      mockRun.mockResolvedValueOnce([
        runRow({ runId: 'run-fail', result: 'fail', headSha: 'sha1' }),
        runRow({ runId: 'run-pass', result: 'pass', headSha: 'sha2', gateDecisionId: 'gd-002', commitSnapshotId: 'cs-002' }),
      ]);
      mockRun.mockResolvedValue([]);

      await runModule();

      const mergeCalls = mockRun.mock.calls.slice(1);
      const preventedCall = mergeCalls.find(
        (c: any[]) => String(c[0]).includes('PREVENTED'),
      );
      expect(preventedCall).toBeUndefined();
    });
  });

  // ─── Behavior 3: reports backfill counts ───
  describe('B3: reports backfill counts', () => {
    it('outputs JSON with edge and event counts', async () => {
      mockRun.mockResolvedValueOnce([runRow(), runRow({ runId: 'run-002', gateDecisionId: 'gd-002', commitSnapshotId: 'cs-002' })]);
      mockRun.mockResolvedValue([]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.ok).toBe(true);
      expect(parsed).toHaveProperty('runsSeen');
      expect(parsed).toHaveProperty('affectsCommitEdges');
      expect(parsed).toHaveProperty('regressionEventsUpserted');
      expect(parsed).toHaveProperty('detectedEdges');
      expect(parsed).toHaveProperty('preventedEdges');
      expect(parsed.runsSeen).toBe(2);
      expect(parsed.affectsCommitEdges).toBe(2);
    });

    it('reports zero counts when no runs exist', async () => {
      mockRun.mockResolvedValueOnce([]);

      await runModule();

      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.runsSeen).toBe(0);
      expect(parsed.affectsCommitEdges).toBe(0);
      expect(parsed.regressionEventsUpserted).toBe(0);
    });
  });

  // ─── Behavior 4: toStr handles null/undefined safely ───
  describe('B4: toStr handles null/undefined', () => {
    it('maps null values to empty strings without crashing', async () => {
      mockRun.mockResolvedValueOnce([
        runRow({
          runId: null,
          ranAt: undefined,
          result: null,
          headSha: null,
          gateDecisionId: null,
          commitSnapshotId: null,
        }),
      ]);
      mockRun.mockResolvedValue([]);

      await runModule();

      // Should not throw — toStr handles null/undefined
      const output = mockConsoleLog.mock.calls.flat().join(' ');
      const parsed = JSON.parse(output);
      expect(parsed.ok).toBe(true);
    });
  });

  // SPEC-GAP: RegressionEvent status values ('prevented_before_commit' vs 'unresolved') not specified in GM-2 section
  // SPEC-GAP: The detection of "resolution" via headSha matching between fail and subsequent pass is an implementation heuristic not in the spec

  describe('cleanup: always closes Neo4j', () => {
    it('closes Neo4jService on success', async () => {
      mockRun.mockResolvedValueOnce([]);
      await runModule();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
