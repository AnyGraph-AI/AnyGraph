// AUD-TC-03-L1b-14: verify-document-namespace-contract.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/ADAPTER_ROADMAP.md document namespace isolation

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNeoRun = vi.fn();
const mockNeoClose = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
}));

const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => { vi.clearAllMocks(); });

async function runModule() {
  vi.resetModules();
  await import('../../../utils/verify-document-namespace-contract.js');
  await new Promise((r) => setTimeout(r, 150));
}

describe('verify-document-namespace-contract audit tests (L1b-14)', () => {
  it('B1: queries non-document projects with doc-like nodes for namespace violations', async () => {
    mockNeoRun.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await runModule();
    expect(mockNeoRun).toHaveBeenCalledTimes(2);
    const cypher1 = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher1).toContain("p.projectType <> 'document'");
    expect(cypher1).toContain('DocumentWitness');
    const cypher2 = String(mockNeoRun.mock.calls[1][0]);
    expect(cypher2).toContain("projectType = 'code'");
  });

  it('B2: produces violation for missing shadow_only annotation', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ projectId: 'proj_bad', projectType: 'code', status: '', expiresAt: '', docLikeCount: 5 }])
      .mockResolvedValueOnce([]);
    await runModule();
    expect(mockExit).toHaveBeenCalledWith(1);
    const errCall = mockErr.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === false; } catch { return false; }
    });
    expect(errCall).toBeDefined();
    const parsed = JSON.parse(String(errCall![0]));
    expect(parsed.details.some((d: any) => d.code === 'missing_shadow_only_annotation')).toBe(true);
  });

  it('B2b: produces violation for expired shadow expiry', async () => {
    mockNeoRun
      .mockResolvedValueOnce([{ projectId: 'proj_exp', projectType: 'code', status: 'shadow_only', expiresAt: '2020-01-01T00:00:00Z', docLikeCount: 3 }])
      .mockResolvedValueOnce([]);
    await runModule();
    expect(mockExit).toHaveBeenCalledWith(1);
    const errCall = mockErr.mock.calls.find((c) => {
      try { const p = JSON.parse(String(c[0])); return p.ok === false; } catch { return false; }
    });
    const parsed = JSON.parse(String(errCall![0]));
    expect(parsed.details.some((d: any) => d.code === 'invalid_or_expired_shadow_expiry')).toBe(true);
  });

  it('B2c: produces violation for document_witness_under_code_project', async () => {
    mockNeoRun.mockResolvedValueOnce([]).mockResolvedValueOnce([{ projectId: 'proj_code', witnessCount: 5 }]);
    await runModule();
    expect(mockExit).toHaveBeenCalledWith(1);
    const errCall = mockErr.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === false; } catch { return false; }
    });
    const parsed = JSON.parse(String(errCall![0]));
    expect(parsed.details.some((d: any) => d.code === 'document_witness_under_code_project')).toBe(true);
  });

  it('B3: reports ok=true when no violations found', async () => {
    mockNeoRun.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
  });

  it('B5: handles Neo4j Integer objects via toNum helper', async () => {
    mockNeoRun.mockResolvedValueOnce([]).mockResolvedValueOnce([{ projectId: 'proj_int', witnessCount: { toNumber: () => 8 } }]);
    await runModule();
    const errCall = mockErr.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === false; } catch { return false; }
    });
    const parsed = JSON.parse(String(errCall![0]));
    expect(parsed.details.some((d: any) => d.details.includes('8'))).toBe(true);
  });

  // SPEC-GAP: Spec doesn't define the 3 specific violation codes
  // SPEC-GAP: Spec doesn't mention the second query for parser code projects
});
