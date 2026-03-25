// Spec source: _drafts/ground-truth-hook/DESIGN.md
import { describe, it, expect } from 'vitest';
import type {
  TaskStatusValue,
  MilestoneValue,
  UnblockedTaskValue,
  GovernanceHealthValue,
  EvidenceCoverageValue,
  Observation,
} from '../types.js';

describe('AUD-TC-11d-11: types structural contracts', () => {
  it('TaskStatusValue structural shape is enforced', () => {
    const value: TaskStatusValue = { done: 10, planned: 2, total: 12, pct: 83 };
    expect(value.total).toBe(12);
    expect(value.pct).toBe(83);
  });

  it('MilestoneValue and UnblockedTaskValue required fields exist', () => {
    const milestone: MilestoneValue = { name: 'RF-1', done: 1, total: 3 };
    const task: UnblockedTaskValue = { milestone: 'RF-1', task: 'Add view typing' };
    expect(milestone.name).toBe('RF-1');
    expect(task.task).toContain('view');
  });

  it('GovernanceHealthValue and EvidenceCoverageValue numeric contracts', () => {
    const health: GovernanceHealthValue = {
      verificationRuns: 9,
      gateFailures: 0,
      interceptionRate: 1,
      invariantViolations: 0,
      ageHours: 2,
    };
    const coverage: EvidenceCoverageValue = { withEvidence: 82, withoutEvidence: 215, total: 297, pct: 28 };
    expect(health.gateFailures).toBe(0);
    expect(coverage.total).toBe(297);
  });

  it('Observation envelope requires provenance fields', () => {
    const obs: Observation = {
      value: { count: 1 },
      observedAt: new Date().toISOString(),
      source: 'Task',
      freshnessState: 'fresh',
      confidenceClass: 'exact',
    };
    expect(obs.source).toBe('Task');
    expect(obs.freshnessState).toBe('fresh');
  });
});
