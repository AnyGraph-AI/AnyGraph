// AUD-TC-03-L1b-13: verify-document-claim-support.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/ADAPTER_ROADMAP.md document layer completion contract

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNeoRun = vi.fn();
const mockNeoClose = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
}));

const origArgv = process.argv;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  process.argv = origArgv.slice();
});

async function runModule() {
  vi.resetModules();
  await import('../../../utils/verify-document-claim-support.js');
  await new Promise((r) => setTimeout(r, 150));
}

describe('verify-document-claim-support audit tests (L1b-13)', () => {
  it('B1: queries claims with claimType=task_completion containing forbidden document phrases', async () => {
    mockNeoRun.mockResolvedValue([]);
    process.argv = ['node', 'script.js'];
    await runModule();
    expect(mockNeoRun).toHaveBeenCalled();
    const cypher = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher).toContain('task_completion');
    expect(cypher).toContain('document layer complete');
    expect(cypher).toContain('document complete');
  });

  it('B2: excludes meta-governance tasks from violation detection', async () => {
    mockNeoRun.mockResolvedValue([]);
    process.argv = ['node', 'script.js'];
    await runModule();
    const cypher = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher).toContain('fail claim generation for');
    expect(cypher).toContain('forbidden wording rule');
    expect(cypher).toContain('NOT');
  });

  it('B3: reports ok=true with checkedClaims count when no violations', async () => {
    mockNeoRun.mockResolvedValue([
      { claimId: 'c1', statement: 'doc complete impl', supportGrade: 'runtime_materialized', supportCount: 2, runtimeHits: 1 },
    ]);
    process.argv = ['node', 'script.js'];
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
    expect(JSON.parse(String(jsonCall![0])).checkedClaims).toBe(1);
  });

  it('B4: exits with code 1 when claims lack runtime_materialized support grade', async () => {
    mockNeoRun.mockResolvedValue([
      { claimId: 'c1', statement: 'document layer complete', supportGrade: 'plan_only', supportCount: 0, runtimeHits: 0 },
    ]);
    process.argv = ['node', 'script.js'];
    await runModule();
    expect(mockExit).toHaveBeenCalledWith(1);
    const errCall = mockErr.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === false; } catch { return false; }
    });
    expect(errCall).toBeDefined();
    const parsed = JSON.parse(String(errCall![0]));
    expect(parsed.violations).toBe(1);
  });

  it('B5: uses custom planProjectId from argv[2]', async () => {
    mockNeoRun.mockResolvedValue([]);
    process.argv = ['node', 'script.js', 'plan_custom'];
    await runModule();
    expect(mockNeoRun.mock.calls[0][1]).toEqual({ planProjectId: 'plan_custom' });
  });

  it('B5b: defaults planProjectId to plan_codegraph', async () => {
    mockNeoRun.mockResolvedValue([]);
    process.argv = ['node', 'script.js'];
    await runModule();
    expect(mockNeoRun.mock.calls[0][1]).toEqual({ planProjectId: 'plan_codegraph' });
  });

  // SPEC-GAP: Spec doesn't define supportGrade filtering logic (only non-runtime_materialized are violations)
  // SPEC-GAP: Spec doesn't mention statement truncation to 220 chars in details
});
