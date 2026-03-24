/**
 * AUD-TC-03-L1b-11: verification-status-dashboard.ts audit tests
 *
 * Spec: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md
 *       §"Add graph-native verification status dashboard utility" + Q11/Q18
 *
 * Behaviors:
 *   (1) queries milestone buckets via CONTRACT_QUERY_Q11_MILESTONE_BUCKETS
 *   (2) queries next unblocked tasks via CONTRACT_QUERY_Q11_NEXT_TASKS
 *   (3) queries blocked/effectiveBlocked/nullStatusCount via CONTRACT_QUERY_Q11_BLOCKED
 *   (4) queries runtime evidence coverage via CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE
 *   (5) queries latest governance metrics via CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST
 *   (6) queries governance metric trend via CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND
 *   (7) checks wording contract: forbiddenPhrase detection + invariant violation
 *   (8) reports wording status as violation/restricted/open
 *   (9) accepts 3 optional argv project ID overrides
 *   (10) toNum/str helpers handle Neo4j Integer objects safely
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

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

// Known query contracts — imported for assertion matching
const Q11_MILESTONE = 'CONTRACT_QUERY_Q11_MILESTONE_BUCKETS';
const Q11_NEXT = 'CONTRACT_QUERY_Q11_NEXT_TASKS';
const Q11_BLOCKED = 'CONTRACT_QUERY_Q11_BLOCKED';
const Q11_RUNTIME = 'CONTRACT_QUERY_Q11_RUNTIME_EVIDENCE';
const Q18_LATEST = 'CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_LATEST';
const Q18_TREND = 'CONTRACT_QUERY_Q18_GOVERNANCE_METRIC_TREND';

function milestoneRow(bucket: string, total: number, done: number) {
  return { bucket, total, done, planned: total - done, blocked: 0, inProgress: 0 };
}

function nextTaskRow(id: string, task: string, status = 'planned', openDeps = 0) {
  return { id, line: 1, task, status, openDeps };
}

function blockedRow(explicit = 0, effective = 0, nullStatus = 0) {
  return { explicitBlocked: explicit, effectiveBlocked: effective, nullStatusCount: nullStatus };
}

function runtimeRow(total = 10, withEv = 5, doneWithout = 2, edges = 8, artifacts = 3) {
  return {
    totalTasks: total,
    withEvidence: withEv,
    doneWithoutEvidence: doneWithout,
    evidenceEdgeCount: edges,
    evidenceArtifactCount: artifacts,
  };
}

function govLatestRow() {
  return {
    id: 'gm-001',
    timestamp: '2026-03-24T10:00:00Z',
    verificationRuns: 12,
    gateFailures: 2,
    failuresResolvedBeforeCommit: 1,
    preventedRuns: 3,
    preventedEdgesDiagnostic: 5,
    totalRegressionEvents: 0,
    regressionsAfterMerge: 0,
    interceptionRate: 0.85,
    operationalInterceptionRate: 0.9,
    invariantViolations: 0,
    falseCompletionEvents: 0,
    meanRecoveryRuns: 1.5,
  };
}

function govTrendRow(ts: string, rate: number) {
  return {
    timestamp: ts,
    interceptionRate: rate,
    gateFailures: 1,
    failuresResolvedBeforeCommit: 1,
    preventedRuns: 2,
    preventedEdgesDiagnostic: 3,
    totalRegressionEvents: 0,
    regressionsAfterMerge: 0,
    invariantViolations: 0,
  };
}

function wordingRow(doneMat = 0, docProj = 0, witnesses = 0, forbidden = 0) {
  return {
    doneMaterializationTasks: doneMat,
    documentProjectCount: docProj,
    witnessCount: witnesses,
    forbiddenCount: forbidden,
  };
}

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;
let savedArgv: string[];

/**
 * Set up sequential mock responses matching the 7 queries in execution order.
 */
function setupDefaultMocks() {
  mockRun
    .mockResolvedValueOnce([milestoneRow('VG-5', 10, 7), milestoneRow('CA-4', 5, 3)]) // milestones
    .mockResolvedValueOnce([nextTaskRow('t1', 'Implement X'), nextTaskRow('t2', 'Fix Y')]) // next tasks
    .mockResolvedValueOnce([blockedRow(1, 2, 0)]) // blocked
    .mockResolvedValueOnce([runtimeRow()]) // runtime evidence
    .mockResolvedValueOnce([govLatestRow()]) // governance latest
    .mockResolvedValueOnce([govTrendRow('2026-03-23T10:00:00Z', 0.8), govTrendRow('2026-03-24T10:00:00Z', 0.85)]) // governance trend
    .mockResolvedValueOnce([wordingRow(3, 1, 5, 0)]); // wording contract
}

beforeEach(() => {
  vi.resetModules();
  mockRun.mockReset();
  mockClose.mockReset().mockResolvedValue(undefined);
  setupDefaultMocks();

  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  savedArgv = process.argv;
  process.argv = ['node', 'script'];
});

afterEach(() => {
  mockExit.mockRestore();
  mockConsoleLog.mockRestore();
  mockConsoleError.mockRestore();
  process.argv = savedArgv;
});

async function runModule(args: string[] = []): Promise<void> {
  process.argv = ['node', 'script', ...args];
  await import('../../../utils/verification-status-dashboard.js');
  await new Promise((r) => setTimeout(r, 50));
}

function getOutput(): any {
  expect(mockConsoleLog).toHaveBeenCalled();
  return JSON.parse(mockConsoleLog.mock.calls[0][0]);
}

describe('AUD-TC-03-L1b-11 | verification-status-dashboard.ts', () => {

  // ─── Behavior 1: queries milestone buckets ───
  describe('B1: queries milestone buckets via Q11', () => {
    it('first neo4j query uses milestone buckets query', async () => {
      await runModule();
      const firstQuery = String(mockRun.mock.calls[0][0]);
      expect(firstQuery).toContain('bucket');
      expect(firstQuery).toContain('VG-');
    });

    it('output includes milestoneBuckets array with bucket/total/done', async () => {
      await runModule();
      const output = getOutput();
      expect(output.milestoneBuckets).toHaveLength(2);
      expect(output.milestoneBuckets[0]).toMatchObject({
        bucket: 'VG-5',
        total: 10,
        done: 7,
      });
    });
  });

  // ─── Behavior 2: queries next unblocked tasks ───
  describe('B2: queries next unblocked tasks via Q11', () => {
    it('output includes nextTasks array', async () => {
      await runModule();
      const output = getOutput();
      expect(output.nextTasks).toHaveLength(2);
      expect(output.nextTasks[0]).toMatchObject({
        id: 't1',
        task: 'Implement X',
        status: 'planned',
      });
    });
  });

  // ─── Behavior 3: queries blocked stats ───
  describe('B3: queries blocked/effectiveBlocked/nullStatusCount', () => {
    it('output includes blocked object with all three counts', async () => {
      await runModule();
      const output = getOutput();
      expect(output.blocked).toMatchObject({
        explicitBlocked: 1,
        effectiveBlocked: 2,
        nullStatusCount: 0,
      });
    });

    it('defaults to zeros when no blocked rows returned', async () => {
      mockRun.mockReset();
      mockRun
        .mockResolvedValueOnce([milestoneRow('VG-5', 10, 7)])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // empty blocked
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wordingRow()]);

      await runModule();
      const output = getOutput();
      expect(output.blocked).toMatchObject({
        explicitBlocked: 0,
        effectiveBlocked: 0,
        nullStatusCount: 0,
      });
    });
  });

  // ─── Behavior 4: queries runtime evidence ───
  describe('B4: queries runtime evidence coverage', () => {
    it('output includes runtimeEvidence with task/evidence counts', async () => {
      await runModule();
      const output = getOutput();
      expect(output.runtimeEvidence).toMatchObject({
        totalTasks: 10,
        withEvidence: 5,
        doneWithoutEvidence: 2,
        evidenceEdgeCount: 8,
        evidenceArtifactCount: 3,
      });
    });
  });

  // ─── Behavior 5: queries latest governance metrics ───
  describe('B5: queries governance metric latest via Q18', () => {
    it('output includes governanceMetricsLatest with all metric fields', async () => {
      await runModule();
      const output = getOutput();
      expect(output.governanceMetricsLatest).not.toBeNull();
      expect(output.governanceMetricsLatest.interceptionRate).toBe(0.85);
      expect(output.governanceMetricsLatest.verificationRuns).toBe(12);
      expect(output.governanceMetricsLatest.gateFailures).toBe(2);
    });

    it('governanceMetricsLatest is null when no metrics exist', async () => {
      mockRun.mockReset();
      mockRun
        .mockResolvedValueOnce([milestoneRow('VG-5', 10, 7)])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([blockedRow()])
        .mockResolvedValueOnce([runtimeRow()])
        .mockResolvedValueOnce([]) // empty governance latest
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wordingRow()]);

      await runModule();
      const output = getOutput();
      expect(output.governanceMetricsLatest).toBeNull();
    });
  });

  // ─── Behavior 6: queries governance trend ───
  describe('B6: queries governance metric trend via Q18', () => {
    it('output includes governanceMetricsTrend array', async () => {
      await runModule();
      const output = getOutput();
      expect(output.governanceMetricsTrend).toHaveLength(2);
      expect(output.governanceMetricsTrend[0].interceptionRate).toBe(0.8);
      expect(output.governanceMetricsTrend[1].interceptionRate).toBe(0.85);
    });
  });

  // ─── Behavior 7: wording contract detection ───
  describe('B7: checks wording contract invariant', () => {
    it('detects invariant red when done materialization tasks exist but no doc projects', async () => {
      mockRun.mockReset();
      setupDefaultMocksExceptWording();
      // doneMat=3, docProj=0, witnesses=0 → invariantRed=true
      mockRun.mockResolvedValueOnce([wordingRow(3, 0, 0, 0)]);

      await runModule();
      const output = getOutput();
      expect(output.wordingContract.invariantRed).toBe(true);
    });

    it('invariant is NOT red when doc projects and witnesses exist', async () => {
      await runModule(); // default has docProj=1, witnesses=5
      const output = getOutput();
      expect(output.wordingContract.invariantRed).toBe(false);
    });

    it('invariant is NOT red when no done materialization tasks', async () => {
      mockRun.mockReset();
      setupDefaultMocksExceptWording();
      mockRun.mockResolvedValueOnce([wordingRow(0, 0, 0, 0)]);

      await runModule();
      const output = getOutput();
      expect(output.wordingContract.invariantRed).toBe(false);
    });
  });

  // ─── Behavior 8: wording status categories ───
  describe('B8: reports wording status as violation/restricted/open', () => {
    it('status=violation when invariantRed AND forbiddenCount > 0', async () => {
      mockRun.mockReset();
      setupDefaultMocksExceptWording();
      mockRun.mockResolvedValueOnce([wordingRow(3, 0, 0, 2)]);

      await runModule();
      const output = getOutput();
      expect(output.wordingContract.status).toBe('violation');
    });

    it('status=restricted when invariantRed but forbiddenCount=0', async () => {
      mockRun.mockReset();
      setupDefaultMocksExceptWording();
      mockRun.mockResolvedValueOnce([wordingRow(3, 0, 0, 0)]);

      await runModule();
      const output = getOutput();
      expect(output.wordingContract.status).toBe('restricted');
    });

    it('status=open when invariant is NOT red', async () => {
      await runModule(); // default: docProj=1, witnesses=5
      const output = getOutput();
      expect(output.wordingContract.status).toBe('open');
    });
  });

  // ─── Behavior 9: accepts argv project ID overrides ───
  describe('B9: accepts optional project ID overrides from argv', () => {
    it('uses argv[2] as planProjectId', async () => {
      await runModule(['plan_custom']);
      const firstCallParams = mockRun.mock.calls[0][1];
      expect(firstCallParams.projectId).toBe('plan_custom');
    });

    it('uses argv[3] as runtimeProjectId', async () => {
      await runModule(['plan_codegraph', 'plan_custom_runtime']);
      // 4th call is runtime evidence query
      const runtimeCallParams = mockRun.mock.calls[3][1];
      expect(runtimeCallParams.runtimeProjectId).toBe('plan_custom_runtime');
    });

    it('uses argv[4] as governanceProjectId', async () => {
      await runModule(['plan_codegraph', 'plan_runtime_graph', 'proj_custom_gov']);
      // 5th call is governance latest
      const govCallParams = mockRun.mock.calls[4][1];
      expect(govCallParams.projectId).toBe('proj_custom_gov');
    });

    it('uses defaults when no argv provided', async () => {
      await runModule();
      const output = getOutput();
      expect(output.planProjectId).toBe('plan_codegraph');
      expect(output.runtimeProjectId).toBe('plan_runtime_graph');
      expect(output.governanceProjectId).toBe('proj_c0d3e9a1f200');
    });
  });

  // ─── Behavior 10: toNum/str helpers ───
  describe('B10: toNum/str handle Neo4j Integer objects safely', () => {
    it('toNum converts Neo4j Integer-like objects via .toNumber()', async () => {
      mockRun.mockReset();
      const neo4jInt = { toNumber: () => 42 };
      mockRun
        .mockResolvedValueOnce([{ bucket: 'VG-5', total: neo4jInt, done: neo4jInt, planned: 0, blocked: 0, inProgress: 0 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ explicitBlocked: neo4jInt, effectiveBlocked: 0, nullStatusCount: 0 }])
        .mockResolvedValueOnce([runtimeRow()])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wordingRow()]);

      await runModule();
      const output = getOutput();
      expect(output.milestoneBuckets[0].total).toBe(42);
      expect(output.blocked.explicitBlocked).toBe(42);
    });

    it('toNum returns 0 for null/undefined values', async () => {
      mockRun.mockReset();
      mockRun
        .mockResolvedValueOnce([{ bucket: 'VG-5', total: null, done: undefined, planned: null, blocked: null, inProgress: null }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([blockedRow()])
        .mockResolvedValueOnce([runtimeRow()])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wordingRow()]);

      await runModule();
      const output = getOutput();
      expect(output.milestoneBuckets[0].total).toBe(0);
      expect(output.milestoneBuckets[0].done).toBe(0);
    });

    it('str returns empty string for null/undefined', async () => {
      mockRun.mockReset();
      mockRun
        .mockResolvedValueOnce([{ bucket: null, total: 0, done: 0, planned: 0, blocked: 0, inProgress: 0 }])
        .mockResolvedValueOnce([{ id: null, line: 0, task: undefined, status: null, openDeps: 0 }])
        .mockResolvedValueOnce([blockedRow()])
        .mockResolvedValueOnce([runtimeRow()])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([wordingRow()]);

      await runModule();
      const output = getOutput();
      expect(output.milestoneBuckets[0].bucket).toBe('');
      expect(output.nextTasks[0].task).toBe('');
    });
  });

  // ─── Cleanup ───
  describe('Cleanup', () => {
    it('closes Neo4jService in finally block', async () => {
      await runModule();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('closes Neo4jService even on query error', async () => {
      mockRun.mockReset().mockRejectedValue(new Error('Neo4j down'));
      await runModule();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });
  });

  // ─── SPEC-GAPs ───
  // SPEC-GAP: Q11 spec does not define behavior when projectId doesn't exist in graph (silent empty vs error)
  // SPEC-GAP: Dashboard spec does not specify output format (pretty JSON vs compact) or file output option
  // SPEC-GAP: Wording contract "forbiddenPhrase" is hardcoded; spec mentions it as policy but implementation uses literal string
});

/** Setup all mocks except the last (wording) query */
function setupDefaultMocksExceptWording() {
  mockRun
    .mockResolvedValueOnce([milestoneRow('VG-5', 10, 7)])
    .mockResolvedValueOnce([nextTaskRow('t1', 'Do X')])
    .mockResolvedValueOnce([blockedRow()])
    .mockResolvedValueOnce([runtimeRow()])
    .mockResolvedValueOnce([govLatestRow()])
    .mockResolvedValueOnce([govTrendRow('2026-03-24', 0.85)]);
}
