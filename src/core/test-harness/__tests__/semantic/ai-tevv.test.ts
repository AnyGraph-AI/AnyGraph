/**
 * L2: AI TEVV Full Lane — Test Suite
 *
 * Tests the three L2 tasks:
 * 1. Public canary + private promotion + adversarial eval sets
 * 2. Per-hazard thresholds
 * 3. Lineage-gated promotion
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L2
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  runEvalCase,
  runEvalSet,
  evaluatePromotion,
  DEFAULT_HAZARD_THRESHOLDS,
  NL_TO_CYPHER_CANARY,
  NL_TO_CYPHER_ADVERSARIAL,
  type EvalCase,
  type EvalResult,
  type HazardThreshold,
} from '../../index.js';

describe('L2: AI TEVV Full Lane', () => {
  beforeEach(() => {
    setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' });
  });

  afterEach(() => {
    teardownHermeticEnv();
  });

  describe('Task 1: Eval set tiers', () => {
    it('canary eval set has correct structure', () => {
      expect(NL_TO_CYPHER_CANARY.length).toBeGreaterThanOrEqual(3);
      for (const c of NL_TO_CYPHER_CANARY) {
        expect(c.tier).toBe('public_canary');
        expect(c.caseId).toBeTruthy();
        expect(c.hazardClass).toBeTruthy();
        expect(c.input).toBeTruthy();
        expect(c.expected.mode).toBeTruthy();
        expect(c.expected.value).toBeTruthy();
      }
    });

    it('adversarial eval set has correct structure', () => {
      expect(NL_TO_CYPHER_ADVERSARIAL.length).toBeGreaterThanOrEqual(3);
      for (const c of NL_TO_CYPHER_ADVERSARIAL) {
        expect(c.tier).toBe('adversarial');
        expect(['harmful_output', 'privacy_leak', 'fabrication']).toContain(c.hazardClass);
      }
    });

    it('runEvalCase: contains match passes correctly', () => {
      const evalCase: EvalCase = {
        caseId: 'test_contains',
        tier: 'public_canary',
        hazardClass: 'fabrication',
        input: 'test query',
        expected: { mode: 'contains', value: 'MATCH' },
        description: 'test',
        tags: [],
      };
      const result = runEvalCase(evalCase, 'MATCH (n) RETURN n');
      expect(result.passed).toBe(true);
      expect(result.matchDetails).toContain('Contains');
    });

    it('runEvalCase: not_contains blocks forbidden output', () => {
      const evalCase: EvalCase = {
        caseId: 'test_notcontains',
        tier: 'adversarial',
        hazardClass: 'harmful_output',
        input: 'drop everything',
        expected: { mode: 'not_contains', value: 'DELETE' },
        description: 'test',
        tags: [],
      };
      expect(runEvalCase(evalCase, 'MATCH (n) RETURN n').passed).toBe(true);
      expect(runEvalCase(evalCase, 'MATCH (n) DELETE n').passed).toBe(false);
    });

    it('runEvalCase: regex match works', () => {
      const evalCase: EvalCase = {
        caseId: 'test_regex',
        tier: 'public_canary',
        hazardClass: 'fabrication',
        input: 'test',
        expected: { mode: 'regex', value: 'MATCH.*RETURN' },
        description: 'test',
        tags: [],
      };
      expect(runEvalCase(evalCase, 'MATCH (n) RETURN n').passed).toBe(true);
      expect(runEvalCase(evalCase, 'SELECT * FROM nodes').passed).toBe(false);
    });

    it('runEvalSet: aggregates results correctly', () => {
      const cases: EvalCase[] = [
        { caseId: 'c1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
        { caseId: 'c2', tier: 'public_canary', hazardClass: 'fabrication', input: 'b', expected: { mode: 'contains', value: 'y' }, description: '', tags: [] },
        { caseId: 'c3', tier: 'public_canary', hazardClass: 'hallucination', input: 'c', expected: { mode: 'contains', value: 'z' }, description: '', tags: [] },
      ];
      const outputs = new Map([['c1', 'has x'], ['c2', 'no match'], ['c3', 'has z']]);
      const result = runEvalSet(cases, outputs);

      expect(result.totalCases).toBe(3);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.passRate).toBeCloseTo(2/3, 2);
      expect(result.failedCases).toHaveLength(1);
      expect(result.failedCases[0].caseId).toBe('c2');
    });
  });

  describe('Task 2: Per-hazard thresholds', () => {
    it('default thresholds cover all 5 hazard categories', () => {
      expect(DEFAULT_HAZARD_THRESHOLDS).toHaveLength(5);
      const categories = DEFAULT_HAZARD_THRESHOLDS.map(t => t.hazardClass);
      expect(categories).toContain('fabrication');
      expect(categories).toContain('hallucination');
      expect(categories).toContain('harmful_output');
      expect(categories).toContain('bias_discrimination');
      expect(categories).toContain('privacy_leak');
    });

    it('fabrication and harmful_output require 100% pass rate', () => {
      const fab = DEFAULT_HAZARD_THRESHOLDS.find(t => t.hazardClass === 'fabrication')!;
      const harm = DEFAULT_HAZARD_THRESHOLDS.find(t => t.hazardClass === 'harmful_output')!;
      expect(fab.minPassRate).toBe(1.0);
      expect(fab.maxFailures).toBe(0);
      expect(harm.minPassRate).toBe(1.0);
      expect(harm.maxFailures).toBe(0);
    });

    it('all default thresholds block promotion', () => {
      for (const t of DEFAULT_HAZARD_THRESHOLDS) {
        expect(t.blocksPromotion).toBe(true);
      }
    });
  });

  describe('Task 3: Lineage-gated promotion', () => {
    it('all passing → promotion approved', () => {
      const cases: EvalCase[] = [
        { caseId: 'p1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
        { caseId: 'p2', tier: 'public_canary', hazardClass: 'hallucination', input: 'b', expected: { mode: 'contains', value: 'y' }, description: '', tags: [] },
      ];
      const results: EvalResult[] = [
        { caseId: 'p1', passed: true, actualOutput: 'x', matchDetails: 'ok', durationMs: 1, evaluatedAt: '' },
        { caseId: 'p2', passed: true, actualOutput: 'y', matchDetails: 'ok', durationMs: 1, evaluatedAt: '' },
      ];
      const decision = evaluatePromotion(results, cases);
      expect(decision.approved).toBe(true);
      expect(decision.blockingHazards).toHaveLength(0);
      expect(decision.lineageDigest).toHaveLength(64);
    });

    it('fabrication failure → promotion blocked', () => {
      const cases: EvalCase[] = [
        { caseId: 'f1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
      ];
      const results: EvalResult[] = [
        { caseId: 'f1', passed: false, actualOutput: 'wrong', matchDetails: 'no match', durationMs: 1, evaluatedAt: '' },
      ];
      const decision = evaluatePromotion(results, cases);
      expect(decision.approved).toBe(false);
      expect(decision.blockingHazards).toContain('fabrication');
      expect(decision.reasoning).toContain('BLOCKED');
    });

    it('hallucination within tolerance → promotion approved', () => {
      const cases: EvalCase[] = [];
      const results: EvalResult[] = [];
      for (let i = 0; i < 20; i++) {
        cases.push({ caseId: `h${i}`, tier: 'public_canary', hazardClass: 'hallucination', input: `q${i}`, expected: { mode: 'contains', value: 'x' }, description: '', tags: [] });
        results.push({ caseId: `h${i}`, passed: i !== 5, actualOutput: i === 5 ? 'bad' : 'x', matchDetails: '', durationMs: 1, evaluatedAt: '' });
      }
      const decision = evaluatePromotion(results, cases);
      expect(decision.approved).toBe(true);
    });

    it('lineage digest is deterministic for same results', () => {
      const cases: EvalCase[] = [
        { caseId: 'd1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
      ];
      const results: EvalResult[] = [
        { caseId: 'd1', passed: true, actualOutput: 'x', matchDetails: 'ok', durationMs: 1, evaluatedAt: '' },
      ];
      const d1 = evaluatePromotion(results, cases);
      const d2 = evaluatePromotion(results, cases);
      expect(d1.lineageDigest).toBe(d2.lineageDigest);
    });

    it('custom thresholds override defaults', () => {
      const relaxed: HazardThreshold[] = [
        { hazardClass: 'fabrication', minPassRate: 0.5, maxFailures: 10, blocksPromotion: false },
      ];
      const cases: EvalCase[] = [
        { caseId: 'r1', tier: 'public_canary', hazardClass: 'fabrication', input: 'a', expected: { mode: 'contains', value: 'x' }, description: '', tags: [] },
      ];
      const results: EvalResult[] = [
        { caseId: 'r1', passed: false, actualOutput: 'nope', matchDetails: 'fail', durationMs: 1, evaluatedAt: '' },
      ];
      const decision = evaluatePromotion(results, cases, relaxed);
      expect(decision.approved).toBe(true);
    });
  });
});
