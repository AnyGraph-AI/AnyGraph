/**
 * AUD-TC-07-L1-10: src/constants.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/PLAN.md §Phase 1 "Promise .catch/.then/.finally filtering
 *              (fork: BUILT_IN_METHODS skip list)" + §"resolutionKind on CALLS edges"
 *
 * Accept: 7+ behavioral assertions, all green
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_TRAVERSAL_DEPTH,
  EXCLUDE_PATTERNS_REGEX,
  EXCLUDE_PATTERNS_GLOB,
  BUILT_IN_FUNCTIONS,
  BUILT_IN_METHODS,
  BUILT_IN_CLASSES,
} from '../../../constants.js';

describe('AUD-TC-07 | src/constants.ts', () => {

  // ─── Behavior 1: MAX_TRAVERSAL_DEPTH ────────────────────────────────────

  describe('Behavior 1: MAX_TRAVERSAL_DEPTH is 5', () => {
    it('equals 5', () => {
      expect(MAX_TRAVERSAL_DEPTH).toBe(5);
    });

    it('is a number', () => {
      expect(typeof MAX_TRAVERSAL_DEPTH).toBe('number');
    });
  });

  // ─── Behavior 2: EXCLUDE_PATTERNS_REGEX includes key directory patterns ──

  describe('Behavior 2: EXCLUDE_PATTERNS_REGEX includes required patterns', () => {
    it('includes node_modules/ pattern', () => {
      expect(EXCLUDE_PATTERNS_REGEX.some(p => p.includes('node_modules'))).toBe(true);
    });

    it('includes dist/ pattern', () => {
      expect(EXCLUDE_PATTERNS_REGEX.some(p => p.includes('dist'))).toBe(true);
    });

    it('includes build/ pattern', () => {
      expect(EXCLUDE_PATTERNS_REGEX.some(p => p.includes('build'))).toBe(true);
    });

    it('includes coverage/ pattern', () => {
      expect(EXCLUDE_PATTERNS_REGEX.some(p => p.includes('coverage'))).toBe(true);
    });

    it('includes .d.ts pattern', () => {
      expect(EXCLUDE_PATTERNS_REGEX.some(p => p.includes('.d.ts') || p.includes('d\\.ts'))).toBe(true);
    });

    it('includes .test.ts pattern', () => {
      expect(EXCLUDE_PATTERNS_REGEX.some(p => p.includes('test'))).toBe(true);
    });

    it('includes .spec.ts pattern', () => {
      expect(EXCLUDE_PATTERNS_REGEX.some(p => p.includes('spec'))).toBe(true);
    });

    it('is an array', () => {
      expect(Array.isArray(EXCLUDE_PATTERNS_REGEX)).toBe(true);
      expect(EXCLUDE_PATTERNS_REGEX.length).toBeGreaterThan(0);
    });
  });

  // ─── Behavior 3: EXCLUDE_PATTERNS_GLOB includes required glob patterns ───

  describe('Behavior 3: EXCLUDE_PATTERNS_GLOB includes equivalent glob versions', () => {
    it('includes node_modules/** glob', () => {
      expect(EXCLUDE_PATTERNS_GLOB).toContain('node_modules/**');
    });

    it('includes dist/** glob', () => {
      expect(EXCLUDE_PATTERNS_GLOB).toContain('dist/**');
    });

    it('includes build/** glob', () => {
      expect(EXCLUDE_PATTERNS_GLOB).toContain('build/**');
    });

    it('includes coverage/** glob', () => {
      expect(EXCLUDE_PATTERNS_GLOB).toContain('coverage/**');
    });

    it('includes **/*.d.ts glob', () => {
      expect(EXCLUDE_PATTERNS_GLOB).toContain('**/*.d.ts');
    });

    it('includes **/*.test.ts glob', () => {
      expect(EXCLUDE_PATTERNS_GLOB).toContain('**/*.test.ts');
    });

    it('includes **/*.spec.ts glob', () => {
      expect(EXCLUDE_PATTERNS_GLOB).toContain('**/*.spec.ts');
    });

    it('is an array', () => {
      expect(Array.isArray(EXCLUDE_PATTERNS_GLOB)).toBe(true);
      expect(EXCLUDE_PATTERNS_GLOB.length).toBeGreaterThan(0);
    });
  });

  // ─── Behavior 4: BUILT_IN_FUNCTIONS contains minimum required entries ────

  describe('Behavior 4: BUILT_IN_FUNCTIONS contains minimum required entries', () => {
    it('is a Set', () => {
      expect(BUILT_IN_FUNCTIONS instanceof Set).toBe(true);
    });

    it('contains console', () => {
      expect(BUILT_IN_FUNCTIONS.has('console')).toBe(true);
    });

    it('contains setTimeout', () => {
      expect(BUILT_IN_FUNCTIONS.has('setTimeout')).toBe(true);
    });

    it('contains JSON', () => {
      expect(BUILT_IN_FUNCTIONS.has('JSON')).toBe(true);
    });

    it('contains Math', () => {
      expect(BUILT_IN_FUNCTIONS.has('Math')).toBe(true);
    });

    it('contains Promise', () => {
      expect(BUILT_IN_FUNCTIONS.has('Promise')).toBe(true);
    });

    it('contains require', () => {
      expect(BUILT_IN_FUNCTIONS.has('require')).toBe(true);
    });
  });

  // ─── Behavior 5: BUILT_IN_METHODS contains Promise chain filtering methods ─

  describe('Behavior 5: BUILT_IN_METHODS contains Promise chain filtering methods (spec requirement)', () => {
    it('is a Set', () => {
      expect(BUILT_IN_METHODS instanceof Set).toBe(true);
    });

    it('contains "then" (Promise chain filtering per spec)', () => {
      expect(BUILT_IN_METHODS.has('then')).toBe(true);
    });

    it('contains "catch" (Promise chain filtering per spec)', () => {
      expect(BUILT_IN_METHODS.has('catch')).toBe(true);
    });

    it('contains "finally" (Promise chain filtering per spec)', () => {
      expect(BUILT_IN_METHODS.has('finally')).toBe(true);
    });

    it('contains array utility methods', () => {
      expect(BUILT_IN_METHODS.has('map')).toBe(true);
      expect(BUILT_IN_METHODS.has('filter')).toBe(true);
      expect(BUILT_IN_METHODS.has('reduce')).toBe(true);
      expect(BUILT_IN_METHODS.has('forEach')).toBe(true);
    });

    it('contains string utility methods', () => {
      expect(BUILT_IN_METHODS.has('trim')).toBe(true);
      expect(BUILT_IN_METHODS.has('split')).toBe(true);
      expect(BUILT_IN_METHODS.has('replace')).toBe(true);
    });

    it('contains object utility methods', () => {
      expect(BUILT_IN_METHODS.has('toString')).toBe(true);
      expect(BUILT_IN_METHODS.has('valueOf')).toBe(true);
    });
  });

  // ─── Behavior 6: BUILT_IN_CLASSES contains standard JS classes ───────────

  describe('Behavior 6: BUILT_IN_CLASSES contains standard JS classes', () => {
    it('is a Set', () => {
      expect(BUILT_IN_CLASSES instanceof Set).toBe(true);
    });

    it('contains Array', () => {
      expect(BUILT_IN_CLASSES.has('Array')).toBe(true);
    });

    it('contains Map', () => {
      expect(BUILT_IN_CLASSES.has('Map')).toBe(true);
    });

    it('contains Set', () => {
      expect(BUILT_IN_CLASSES.has('Set')).toBe(true);
    });

    it('contains Promise', () => {
      expect(BUILT_IN_CLASSES.has('Promise')).toBe(true);
    });

    it('contains Buffer', () => {
      expect(BUILT_IN_CLASSES.has('Buffer')).toBe(true);
    });

    it('contains EventEmitter', () => {
      expect(BUILT_IN_CLASSES.has('EventEmitter')).toBe(true);
    });

    it('contains Error variants', () => {
      expect(BUILT_IN_CLASSES.has('Error')).toBe(true);
      expect(BUILT_IN_CLASSES.has('TypeError')).toBe(true);
    });
  });

  // ─── Behavior 7: regex and glob pattern consistency ───────────────────────

  describe('Behavior 7: regex and glob pattern sets are consistent (same directories excluded in both formats)', () => {
    it('both sets exclude node_modules', () => {
      const inRegex = EXCLUDE_PATTERNS_REGEX.some(p => p.includes('node_modules'));
      const inGlob = EXCLUDE_PATTERNS_GLOB.some(p => p.includes('node_modules'));
      expect(inRegex).toBe(true);
      expect(inGlob).toBe(true);
    });

    it('both sets exclude dist', () => {
      const inRegex = EXCLUDE_PATTERNS_REGEX.some(p => p.includes('dist'));
      const inGlob = EXCLUDE_PATTERNS_GLOB.some(p => p.includes('dist'));
      expect(inRegex).toBe(true);
      expect(inGlob).toBe(true);
    });

    it('both sets exclude coverage', () => {
      const inRegex = EXCLUDE_PATTERNS_REGEX.some(p => p.includes('coverage'));
      const inGlob = EXCLUDE_PATTERNS_GLOB.some(p => p.includes('coverage'));
      expect(inRegex).toBe(true);
      expect(inGlob).toBe(true);
    });

    it('both sets exclude .d.ts files', () => {
      const inRegex = EXCLUDE_PATTERNS_REGEX.some(p => p.includes('.d.ts') || p.includes('d\\.ts'));
      const inGlob = EXCLUDE_PATTERNS_GLOB.some(p => p.includes('.d.ts'));
      expect(inRegex).toBe(true);
      expect(inGlob).toBe(true);
    });

    it('both sets exclude test files', () => {
      const inRegex = EXCLUDE_PATTERNS_REGEX.some(p => p.includes('test'));
      const inGlob = EXCLUDE_PATTERNS_GLOB.some(p => p.includes('test'));
      expect(inRegex).toBe(true);
      expect(inGlob).toBe(true);
    });
  });
});
