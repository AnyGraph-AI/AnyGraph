// AUD-TC-03-L1b-28: document-namespace-audit.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/ADAPTER_ROADMAP.md document namespace isolation

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

const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => { vi.clearAllMocks(); });

async function runModule() {
  vi.resetModules();
  await import('../../../utils/document-namespace-audit.js');
  await new Promise((r) => setTimeout(r, 150));
}

describe('document-namespace-audit audit tests (L1b-28)', () => {
  it('B1: queries all Projects with document-like IRNode/DocumentWitness counts', async () => {
    mockNeoRun.mockResolvedValue([]);
    await runModule();
    expect(mockNeoRun).toHaveBeenCalled();
    const cypher = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher).toContain('Project');
    expect(cypher).toContain('DocumentWitness');
    expect(cypher).toContain('DocumentCollection');
  });

  it('B2: reports per-project metrics', async () => {
    mockNeoRun.mockResolvedValue([{
      projectId: 'proj_doc1', projectType: 'document', sourceKind: 'parser',
      docCollections: 2, docNodes: 10, paragraphs: 50, docWitnesses: 3,
    }]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.findings[0]).toMatchObject({ projectId: 'proj_doc1', docCollections: 2, docNodes: 10 });
  });

  it('B3: writes timestamped + latest artifacts to disk', async () => {
    mockNeoRun.mockResolvedValue([]);
    await runModule();
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining('document-namespace-audit'), { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    expect(mockWriteFileSync.mock.calls.some((c) => String(c[0]).includes('latest.json'))).toBe(true);
  });

  it('B4: handles Neo4j Integer objects via toNum', async () => {
    mockNeoRun.mockResolvedValue([{
      projectId: 'proj_neo', projectType: 'document', sourceKind: 'parser',
      docCollections: { toNumber: () => 5 }, docNodes: { toNumber: () => 20 },
      paragraphs: { toNumber: () => 100 }, docWitnesses: { toNumber: () => 8 },
    }]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.findings[0].docCollections).toBe(5);
    expect(parsed.findings[0].docWitnesses).toBe(8);
  });

  // SPEC-GAP: Spec doesn't mention the nonDocumentNamespaces filter or migration recommendation
});
