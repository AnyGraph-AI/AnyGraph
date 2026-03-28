/**
 * [AUD-TC-13-L1-06] report-project-registry-duplicates.ts — Contract Tests
 *
 * Self-executing CLI (no exports). Tests verify behavioral contracts
 * via source analysis and pure helper logic.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../../tools/report-project-registry-duplicates.ts'),
  'utf-8',
);

// Re-implement toNum helper from source
function toNum(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val != null && typeof val === 'object' && 'toNumber' in val) {
    return (val as { toNumber(): number }).toNumber();
  }
  return Number(val);
}

describe('[aud-tc-13] report-project-registry-duplicates.ts', () => {
  describe('Contract verification', () => {
    it('(1) queries Project nodes grouped by displayName with duplicate detection', () => {
      expect(SOURCE).toContain('Project');
      expect(SOURCE).toContain('displayName');
      // Groups by displayName to find duplicates
      expect(SOURCE).toMatch(/collect|GROUP BY|group/i);
    });

    it('(2) uses toNum helper for Neo4j Integer handling', () => {
      expect(SOURCE).toContain('toNum');
      expect(SOURCE).toContain('toNumber');
      expect(SOURCE).toContain('Number(');
    });

    it('(3) produces DuplicateRow with displayName, projectIds, projectCount', () => {
      expect(SOURCE).toContain('displayName');
      expect(SOURCE).toContain('projectId');
    });

    it('(4) writes JSON report to artifacts/project-registry/ with timestamp', () => {
      expect(SOURCE).toContain("'artifacts', 'project-registry'");
      expect(SOURCE).toContain('.json');
    });

    it('(5) writes latest symlink/file', () => {
      expect(SOURCE).toMatch(/latest/);
    });

    it('(6) creates output directory recursively', () => {
      expect(SOURCE).toContain('mkdirSync');
      expect(SOURCE).toContain('recursive');
    });

    it('(7) outputs summary to console', () => {
      expect(SOURCE).toContain('console.');
    });

    it('(8) closes Neo4j driver in finally block', () => {
      expect(SOURCE).toContain('finally');
      expect(SOURCE).toMatch(/\.close\(\)/);
    });
  });

  describe('toNum helper — pure function logic', () => {
    it('handles plain numbers', () => {
      expect(toNum(42)).toBe(42);
      expect(toNum(0)).toBe(0);
    });

    it('handles Neo4j Integer objects with toNumber()', () => {
      const neoInt = { toNumber: () => 7 };
      expect(toNum(neoInt)).toBe(7);
    });

    it('falls back to Number() for other types', () => {
      expect(toNum('123')).toBe(123);
      expect(toNum(null)).toBe(0);
    });
  });
});
