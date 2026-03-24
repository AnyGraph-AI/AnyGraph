/**
 * AUD-TC B6: src/core/utils/shared-utils.ts — Behavioral Audit Tests
 * Fork: Drew/Jason origin
 *
 * Spec source: No formal spec — fork code. Dead code and duplicate detection utilities.
 * Accept: 11 behavioral assertions, all green
 */
import { describe, it, expect } from 'vitest';
import {
  toNumber,
  isUIComponent,
  isPackageExport,
  getMonorepoAppName,
  isExcludedByPattern,
  truncateSourceCode,
  getShortPath,
} from '../../utils/shared-utils.js';
import path from 'path';

// SPEC-GAP: No spec defines what toNumber returns for non-number, non-Integer, non-null values (e.g., strings). Code returns 0.
// SPEC-GAP: No spec defines the exact directory patterns for isUIComponent (components/ui vs ui/components). Derived from regex.
// SPEC-GAP: No spec defines behavior of isExcludedByPattern for patterns NOT starting with * (code still does endsWith).

describe('AUD-TC B6 | shared-utils.ts', () => {
  // ─── Behavior 1: toNumber converts regular JS numbers ────────────────────
  describe('Behavior 1: toNumber with JS numbers', () => {
    it('converts positive number', () => {
      expect(toNumber(42)).toBe(42);
    });

    it('converts zero', () => {
      expect(toNumber(0)).toBe(0);
    });

    it('converts negative number', () => {
      expect(toNumber(-7)).toBe(-7);
    });

    it('converts float', () => {
      expect(toNumber(3.14)).toBe(3.14);
    });
  });

  // ─── Behavior 2: toNumber converts Neo4j Integer objects ─────────────────
  describe('Behavior 2: toNumber with Neo4j Integer', () => {
    it('calls .toNumber() on Neo4j Integer objects', () => {
      const neo4jInt = { toNumber: () => 99 };
      expect(toNumber(neo4jInt)).toBe(99);
    });
  });

  // ─── Behavior 3: toNumber returns 0 for null/undefined ──────────────────
  describe('Behavior 3: toNumber null/undefined', () => {
    it('returns 0 for null', () => {
      expect(toNumber(null)).toBe(0);
    });

    it('returns 0 for undefined', () => {
      expect(toNumber(undefined)).toBe(0);
    });
  });

  // ─── Behavior 4: isUIComponent detects UI component files ───────────────
  describe('Behavior 4: isUIComponent returns true for UI dir + component extension', () => {
    it('returns true for components/ui path with .tsx', () => {
      expect(isUIComponent('src/components/ui/Button.tsx')).toBe(true);
    });

    it('returns true for ui/components path with .jsx', () => {
      expect(isUIComponent('src/ui/components/Card.jsx')).toBe(true);
    });

    it('returns true for .vue file in UI dir', () => {
      expect(isUIComponent('src/components/ui/Modal.vue')).toBe(true);
    });

    it('returns false for .ts file in UI dir (not a component extension)', () => {
      expect(isUIComponent('src/components/ui/utils.ts')).toBe(false);
    });

    it('returns false for .tsx outside UI dir', () => {
      expect(isUIComponent('src/pages/Home.tsx')).toBe(false);
    });
  });

  // ─── Behavior 5: isUIComponent handles both separators ──────────────────
  describe('Behavior 5: isUIComponent cross-platform separators', () => {
    it('handles backslash separators', () => {
      expect(isUIComponent('src\\components\\ui\\Button.tsx')).toBe(true);
    });

    it('handles mixed separators', () => {
      expect(isUIComponent('src/components\\ui/Button.tsx')).toBe(true);
    });
  });

  // ─── Behavior 6: isPackageExport detects monorepo packages/ paths ───────
  // FINDING: regex requires a separator BEFORE 'packages/' — bare relative paths
  // like 'packages/shared/...' fail because no leading [/\\]. Only absolute or
  // deeper relative paths match (e.g., '/root/packages/shared/...').
  describe('Behavior 6: isPackageExport', () => {
    it('returns true for absolute packages/ path', () => {
      expect(isPackageExport('/root/packages/shared/src/index.ts')).toBe(true);
    });

    it('returns false for non-packages path', () => {
      expect(isPackageExport('src/utils/helper.ts')).toBe(false);
    });

    it('handles backslash separators', () => {
      expect(isPackageExport('C:\\repo\\packages\\shared\\src\\index.ts')).toBe(true);
    });

    // FINDING: bare relative 'packages/...' does NOT match (no leading separator)
    it('returns false for bare relative packages/ path (regex requires leading separator)', () => {
      expect(isPackageExport('packages/shared/src/index.ts')).toBe(false);
    });
  });

  // ─── Behavior 7: getMonorepoAppName extracts app/package name ──────────
  // FINDING: same regex issue — requires leading separator before apps/ or packages/
  describe('Behavior 7: getMonorepoAppName extraction', () => {
    it('extracts name from absolute apps/ path', () => {
      expect(getMonorepoAppName('/root/apps/web/src/index.ts')).toBe('web');
    });

    it('extracts name from absolute packages/ path', () => {
      expect(getMonorepoAppName('/root/packages/shared/src/utils.ts')).toBe('shared');
    });

    // FINDING: bare relative paths return null
    it('returns null for bare relative apps/ path (regex limitation)', () => {
      expect(getMonorepoAppName('apps/web/src/index.ts')).toBeNull();
    });
  });

  // ─── Behavior 8: getMonorepoAppName returns null for non-monorepo ──────
  describe('Behavior 8: getMonorepoAppName null for non-monorepo', () => {
    it('returns null for regular src/ path', () => {
      expect(getMonorepoAppName('src/utils/helper.ts')).toBeNull();
    });

    it('returns null for root file', () => {
      expect(getMonorepoAppName('index.ts')).toBeNull();
    });
  });

  // ─── Behavior 9: isExcludedByPattern matches glob patterns ─────────────
  describe('Behavior 9: isExcludedByPattern', () => {
    it('matches pattern starting with * (glob suffix)', () => {
      expect(isExcludedByPattern('src/test/file.spec.ts', ['*.spec.ts'])).toBe(true);
    });

    it('does not match non-matching pattern', () => {
      expect(isExcludedByPattern('src/utils/helper.ts', ['*.spec.ts'])).toBe(false);
    });

    it('matches exact suffix pattern without *', () => {
      expect(isExcludedByPattern('src/test/file.spec.ts', ['.spec.ts'])).toBe(true);
    });

    it('checks all patterns in array', () => {
      expect(isExcludedByPattern('file.test.ts', ['*.spec.ts', '*.test.ts'])).toBe(true);
    });
  });

  // ─── Behavior 10: truncateSourceCode ────────────────────────────────────
  describe('Behavior 10: truncateSourceCode', () => {
    it('returns undefined for null', () => {
      expect(truncateSourceCode(null)).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(truncateSourceCode('')).toBeUndefined();
    });

    it('returns undefined for undefined', () => {
      expect(truncateSourceCode(undefined)).toBeUndefined();
    });

    it('truncates to maxLength', () => {
      const long = 'a'.repeat(1000);
      const result = truncateSourceCode(long, 100);
      expect(result).toHaveLength(100);
    });

    it('returns full string if shorter than maxLength', () => {
      expect(truncateSourceCode('short', 500)).toBe('short');
    });
  });

  // ─── Behavior 11: getShortPath returns last N segments ─────────────────
  describe('Behavior 11: getShortPath', () => {
    it('returns last 2 segments by default', () => {
      const input = ['src', 'core', 'utils', 'helper.ts'].join(path.sep);
      const result = getShortPath(input);
      expect(result).toBe(['utils', 'helper.ts'].join(path.sep));
    });

    it('returns last N segments when specified', () => {
      const input = ['a', 'b', 'c', 'd'].join(path.sep);
      const result = getShortPath(input, 3);
      expect(result).toBe(['b', 'c', 'd'].join(path.sep));
    });

    it('returns full path if fewer segments than requested', () => {
      const result = getShortPath('file.ts', 5);
      expect(result).toBe('file.ts');
    });
  });
});
