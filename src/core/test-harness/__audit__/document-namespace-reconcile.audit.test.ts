// AUD-TC-03-L1b-29: document-namespace-reconcile.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/ADAPTER_ROADMAP.md document namespace reconciliation

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNeoRun = vi.fn();
const mockNeoClose = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
}));

const origEnv = { ...process.env };
vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...origEnv };
  delete process.env.DOCUMENT_SHADOW_EXPIRES_DAYS;
});

async function runModule() {
  vi.resetModules();
  await import('../../../utils/document-namespace-reconcile.js');
  await new Promise((r) => setTimeout(r, 150));
}

describe('document-namespace-reconcile audit tests (L1b-29)', () => {
  it('B1: computes expiry date ~30 days in the future by default', async () => {
    mockNeoRun.mockResolvedValue([]);
    await runModule();
    const params = mockNeoRun.mock.calls[0][1];
    const diffDays = (new Date(params.expiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(28);
    expect(diffDays).toBeLessThan(32);
  });

  it('B1b: respects custom DOCUMENT_SHADOW_EXPIRES_DAYS', async () => {
    process.env.DOCUMENT_SHADOW_EXPIRES_DAYS = '7';
    mockNeoRun.mockResolvedValue([]);
    await runModule();
    const params = mockNeoRun.mock.calls[0][1];
    const diffDays = (new Date(params.expiry).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(5);
    expect(diffDays).toBeLessThan(9);
  });

  it('B2: queries non-document projects and sets shadow_only status', async () => {
    mockNeoRun.mockResolvedValue([{
      projectId: 'proj_stale', projectType: 'code', sourceKind: 'parser',
      documentNamespaceStatus: 'shadow_only', documentNamespaceExpiresAt: '2026-04-30', docLikeCount: 5,
    }]);
    await runModule();
    const cypher = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher).toContain("p.projectType <> 'document'");
    expect(cypher).toContain('shadow_only');
  });

  it('B3: outputs JSON with ok, updatedProjects, and project list', async () => {
    mockNeoRun.mockResolvedValue([{
      projectId: 'proj_a', projectType: 'code', sourceKind: 'parser',
      documentNamespaceStatus: 'shadow_only', documentNamespaceExpiresAt: '2026-05-01', docLikeCount: 3,
    }]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.updatedProjects).toBe(1);
    expect(parsed.projects[0].projectId).toBe('proj_a');
  });

  it('B4: handles Neo4j Integer objects in docLikeCount', async () => {
    mockNeoRun.mockResolvedValue([{
      projectId: 'proj_int', projectType: 'code', sourceKind: 'parser',
      documentNamespaceStatus: 'shadow_only', documentNamespaceExpiresAt: '2026-05-01',
      docLikeCount: { toNumber: () => 42 },
    }]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.projects[0].docLikeCount).toBe(42);
  });

  // SPEC-GAP: Spec doesn't mention DL-3 ticket assignment
  // SPEC-GAP: Spec doesn't define behavior when DOCUMENT_SHADOW_EXPIRES_DAYS is 0 (impl uses Math.max(1,...))
});
