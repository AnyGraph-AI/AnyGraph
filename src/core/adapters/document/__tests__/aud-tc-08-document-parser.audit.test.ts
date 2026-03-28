/**
 * AUD-TC-08-L1-01: document-parser.ts — Behavioral Contract Tests
 *
 * Spec: plans/codegraph/ADAPTER_ROADMAP.md §Milestone 2 "Document Adapter"
 *
 * Strategy: Mock sibling modules (pdf-extractor, text-ingester, entity-extractor,
 * llm-entity-extractor) at the module boundary. Only mock node:fs/promises for
 * stat/readdir which document-parser.ts uses directly for file discovery.
 * This tests the ORCHESTRATION logic without re-testing extractors.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock sibling modules ──────────────────────────────────────────────
const mockExtractPdfText = vi.fn();
vi.mock('../pdf-extractor.js', () => ({
  extractPdfText: (...args: unknown[]) => mockExtractPdfText(...args),
}));

const mockIngestPlainText = vi.fn();
vi.mock('../text-ingester.js', () => ({
  ingestPlainText: (...args: unknown[]) => mockIngestPlainText(...args),
}));

const mockExtractEntities = vi.fn();
vi.mock('../entity-extractor.js', () => ({
  extractEntities: (...args: unknown[]) => mockExtractEntities(...args),
}));

const mockExtractEntitiesWithLlm = vi.fn();
vi.mock('../llm-entity-extractor.js', () => ({
  extractEntitiesWithLlm: (...args: unknown[]) => mockExtractEntitiesWithLlm(...args),
}));

// ── Mock node:fs/promises (stat + readdir only) ──────────────────────
const mockStat = vi.fn();
const mockReaddir = vi.fn();
vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
}));

import { parseDocumentCollection, documentSchemaToIr } from '../document-parser.js';

// ── Helpers ───────────────────────────────────────────────────────────
function dirStat() {
  return { isDirectory: () => true, isFile: () => false };
}
function fileStat() {
  return { isDirectory: () => false, isFile: () => true };
}
function dirEntry(name: string) {
  return { name, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
}
function fileEntry(name: string) {
  return { name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
}

describe('[aud-tc-08] document-parser.ts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset all mock implementations and queued values
    mockStat.mockReset();
    mockReaddir.mockReset();
    mockExtractPdfText.mockReset();
    mockIngestPlainText.mockReset();
    mockExtractEntities.mockReset();
    mockExtractEntitiesWithLlm.mockReset();

    // Default: extractEntities returns empty, LLM returns empty
    mockExtractEntities.mockReturnValue([]);
    mockExtractEntitiesWithLlm.mockResolvedValue([]);
  });

  // ── B1: accepts ParseDocumentCollectionOptions ──────────────────────
  it('B1: accepts options with projectId, sourcePath, collectionName, enableLlmEntityExtraction', async () => {
    // Directory with one .txt file
    mockStat
      .mockResolvedValueOnce(dirStat())   // collectFiles: stat(sourcePath)
      .mockResolvedValueOnce(dirStat());  // parseDocumentCollection: stat(sourcePath) for sourceType
    mockReaddir.mockResolvedValueOnce([fileEntry('notes.txt')]);
    mockIngestPlainText.mockResolvedValueOnce({ filePath: '/docs/notes.txt', fileName: 'notes.txt', extension: '.txt', paragraphs: ['Hello'] });

    const result = await parseDocumentCollection({
      projectId: 'proj_test',
      sourcePath: '/docs',
      collectionName: 'Test Collection',
      enableLlmEntityExtraction: false,
    });

    expect(result).toHaveProperty('collection');
    expect(result).toHaveProperty('documents');
    expect(result).toHaveProperty('paragraphs');
    expect(result).toHaveProperty('entities');
    expect(result).toHaveProperty('witnesses');
    expect(result.collection.name).toBe('Test Collection');
    expect(result.collection.projectId).toBe('proj_test');
  });

  // ── B2: collectFiles recursively discovers files ────────────────────
  it('B2: discovers files recursively through subdirectories', async () => {
    mockStat
      .mockResolvedValueOnce(dirStat())   // collectFiles: /docs
      .mockResolvedValueOnce(dirStat())   // collectFiles recurse: /docs/sub
      .mockResolvedValueOnce(dirStat());  // sourceType check

    mockReaddir
      .mockResolvedValueOnce([fileEntry('a.txt'), dirEntry('sub')])  // /docs
      .mockResolvedValueOnce([fileEntry('b.txt')]);                   // /docs/sub

    mockIngestPlainText
      .mockResolvedValueOnce({ filePath: '/docs/a.txt', fileName: 'a.txt', extension: '.txt', paragraphs: ['A'] })
      .mockResolvedValueOnce({ filePath: '/docs/sub/b.txt', fileName: 'b.txt', extension: '.txt', paragraphs: ['B'] });

    const result = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs' });

    expect(result.documents).toHaveLength(2);
  });

  // ── B2b: single file as sourcePath ──────────────────────────────────
  it('B2b: handles single file as sourcePath', async () => {
    mockStat
      .mockResolvedValueOnce(fileStat())   // collectFiles: stat → isFile → return [path]
      .mockResolvedValueOnce(fileStat());  // sourceType check → 'single-file'

    mockIngestPlainText.mockResolvedValueOnce({
      filePath: '/docs/single.txt', fileName: 'single.txt', extension: '.txt', paragraphs: ['Content'],
    });

    const result = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs/single.txt' });

    expect(result.collection.sourceType).toBe('single-file');
    expect(result.documents).toHaveLength(1);
  });

  // ── B3: PDF files are processed via extractPdfText ──────────────────
  it('B3: processes PDF files via extractPdfText', async () => {
    mockStat
      .mockResolvedValueOnce(dirStat())
      .mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([fileEntry('report.pdf')]);

    mockExtractPdfText.mockResolvedValueOnce({
      filePath: '/docs/report.pdf',
      fileName: 'report.pdf',
      pageCount: 2,
      pages: [
        { page: 1, text: 'Page one content.' },
        { page: 2, text: 'Page two content.' },
      ],
    });

    const result = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs' });

    expect(mockExtractPdfText).toHaveBeenCalledTimes(1);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].extension).toBe('.pdf');
    expect(result.documents[0].pageCount).toBe(2);
    expect(result.paragraphs.length).toBeGreaterThan(0);
  });

  // ── B4: text files processed via ingestPlainText ────────────────────
  it('B4: processes .txt/.md/.csv/.json/.log via ingestPlainText', async () => {
    mockStat
      .mockResolvedValueOnce(dirStat())
      .mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([fileEntry('data.txt')]);

    mockIngestPlainText.mockResolvedValueOnce({
      filePath: '/docs/data.txt', fileName: 'data.txt', extension: '.txt',
      paragraphs: ['Para 1', 'Para 2'],
    });

    const result = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs' });

    expect(mockIngestPlainText).toHaveBeenCalledTimes(1);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].extension).toBe('.txt');
    expect(result.paragraphs).toHaveLength(2);
  });

  // ── B5: non-text/non-PDF files are skipped ──────────────────────────
  it('B5: skips unsupported file types (.png, .mp4, .exe)', async () => {
    mockStat
      .mockResolvedValueOnce(dirStat())
      .mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([
      fileEntry('data.txt'),
      fileEntry('image.png'),
      fileEntry('video.mp4'),
    ]);

    mockIngestPlainText.mockResolvedValueOnce({
      filePath: '/docs/data.txt', fileName: 'data.txt', extension: '.txt',
      paragraphs: ['Content'],
    });

    const result = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs' });

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].extension).toBe('.txt');
    // extractPdfText should not be called (no PDFs)
    expect(mockExtractPdfText).not.toHaveBeenCalled();
    // ingestPlainText called once (only .txt)
    expect(mockIngestPlainText).toHaveBeenCalledTimes(1);
  });

  // ── B6: DocumentNode with deterministic id and contentHash ──────────
  it('B6: creates DocumentNode with deterministic id and SHA256 contentHash', async () => {
    const setup = () => {
      mockStat.mockResolvedValueOnce(dirStat()).mockResolvedValueOnce(dirStat());
      mockReaddir.mockResolvedValueOnce([fileEntry('doc.txt')]);
      mockIngestPlainText.mockResolvedValueOnce({
        filePath: '/docs/doc.txt', fileName: 'doc.txt', extension: '.txt',
        paragraphs: ['Stable content'],
      });
    };

    setup();
    const r1 = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs' });

    vi.clearAllMocks();
    mockExtractEntities.mockReturnValue([]);
    mockExtractEntitiesWithLlm.mockResolvedValue([]);

    setup();
    const r2 = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs' });

    // Deterministic: same inputs → same id
    expect(r1.documents[0].id).toBe(r2.documents[0].id);
    // id format: 20-char hex (MD5 truncated from deterministicId)
    expect(r1.documents[0].id).toMatch(/^[0-9a-f]{20}$/);
    // contentHash: SHA256 hex
    expect(r1.documents[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    // paragraphCount matches
    expect(r1.documents[0].paragraphCount).toBe(1);
  });

  // ── B7: paragraphs with sequential 1-indexed ordinals ───────────────
  it('B7: assigns sequential ordinals to paragraphs (1-indexed)', async () => {
    mockStat.mockResolvedValueOnce(dirStat()).mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([fileEntry('multi.txt')]);
    mockIngestPlainText.mockResolvedValueOnce({
      filePath: '/docs/multi.txt', fileName: 'multi.txt', extension: '.txt',
      paragraphs: ['First', 'Second', 'Third'],
    });

    const result = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs' });

    expect(result.paragraphs).toHaveLength(3);
    expect(result.paragraphs[0].ordinal).toBe(1);
    expect(result.paragraphs[1].ordinal).toBe(2);
    expect(result.paragraphs[2].ordinal).toBe(3);
  });

  // ── B8: entity extraction runs on each paragraph ────────────────────
  it('B8: calls extractEntities for each paragraph', async () => {
    mockStat.mockResolvedValueOnce(dirStat()).mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([fileEntry('ner.txt')]);
    mockIngestPlainText.mockResolvedValueOnce({
      filePath: '/docs/ner.txt', fileName: 'ner.txt', extension: '.txt',
      paragraphs: ['Para one', 'Para two'],
    });

    mockExtractEntities
      .mockReturnValueOnce([{ id: 'e1', kind: 'email', value: 'a@b.com', extractor: 'regex', confidence: 1 }])
      .mockReturnValueOnce([]);

    const result = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs' });

    expect(mockExtractEntities).toHaveBeenCalledTimes(2);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].kind).toBe('email');
  });

  // ── B9: LLM entity extraction when enabled ──────────────────────────
  it('B9: calls extractEntitiesWithLlm when enableLlmEntityExtraction=true', async () => {
    mockStat.mockResolvedValueOnce(dirStat()).mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([fileEntry('llm.txt')]);
    mockIngestPlainText.mockResolvedValueOnce({
      filePath: '/docs/llm.txt', fileName: 'llm.txt', extension: '.txt',
      paragraphs: ['Ambiguous entity'],
    });

    mockExtractEntitiesWithLlm.mockResolvedValueOnce([
      { id: 'llm1', kind: 'person', value: 'Jane Doe', extractor: 'llm', confidence: 0.85 },
    ]);

    const result = await parseDocumentCollection({
      projectId: 'p', sourcePath: '/docs', enableLlmEntityExtraction: true,
    });

    expect(mockExtractEntitiesWithLlm).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Ambiguous entity' }),
      expect.any(Array),
      { enabled: true },
    );
    expect(result.entities.some((e) => e.extractor === 'llm')).toBe(true);
  });

  // ── B10: collection name from options or directory basename ──────────
  it('B10a: uses collectionName from options when provided', async () => {
    mockStat.mockResolvedValueOnce(dirStat()).mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([]);

    const result = await parseDocumentCollection({
      projectId: 'p', sourcePath: '/docs/subdir', collectionName: 'Custom',
    });

    expect(result.collection.name).toBe('Custom');
  });

  it('B10b: falls back to directory basename when collectionName not provided', async () => {
    mockStat.mockResolvedValueOnce(dirStat()).mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([]);

    const result = await parseDocumentCollection({
      projectId: 'p', sourcePath: '/data/my-corpus',
    });

    expect(result.collection.name).toBe('my-corpus');
  });

  // ── B11: documentSchemaToIr produces valid IrDocument ───────────────
  it('B11: documentSchemaToIr converts schema to IrDocument with correct structure', async () => {
    mockStat.mockResolvedValueOnce(dirStat()).mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([fileEntry('doc.txt')]);
    mockIngestPlainText.mockResolvedValueOnce({
      filePath: '/docs/doc.txt', fileName: 'doc.txt', extension: '.txt',
      paragraphs: ['Content here'],
    });

    const schema = await parseDocumentCollection({ projectId: 'p', sourcePath: '/docs' });
    const ir = documentSchemaToIr(schema);

    expect(ir.version).toBe('ir.v1');
    expect(ir.projectId).toBe('p');
    expect(ir.sourceKind).toBe('document');
    expect(Array.isArray(ir.nodes)).toBe(true);
    expect(Array.isArray(ir.edges)).toBe(true);

    // IR uses type='Artifact'|'Site'|'Entity', kind= specific type
    const nodeKinds = ir.nodes.map((n) => n.kind);
    expect(nodeKinds).toContain('DocumentCollection');
    expect(nodeKinds).toContain('DocumentNode');
    expect(nodeKinds).toContain('Paragraph');
    expect(nodeKinds).toContain('DocumentWitness');
    // IR types: Artifact (collection, doc, witness), Site (paragraph)
    const nodeTypes = ir.nodes.map((n) => n.type);
    expect(nodeTypes).toContain('Artifact');
    expect(nodeTypes).toContain('Site');
  });

  // ── B12: DocumentWitness per document ───────────────────────────────
  it('B12: creates DocumentWitness for each document with SHA256 witnessId', async () => {
    mockStat.mockResolvedValueOnce(dirStat()).mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([fileEntry('a.txt'), fileEntry('b.md')]);
    mockIngestPlainText
      .mockResolvedValueOnce({ filePath: '/d/a.txt', fileName: 'a.txt', extension: '.txt', paragraphs: ['A'] })
      .mockResolvedValueOnce({ filePath: '/d/b.md', fileName: 'b.md', extension: '.md', paragraphs: ['B'] });

    const result = await parseDocumentCollection({ projectId: 'p', sourcePath: '/d' });

    expect(result.witnesses).toHaveLength(2);
    expect(result.witnesses[0].witnessId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.witnesses[1].witnessId).toMatch(/^[0-9a-f]{64}$/);
    // Each witness references its document
    expect(result.witnesses[0].documentId).toBe(result.documents[0].id);
    expect(result.witnesses[1].documentId).toBe(result.documents[1].id);
  });

  // ── B13: empty directory produces 0 documents ───────────────────────
  it('B13: handles empty directory gracefully', async () => {
    mockStat.mockResolvedValueOnce(dirStat()).mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([]);

    const result = await parseDocumentCollection({ projectId: 'p', sourcePath: '/empty' });

    expect(result.collection).toBeDefined();
    expect(result.collection.sourceType).toBe('directory');
    expect(result.documents).toEqual([]);
    expect(result.paragraphs).toEqual([]);
    expect(result.entities).toEqual([]);
    expect(result.witnesses).toEqual([]);
  });
});
