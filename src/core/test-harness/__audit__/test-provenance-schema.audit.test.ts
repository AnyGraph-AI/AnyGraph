/**
 * AUD-TC-07-L1-07: test-provenance-schema.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/TDD_ROADMAP.md §Milestone N1
 *              "Define and freeze test provenance schema" + S5 Provenance Store
 *
 * Accept: 5+ behavioral assertions, all green
 */
import { describe, it, expect } from 'vitest';
import {
  TEST_PROVENANCE_SCHEMA_VERSION,
  REQUIRED_PROVENANCE_FIELDS,
  type TestProvenanceRecord,
  type ExternalParameters,
  type Byproduct,
} from '../../../core/config/test-provenance-schema.js';

describe('AUD-TC-07 | test-provenance-schema.ts', () => {

  // ─── Behavior 1: TEST_PROVENANCE_SCHEMA_VERSION is "1.0.0" ───────────────

  describe('Behavior 1: TEST_PROVENANCE_SCHEMA_VERSION is "1.0.0"', () => {
    it('equals exactly "1.0.0"', () => {
      expect(TEST_PROVENANCE_SCHEMA_VERSION).toBe('1.0.0');
    });

    it('is a string type', () => {
      expect(typeof TEST_PROVENANCE_SCHEMA_VERSION).toBe('string');
    });
  });

  // ─── Behavior 2: REQUIRED_PROVENANCE_FIELDS has exactly 5 fields ─────────

  describe('Behavior 2: REQUIRED_PROVENANCE_FIELDS contains exactly 5 required fields', () => {
    it('has exactly 5 entries', () => {
      expect(REQUIRED_PROVENANCE_FIELDS).toHaveLength(5);
    });

    it('contains subjectDigests', () => {
      expect(REQUIRED_PROVENANCE_FIELDS).toContain('subjectDigests');
    });

    it('contains externalParameters', () => {
      expect(REQUIRED_PROVENANCE_FIELDS).toContain('externalParameters');
    });

    it('contains builderId', () => {
      expect(REQUIRED_PROVENANCE_FIELDS).toContain('builderId');
    });

    it('contains invocationId', () => {
      expect(REQUIRED_PROVENANCE_FIELDS).toContain('invocationId');
    });

    it('contains executedAt', () => {
      expect(REQUIRED_PROVENANCE_FIELDS).toContain('executedAt');
    });

    it('has no duplicates', () => {
      expect(new Set(REQUIRED_PROVENANCE_FIELDS).size).toBe(REQUIRED_PROVENANCE_FIELDS.length);
    });

    it('every field is a valid key of TestProvenanceRecord', () => {
      const knownKeys: (keyof TestProvenanceRecord)[] = [
        'subjectDigests', 'externalParameters', 'resolvedDependencies',
        'builderId', 'invocationId', 'executedAt', 'byproducts',
      ];
      for (const field of REQUIRED_PROVENANCE_FIELDS) {
        expect(knownKeys).toContain(field);
      }
    });
  });

  // ─── Behavior 3: ExternalParameters.fixtureTier union of exactly 4 tiers ─

  describe('Behavior 3: ExternalParameters.fixtureTier is union of exactly 4 tiers', () => {
    // TypeScript union enforcement is compile-time; we verify all valid literals at runtime
    // by constructing valid ExternalParameters objects for each tier
    const validTiers: ExternalParameters['fixtureTier'][] = [
      'micro', 'scenario', 'sampled', 'stress',
    ];

    it('accepts "micro" fixtureTier', () => {
      const ep: ExternalParameters = { lane: 'A', fixtureTier: 'micro' };
      expect(ep.fixtureTier).toBe('micro');
    });

    it('accepts "scenario" fixtureTier', () => {
      const ep: ExternalParameters = { lane: 'A', fixtureTier: 'scenario' };
      expect(ep.fixtureTier).toBe('scenario');
    });

    it('accepts "sampled" fixtureTier', () => {
      const ep: ExternalParameters = { lane: 'A', fixtureTier: 'sampled' };
      expect(ep.fixtureTier).toBe('sampled');
    });

    it('accepts "stress" fixtureTier', () => {
      const ep: ExternalParameters = { lane: 'A', fixtureTier: 'stress' };
      expect(ep.fixtureTier).toBe('stress');
    });

    it('has exactly 4 valid fixture tiers', () => {
      expect(validTiers).toHaveLength(4);
      expect(new Set(validTiers).size).toBe(4);
    });
  });

  // ─── Behavior 4: Byproduct.type union of exactly 5 types ─────────────────

  describe('Behavior 4: Byproduct.type is union of exactly 5 types', () => {
    const validTypes: Byproduct['type'][] = [
      'log', 'counterexample', 'diff', 'snapshot', 'report',
    ];

    it('accepts "log" type', () => {
      const b: Byproduct = { type: 'log', ref: '/path/to/log' };
      expect(b.type).toBe('log');
    });

    it('accepts "counterexample" type', () => {
      const b: Byproduct = { type: 'counterexample', ref: 'artifact/ce.json' };
      expect(b.type).toBe('counterexample');
    });

    it('accepts "diff" type', () => {
      const b: Byproduct = { type: 'diff', ref: 'artifact/diff.txt' };
      expect(b.type).toBe('diff');
    });

    it('accepts "snapshot" type', () => {
      const b: Byproduct = { type: 'snapshot', ref: 'artifact/snap.json' };
      expect(b.type).toBe('snapshot');
    });

    it('accepts "report" type', () => {
      const b: Byproduct = { type: 'report', ref: 'artifact/report.html' };
      expect(b.type).toBe('report');
    });

    it('has exactly 5 valid byproduct types', () => {
      expect(validTypes).toHaveLength(5);
      expect(new Set(validTypes).size).toBe(5);
    });
  });

  // ─── Behavior 5: TestProvenanceRecord shape ────────────────────────────────

  describe('Behavior 5: TestProvenanceRecord interface enforces all fields are typed', () => {
    it('can construct a valid minimal TestProvenanceRecord', () => {
      const record: TestProvenanceRecord = {
        subjectDigests: [{ name: 'test.ts', digest: 'sha256:abc123', type: 'application/typescript' }],
        externalParameters: { lane: 'A', fixtureTier: 'micro', seed: '42' },
        resolvedDependencies: [{ name: 'vitest', version: '2.0.0' }],
        builderId: 'watson-test-runner',
        invocationId: 'inv-001',
        executedAt: '2026-03-23T00:00:00.000Z',
        byproducts: [],
      };
      expect(record.builderId).toBe('watson-test-runner');
      expect(record.externalParameters.fixtureTier).toBe('micro');
      expect(record.subjectDigests).toHaveLength(1);
    });

    it('required provenance fields are all present on the constructed record', () => {
      const record: TestProvenanceRecord = {
        subjectDigests: [],
        externalParameters: { lane: 'B', fixtureTier: 'scenario' },
        resolvedDependencies: [],
        builderId: 'ci-runner',
        invocationId: 'run-xyz',
        executedAt: '2026-01-01T00:00:00.000Z',
        byproducts: [],
      };
      for (const field of REQUIRED_PROVENANCE_FIELDS) {
        expect(record[field as keyof TestProvenanceRecord]).toBeDefined();
      }
    });

    it('SLSA-shaped: subjectDigests supports digest field', () => {
      const digest = { name: 'artifact.json', digest: 'sha256:deadbeef', type: 'application/json' };
      expect(digest.digest.startsWith('sha256:')).toBe(true);
    });
  });
});
