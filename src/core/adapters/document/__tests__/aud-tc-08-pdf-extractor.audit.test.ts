/**
 * AUD-TC-08-L1-06: pdf-extractor.ts — Behavioral Contract Tests
 *
 * Spec: plans/codegraph/ADAPTER_ROADMAP.md §M2A "Build PDF text extractor (PyMuPDF — already proven on Dataset 10)"
 *
 * Behaviors tested:
 * (1) extractPdfText accepts filePath and returns ExtractedPdfDocument with filePath/fileName/pageCount/pages
 * (2) resolves filePath to absolute and checks R_OK access (throws on missing file)
 * (3) spawns python3 subprocess with inline PyMuPDF script via execFile
 * (4) PyMuPDF script outputs JSON with ok/pageCount/pages array (each with page number and text)
 * (5) handles PyMuPDF import failure: output has ok: false with error message
 * (6) parses stdout JSON and maps to ExtractedPdfPage[] with page/text
 * (7) each ExtractedPdfPage has 1-indexed page number
 * (8) handles empty pages (text="" for pages with no extractable text)
 * (9) throws on python3 not found or non-zero exit code
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs/promises
const mockAccess = vi.fn();

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}));

// Mock child_process with a function that will be set up in beforeEach
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Mock util promisify
vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn, // Return the function itself (it's already mocked)
}));

import { extractPdfText } from '../pdf-extractor.js';
import { execFile } from 'node:child_process';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

describe('[aud-tc-08] pdf-extractor.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined); // Default: file exists
  });

  // Behavior 1: extractPdfText accepts filePath and returns ExtractedPdfDocument
  it('B1: returns ExtractedPdfDocument with correct structure', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 1,
        pages: [{ page: 1, text: 'Page content' }],
      }),
      stderr: '',
    });

    const result = await extractPdfText('/test/doc.pdf');

    expect(result).toHaveProperty('filePath');
    expect(result).toHaveProperty('fileName');
    expect(result).toHaveProperty('pageCount');
    expect(result).toHaveProperty('pages');
    expect(Array.isArray(result.pages)).toBe(true);
  });

  // Behavior 2: resolves filePath to absolute and checks R_OK access
  it('B2: throws on missing file', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

    await expect(extractPdfText('/test/missing.pdf')).rejects.toThrow();
  });

  // Behavior 3: spawns python3 subprocess with inline PyMuPDF script
  it('B3: calls execFile with python3 and inline script', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 1,
        pages: [{ page: 1, text: 'Text' }],
      }),
      stderr: '',
    });

    await extractPdfText('/test/doc.pdf');

    expect(mockExecFile).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining(['-c', expect.stringContaining('import fitz')]),
      expect.objectContaining({ maxBuffer: 20 * 1024 * 1024 }),
    );
  });

  // Behavior 4: PyMuPDF script outputs JSON with ok/pageCount/pages
  it('B4: parses valid JSON output from PyMuPDF', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 3,
        pages: [
          { page: 1, text: 'Page 1 content' },
          { page: 2, text: 'Page 2 content' },
          { page: 3, text: 'Page 3 content' },
        ],
      }),
      stderr: '',
    });

    const result = await extractPdfText('/test/doc.pdf');

    expect(result.pageCount).toBe(3);
    expect(result.pages).toHaveLength(3);
  });

  // Behavior 5: handles PyMuPDF import failure
  it('B5: throws when PyMuPDF import fails', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: false,
        error: 'PyMuPDF import failed: No module named fitz',
      }),
      stderr: '',
    });

    await expect(extractPdfText('/test/doc.pdf')).rejects.toThrow(/PyMuPDF import failed/);
  });

  // Behavior 6: parses stdout JSON and maps to ExtractedPdfPage[]
  it('B6: maps JSON pages to ExtractedPdfPage objects', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 2,
        pages: [
          { page: 1, text: 'First page' },
          { page: 2, text: 'Second page' },
        ],
      }),
      stderr: '',
    });

    const result = await extractPdfText('/test/doc.pdf');

    expect(result.pages[0]).toEqual({ page: 1, text: 'First page' });
    expect(result.pages[1]).toEqual({ page: 2, text: 'Second page' });
  });

  // Behavior 7: each ExtractedPdfPage has 1-indexed page number
  it('B7: page numbers are 1-indexed', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 3,
        pages: [
          { page: 1, text: 'Page 1' },
          { page: 2, text: 'Page 2' },
          { page: 3, text: 'Page 3' },
        ],
      }),
      stderr: '',
    });

    const result = await extractPdfText('/test/doc.pdf');

    expect(result.pages[0].page).toBe(1);
    expect(result.pages[1].page).toBe(2);
    expect(result.pages[2].page).toBe(3);
  });

  // Behavior 8: handles empty pages (text="" for pages with no extractable text)
  it('B8: handles pages with no extractable text', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 2,
        pages: [
          { page: 1, text: 'Content' },
          { page: 2, text: '' },
        ],
      }),
      stderr: '',
    });

    const result = await extractPdfText('/test/doc.pdf');

    expect(result.pages[1].text).toBe('');
  });

  // Behavior 8 (continued): handles null text from PyMuPDF
  it('B8b: converts null text to empty string', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 1,
        pages: [{ page: 1, text: null }],
      }),
      stderr: '',
    });

    const result = await extractPdfText('/test/doc.pdf');

    expect(result.pages[0].text).toBe('');
  });

  // Behavior 9: throws on non-zero exit code
  it('B9: throws on python3 execution failure', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('python3 not found'));

    await expect(extractPdfText('/test/doc.pdf')).rejects.toThrow();
  });

  // Behavior 6 (validation): throws on malformed JSON output
  it('B6b: throws when stdout is not valid JSON', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: 'not valid json',
      stderr: '',
    });

    await expect(extractPdfText('/test/doc.pdf')).rejects.toThrow(/Failed to parse PDF extractor output/);
  });

  // Behavior 1 (validation): returns correct fileName
  it('B1b: returns correct fileName from path', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 1,
        pages: [{ page: 1, text: 'Text' }],
      }),
      stderr: '',
    });

    const result = await extractPdfText('/test/docs/report.pdf');

    expect(result.fileName).toBe('report.pdf');
  });

  // Behavior 2 (validation): resolves relative paths to absolute
  it('B2b: resolves relative path to absolute', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 1,
        pages: [{ page: 1, text: 'Text' }],
      }),
      stderr: '',
    });

    const result = await extractPdfText('doc.pdf');

    expect(result.filePath).toMatch(/^[/\\]/); // Absolute path
  });

  // Behavior 4 (edge case): handles zero-page PDF
  it('B4b: handles zero-page PDF', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 0,
        pages: [],
      }),
      stderr: '',
    });

    const result = await extractPdfText('/test/empty.pdf');

    expect(result.pageCount).toBe(0);
    expect(result.pages).toEqual([]);
  });

  // Behavior 5 (validation): throws with error message from PyMuPDF
  it('B5b: error message includes PyMuPDF error details', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: false,
        error: 'fitz.fitz.FileDataError: cannot open broken document',
      }),
      stderr: '',
    });

    await expect(extractPdfText('/test/doc.pdf')).rejects.toThrow(/cannot open broken document/);
  });

  // Behavior 3 (validation): passes absolute path to python script
  it('B3b: passes absolute file path to python script', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify({
        ok: true,
        pageCount: 1,
        pages: [{ page: 1, text: 'Text' }],
      }),
      stderr: '',
    });

    await extractPdfText('/test/doc.pdf');

    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[1]).toContain('/test/doc.pdf');
  });
});
