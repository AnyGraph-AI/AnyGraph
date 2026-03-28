/**
 * AUD-TC-08-L1-07: text-ingester.ts — Behavioral Contract Tests
 *
 * Spec: plans/codegraph/ADAPTER_ROADMAP.md §M2A "Build plain text ingester (markdown, txt, csv → paragraphs)"
 *
 * Behaviors tested:
 * (1) ingestPlainText accepts filePath and returns ExtractedTextDocument
 * (2) resolves filePath to absolute via path.resolve
 * (3) reads file content as UTF-8 via readFile
 * (4) splits content into paragraphs via splitParagraphs from utils (double-newline separated)
 * (5) returns filePath (absolute), fileName (basename), extension (lowercase), paragraphs array
 * (6) empty file produces empty paragraphs array
 * (7) handles various extensions (.txt, .md, .csv, .json, .log)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs/promises
const mockReadFile = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import { ingestPlainText } from '../text-ingester.js';

describe('[aud-tc-08] text-ingester.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Behavior 1: ingestPlainText accepts filePath and returns ExtractedTextDocument
  it('B1: returns ExtractedTextDocument with correct structure', async () => {
    mockReadFile.mockResolvedValueOnce('Paragraph 1.\n\nParagraph 2.');

    const result = await ingestPlainText('/test/doc.txt');

    expect(result).toHaveProperty('filePath');
    expect(result).toHaveProperty('fileName');
    expect(result).toHaveProperty('extension');
    expect(result).toHaveProperty('paragraphs');
    expect(Array.isArray(result.paragraphs)).toBe(true);
  });

  // Behavior 2: resolves filePath to absolute via path.resolve
  it('B2: resolves relative paths to absolute', async () => {
    mockReadFile.mockResolvedValueOnce('Content');

    const result = await ingestPlainText('doc.txt');

    expect(result.filePath).toMatch(/^[/\\]/); // Starts with / or \ (absolute)
  });

  // Behavior 3: reads file content as UTF-8 via readFile
  it('B3: reads file content correctly', async () => {
    mockReadFile.mockResolvedValueOnce('First paragraph.\n\nSecond paragraph.');

    const result = await ingestPlainText('/test/doc.txt');

    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs[0]).toBe('First paragraph.');
    expect(result.paragraphs[1]).toBe('Second paragraph.');
  });

  // Behavior 4: splits content into paragraphs via splitParagraphs (double-newline separated)
  it('B4: splits paragraphs on double-newline', async () => {
    mockReadFile.mockResolvedValueOnce('Para 1.\n\nPara 2.\n\nPara 3.');

    const result = await ingestPlainText('/test/doc.txt');

    expect(result.paragraphs).toHaveLength(3);
    expect(result.paragraphs).toEqual(['Para 1.', 'Para 2.', 'Para 3.']);
  });

  // Behavior 5: returns filePath (absolute), fileName (basename), extension (lowercase), paragraphs array
  it('B5: returns correct filePath, fileName, and extension', async () => {
    mockReadFile.mockResolvedValueOnce('Content.');

    const result = await ingestPlainText('/test/docs/example.TXT');

    expect(result.filePath).toMatch(/\/test\/docs\/example\.TXT$/);
    expect(result.fileName).toBe('example.TXT');
    expect(result.extension).toBe('.txt'); // Lowercase
  });

  // Behavior 6: empty file produces empty paragraphs array
  it('B6: handles empty file gracefully', async () => {
    mockReadFile.mockResolvedValueOnce('');

    const result = await ingestPlainText('/test/empty.txt');

    expect(result.paragraphs).toEqual([]);
  });

  // Behavior 6 (continued): whitespace-only file produces empty paragraphs array
  it('B6b: handles whitespace-only file', async () => {
    mockReadFile.mockResolvedValueOnce('   \n\n  \n  ');

    const result = await ingestPlainText('/test/whitespace.txt');

    expect(result.paragraphs).toEqual([]);
  });

  // Behavior 7: handles various extensions (.txt, .md, .csv, .json, .log)
  it('B7: handles .txt extension', async () => {
    mockReadFile.mockResolvedValueOnce('Text content.');

    const result = await ingestPlainText('/test/file.txt');

    expect(result.extension).toBe('.txt');
    expect(result.paragraphs).toHaveLength(1);
  });

  it('B7b: handles .md extension', async () => {
    mockReadFile.mockResolvedValueOnce('# Title\n\nMarkdown paragraph.');

    const result = await ingestPlainText('/test/README.md');

    expect(result.extension).toBe('.md');
    expect(result.paragraphs).toHaveLength(2);
    expect(result.paragraphs[0]).toBe('# Title');
    expect(result.paragraphs[1]).toBe('Markdown paragraph.');
  });

  it('B7c: handles .csv extension', async () => {
    mockReadFile.mockResolvedValueOnce('col1,col2\nval1,val2');

    const result = await ingestPlainText('/test/data.csv');

    expect(result.extension).toBe('.csv');
    expect(result.paragraphs).toHaveLength(1);
  });

  it('B7d: handles .json extension', async () => {
    mockReadFile.mockResolvedValueOnce('{"key": "value"}');

    const result = await ingestPlainText('/test/config.json');

    expect(result.extension).toBe('.json');
    expect(result.paragraphs).toHaveLength(1);
  });

  it('B7e: handles .log extension', async () => {
    mockReadFile.mockResolvedValueOnce('[INFO] Log entry 1.\n\n[ERROR] Log entry 2.');

    const result = await ingestPlainText('/test/app.log');

    expect(result.extension).toBe('.log');
    expect(result.paragraphs).toHaveLength(2);
  });

  // Behavior 4 (edge case): single paragraph with no double-newline
  it('B4b: handles single paragraph with no separator', async () => {
    mockReadFile.mockResolvedValueOnce('Single paragraph with no breaks.');

    const result = await ingestPlainText('/test/single.txt');

    expect(result.paragraphs).toHaveLength(1);
    expect(result.paragraphs[0]).toBe('Single paragraph with no breaks.');
  });

  // Behavior 3 (validation): throws on missing file
  it('B3b: throws error when file does not exist', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

    await expect(ingestPlainText('/test/missing.txt')).rejects.toThrow();
  });

  // Behavior 5 (validation): handles files with no extension
  it('B5b: handles files with no extension', async () => {
    mockReadFile.mockResolvedValueOnce('Content.');

    const result = await ingestPlainText('/test/README');

    expect(result.extension).toBe('');
    expect(result.fileName).toBe('README');
  });
});
