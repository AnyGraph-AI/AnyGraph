/**
 * AUD-TC-07-L1-02: eval-lineage-schema.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/TDD_ROADMAP.md §Milestone N1 "Define and freeze
 *              eval lineage schema" + Lane E (AI Eval TDD TEVV)
 *
 * Accept: 5+ behavioral assertions, all green
 */
import { describe, it, expect } from 'vitest';
import {
  EVAL_LINEAGE_SCHEMA_VERSION,
  HazardClass,
  REQUIRED_EVAL_LINEAGE_FIELDS,
  AI_EVAL_TRIGGERS,
  type EvalLineageRecord,
} from '../../../core/config/eval-lineage-schema.js';

// ─── Behavior 1: EVAL_LINEAGE_SCHEMA_VERSION ─────────────────────────────────

describe('AUD-TC-07 | eval-lineage-schema.ts', () => {
  describe('Behavior 1: EVAL_LINEAGE_SCHEMA_VERSION is string "1.0.0"', () => {
    it('is exactly the string "1.0.0"', () => {
      expect(EVAL_LINEAGE_SCHEMA_VERSION).toBe('1.0.0');
    });

    it('is a string type', () => {
      expect(typeof EVAL_LINEAGE_SCHEMA_VERSION).toBe('string');
    });
  });

  // ─── Behavior 2: HazardClass enum has exactly 5 members ──────────────────

  describe('Behavior 2: HazardClass enum has exactly 5 members with correct string values', () => {
    it('has NONE = "none"', () => {
      expect(HazardClass.NONE).toBe('none');
    });

    it('has LOW = "low"', () => {
      expect(HazardClass.LOW).toBe('low');
    });

    it('has MEDIUM = "medium"', () => {
      expect(HazardClass.MEDIUM).toBe('medium');
    });

    it('has HIGH = "high"', () => {
      expect(HazardClass.HIGH).toBe('high');
    });

    it('has CRITICAL = "critical"', () => {
      expect(HazardClass.CRITICAL).toBe('critical');
    });

    it('has exactly 5 members (no extras)', () => {
      // TypeScript string enums export both key→value and value→key entries
      // but for string enums, only key→value entries are present
      const members = Object.values(HazardClass);
      expect(members).toHaveLength(5);
      expect(new Set(members).size).toBe(5);
    });
  });

  // ─── Behavior 3: REQUIRED_EVAL_LINEAGE_FIELDS has exactly 9 fields ───────

  describe('Behavior 3: REQUIRED_EVAL_LINEAGE_FIELDS contains exactly 9 required fields', () => {
    it('has exactly 9 entries', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toHaveLength(9);
    });

    it('contains evalSetVersion', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toContain('evalSetVersion');
    });

    it('contains hazardClass', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toContain('hazardClass');
    });

    it('contains baselineRef', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toContain('baselineRef');
    });

    it('contains deltaMetrics', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toContain('deltaMetrics');
    });

    it('contains modelVersion', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toContain('modelVersion');
    });

    it('contains promptVersion', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toContain('promptVersion');
    });

    it('contains toolchainDigest', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toContain('toolchainDigest');
    });

    it('contains evaluatorVersion', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toContain('evaluatorVersion');
    });

    it('contains promotionDecisionHash', () => {
      expect(REQUIRED_EVAL_LINEAGE_FIELDS).toContain('promotionDecisionHash');
    });

    it('every field is a valid key of EvalLineageRecord (no typos)', () => {
      // Compile-time check: if this compiles, every entry is a valid EvalLineageRecord key
      // Runtime: every entry must be a non-empty string
      for (const field of REQUIRED_EVAL_LINEAGE_FIELDS) {
        expect(typeof field).toBe('string');
        expect(field.length).toBeGreaterThan(0);
      }
    });

    it('has no duplicate fields', () => {
      expect(new Set(REQUIRED_EVAL_LINEAGE_FIELDS).size).toBe(REQUIRED_EVAL_LINEAGE_FIELDS.length);
    });
  });

  // ─── Behavior 4: AI_EVAL_TRIGGERS contains expected glob patterns ─────────

  describe('Behavior 4: AI_EVAL_TRIGGERS contains expected glob patterns', () => {
    it('is a non-empty array', () => {
      expect(Array.isArray(AI_EVAL_TRIGGERS)).toBe(true);
      expect(AI_EVAL_TRIGGERS.length).toBeGreaterThan(0);
    });

    it('includes embeddings glob', () => {
      expect(AI_EVAL_TRIGGERS.some(t => t.includes('embeddings'))).toBe(true);
    });

    it('includes nl-to-cypher pattern', () => {
      expect(AI_EVAL_TRIGGERS.some(t => t.includes('nl-to-cypher'))).toBe(true);
    });

    it('includes SKILL.md', () => {
      expect(AI_EVAL_TRIGGERS).toContain('SKILL.md');
    });

    it('includes AGENTS.md', () => {
      expect(AI_EVAL_TRIGGERS).toContain('AGENTS.md');
    });

    it('includes CLAUDE.md', () => {
      expect(AI_EVAL_TRIGGERS).toContain('CLAUDE.md');
    });

    it('includes .mcp.json', () => {
      expect(AI_EVAL_TRIGGERS).toContain('.mcp.json');
    });
  });

  // ─── Behavior 5: compile-time type satisfaction ────────────────────────────

  describe('Behavior 5: EvalLineageRecord type shape', () => {
    it('REQUIRED_EVAL_LINEAGE_FIELDS covers 9 of the 10 interface keys (excluding evaluatedAt)', () => {
      // EvalLineageRecord has 10 fields total; evaluatedAt is the only one not in REQUIRED set
      // Verify that the required fields count is 9 out of 10
      const knownKeys: (keyof EvalLineageRecord)[] = [
        'evalSetVersion', 'hazardClass', 'baselineRef', 'deltaMetrics',
        'modelVersion', 'promptVersion', 'toolchainDigest', 'evaluatorVersion',
        'promotionDecisionHash', 'evaluatedAt',
      ];
      const requiredSet = new Set(REQUIRED_EVAL_LINEAGE_FIELDS as string[]);
      // evaluatedAt is intentionally excluded from required fields
      expect(requiredSet.has('evaluatedAt')).toBe(false);
      // All 9 required fields are valid interface keys
      for (const f of REQUIRED_EVAL_LINEAGE_FIELDS) {
        expect(knownKeys).toContain(f);
      }
    });
  });
});
