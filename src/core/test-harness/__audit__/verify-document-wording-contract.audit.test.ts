// AUD-TC-03-L1b-16: verify-document-wording-contract.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §"Surface wording status"

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNeoRun = vi.fn();
const mockNeoClose = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
}));

const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
vi.mock('node:fs', () => ({
  mkdirSync: (...a: unknown[]) => mockMkdirSync(...a),
  writeFileSync: (...a: unknown[]) => mockWriteFileSync(...a),
}));

const origArgv = process.argv;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  process.argv = origArgv.slice();
});

async function runModule() {
  vi.resetModules();
  await import('../../../utils/verify-document-wording-contract.js');
  await new Promise((r) => setTimeout(r, 150));
}

describe('verify-document-wording-contract audit tests (L1b-16)', () => {
  it('B1: runs state check query and forbidden phrase query', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 0, documentProjectCount: 0, witnessCount: 0 }])
      .mockResolvedValueOnce([]);
    process.argv = ['node', 'script.js'];
    await runModule();
    expect(mockNeoRun).toHaveBeenCalledTimes(2);
    const cypher1 = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher1).toContain('doneMaterializationTasks');
    const cypher2 = String(mockNeoRun.mock.calls[1][0]);
    expect(cypher2).toContain('document layer complete');
  });

  it('B2: writes timestamped and latest JSON artifacts', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 0, documentProjectCount: 0, witnessCount: 0 }])
      .mockResolvedValueOnce([]);
    process.argv = ['node', 'script.js'];
    await runModule();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('document-wording-contract'), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
  });

  it('B3a: reports status=open when no done tasks and no forbidden claims', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 0, documentProjectCount: 0, witnessCount: 0 }])
      .mockResolvedValueOnce([]);
    process.argv = ['node', 'script.js'];
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.status).toBe('open');
    expect(parsed.forbiddenTriggered).toBe(false);
  });

  it('B3b: reports status=restricted when invariantRed but no forbidden claims', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 3, documentProjectCount: 0, witnessCount: 0 }])
      .mockResolvedValueOnce([]);
    process.argv = ['node', 'script.js'];
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.status).toBe('restricted');
    expect(parsed.invariantRed).toBe(true);
  });

  it('B3c: reports status=violation when invariantRed AND forbidden claims exist', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 3, documentProjectCount: 0, witnessCount: 0 }])
      .mockResolvedValueOnce([{ claimId: 'c1', statement: 'document layer complete' }]);
    process.argv = ['node', 'script.js'];
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.status).toBe('violation');
    expect(parsed.forbiddenTriggered).toBe(true);
  });

  it('B4: exits with code 1 when forbiddenTriggered', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 2, documentProjectCount: 0, witnessCount: 0 }])
      .mockResolvedValueOnce([{ claimId: 'c1', statement: 'document layer complete' }]);
    process.argv = ['node', 'script.js'];
    await runModule();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('B4b: does not exit 1 when forbidden claims exist but invariantRed is false', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 0, documentProjectCount: 0, witnessCount: 0 }])
      .mockResolvedValueOnce([{ claimId: 'c1', statement: 'document layer complete' }]);
    process.argv = ['node', 'script.js'];
    await runModule();
    // invariantRed=false so forbiddenTriggered=false even with forbidden claims
    expect(mockExit).not.toHaveBeenCalledWith(1);
  });

  it('B5: uses custom planProjectId from argv[2]', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 0, documentProjectCount: 0, witnessCount: 0 }])
      .mockResolvedValueOnce([]);
    process.argv = ['node', 'script.js', 'plan_other'];
    await runModule();
    expect(mockNeoRun.mock.calls[0][1]).toEqual({ planProjectId: 'plan_other' });
    expect(mockNeoRun.mock.calls[1][1]).toEqual({ planProjectId: 'plan_other' });
  });

  // SPEC-GAP: Spec doesn't define the invariantRed logic
  // SPEC-GAP: Spec doesn't distinguish 'forbidden claims exist' vs 'forbiddenTriggered' (AND with invariantRed)
});
