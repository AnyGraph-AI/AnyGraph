/**
 * AUD-TC-03-L1b-03: verification-done-vs-proven.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §VG-6
 * "Add done-vs-proven acceptance query"
 *
 * Role: B6 (Health Witness)
 * Accept: 7 behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRun, mockClose } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4j {
    run = mockRun;
    close = mockClose;
  },
}));

const originalArgv = [...process.argv];

describe('AUD-TC-03-L1b-03 | verification-done-vs-proven.ts', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRun.mockReset().mockResolvedValue([]);
    mockClose.mockReset().mockResolvedValue(undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  async function runCLI(args: string[] = []) {
    process.argv = ['node', 'verification-done-vs-proven.ts', ...args];
    vi.resetModules();
    await import('../../../utils/verification-done-vs-proven.js');
    await new Promise((r) => setTimeout(r, 100));
  }

  // ─── B1: queries VG-5 invariant validation tasks ───
  it('B1: queries tasks with name STARTS WITH Validate invariant:', async () => {
    await runCLI([]);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("STARTS WITH 'Validate invariant:'"),
      expect.objectContaining({ milestoneCode: 'VG-5' }),
    );
  });

  // ─── B2: identifies doneWithoutProof ───
  it('B2: identifies done tasks without proofs as doneWithoutProof', async () => {
    mockRun.mockResolvedValue([
      { task: 'Validate invariant: A', status: 'done', proofResult: '', proofRunId: '', proofInvariantId: '', proofCount: 0 },
      { task: 'Validate invariant: B', status: 'done', proofResult: 'pass', proofRunId: 'run1', proofInvariantId: 'inv1', proofCount: 1 },
    ]);
    await runCLI([]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errCall = errSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"doneWithoutProof"'),
    );
    expect(errCall).toBeDefined();
    const output = JSON.parse(errCall![0]);
    expect(output.doneWithoutProof).toBe(1);
  });

  // ─── B3: identifies proofWithoutDone ───
  it('B3: identifies tasks with proofs but not done as proofWithoutDone', async () => {
    mockRun.mockResolvedValue([
      { task: 'Validate invariant: A', status: 'planned', proofResult: 'pass', proofRunId: 'run1', proofInvariantId: 'inv1', proofCount: 1 },
    ]);
    await runCLI([]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errCall = errSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"proofWithoutDone"'),
    );
    expect(errCall).toBeDefined();
    const output = JSON.parse(errCall![0]);
    expect(output.proofWithoutDone).toBe(1);
  });

  // ─── B4: ok=true only when both counts are 0 ───
  it('B4: reports ok=true when doneWithoutProof=0 AND proofWithoutDone=0', async () => {
    mockRun.mockResolvedValue([
      { task: 'Validate invariant: A', status: 'done', proofResult: 'pass', proofRunId: 'run1', proofInvariantId: 'inv1', proofCount: 1 },
      { task: 'Validate invariant: B', status: 'planned', proofResult: '', proofRunId: '', proofInvariantId: '', proofCount: 0 },
    ]);
    await runCLI([]);
    expect(exitSpy).not.toHaveBeenCalled();
    const jsonCall = logSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok": true'),
    );
    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0]);
    expect(output.doneWithoutProof).toBe(0);
    expect(output.proofWithoutDone).toBe(0);
  });

  // ─── B5: exits with code 1 when not ok ───
  it('B5: exits code 1 when not ok', async () => {
    mockRun.mockResolvedValue([
      { task: 'Validate invariant: A', status: 'done', proofResult: '', proofRunId: '', proofInvariantId: '', proofCount: 0 },
    ]);
    await runCLI([]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // ─── B6: defaults to plan_codegraph project and VG-5 milestone ───
  it('B6: defaults to plan_codegraph and VG-5', async () => {
    await runCLI([]);
    expect(mockRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        projectId: 'plan_codegraph',
        milestoneCode: 'VG-5',
      }),
    );
  });

  // ─── B7: accepts custom projectId from argv[2] ───
  it('B7: accepts custom projectId from argv[2]', async () => {
    await runCLI(['plan_custom']);
    expect(mockRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ projectId: 'plan_custom' }),
    );
  });

  // ─── Cleanup + error handling ───
  it('closes Neo4jService in finally block', async () => {
    await runCLI([]);
    expect(mockClose).toHaveBeenCalled();
  });

  it('exits code 1 + JSON error on unexpected failure', async () => {
    mockRun.mockRejectedValue(new Error('Neo4j connection failed'));
    await runCLI([]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errCall = errSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok":false'),
    );
    expect(errCall).toBeDefined();
  });
});
