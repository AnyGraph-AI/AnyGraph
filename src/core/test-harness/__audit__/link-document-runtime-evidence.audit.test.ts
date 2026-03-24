// AUD-TC-03-L1b-47: link-document-runtime-evidence.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/ADAPTER_ROADMAP.md evidence linking

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNeoRun = vi.fn();
const mockNeoClose = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
}));

vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => { vi.clearAllMocks(); });

async function runModule() {
  vi.resetModules();
  await import('../../../utils/link-document-runtime-evidence.js');
  await new Promise((r) => setTimeout(r, 150));
}

describe('link-document-runtime-evidence audit tests (L1b-47)', () => {
  it('B1: queries for task by exact TARGET_TASK name', async () => {
    mockNeoRun.mockResolvedValue([{ linkedNodes: 5, documentProjects: 1 }]);
    await runModule();
    expect(mockNeoRun).toHaveBeenCalled();
    const cypher = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher).toContain('Task');
    expect(cypher).toContain('$taskName');
    expect(mockNeoRun.mock.calls[0][1].taskName).toContain('Link runtime ingest artifacts');
  });

  it('B2: matches DocumentWitness, DocumentNode, DocumentCollection, and Paragraph nodes', async () => {
    mockNeoRun.mockResolvedValue([{ linkedNodes: 10, documentProjects: 2 }]);
    await runModule();
    const cypher = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher).toContain('DocumentWitness');
    expect(cypher).toContain('DocumentNode');
    expect(cypher).toContain('DocumentCollection');
    expect(cypher).toContain('Paragraph');
  });

  it('B3: creates HAS_CODE_EVIDENCE edges via MERGE', async () => {
    mockNeoRun.mockResolvedValue([{ linkedNodes: 3, documentProjects: 1 }]);
    await runModule();
    const cypher = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher).toContain('HAS_CODE_EVIDENCE');
    expect(cypher).toContain('MERGE');
  });

  it('B4: sets confidence=high and source=runtime_document_ingest on edges', async () => {
    mockNeoRun.mockResolvedValue([{ linkedNodes: 3, documentProjects: 1 }]);
    await runModule();
    const cypher = String(mockNeoRun.mock.calls[0][0]);
    expect(cypher).toContain("'high'");
    expect(cypher).toContain("'runtime_document_ingest'");
    // SPEC-GAP: Spec says source='document_runtime_link' but impl uses 'runtime_document_ingest'
  });

  it('B5: outputs JSON with ok, taskName, documentProjects, linkedNodes', async () => {
    mockNeoRun.mockResolvedValue([{ linkedNodes: 15, documentProjects: 3 }]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed).toMatchObject({ ok: true, linkedNodes: 15, documentProjects: 3 });
  });

  it('B5b: handles Neo4j Integer objects in counts', async () => {
    mockNeoRun.mockResolvedValue([{
      linkedNodes: { toNumber: () => 7 }, documentProjects: { toNumber: () => 2 },
    }]);
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed.linkedNodes).toBe(7);
    expect(parsed.documentProjects).toBe(2);
  });

  // SPEC-GAP: Spec says source='document_runtime_link' but code uses 'runtime_document_ingest'
  // SPEC-GAP: Spec doesn't mention refType='file_path' on edges
});
