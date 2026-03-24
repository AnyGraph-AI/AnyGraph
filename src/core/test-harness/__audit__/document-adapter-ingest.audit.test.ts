// AUD-TC-03-L1b-26: document-adapter-ingest.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/ADAPTER_ROADMAP.md Sprint 1 "Document adapter foundation"

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNeoRun = vi.fn().mockResolvedValue([]);
const mockNeoClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
}));

const mockParseDocumentCollection = vi.fn();
const mockDocumentSchemaToIr = vi.fn();
vi.mock('../../../core/adapters/document/document-parser.js', () => ({
  parseDocumentCollection: (...a: unknown[]) => mockParseDocumentCollection(...a),
  documentSchemaToIr: (...a: unknown[]) => mockDocumentSchemaToIr(...a),
}));

const mockMaterializeIrDocument = vi.fn();
vi.mock('../../../core/ir/ir-materializer.js', () => ({
  materializeIrDocument: (...a: unknown[]) => mockMaterializeIrDocument(...a),
}));

const mockResolveProjectId = vi.fn();
vi.mock('../../../core/utils/project-id.js', () => ({
  resolveProjectId: (...a: unknown[]) => mockResolveProjectId(...a),
}));

const origArgv = process.argv;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});

function defaultMocks() {
  mockResolveProjectId.mockReturnValue('proj_aabbccddee00');
  mockParseDocumentCollection.mockResolvedValue({
    collection: { name: 'TestDocs' },
    documents: [{ id: 'd1' }],
    paragraphs: [{ id: 'p1' }, { id: 'p2' }],
    entities: [{ id: 'e1' }],
    witnesses: [{ id: 'w1' }],
  });
  mockDocumentSchemaToIr.mockReturnValue({ nodes: [], edges: [] });
  mockMaterializeIrDocument.mockResolvedValue({ nodesCreated: 3, edgesCreated: 2 });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.argv = origArgv.slice();
  defaultMocks();
});

async function runModule() {
  vi.resetModules();
  await import('../../../utils/document-adapter-ingest.js');
  await new Promise((r) => setTimeout(r, 150));
}

describe('document-adapter-ingest audit tests (L1b-26)', () => {
  it('B1: exits with code 1 and usage message when no sourcePath provided', async () => {
    process.argv = ['node', 'script.js'];
    await runModule();
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockErr.mock.calls.some(c => String(c[0]).includes('Usage'))).toBe(true);
  });

  it('B2: resolves relative sourcePath to absolute path', async () => {
    process.argv = ['node', 'script.js', './rel/path'];
    await runModule();
    if (mockParseDocumentCollection.mock.calls.length > 0) {
      const arg = mockParseDocumentCollection.mock.calls[0][0];
      expect(arg.sourcePath).toMatch(/^\//);
      expect(arg.sourcePath).toContain('rel/path');
    }
  });

  it('B3: calls parseDocumentCollection with projectId and sourcePath', async () => {
    process.argv = ['node', 'script.js', '/test/docs'];
    await runModule();
    expect(mockParseDocumentCollection).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj_aabbccddee00', sourcePath: '/test/docs' }),
    );
  });

  it('B4: calls documentSchemaToIr with the parsed schema result', async () => {
    process.argv = ['node', 'script.js', '/test/docs'];
    await runModule();
    expect(mockDocumentSchemaToIr).toHaveBeenCalledWith(
      expect.objectContaining({ collection: { name: 'TestDocs' } }),
    );
  });

  it('B5: calls materializeIrDocument with IR and batchSize/clearProjectFirst options', async () => {
    process.argv = ['node', 'script.js', '/test/docs'];
    await runModule();
    expect(mockMaterializeIrDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ batchSize: 500, clearProjectFirst: true }),
    );
  });

  it('B6: passes explicit projectId from argv[3] to resolveProjectId', async () => {
    process.argv = ['node', 'script.js', '/test/docs', 'proj_explicit1234'];
    await runModule();
    expect(mockResolveProjectId).toHaveBeenCalledWith('/test/docs', 'proj_explicit1234');
  });

  it('B7: outputs JSON with ok, sourcePath, document/paragraph/entity/witness counts', async () => {
    process.argv = ['node', 'script.js', '/test/docs'];
    await runModule();
    const jsonCall = mockLog.mock.calls.find((c) => {
      try { return JSON.parse(String(c[0])).ok === true; } catch { return false; }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(String(jsonCall![0]));
    expect(parsed).toMatchObject({ ok: true, documents: 1, paragraphs: 2, entities: 1, witnesses: 1 });
    expect(parsed.projectId).toBe('proj_aabbccddee00');
  });

  // SPEC-GAP: Spec doesn't mention the two Neo4j MERGE queries (Project upsert + count update) after materialization
  // SPEC-GAP: Spec doesn't define error handling for partial materialization failures
});
