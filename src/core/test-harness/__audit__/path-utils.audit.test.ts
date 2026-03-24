// Fork: Drew/Jason origin
// AUD-TC B6 (Health Witness) — path-utils.ts audit tests
// SPEC-GAP: No formal spec exists; behaviors derived from task description and code signatures

import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  normalizeFilePath,
  toRelativePath,
  getCommonRoot,
  isAbsolutePath,
  normalizeForComparison,
} from '../../utils/path-utils';

describe('path-utils audit tests', () => {
  // Behavior 1: normalizeFilePath returns empty string for falsy input
  it('normalizeFilePath returns empty string for falsy input', () => {
    expect(normalizeFilePath('')).toBe('');
    expect(normalizeFilePath(undefined as any)).toBe('');
    expect(normalizeFilePath(null as any)).toBe('');
  });

  // Behavior 2: normalizeFilePath resolves relative paths against cwd
  it('normalizeFilePath resolves relative paths against cwd', () => {
    const result = normalizeFilePath('foo/bar.ts');
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(path.resolve(process.cwd(), 'foo/bar.ts'));
  });

  // Behavior 3: normalizeFilePath normalizes separators and ../. segments
  it('normalizeFilePath normalizes .. and . segments', () => {
    const result = normalizeFilePath('/a/b/../c/./d.ts');
    expect(result).toBe(path.normalize('/a/c/d.ts'));
  });

  // Behavior 4: toRelativePath returns relative path from projectRoot
  it('toRelativePath returns relative path from projectRoot', () => {
    const result = toRelativePath('/project/src/foo.ts', '/project');
    expect(result).toBe(path.join('src', 'foo.ts'));
  });

  // Behavior 5: toRelativePath returns absolute path unchanged when outside root
  it('toRelativePath returns absolute path when outside root', () => {
    const result = toRelativePath('/other/place/foo.ts', '/project');
    expect(result).toBe('/other/place/foo.ts');
  });

  // Behavior 6: toRelativePath handles empty inputs gracefully
  it('toRelativePath handles empty inputs gracefully', () => {
    expect(toRelativePath('', '/project')).toBe('');
    expect(toRelativePath('/project/foo.ts', '')).toBe('/project/foo.ts');
  });

  // Behavior 7: getCommonRoot returns cwd for empty array
  it('getCommonRoot returns cwd for empty array', () => {
    expect(getCommonRoot([])).toBe(process.cwd());
  });

  // Behavior 8: getCommonRoot returns dirname for single file
  it('getCommonRoot returns dirname for single file', () => {
    expect(getCommonRoot(['/a/b/c.ts'])).toBe('/a/b');
  });

  // Behavior 9: getCommonRoot finds longest common prefix for multiple paths
  it('getCommonRoot finds longest common prefix', () => {
    const result = getCommonRoot(['/a/b/c/d.ts', '/a/b/c/e.ts', '/a/b/f/g.ts']);
    expect(result).toBe('/a/b');
  });

  // Behavior 10: isAbsolutePath delegates to path.isAbsolute correctly
  it('isAbsolutePath delegates to path.isAbsolute', () => {
    expect(isAbsolutePath('/foo/bar')).toBe(true);
    expect(isAbsolutePath('foo/bar')).toBe(false);
  });

  // Behavior 11: normalizeForComparison returns empty string for falsy input
  it('normalizeForComparison returns empty string for falsy input', () => {
    expect(normalizeForComparison('')).toBe('');
    expect(normalizeForComparison(undefined as any)).toBe('');
    expect(normalizeForComparison(null as any)).toBe('');
  });

  // SPEC-GAP: No spec for normalizeForComparison behavior on valid paths (just delegates to path.normalize)
  it('normalizeForComparison normalizes a valid path', () => {
    expect(normalizeForComparison('/a/b/../c')).toBe(path.normalize('/a/b/../c'));
  });
});
