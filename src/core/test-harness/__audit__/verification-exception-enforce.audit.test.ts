/**
 * AUD-TC-03-L1b-04: verification-exception-enforce.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §VG-4
 * "Add exception enforcement pass (expiry, approval mode, ticket linkage)"
 *
 * Role: B6 (Health Witness)
 * Accept: 4 behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRun, mockClose, mockRunExceptionEnforcement } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockClose: vi.fn(),
  mockRunExceptionEnforcement: vi.fn(),
}));

vi.mock('../../../core/verification/index.js', () => ({
  runExceptionEnforcement: mockRunExceptionEnforcement,
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4j {
    run = mockRun;
    close = mockClose;
  },
}));

const originalArgv = [...process.argv];

describe('AUD-TC-03-L1b-04 | verification-exception-enforce.ts', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRun.mockReset().mockResolvedValue([]);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockRunExceptionEnforcement.mockReset().mockResolvedValue({ violations: 0 });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  async function runCLI(args: string[] = []) {
    process.argv = ['node', 'verification-exception-enforce.ts', ...args];
    vi.resetModules();
    await import('../../../utils/verification-exception-enforce.js');
    await new Promise((r) => setTimeout(r, 100));
  }

  // ─── B1: creates Neo4jService and closes in finally block ───
  it('B1: creates Neo4jService and closes in finally block', async () => {
    await runCLI(['proj_test123456']);
    expect(mockClose).toHaveBeenCalled();
  });

  // ─── B2: runs enforcement for specified project or all projects ───
  it('B2a: runs enforcement for single specified project', async () => {
    await runCLI(['proj_abc123def456']);
    expect(mockRunExceptionEnforcement).toHaveBeenCalledTimes(1);
    expect(mockRunExceptionEnforcement).toHaveBeenCalledWith('proj_abc123def456');
  });

  it('B2b: queries and runs enforcement for all projects when no arg', async () => {
    mockRun.mockResolvedValue([
      { id: 'proj_aaa111bbb222' },
      { id: 'proj_ccc333ddd444' },
    ]);
    await runCLI([]);
    expect(mockRun).toHaveBeenCalledWith(expect.stringContaining('MATCH (p:Project)'));
    expect(mockRunExceptionEnforcement).toHaveBeenCalledTimes(2);
  });

  // ─── B3: outputs JSON result per project ───
  it('B3: outputs JSON with ok/projectId/result per project', async () => {
    const mockResult = { violations: 0, checked: 5 };
    mockRunExceptionEnforcement.mockResolvedValue(mockResult);
    await runCLI(['proj_test123456']);

    const jsonCall = logSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok"'),
    );
    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0]);
    expect(output).toEqual(
      expect.objectContaining({ ok: true, projectId: 'proj_test123456', result: mockResult }),
    );
  });

  // ─── B4: exits with code 1 on error ───
  it('B4: exits code 1 + JSON error on failure', async () => {
    mockRunExceptionEnforcement.mockRejectedValue(new Error('Enforcement failed'));
    await runCLI(['proj_test123456']);
    expect(exitSpy).toHaveBeenCalledWith(1);

    const errCall = errSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok"'),
    );
    expect(errCall).toBeDefined();
    const errOutput = JSON.parse(errCall![0]);
    expect(errOutput).toEqual(expect.objectContaining({ ok: false, error: 'Enforcement failed' }));
  });
});
