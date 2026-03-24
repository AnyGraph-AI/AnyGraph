/**
 * AUD-TC-03-L1b-08: verification-recommendation-mismatch.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §VG-6
 * "Add metric: recommendation mismatch rate"
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
const originalEnv = { ...process.env };

describe('AUD-TC-03-L1b-08 | verification-recommendation-mismatch.ts', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRun.mockReset().mockResolvedValue([]);
    mockClose.mockReset().mockResolvedValue(undefined);
    delete process.env.MAX_RECOMMENDATION_MISMATCH_RATE;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  async function runCLI(args: string[] = [], env: Record<string, string> = {}) {
    Object.assign(process.env, env);
    process.argv = ['node', 'verification-recommendation-mismatch.ts', ...args];
    vi.resetModules();
    await import('../../../utils/verification-recommendation-mismatch.js');
    await new Promise((r) => setTimeout(r, 100));
  }

  // ─── B1: queries unblocked tasks (planned/in_progress with 0 open deps) ───
  it('B1: queries unblocked tasks via Neo4j', async () => {
    await runCLI([]);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('openDeps = 0'),
      expect.any(Object),
    );
  });

  // ─── B2: counts how many recommended tasks have status='done' ───
  it('B2: identifies done tasks among recommended (mismatch)', async () => {
    mockRun.mockResolvedValue([
      { projectId: 'plan_x', task: 'Task A', status: 'planned', line: 1 },
      { projectId: 'plan_x', task: 'Task B', status: 'done', line: 2 },
      { projectId: 'plan_x', task: 'Task C', status: 'planned', line: 3 },
    ]);
    await runCLI([]);
    // mismatchRate > 0 with default max=0 → exit 1
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // ─── B3: computes mismatchRate = doneRecommended / recommended ───
  it('B3: computes mismatchRate correctly', async () => {
    mockRun.mockResolvedValue([
      { projectId: 'plan_x', task: 'Task A', status: 'planned', line: 1 },
      { projectId: 'plan_x', task: 'Task B', status: 'done', line: 2 },
    ]);
    await runCLI([], { MAX_RECOMMENDATION_MISMATCH_RATE: '1.0' });

    const jsonCall = logSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"mismatchRate"'),
    );
    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0]);
    expect(output.mismatchRate).toBe(0.5);
    expect(output.recommendedTasks).toBe(2);
    expect(output.doneRecommendedTasks).toBe(1);
  });

  // ─── B4: compares against MAX_RECOMMENDATION_MISMATCH_RATE (default 0) ───
  it('B4: defaults maxAllowedMismatchRate to 0', async () => {
    await runCLI([]);
    const jsonCall = logSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"maxAllowedMismatchRate"'),
    );
    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0]);
    expect(output.maxAllowedMismatchRate).toBe(0);
  });

  // ─── B5: accepts optional project filter from argv[2] ───
  it('B5: accepts project filter from argv[2]', async () => {
    await runCLI(['plan_codegraph']);
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('$projectId'),
      expect.objectContaining({ projectId: 'plan_codegraph' }),
    );
  });

  // ─── B6: reports summary with sample of mismatched tasks (up to 10) ───
  it('B6: sample contains up to 10 mismatched tasks', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      projectId: 'plan_x',
      task: `Task ${i}`,
      status: 'done',
      line: i + 1,
    }));
    mockRun.mockResolvedValue(rows);
    await runCLI([], { MAX_RECOMMENDATION_MISMATCH_RATE: '1.0' });

    const jsonCall = logSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"sample"'),
    );
    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0]);
    expect(output.sample.length).toBeLessThanOrEqual(10);
  });

  // ─── B7: exits with code 1 when mismatchRate > maxAllowed ───
  it('B7: exits code 1 when mismatchRate exceeds maxAllowed', async () => {
    mockRun.mockResolvedValue([
      { projectId: 'plan_x', task: 'Done task', status: 'done', line: 1 },
    ]);
    await runCLI([]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('B7b: ok=true when mismatchRate is 0', async () => {
    mockRun.mockResolvedValue([
      { projectId: 'plan_x', task: 'Planned task', status: 'planned', line: 1 },
    ]);
    await runCLI([]);
    expect(exitSpy).not.toHaveBeenCalled();
    const jsonCall = logSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok": true'),
    );
    expect(jsonCall).toBeDefined();
  });
});
