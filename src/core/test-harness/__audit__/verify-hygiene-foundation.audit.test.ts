/**
 * AUD-TC-03-L2-04: verify-hygiene-foundation.ts audit tests
 *
 * Verdict: INCOMPLETE
 * Existing tests (hygiene-foundation-verify.spec-test.ts) cover getRequiredEntitySet
 * with 2 solid behavioral tests (inactive lanes → minimal set, active lanes → full set).
 * But the main() function and all graph query/exit logic is untested.
 *
 * SPEC-GAP: REQUIRED_FAILURE_CLASSES contains the 4 required classes
 * SPEC-GAP: REQUIRED_ENTITY_LABELS contains the 6 required labels
 * SPEC-GAP: getRequiredEntitySet boundary: single lane active at a time
 * SPEC-GAP: getRequiredEntitySet never includes Artifact (advisory only)
 * SPEC-GAP: missing entities detection logic (missingEntities filter)
 * SPEC-GAP: main() exits with code 1 when required entities missing
 * SPEC-GAP: main() accepts PROJECT_ID from env
 */

import { describe, it, expect } from 'vitest';
import { getRequiredEntitySet } from '../../../utils/verify-hygiene-foundation.js';

describe('AUD-TC-03-L2-04: verify-hygiene-foundation spec-gap coverage', () => {
  // SPEC-GAP: getRequiredEntitySet boundary cases — one lane at a time
  describe('getRequiredEntitySet single-lane activation', () => {
    it('activates only DocumentWitness when only document projects exist', () => {
      const required = getRequiredEntitySet({
        documentProjectCount: 1,
        advisoryGateDecisionCount: 0,
        commitLinkedVerificationRunCount: 0,
      });
      expect(required.has('DocumentWitness')).toBe(true);
      expect(required.has('GateDecision')).toBe(false);
      expect(required.has('CommitSnapshot')).toBe(false);
    });

    it('activates only GateDecision when only advisory gates exist', () => {
      const required = getRequiredEntitySet({
        documentProjectCount: 0,
        advisoryGateDecisionCount: 5,
        commitLinkedVerificationRunCount: 0,
      });
      expect(required.has('GateDecision')).toBe(true);
      expect(required.has('DocumentWitness')).toBe(false);
      expect(required.has('CommitSnapshot')).toBe(false);
    });

    it('activates only CommitSnapshot when only commit-linked runs exist', () => {
      const required = getRequiredEntitySet({
        documentProjectCount: 0,
        advisoryGateDecisionCount: 0,
        commitLinkedVerificationRunCount: 10,
      });
      expect(required.has('CommitSnapshot')).toBe(true);
      expect(required.has('GateDecision')).toBe(false);
      expect(required.has('DocumentWitness')).toBe(false);
    });
  });

  // SPEC-GAP: Artifact is NEVER in the required set (advisory only)
  describe('Artifact is always advisory-only', () => {
    it('Artifact is not required even when all lanes are active', () => {
      const required = getRequiredEntitySet({
        documentProjectCount: 100,
        advisoryGateDecisionCount: 100,
        commitLinkedVerificationRunCount: 100,
      });
      expect(required.has('Artifact' as any)).toBe(false);
    });

    it('Artifact is not required when all lanes are inactive', () => {
      const required = getRequiredEntitySet({
        documentProjectCount: 0,
        advisoryGateDecisionCount: 0,
        commitLinkedVerificationRunCount: 0,
      });
      expect(required.has('Artifact' as any)).toBe(false);
    });
  });

  // SPEC-GAP: Hard-required entities always present
  describe('hard-required entities invariant', () => {
    it('Project and VerificationRun are always required regardless of context', () => {
      const contexts = [
        { documentProjectCount: 0, advisoryGateDecisionCount: 0, commitLinkedVerificationRunCount: 0 },
        { documentProjectCount: 1, advisoryGateDecisionCount: 1, commitLinkedVerificationRunCount: 1 },
        { documentProjectCount: 999, advisoryGateDecisionCount: 0, commitLinkedVerificationRunCount: 0 },
      ];
      for (const ctx of contexts) {
        const required = getRequiredEntitySet(ctx);
        expect(required.has('Project')).toBe(true);
        expect(required.has('VerificationRun')).toBe(true);
      }
    });
  });

  // SPEC-GAP: Required set size bounds
  describe('required set size bounds', () => {
    it('minimum required set size is 2 (Project + VerificationRun)', () => {
      const required = getRequiredEntitySet({
        documentProjectCount: 0,
        advisoryGateDecisionCount: 0,
        commitLinkedVerificationRunCount: 0,
      });
      expect(required.size).toBe(2);
    });

    it('maximum required set size is 5 (all optional lanes active, minus Artifact)', () => {
      const required = getRequiredEntitySet({
        documentProjectCount: 1,
        advisoryGateDecisionCount: 1,
        commitLinkedVerificationRunCount: 1,
      });
      expect(required.size).toBe(5);
    });
  });

  // SPEC-GAP: missingEntities detection pattern
  // This tests the pattern used in main() to detect missing entities
  describe('missing entities detection pattern', () => {
    it('filters labels where required=true but count=0', () => {
      const REQUIRED_ENTITY_LABELS = ['Project', 'VerificationRun', 'GateDecision', 'CommitSnapshot', 'Artifact', 'DocumentWitness'] as const;

      const requiredEntitySet = getRequiredEntitySet({
        documentProjectCount: 1,
        advisoryGateDecisionCount: 1,
        commitLinkedVerificationRunCount: 1,
      });

      const entityCoverageGlobal: Record<string, number> = {
        Project: 5,
        VerificationRun: 3,
        GateDecision: 0,        // missing!
        CommitSnapshot: 2,
        Artifact: 0,            // not required
        DocumentWitness: 0,     // missing!
      };

      const missingEntities = REQUIRED_ENTITY_LABELS.filter(
        (label) => requiredEntitySet.has(label) && entityCoverageGlobal[label] === 0,
      );

      expect(missingEntities).toContain('GateDecision');
      expect(missingEntities).toContain('DocumentWitness');
      expect(missingEntities).not.toContain('Artifact');  // not required
      expect(missingEntities).not.toContain('Project');    // has count > 0
    });
  });
});
