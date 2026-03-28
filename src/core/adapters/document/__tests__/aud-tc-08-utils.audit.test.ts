/**
 * AUD-TC-08-L1-08: utils.ts — Behavioral Contract Tests
 *
 * Spec: No formal spec — shared utility functions for document adapter. 17 lines.
 *
 * Behaviors tested:
 * (1) deterministicId accepts variadic string/number/undefined parts, normalizes (String + trim), filters empty, joins with '|', and returns MD5 hex hash truncated to 20 chars
 * (2) deterministicId is deterministic (same inputs → same output)
 * (3) deterministicId handles undefined/null parts gracefully (treated as empty string)
 * (4) splitParagraphs splits text on double-newline (\n\s*\n)
 * (5) splitParagraphs trims and collapses internal whitespace in each paragraph
 * (6) splitParagraphs filters out empty paragraphs after trimming
 * (7) splitParagraphs returns empty array for empty/whitespace-only input
 */
import { describe, it, expect } from 'vitest';
import { deterministicId, splitParagraphs } from '../utils.js';

describe('[aud-tc-08] utils.ts', () => {
  describe('deterministicId', () => {
    // Behavior 1: accepts variadic parts, normalizes, filters empty, joins with '|', returns MD5 hex truncated to 20 chars
    it('B1: produces 20-character hex hash from joined normalized parts', () => {
      const result = deterministicId('proj_test', 'DocumentNode', '/path/to/file.txt');

      expect(result).toHaveLength(20);
      expect(result).toMatch(/^[0-9a-f]{20}$/);
    });

    // Behavior 2: is deterministic (same inputs → same output)
    it('B2: returns identical hash for identical inputs', () => {
      const result1 = deterministicId('proj_1', 'doc', 'file.txt');
      const result2 = deterministicId('proj_1', 'doc', 'file.txt');

      expect(result1).toBe(result2);
    });

    // Behavior 2 (continued): different inputs produce different hashes
    it('B2b: returns different hash for different inputs', () => {
      const result1 = deterministicId('proj_1', 'doc', 'file1.txt');
      const result2 = deterministicId('proj_1', 'doc', 'file2.txt');

      expect(result1).not.toBe(result2);
    });

    // Behavior 3: handles undefined/null parts gracefully (treated as empty string)
    it('B3: filters out undefined parts', () => {
      const result1 = deterministicId('proj_1', undefined, 'doc', undefined, 'file.txt');
      const result2 = deterministicId('proj_1', 'doc', 'file.txt');

      expect(result1).toBe(result2);
    });

    // Behavior 1 (validation): trims whitespace from parts
    it('B1b: trims whitespace from each part before joining', () => {
      const result1 = deterministicId('  proj_1  ', '  doc  ', '  file.txt  ');
      const result2 = deterministicId('proj_1', 'doc', 'file.txt');

      expect(result1).toBe(result2);
    });

    // Behavior 1 (validation): converts numbers to strings
    it('B1c: converts number parts to strings', () => {
      const result = deterministicId('proj_1', 'para', 42);

      expect(result).toHaveLength(20);
      expect(result).toMatch(/^[0-9a-f]{20}$/);
    });

    // Behavior 1 (validation): filters empty strings after trim
    it('B1d: filters empty strings after trimming', () => {
      const result1 = deterministicId('proj_1', '', '   ', 'doc');
      const result2 = deterministicId('proj_1', 'doc');

      expect(result1).toBe(result2);
    });
  });

  describe('splitParagraphs', () => {
    // Behavior 4: splits text on double-newline (\n\s*\n)
    it('B4: splits on double-newline separator', () => {
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';

      const result = splitParagraphs(text);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('First paragraph.');
      expect(result[1]).toBe('Second paragraph.');
      expect(result[2]).toBe('Third paragraph.');
    });

    // Behavior 4 (continued): handles variable whitespace between newlines
    it('B4b: splits on double-newline with whitespace variations', () => {
      const text = 'Para 1.\n\nPara 2.\n  \n  \nPara 3.';

      const result = splitParagraphs(text);

      expect(result).toHaveLength(3);
    });

    // Behavior 5: trims and collapses internal whitespace in each paragraph
    it('B5: collapses internal whitespace to single space', () => {
      const text = '  First   paragraph   with   spaces.  \n\nSecond.';

      const result = splitParagraphs(text);

      expect(result[0]).toBe('First paragraph with spaces.');
      expect(result[1]).toBe('Second.');
    });

    // Behavior 5 (continued): trims leading/trailing whitespace from paragraphs
    it('B5b: trims leading and trailing whitespace from each paragraph', () => {
      const text = '   Leading spaces.\n\nTrailing spaces.   ';

      const result = splitParagraphs(text);

      expect(result[0]).toBe('Leading spaces.');
      expect(result[1]).toBe('Trailing spaces.');
    });

    // Behavior 6: filters out empty paragraphs after trimming
    it('B6: filters out empty paragraphs after trim', () => {
      const text = 'Para 1.\n\n   \n\nPara 2.\n\n\n\nPara 3.';

      const result = splitParagraphs(text);

      expect(result).toHaveLength(3);
      expect(result).not.toContain('');
    });

    // Behavior 7: returns empty array for empty/whitespace-only input
    it('B7: returns empty array for empty string', () => {
      const result = splitParagraphs('');

      expect(result).toEqual([]);
    });

    // Behavior 7 (continued): returns empty array for whitespace-only input
    it('B7b: returns empty array for whitespace-only string', () => {
      const result = splitParagraphs('   \n\n  \n  ');

      expect(result).toEqual([]);
    });

    // Behavior 4 (edge case): single paragraph with no double-newline
    it('B4c: handles single paragraph with no separator', () => {
      const text = 'Single paragraph with no breaks.';

      const result = splitParagraphs(text);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Single paragraph with no breaks.');
    });
  });
});
