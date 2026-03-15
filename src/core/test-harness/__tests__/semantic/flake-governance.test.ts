/**
 * X4: Flake Governance Operationalization — Test Suite
 *
 * Tests the two X4 tasks:
 * 1. Quarantine workflow with expiry + reintegration criteria
 * 2. Flake budget monitoring in weekly report
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X4
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupHermeticEnv, teardownHermeticEnv, FlakeTracker, type TestRun } from '../../index.js';

function makeRun(testId: string, passed: boolean, lane = 'A', runIndex = 0): TestRun {
  return {
    testId, testName: `test_${testId}`, lane, passed,
    durationMs: 100, runAt: new Date().toISOString(), runId: `run_${testId}_${runIndex}`,
  };
}

describe('X4: Flake Governance Operationalization', () => {
  beforeEach(() => { setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' }); });
  afterEach(() => { teardownHermeticEnv(); });

  describe('Task 1: Quarantine workflow', () => {
    it('test starts not quarantined', () => {
      const tracker = new FlakeTracker();
      tracker.recordRun(makeRun('t1', true));
      const record = tracker.getRecord('t1')!;
      expect(record.quarantined).toBe(false);
      expect(record.flakeRate).toBe(0);
    });

    it('auto-quarantine when flake rate exceeds threshold', () => {
      const tracker = new FlakeTracker({ autoQuarantineThreshold: 0.05, trailingWindowSize: 10 });
      for (let i = 0; i < 9; i++) tracker.recordRun(makeRun('t1', true, 'A', i));
      tracker.recordRun(makeRun('t1', false, 'A', 9));
      const record = tracker.getRecord('t1')!;
      expect(record.quarantined).toBe(true);
      expect(record.quarantineReason).toContain('Auto-quarantined');
      expect(record.quarantineExpiresAt).toBeTruthy();
    });

    it('reintegration after enough consecutive passes', () => {
      const tracker = new FlakeTracker({ autoQuarantineThreshold: 0.05, trailingWindowSize: 20, reintegrationPasses: 5 });
      for (let i = 0; i < 18; i++) tracker.recordRun(makeRun('t1', true, 'A', i));
      tracker.recordRun(makeRun('t1', false, 'A', 18));
      tracker.recordRun(makeRun('t1', false, 'A', 19));
      expect(tracker.getRecord('t1')!.quarantined).toBe(true);
      for (let i = 20; i < 25; i++) tracker.recordRun(makeRun('t1', true, 'A', i));
      const reintegrated = tracker.getRecord('t1')!;
      expect(reintegrated.quarantined).toBe(false);
      expect(reintegrated.quarantineReason).toBeNull();
    });

    it('expired quarantine detected', () => {
      const tracker = new FlakeTracker({ quarantineDurationDays: 14 });
      tracker.recordRun(makeRun('t1', true));
      tracker.quarantine('t1', 'manual quarantine');
      expect(tracker.checkExpiredQuarantines(new Date('2026-03-20T00:00:00.000Z'))).toHaveLength(0);
      const expired = tracker.checkExpiredQuarantines(new Date('2026-03-29T00:00:00.000Z'));
      expect(expired).toHaveLength(1);
      expect(expired[0]).toBe('t1');
    });

    it('manual quarantine and reintegrate', () => {
      const tracker = new FlakeTracker();
      tracker.recordRun(makeRun('t1', true));
      tracker.quarantine('t1', 'manual: investigating flakiness');
      expect(tracker.getRecord('t1')!.quarantined).toBe(true);
      tracker.reintegrate('t1');
      expect(tracker.getRecord('t1')!.quarantined).toBe(false);
    });

    it('quarantined tests list is accurate', () => {
      const tracker = new FlakeTracker();
      tracker.recordRun(makeRun('t1', true));
      tracker.recordRun(makeRun('t2', true));
      tracker.recordRun(makeRun('t3', true));
      tracker.quarantine('t1', 'flaky');
      tracker.quarantine('t3', 'flaky');
      const quarantined = tracker.getQuarantined();
      expect(quarantined).toHaveLength(2);
      expect(quarantined.some(r => r.testId === 't1')).toBe(true);
      expect(quarantined.some(r => r.testId === 't3')).toBe(true);
    });
  });

  describe('Task 2: Flake budget monitoring', () => {
    it('report with zero flakes shows within budget', () => {
      const tracker = new FlakeTracker();
      for (let i = 0; i < 100; i++) tracker.recordRun(makeRun(`t${i % 10}`, true, 'A', i));
      const report = tracker.generateReport();
      expect(report.overallFlakeRate).toBe(0);
      expect(report.overallWithinBudget).toBe(true);
      expect(report.quarantineBacklog).toBe(0);
      expect(report.expiryBreaches).toBe(0);
      expect(report.topFlakers).toHaveLength(0);
    });

    it('report detects lane budget breach', () => {
      const tracker = new FlakeTracker({ criticalLaneBudget: 0.01 });
      for (let i = 0; i < 98; i++) tracker.recordRun(makeRun(`ta${i % 5}`, true, 'A', i));
      tracker.recordRun(makeRun('ta_flaky', false, 'A', 98));
      tracker.recordRun(makeRun('ta_flaky', false, 'A', 99));
      for (let i = 0; i < 50; i++) tracker.recordRun(makeRun(`tb${i % 3}`, true, 'B', i));
      const report = tracker.generateReport();
      const laneA = report.laneBreakdown.find(l => l.laneId === 'A')!;
      const laneB = report.laneBreakdown.find(l => l.laneId === 'B')!;
      expect(laneA.withinBudget).toBe(false);
      expect(laneB.withinBudget).toBe(true);
    });

    it('report includes top flakers', () => {
      const tracker = new FlakeTracker({ trailingWindowSize: 10 });
      for (let i = 0; i < 5; i++) { tracker.recordRun(makeRun('flaky1', true, 'A', i)); tracker.recordRun(makeRun('flaky1', false, 'A', i + 5)); }
      for (let i = 0; i < 8; i++) tracker.recordRun(makeRun('flaky2', true, 'A', i));
      tracker.recordRun(makeRun('flaky2', false, 'A', 8));
      tracker.recordRun(makeRun('flaky2', false, 'A', 9));
      for (let i = 0; i < 10; i++) tracker.recordRun(makeRun('stable', true, 'A', i));
      const report = tracker.generateReport();
      expect(report.topFlakers.length).toBeGreaterThanOrEqual(2);
      expect(report.topFlakers[0].testId).toBe('flaky1');
      expect(report.topFlakers.some(f => f.testId === 'stable')).toBe(false);
    });

    it('report tracks quarantine backlog and expiry breaches', () => {
      const tracker = new FlakeTracker({ quarantineDurationDays: 7 });
      tracker.recordRun(makeRun('t1', true));
      tracker.recordRun(makeRun('t2', true));
      tracker.quarantine('t1', 'flaky');
      tracker.quarantine('t2', 'flaky');
      const report1 = tracker.generateReport(new Date('2026-03-14T00:00:00.000Z'));
      expect(report1.quarantineBacklog).toBe(2);
      expect(report1.expiryBreaches).toBe(0);
      const report2 = tracker.generateReport(new Date('2026-03-22T00:00:00.000Z'));
      expect(report2.quarantineBacklog).toBe(2);
      expect(report2.expiryBreaches).toBe(2);
      expect(report2.expiredQuarantineIds.sort()).toEqual(['t1', 't2']);
    });

    it('report has all required governance scoreboard fields', () => {
      const tracker = new FlakeTracker();
      tracker.recordRun(makeRun('t1', true));
      const report = tracker.generateReport();
      expect(report).toHaveProperty('overallFlakeRate');
      expect(report).toHaveProperty('quarantineBacklog');
      expect(report).toHaveProperty('expiryBreaches');
      expect(report).toHaveProperty('laneBreakdown');
      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('totalTests');
      expect(report).toHaveProperty('totalRuns');
      expect(report).toHaveProperty('totalFailures');
      expect(report).toHaveProperty('config');
    });
  });
});
