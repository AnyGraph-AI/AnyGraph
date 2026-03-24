// AUD-TC-03-L1b-27: document-claim-support-grade.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/ADAPTER_ROADMAP.md document claim support grading

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNeoRun = vi.fn();
const mockNeoClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class {
    run = mockNeoRun;
    close = mockNeoClose;
  },
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
  await import('../../../utils/document-claim-support-grade.js');
  await new Promise((r) => setTimeout(r, 150));
}

describe('document-claim-support-grade audit tests (L1b-27)', () => {
  it('B1: runs Cypher query filtering claims by claimType=task_completion and document keyword', async () => {
    mockNeoRun.mockResolvedValue([]);
    process.argv = ['node', 'script.js'];
    await runModule();
    expect(mockNeoRun).toHaveBeenCalled();
    const cypher = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher).toContain('task_completion');
    expect(cypher).toContain('document');
    expect(cypher).toContain('supportGrade');
  });

  it('B2: grades claims into three tiers based on support evidence', async () => {
    mockNeoRun.mockResolvedValue([
      { claimId: 'c1', statement: 'doc A', supportGrade: 'plan_only', supportCount: 0, runtimeSupportHits: 0, codeLikeSupportHits: 0 },
      { claimId: 'c2', statement: 'doc B', supportGrade: 'code_only', supportCount: 1, runtimeSupportHits: 0, codeLikeSupportHits: 1 },
      { claimId: 'c3', statement: 'doc C', supportGrade: 'runtime_materialized', supportCount: 2, runtimeSupportHits: 1, codeLikeSupportHits: 1 },
    ]);
    process.argv = ['node', 'script.js'];
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.byGrade).toEqual({ plan_only: 1, code_only: 1, runtime_materialized: 1 });
  });

  it('B3: outputs JSON with ok, claimsGraded count, and byGrade distribution', async () => {
    mockNeoRun.mockResolvedValue([
      { claimId: 'c1', supportGrade: 'plan_only', supportCount: 0, runtimeSupportHits: 0, codeLikeSupportHits: 0 },
    ]);
    process.argv = ['node', 'script.js'];
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.claimsGraded).toBe(1);
    expect(parsed.byGrade).toBeDefined();
  });

  it('B4: handles Neo4j Integer objects in row values', async () => {
    mockNeoRun.mockResolvedValue([
      { claimId: 'c1', supportGrade: 'runtime_materialized', supportCount: { toNumber: () => 3 }, runtimeSupportHits: { toNumber: () => 1 }, codeLikeSupportHits: { toNumber: () => 2 } },
    ]);
    process.argv = ['node', 'script.js'];
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.claimsGraded).toBe(1);
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

  // SPEC-GAP: Spec doesn't define behavior when neo4j.run throws
  // SPEC-GAP: Spec doesn't mention the SET operations that grade claims in-place on Claim nodes
});
