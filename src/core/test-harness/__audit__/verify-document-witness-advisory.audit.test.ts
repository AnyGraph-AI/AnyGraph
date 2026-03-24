// AUD-TC-03-L1b-15: verify-document-witness-advisory.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/ADAPTER_ROADMAP.md document witness contract

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

const origEnv = { ...process.env };
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...origEnv };
  delete process.env.DOCUMENT_WITNESS_ENFORCE;
});

async function runModule() {
  vi.resetModules();
  await import('../../../utils/verify-document-witness-advisory.js');
  await new Promise((r) => setTimeout(r, 150));
}

describe('verify-document-witness-advisory audit tests (L1b-15)', () => {
  it('B1: queries materialization tasks, document projects, witnesses, and claim support', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 2, documentProjectCount: 1, witnessCount: 5, claimsSupportedByWitness: 3 }])
      .mockResolvedValueOnce([{ shadowProjects: 0, missingTicket: 0, missingExpiry: 0 }]);
    await runModule();
    expect(mockNeoRun).toHaveBeenCalledTimes(2);
    const cypher1 = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher1).toContain('Task');
    expect(cypher1).toContain("status = 'done'");
    expect(cypher1).toContain('DocumentWitness');
  });

  it('B2: writes timestamped and latest JSON artifacts', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 0, documentProjectCount: 0, witnessCount: 0, claimsSupportedByWitness: 0 }])
      .mockResolvedValueOnce([{ shadowProjects: 0, missingTicket: 0, missingExpiry: 0 }]);
    await runModule();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('document-witness-advisory'), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
  });

  it('B3: reports advisoryOk=true when no done materialization tasks', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 0, documentProjectCount: 0, witnessCount: 0, claimsSupportedByWitness: 0 }])
      .mockResolvedValueOnce([{ shadowProjects: 0, missingTicket: 0, missingExpiry: 0 }]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.advisoryOk).toBe(true);
    expect(parsed.advisoryLevel).toBe('ok');
  });

  it('B3b: reports advisoryOk=false when done tasks exist but no witnesses', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 3, documentProjectCount: 0, witnessCount: 0, claimsSupportedByWitness: 0 }])
      .mockResolvedValueOnce([{ shadowProjects: 0, missingTicket: 0, missingExpiry: 0 }]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.advisoryOk).toBe(false);
    expect(parsed.advisoryLevel).toBe('warn');
  });

  it('B3c: exits with code 1 when enforce=true and advisory not ok', async () => {
    process.env.DOCUMENT_WITNESS_ENFORCE = 'true';
    mockNeoRun
      .mockResolvedValueOnce([{ doneMaterializationTasks: 3, documentProjectCount: 0, witnessCount: 0, claimsSupportedByWitness: 0 }])
      .mockResolvedValueOnce([{ shadowProjects: 0, missingTicket: 0, missingExpiry: 0 }]);
    await runModule();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('B4: handles Neo4j Integer objects via toNum', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{
        doneMaterializationTasks: { toNumber: () => 1 }, documentProjectCount: { toNumber: () => 2 },
        witnessCount: { toNumber: () => 10 }, claimsSupportedByWitness: { toNumber: () => 5 },
      }])
      .mockResolvedValueOnce([{
        shadowProjects: { toNumber: () => 0 }, missingTicket: { toNumber: () => 0 }, missingExpiry: { toNumber: () => 0 },
      }]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.doneMaterializationTasks).toBe(1);
    expect(parsed.witnessCount).toBe(10);
  });

  // SPEC-GAP: Spec doesn't mention DOCUMENT_WITNESS_ENFORCE env var
  // SPEC-GAP: Spec says "advisory only" but impl supports enforce=true exit(1)
  // SPEC-GAP: Spec doesn't mention second query for shadow project exception hygiene
});
