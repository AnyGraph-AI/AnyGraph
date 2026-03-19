import { describe, expect, it } from 'vitest';
import { getRequiredEntitySet } from '../../../../utils/verify-hygiene-foundation.js';

describe('[HYGIENE] verify-hygiene-foundation entity requirement policy', () => {
  it('requires only hard-core entities when optional lanes are inactive', () => {
    const required = getRequiredEntitySet({
      documentProjectCount: 0,
      advisoryGateDecisionCount: 0,
      commitLinkedVerificationRunCount: 0,
    });

    expect(required.has('Project')).toBe(true);
    expect(required.has('VerificationRun')).toBe(true);
    expect(required.has('GateDecision')).toBe(false);
    expect(required.has('CommitSnapshot')).toBe(false);
    expect(required.has('DocumentWitness')).toBe(false);
    expect(required.has('Artifact')).toBe(false);
  });

  it('activates optional requirements when corresponding lanes have data', () => {
    const required = getRequiredEntitySet({
      documentProjectCount: 1,
      advisoryGateDecisionCount: 2,
      commitLinkedVerificationRunCount: 3,
    });

    expect(required.has('Project')).toBe(true);
    expect(required.has('VerificationRun')).toBe(true);
    expect(required.has('GateDecision')).toBe(true);
    expect(required.has('CommitSnapshot')).toBe(true);
    expect(required.has('DocumentWitness')).toBe(true);
  });
});
