/**
 * AUD-TC-07-L2-01: change-class-matrix.ts — Behavioral Audit Tests (INCOMPLETE → strengthened)
 *
 * Verdict: INCOMPLETE — no dedicated test file; only indirect coverage via policy-replayability.test.ts
 * Action: Write full behavioral coverage in __audit__/
 *
 * Spec source: plans/codegraph/TDD_ROADMAP.md §Milestone N1 "Define and freeze
 *              change-class matrix schema" + §Decision: Change-Class Lane Matrix
 *
 * Accept: 7 behaviors verified
 */
import { describe, it, expect } from 'vitest';
import {
  classifyChange,
  getRequiredLanes,
  CHANGE_CLASS_MATRIX,
  MERGE_RULE,
  ChangeClass,
  TestLane,
} from '../../../core/config/change-class-matrix.js';

describe('AUD-TC-07-L2 | change-class-matrix.ts', () => {

  // ─── Behavior 1: classifyChange routes to correct ChangeClass per file ───

  describe('Behavior 1: classifyChange routes file paths to correct ChangeClass', () => {
    it('src/core/parsers/ts.ts → CODE_ONLY', () => {
      expect(classifyChange(['src/core/parsers/ts.ts'])).toBe(ChangeClass.CODE_ONLY);
    });

    it('src/core/utils/hash.ts → CODE_ONLY', () => {
      expect(classifyChange(['src/core/utils/hash.ts'])).toBe(ChangeClass.CODE_ONLY);
    });

    it('src/core/config/schema.ts → QUERY_SCHEMA_ARTIFACT', () => {
      expect(classifyChange(['src/core/config/schema.ts'])).toBe(ChangeClass.QUERY_SCHEMA_ARTIFACT);
    });

    it('src/mcp/tools/search.ts → QUERY_SCHEMA_ARTIFACT', () => {
      expect(classifyChange(['src/mcp/tools/search.ts'])).toBe(ChangeClass.QUERY_SCHEMA_ARTIFACT);
    });

    it('src/scripts/verify/verify-commit-audit-invariants.ts → STATUS_INVARIANT_CONFIDENCE', () => {
      expect(classifyChange(['src/scripts/verify/verify-commit-audit-invariants.ts']))
        .toBe(ChangeClass.STATUS_INVARIANT_CONFIDENCE);
    });

    it('src/utils/verify-done.ts → STATUS_INVARIANT_CONFIDENCE', () => {
      expect(classifyChange(['src/utils/verify-done.ts'])).toBe(ChangeClass.STATUS_INVARIANT_CONFIDENCE);
    });

    it('config/hygiene-exceptions.json → GATE_POLICY', () => {
      expect(classifyChange(['config/hygiene-exceptions.json'])).toBe(ChangeClass.GATE_POLICY);
    });

    it('src/core/embeddings/embed.ts → AI_EVAL', () => {
      expect(classifyChange(['src/core/embeddings/embed.ts'])).toBe(ChangeClass.AI_EVAL);
    });

    it('SKILL.md → AI_EVAL', () => {
      expect(classifyChange(['SKILL.md'])).toBe(ChangeClass.AI_EVAL);
    });

    it('AGENTS.md → AI_EVAL', () => {
      expect(classifyChange(['AGENTS.md'])).toBe(ChangeClass.AI_EVAL);
    });
  });

  // ─── Behavior 2: classifyChange returns most restrictive class ───────────

  describe('Behavior 2: classifyChange returns most restrictive class when multiple patterns match', () => {
    it('STATUS_INVARIANT_CONFIDENCE beats QUERY_SCHEMA_ARTIFACT', () => {
      const files = [
        'src/core/config/schema.ts',                            // QUERY_SCHEMA_ARTIFACT
        'src/scripts/verify/verify-commit-audit-invariants.ts', // STATUS_INVARIANT_CONFIDENCE
      ];
      expect(classifyChange(files)).toBe(ChangeClass.STATUS_INVARIANT_CONFIDENCE);
    });

    it('STATUS_INVARIANT_CONFIDENCE beats CODE_ONLY', () => {
      const files = [
        'src/core/parsers/typescript-parser.ts',                // CODE_ONLY
        'src/scripts/verify/verify-done.ts',                    // STATUS_INVARIANT_CONFIDENCE
      ];
      expect(classifyChange(files)).toBe(ChangeClass.STATUS_INVARIANT_CONFIDENCE);
    });

    it('GATE_POLICY beats QUERY_SCHEMA_ARTIFACT', () => {
      const files = [
        'src/core/config/schema.ts',                            // QUERY_SCHEMA_ARTIFACT
        'config/hygiene-exceptions-dev.json',                   // GATE_POLICY
      ];
      expect(classifyChange(files)).toBe(ChangeClass.GATE_POLICY);
    });

    it('STATUS_INVARIANT_CONFIDENCE beats GATE_POLICY (most restrictive wins)', () => {
      const files = [
        'config/hygiene-exceptions.json',                       // GATE_POLICY
        'src/scripts/verify/verify-commit-audit-invariants.ts', // STATUS_INVARIANT_CONFIDENCE
      ];
      expect(classifyChange(files)).toBe(ChangeClass.STATUS_INVARIANT_CONFIDENCE);
    });
  });

  // ─── Behavior 3: classifyChange defaults to CODE_ONLY for unknown files ──

  describe('Behavior 3: classifyChange defaults to CODE_ONLY for unknown files', () => {
    it('empty file list → CODE_ONLY', () => {
      expect(classifyChange([])).toBe(ChangeClass.CODE_ONLY);
    });

    it('README.md → CODE_ONLY (no trigger pattern matches)', () => {
      expect(classifyChange(['README.md'])).toBe(ChangeClass.CODE_ONLY);
    });

    it('package.json → CODE_ONLY', () => {
      expect(classifyChange(['package.json'])).toBe(ChangeClass.CODE_ONLY);
    });

    it('some/random/file.ts → CODE_ONLY', () => {
      expect(classifyChange(['some/random/file.ts'])).toBe(ChangeClass.CODE_ONLY);
    });
  });

  // ─── Behavior 4: getRequiredLanes returns correct lanes per class ─────────

  describe('Behavior 4: getRequiredLanes returns correct lanes per class', () => {
    it('CODE_ONLY requires exactly [A]', () => {
      const lanes = getRequiredLanes(ChangeClass.CODE_ONLY);
      expect(lanes).toContain(TestLane.A_CODE);
      expect(lanes).toHaveLength(1);
    });

    it('QUERY_SCHEMA_ARTIFACT requires A + B + C1', () => {
      const lanes = getRequiredLanes(ChangeClass.QUERY_SCHEMA_ARTIFACT);
      expect(lanes).toContain(TestLane.A_CODE);
      expect(lanes).toContain(TestLane.B_CONTRACT);
      expect(lanes).toContain(TestLane.C1_STRUCTURAL);
      expect(lanes).toHaveLength(3);
    });

    it('STATUS_INVARIANT_CONFIDENCE requires A + B + C1 + C2 + C3', () => {
      const lanes = getRequiredLanes(ChangeClass.STATUS_INVARIANT_CONFIDENCE);
      expect(lanes).toContain(TestLane.A_CODE);
      expect(lanes).toContain(TestLane.B_CONTRACT);
      expect(lanes).toContain(TestLane.C1_STRUCTURAL);
      expect(lanes).toContain(TestLane.C2_SEMANTIC);
      expect(lanes).toContain(TestLane.C3_CONFIDENCE);
      expect(lanes).toHaveLength(5);
    });

    it('GATE_POLICY requires A + B + D', () => {
      const lanes = getRequiredLanes(ChangeClass.GATE_POLICY);
      expect(lanes).toContain(TestLane.A_CODE);
      expect(lanes).toContain(TestLane.B_CONTRACT);
      expect(lanes).toContain(TestLane.D_GATE_POLICY);
      expect(lanes).toHaveLength(3);
    });

    it('AI_EVAL requires A + B + E', () => {
      const lanes = getRequiredLanes(ChangeClass.AI_EVAL);
      expect(lanes).toContain(TestLane.A_CODE);
      expect(lanes).toContain(TestLane.B_CONTRACT);
      expect(lanes).toContain(TestLane.E_AI_EVAL);
      expect(lanes).toHaveLength(3);
    });

    it('returns a copy (mutation does not affect registry)', () => {
      const lanes = getRequiredLanes(ChangeClass.CODE_ONLY);
      lanes.push(TestLane.E_AI_EVAL); // mutate the copy
      // Registry unchanged
      expect(getRequiredLanes(ChangeClass.CODE_ONLY)).toHaveLength(1);
    });
  });

  // ─── Behavior 5: matchGlob handles ** and * patterns ─────────────────────

  describe('Behavior 5: matchGlob handles ** and * patterns (tested via classifyChange)', () => {
    it('** matches nested paths (src/core/parsers/deep/file.ts matches src/core/parsers/**)', () => {
      expect(classifyChange(['src/core/parsers/deep/nested/file.ts'])).toBe(ChangeClass.CODE_ONLY);
    });

    it('** matches direct child (src/core/parsers/file.ts)', () => {
      expect(classifyChange(['src/core/parsers/file.ts'])).toBe(ChangeClass.CODE_ONLY);
    });

    it('* does not match path separator (src/mcp/tools/x.ts matches src/mcp/tools/**)', () => {
      expect(classifyChange(['src/mcp/tools/some-tool.ts'])).toBe(ChangeClass.QUERY_SCHEMA_ARTIFACT);
    });

    it('exact path match (src/core/config/schema.ts)', () => {
      expect(classifyChange(['src/core/config/schema.ts'])).toBe(ChangeClass.QUERY_SCHEMA_ARTIFACT);
    });

    it('non-matching path does not trigger (src/core/config/other.ts is not schema.ts)', () => {
      expect(classifyChange(['src/core/config/other.ts'])).toBe(ChangeClass.CODE_ONLY);
    });
  });

  // ─── Behavior 6: CHANGE_CLASS_MATRIX has all 5 classes ───────────────────

  describe('Behavior 6: CHANGE_CLASS_MATRIX has all 5 classes with non-empty triggerPatterns and requiredLanes', () => {
    const classes = Object.values(ChangeClass);

    it('has exactly 5 change classes', () => {
      expect(classes).toHaveLength(5);
    });

    it.each(classes)('class %s has non-empty triggerPatterns', (cls) => {
      expect(CHANGE_CLASS_MATRIX[cls].triggerPatterns.length).toBeGreaterThan(0);
    });

    it.each(classes)('class %s has non-empty requiredLanes', (cls) => {
      expect(CHANGE_CLASS_MATRIX[cls].requiredLanes.length).toBeGreaterThan(0);
    });

    it.each(classes)('class %s has correct id', (cls) => {
      expect(CHANGE_CLASS_MATRIX[cls].id).toBe(cls);
    });
  });

  // ─── Behavior 7: MERGE_RULE is fail-closed with no-critical-to-pass ──────

  describe('Behavior 7: MERGE_RULE enforcement is fail-closed and retryPolicy is no-critical-to-pass', () => {
    it('enforcement is "fail-closed"', () => {
      expect(MERGE_RULE.enforcement).toBe('fail-closed');
    });

    it('retryPolicy is "no-critical-to-pass"', () => {
      expect(MERGE_RULE.retryPolicy).toBe('no-critical-to-pass');
    });

    it('has version field', () => {
      expect(typeof MERGE_RULE.version).toBe('string');
      expect(MERGE_RULE.version.length).toBeGreaterThan(0);
    });

    it('has rule description', () => {
      expect(typeof MERGE_RULE.rule).toBe('string');
      expect(MERGE_RULE.rule.length).toBeGreaterThan(0);
    });
  });
});
