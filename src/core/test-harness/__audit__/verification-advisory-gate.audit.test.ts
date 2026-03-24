/**
 * AUD-TC-03-L1b-01: verification-advisory-gate.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §VG-4
 * "Add OPA/Rego advisory gate lane with decision-log linkage"
 *
 * Role: B6 (Health Witness)
 * Accept: 7 behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRun, mockClose, mockRunAdvisoryGate } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockClose: vi.fn(),
  mockRunAdvisoryGate: vi.fn(),
}));

vi.mock('../../../core/verification/index.js', () => ({
  runAdvisoryGate: mockRunAdvisoryGate,
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4j {
    run = mockRun;
    close = mockClose;
  },
}));

const originalArgv = [...process.argv];

describe('AUD-TC-03-L1b-01 | verification-advisory-gate.ts', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRun.mockReset().mockResolvedValue([]);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockRunAdvisoryGate.mockReset().mockResolvedValue({ passed: true, advisories: [] });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  async function runCLI(args: string[] = []) {
    process.argv = ['node', 'verification-advisory-gate.ts', ...args];
    vi.resetModules();
    await import('../../../utils/verification-advisory-gate.js');
    await new Promise((r) => setTimeout(r, 100));
  }

  // ─── B1: main() creates Neo4jService and closes it in finally block ───
  it('B1: creates Neo4jService and closes it in finally block', async () => {
    await runCLI(['proj_test123456']);
    expect(mockClose).toHaveBeenCalled();
  });

  // ─── B2: when projectId arg provided, runs gate for that single project ───
  it('B2: runs advisory gate for single project when projectId provided', async () => {
    await runCLI(['proj_abc123def456']);
    expect(mockRunAdvisoryGate).toHaveBeenCalledTimes(1);
    expect(mockRunAdvisoryGate).toHaveBeenCalledWith(
      'proj_abc123def456',
      expect.objectContaining({ runExceptionPolicyFirst: true }),
    );
  });

  // ─── B3: when no arg, queries all Project nodes and runs gate for each ───
  it('B3: queries all Projects when no arg, runs gate for each', async () => {
    mockRun.mockResolvedValue([
      { id: 'proj_aaa111bbb222' },
      { id: 'proj_ccc333ddd444' },
    ]);
    await runCLI([]);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (p:Project)'),
    );
    expect(mockRunAdvisoryGate).toHaveBeenCalledTimes(2);
    expect(mockRunAdvisoryGate).toHaveBeenCalledWith('proj_aaa111bbb222', expect.any(Object));
    expect(mockRunAdvisoryGate).toHaveBeenCalledWith('proj_ccc333ddd444', expect.any(Object));
  });

  // ─── B4: passes optional policyBundleId from argv[3] ───
  it('B4: passes policyBundleId from argv[3] to runAdvisoryGate', async () => {
    await runCLI(['proj_test123456', 'custom-policy-v2']);
    expect(mockRunAdvisoryGate).toHaveBeenCalledWith(
      'proj_test123456',
      expect.objectContaining({ policyBundleId: 'custom-policy-v2' }),
    );
  });

  // ─── B5: outputs JSON with ok/projectId/policyBundleId/result per project ───
  it('B5: outputs JSON with ok/projectId/policyBundleId/result', async () => {
    const mockResult = { passed: true, advisories: ['a1'] };
    mockRunAdvisoryGate.mockResolvedValue(mockResult);
    await runCLI(['proj_test123456']);

    const jsonCall = logSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok"'),
    );
    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0]);
    expect(output).toEqual(
      expect.objectContaining({
        ok: true,
        projectId: 'proj_test123456',
        policyBundleId: 'verification-gate-policy-v1',
        result: mockResult,
      }),
    );
  });

  // ─── B6: exits with code 1 and JSON error on failure ───
  it('B6: exits code 1 + JSON error on failure', async () => {
    mockRunAdvisoryGate.mockRejectedValue(new Error('Gate exploded'));
    await runCLI(['proj_test123456']);
    expect(exitSpy).toHaveBeenCalledWith(1);

    const errCall = errSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok"'),
    );
    expect(errCall).toBeDefined();
    const errOutput = JSON.parse(errCall![0]);
    expect(errOutput).toEqual(expect.objectContaining({ ok: false, error: 'Gate exploded' }));
  });

  // ─── B7: passes runExceptionPolicyFirst: true ───
  it('B7: passes runExceptionPolicyFirst: true to gate', async () => {
    await runCLI(['proj_test123456']);
    expect(mockRunAdvisoryGate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ runExceptionPolicyFirst: true }),
    );
  });
});
