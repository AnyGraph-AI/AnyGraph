// Fork: Drew/Jason origin
// AUD-TC B6 (Health Witness) — file-utils.ts audit tests
// SPEC-GAP: No formal spec exists; behaviors derived from task description and code signatures

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// Mock fs/promises at module level for ESM compatibility
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    appendFile: vi.fn().mockResolvedValue(undefined),
  };
});

import { hashFile, debugLog, matchesPattern, cleanTypeName } from '../../utils/file-utils';

describe('file-utils audit tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Behavior 1: hashFile returns SHA256 hex digest of file contents
  it('hashFile returns SHA256 hex digest of file contents', async () => {
    const tmpDir = await (await vi.importActual<typeof import('fs/promises')>('fs/promises')).mkdtemp(
      path.join(os.tmpdir(), 'audit-'),
    );
    const tmpFile = path.join(tmpDir, 'test.txt');
    const content = 'hello world';
    await (await vi.importActual<typeof import('fs/promises')>('fs/promises')).writeFile(tmpFile, content);

    const result = await hashFile(tmpFile);
    const expected = crypto.createHash('sha256').update(Buffer.from(content)).digest('hex');
    expect(result).toBe(expected);

    await (await vi.importActual<typeof import('fs/promises')>('fs/promises')).rm(tmpDir, { recursive: true });
  });

  // Behavior 2: hashFile returns same hash for same file content
  it('hashFile returns same hash for same file content', async () => {
    const actualFs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    const tmpDir = await actualFs.mkdtemp(path.join(os.tmpdir(), 'audit-'));
    const file1 = path.join(tmpDir, 'a.txt');
    const file2 = path.join(tmpDir, 'b.txt');
    await actualFs.writeFile(file1, 'identical content');
    await actualFs.writeFile(file2, 'identical content');

    const hash1 = await hashFile(file1);
    const hash2 = await hashFile(file2);
    expect(hash1).toBe(hash2);

    await actualFs.rm(tmpDir, { recursive: true });
  });

  // Behavior 3: debugLog appends timestamped entry to LOG_CONFIG.debugLogFile
  it('debugLog appends timestamped JSON entry', async () => {
    const mockAppendFile = vi.mocked(fs.appendFile);
    mockAppendFile.mockResolvedValue(undefined);

    await debugLog('test message', { key: 'value' });

    expect(mockAppendFile).toHaveBeenCalledOnce();
    const [filePath, content] = mockAppendFile.mock.calls[0] as [string, string];
    expect(filePath).toContain('debug-search.log');
    expect(content).toContain('test message');
    expect(content).toContain('"key"');
    // Should have ISO timestamp
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
  });

  // Behavior 4: debugLog does not throw when log file write fails
  it('debugLog does not throw when log file write fails', async () => {
    const mockAppendFile = vi.mocked(fs.appendFile);
    mockAppendFile.mockRejectedValue(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(debugLog('test')).resolves.toBeUndefined();
  });

  // Behavior 5: matchesPattern returns true for literal string match
  it('matchesPattern returns true for literal string match', () => {
    expect(matchesPattern('/src/foo/bar.ts', 'foo/bar')).toBe(true);
  });

  // Behavior 6: matchesPattern returns true for regex match
  it('matchesPattern returns true for regex match', () => {
    expect(matchesPattern('/src/foo/bar.ts', '\\.ts$')).toBe(true);
  });

  // Behavior 7: matchesPattern returns false for invalid regex (falls back to includes)
  it('matchesPattern returns false for invalid regex when includes also fails', () => {
    // '[' is invalid regex, and not literally in the path
    expect(matchesPattern('/src/foo/bar.ts', '[invalid')).toBe(false);
  });

  // SPEC-GAP: matchesPattern with invalid regex that IS a literal substring — unclear if intended
  it('matchesPattern with invalid regex that is a literal substring returns true', () => {
    expect(matchesPattern('/src/foo[bar/baz.ts', 'foo[bar')).toBe(true);
  });

  // Behavior 8: cleanTypeName strips import("..."). prefix
  it('cleanTypeName strips import("..."). prefix', () => {
    expect(cleanTypeName('import("./foo").ClassName')).toBe('ClassName');
  });

  // Behavior 9: cleanTypeName strips generic parameters
  it('cleanTypeName strips generic parameters', () => {
    expect(cleanTypeName('ClassName<T>')).toBe('ClassName');
    expect(cleanTypeName('Map<string, number>')).toBe('Map');
  });

  // Behavior 10: cleanTypeName strips array notation
  it('cleanTypeName strips array notation', () => {
    expect(cleanTypeName('ClassName[]')).toBe('ClassName');
  });

  // Combined case
  it('cleanTypeName handles combined import + generic + array', () => {
    expect(cleanTypeName('import("./mod").Foo<T>[]')).toBe('Foo');
  });
});
