/**
 * AUD-TC-03-L1b-12: verification-vg5-thresholds.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §VG-5
 * "Meet pilot threshold: false-positive rate <= 10% for two consecutive runs"
 *
 * Role: B6 (Health Witness)
 * Accept: 8 behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ── hoisted mocks ─────────────────────────────────────────────── */
const { mockExecFileSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync, mockNeo4jRun, mockNeo4jClose } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockNeo4jRun: vi.fn(),
  mockNeo4jClose: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
  };
});

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4j {
    run = mockNeo4jRun;
    close = mockNeo4jClose;
  },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const originalArgv = [...process.argv];

/**
 * Helper to create a valid PilotValidationSummary artifact.
 * All checks pass by default; override specific checks via `failedChecks`.
 */
function makeValidationArtifact(failedChecks: string[] = []) {
  const allChecks: Record<string, boolean> = {
    materializationIdempotency: true,
    projectScopeIntegrity: true,
    originalEdgeTypeFidelity: true,
    deterministicRebuildTotals: true,
    noOrphanRelationshipWrites: true,
  };
  for (const key of failedChecks) {
    allChecks[key] = false;
  }
  return JSON.stringify({
    ok: failedChecks.length === 0,
    checks: allChecks,
  });
}

describe('AUD-TC-03-L1b-12 | verification-vg5-thresholds.ts', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockNeo4jRun.mockReset().mockResolvedValue([{ totalWaivers: 0, compliantWaivers: 0 }]);
    mockNeo4jClose.mockReset().mockResolvedValue(undefined);

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // Default: execFileSync succeeds, readFileSync returns passing artifact
    mockExecFileSync.mockReturnValue(Buffer.from(''));
    mockReadFileSync.mockReturnValue(makeValidationArtifact());
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  async function runCLI(args: string[] = []) {
    process.argv = ['node', 'verification-vg5-thresholds.ts', ...args];
    vi.resetModules();
    await import('../../../utils/verification-vg5-thresholds.js');
    await new Promise((r) => setTimeout(r, 150));
  }

  // ─── B1: runs verification:pilot:ir:validate twice via execFileSync ───
  it('B1: runs IR pilot validation twice via execFileSync', async () => {
    await runCLI();

    const npmCalls = mockExecFileSync.mock.calls.filter(
      ([cmd, args]: [string, string[]]) =>
        cmd === 'npm' && args?.includes('verification:pilot:ir:validate'),
    );
    expect(npmCalls).toHaveLength(2);
    // Both calls should use 'run' subcommand
    for (const [, args] of npmCalls) {
      expect(args).toContain('run');
      expect(args).toContain('verification:pilot:ir:validate');
    }
  });

  // ─── B2: computes per-run false-positive rate from validation artifact checks ───
  it('B2: computes per-run false-positive rate from validation artifact checks', async () => {
    // First run: all pass (0% FP). Second run: 1/5 fails (20% FP).
    let readCount = 0;
    mockReadFileSync.mockImplementation(() => {
      readCount++;
      if (readCount <= 1) return makeValidationArtifact(); // run 1: all pass
      return makeValidationArtifact(['materializationIdempotency']); // run 2: 1 fail
    });

    await runCLI();

    const written = mockWriteFileSync.mock.calls.find(
      ([path]: [string]) => (path as string).includes('vg5-thresholds-latest.json'),
    );
    expect(written).toBeDefined();
    const summary = JSON.parse(written![1] as string);

    expect(summary.falsePositive.runMetrics).toHaveLength(2);
    expect(summary.falsePositive.runMetrics[0].falsePositiveRatePct).toBe(0);
    expect(summary.falsePositive.runMetrics[1].falsePositiveRatePct).toBe(20);
  });

  // ─── B3: asserts consecutiveRunsPass: both runs ≤ 10% false-positive rate ───
  it('B3: asserts consecutiveRunsPass — both runs must be ≤ 10% FP rate', async () => {
    // Both runs pass all checks → 0% FP → consecutive pass
    mockReadFileSync.mockReturnValue(makeValidationArtifact());
    await runCLI();

    const written = mockWriteFileSync.mock.calls.find(
      ([path]: [string]) => (path as string).includes('vg5-thresholds-latest.json'),
    );
    const summary = JSON.parse(written![1] as string);
    expect(summary.falsePositive.consecutiveRunsPass).toBe(true);
    expect(summary.falsePositive.thresholdPct).toBe(10);
  });

  // ─── B4: computes scope completeness (evaluatedCriticalInvariants / total ≥ 95%) ───
  it('B4: computes scope completeness from invariant count', async () => {
    mockReadFileSync.mockReturnValue(makeValidationArtifact());
    await runCLI();

    const written = mockWriteFileSync.mock.calls.find(
      ([path]: [string]) => (path as string).includes('vg5-thresholds-latest.json'),
    );
    const summary = JSON.parse(written![1] as string);

    expect(summary.scopeCompleteness.thresholdPct).toBe(95);
    expect(summary.scopeCompleteness.totalCriticalInvariants).toBe(5); // 5 checks in validation artifact
    expect(summary.scopeCompleteness.evaluatedCriticalInvariants).toBe(5);
    expect(summary.scopeCompleteness.completenessPct).toBe(100);
    expect(summary.scopeCompleteness.pass).toBe(true);
  });

  // ─── B5: queries AdjudicationRecord waiver hygiene ───
  it('B5: queries AdjudicationRecord waiver hygiene (ticketRef + approvalMode + expiresAt compliance)', async () => {
    mockNeo4jRun.mockResolvedValue([{ totalWaivers: 10, compliantWaivers: 10 }]);
    await runCLI();

    // Verify the waiver query was executed with correct structure
    const waiverQueries = mockNeo4jRun.mock.calls.filter(
      ([query]: [string]) =>
        query.includes('AdjudicationRecord') && query.includes('isWaiver'),
    );
    expect(waiverQueries.length).toBeGreaterThanOrEqual(1);

    // Check query looks for ticketRef, approvalMode, expiresAt compliance
    const queryText = waiverQueries[0][0] as string;
    expect(queryText).toContain('ticketRef');
    expect(queryText).toContain('approvalMode');
    expect(queryText).toContain('expiresAt');

    const written = mockWriteFileSync.mock.calls.find(
      ([path]: [string]) => (path as string).includes('vg5-thresholds-latest.json'),
    );
    const summary = JSON.parse(written![1] as string);
    expect(summary.waiverHygiene.compliantPct).toBe(100);
    expect(summary.waiverHygiene.pass).toBe(true);
  });

  // ─── B6: writes ThresholdSummary artifact ───
  it('B6: writes ThresholdSummary artifact to artifacts/verification-pilot/vg5-thresholds-latest.json', async () => {
    await runCLI();

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('artifacts/verification-pilot'),
      { recursive: true },
    );
    const thresholdWrite = mockWriteFileSync.mock.calls.find(
      ([path]: [string]) => (path as string).includes('vg5-thresholds-latest.json'),
    );
    expect(thresholdWrite).toBeDefined();

    const summary = JSON.parse(thresholdWrite![1] as string);
    expect(summary).toHaveProperty('ok');
    expect(summary).toHaveProperty('projectId');
    expect(summary).toHaveProperty('generatedAt');
    expect(summary).toHaveProperty('falsePositive');
    expect(summary).toHaveProperty('scopeCompleteness');
    expect(summary).toHaveProperty('waiverHygiene');
  });

  // ─── B7: ok = consecutiveRunsPass AND scopePass AND waiverPass ───
  it('B7: ok is true only when all three sub-checks pass', async () => {
    // All pass
    mockReadFileSync.mockReturnValue(makeValidationArtifact());
    mockNeo4jRun.mockResolvedValue([{ totalWaivers: 0, compliantWaivers: 0 }]);

    await runCLI();

    const written = mockWriteFileSync.mock.calls.find(
      ([path]: [string]) => (path as string).includes('vg5-thresholds-latest.json'),
    );
    const summary = JSON.parse(written![1] as string);
    expect(summary.ok).toBe(true);
    expect(summary.falsePositive.consecutiveRunsPass).toBe(true);
    expect(summary.scopeCompleteness.pass).toBe(true);
    expect(summary.waiverHygiene.pass).toBe(true);
  });

  // ─── B8: exits with code 1 when not ok ───
  it('B8: exits with code 1 when any sub-check fails', async () => {
    // Force waiver hygiene failure: 5 total waivers, 0 compliant
    mockNeo4jRun.mockResolvedValue([{ totalWaivers: 5, compliantWaivers: 0 }]);
    mockReadFileSync.mockReturnValue(makeValidationArtifact());

    await runCLI();

    const written = mockWriteFileSync.mock.calls.find(
      ([path]: [string]) => (path as string).includes('vg5-thresholds-latest.json'),
    );
    const summary = JSON.parse(written![1] as string);
    expect(summary.ok).toBe(false);
    expect(summary.waiverHygiene.pass).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // ─── SPEC-GAP checks ───
  // SPEC-GAP: §VG-5 does not specify behavior when execFileSync throws (pilot validation crashes mid-run)
  // SPEC-GAP: §VG-5 does not specify what happens when validation artifact file is missing or malformed
  // SPEC-GAP: §VG-5 does not define whether scope completeness uses last run only or both runs
  // SPEC-GAP: §VG-5 thresholds (10% FP, 95% scope, 100% waiver) are hardcoded — no spec for configurability
});
