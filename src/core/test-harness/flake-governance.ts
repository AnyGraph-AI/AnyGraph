/**
 * Flake Governance — Quarantine + Budget Monitoring
 *
 * Tracks test flake rates, quarantines flaky tests with expiry,
 * and generates weekly governance reports.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X4
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// TYPES
// ============================================================================

export interface TestRun {
  testId: string;
  testName: string;
  lane: string;
  passed: boolean;
  durationMs: number;
  runAt: string;
  runId: string;
}

export interface FlakeRecord {
  testId: string;
  testName: string;
  lane: string;
  /** Total runs in the tracking window */
  totalRuns: number;
  /** Number of failures */
  failures: number;
  /** Flake rate (failures / totalRuns) */
  flakeRate: number;
  /** Is this test currently quarantined? */
  quarantined: boolean;
  /** When was it quarantined (ISO timestamp, null if not) */
  quarantinedAt: string | null;
  /** Quarantine expiry (ISO timestamp, null if not quarantined) */
  quarantineExpiresAt: string | null;
  /** Reason for quarantine */
  quarantineReason: string | null;
  /** Number of consecutive passes since last failure */
  consecutivePasses: number;
}

export interface FlakeGovernanceConfig {
  /** Auto-quarantine threshold (flake rate over trailing window) */
  autoQuarantineThreshold: number;
  /** Trailing window size (number of runs) */
  trailingWindowSize: number;
  /** Quarantine duration in days */
  quarantineDurationDays: number;
  /** Consecutive passes needed for reintegration */
  reintegrationPasses: number;
  /** Critical lane flake budget (max acceptable flake rate) */
  criticalLaneBudget: number;
  /** Overall flake budget */
  overallBudget: number;
}

export const DEFAULT_FLAKE_CONFIG: FlakeGovernanceConfig = {
  autoQuarantineThreshold: 0.01, // >1% over trailing 200
  trailingWindowSize: 200,
  quarantineDurationDays: 14,
  reintegrationPasses: 10,
  criticalLaneBudget: 0.003, // <0.3%
  overallBudget: 0.01, // <1%
};

// ============================================================================
// FLAKE TRACKER
// ============================================================================

export class FlakeTracker {
  private records = new Map<string, FlakeRecord>();
  private runs: TestRun[] = [];
  private config: FlakeGovernanceConfig;

  constructor(config: Partial<FlakeGovernanceConfig> = {}) {
    this.config = { ...DEFAULT_FLAKE_CONFIG, ...config };
  }

  /**
   * Record a test run result.
   */
  recordRun(run: TestRun): void {
    this.runs.push(run);

    // Update or create flake record
    let record = this.records.get(run.testId);
    if (!record) {
      record = {
        testId: run.testId,
        testName: run.testName,
        lane: run.lane,
        totalRuns: 0,
        failures: 0,
        flakeRate: 0,
        quarantined: false,
        quarantinedAt: null,
        quarantineExpiresAt: null,
        quarantineReason: null,
        consecutivePasses: 0,
      };
      this.records.set(run.testId, record);
    }

    // Update counts within trailing window
    const recentRuns = this.runs
      .filter(r => r.testId === run.testId)
      .slice(-this.config.trailingWindowSize);

    record.totalRuns = recentRuns.length;
    record.failures = recentRuns.filter(r => !r.passed).length;
    record.flakeRate = record.totalRuns > 0 ? record.failures / record.totalRuns : 0;

    // Track consecutive passes
    if (run.passed) {
      record.consecutivePasses++;
    } else {
      record.consecutivePasses = 0;
    }

    // Auto-quarantine check
    if (!record.quarantined && record.flakeRate > this.config.autoQuarantineThreshold) {
      this.quarantine(run.testId, `Auto-quarantined: flake rate ${(record.flakeRate * 100).toFixed(1)}% exceeds ${(this.config.autoQuarantineThreshold * 100).toFixed(1)}% threshold`);
    }

    // Reintegration check
    if (record.quarantined && record.consecutivePasses >= this.config.reintegrationPasses) {
      this.reintegrate(run.testId);
    }
  }

  /**
   * Quarantine a test.
   */
  quarantine(testId: string, reason: string): void {
    const record = this.records.get(testId);
    if (!record) return;

    const now = new Date();
    record.quarantined = true;
    record.quarantinedAt = now.toISOString();
    record.quarantineExpiresAt = new Date(
      now.getTime() + this.config.quarantineDurationDays * 24 * 60 * 60 * 1000
    ).toISOString();
    record.quarantineReason = reason;
  }

  /**
   * Reintegrate a quarantined test.
   */
  reintegrate(testId: string): void {
    const record = this.records.get(testId);
    if (!record) return;

    record.quarantined = false;
    record.quarantinedAt = null;
    record.quarantineExpiresAt = null;
    record.quarantineReason = null;
  }

  /**
   * Check for expired quarantines and handle them.
   * Returns list of test IDs whose quarantine expired without reintegration.
   */
  checkExpiredQuarantines(now: Date = new Date()): string[] {
    const expired: string[] = [];
    for (const record of this.records.values()) {
      if (record.quarantined && record.quarantineExpiresAt) {
        if (new Date(record.quarantineExpiresAt) < now) {
          expired.push(record.testId);
          // Mark as expired but DON'T auto-reintegrate — requires investigation
        }
      }
    }
    return expired;
  }

  /**
   * Get a test's flake record.
   */
  getRecord(testId: string): FlakeRecord | undefined {
    return this.records.get(testId);
  }

  /**
   * Get all records.
   */
  getAllRecords(): FlakeRecord[] {
    return [...this.records.values()];
  }

  /**
   * Get quarantined tests.
   */
  getQuarantined(): FlakeRecord[] {
    return [...this.records.values()].filter(r => r.quarantined);
  }

  /**
   * Generate a weekly governance report.
   */
  generateReport(now: Date = new Date()): FlakeReport {
    const allRecords = this.getAllRecords();
    const quarantined = this.getQuarantined();
    const expiredQuarantines = this.checkExpiredQuarantines(now);

    // Calculate overall flake rate
    const totalRuns = this.runs.length;
    const totalFailures = this.runs.filter(r => !r.passed).length;
    const overallFlakeRate = totalRuns > 0 ? totalFailures / totalRuns : 0;

    // Per-lane breakdown
    const laneMap = new Map<string, { runs: number; failures: number }>();
    for (const run of this.runs) {
      const lane = laneMap.get(run.lane) ?? { runs: 0, failures: 0 };
      lane.runs++;
      if (!run.passed) lane.failures++;
      laneMap.set(run.lane, lane);
    }

    const laneBreakdown: LaneFlakeReport[] = [];
    for (const [laneId, stats] of laneMap) {
      const flakeRate = stats.runs > 0 ? stats.failures / stats.runs : 0;
      laneBreakdown.push({
        laneId,
        totalRuns: stats.runs,
        failures: stats.failures,
        flakeRate,
        withinBudget: flakeRate <= this.config.criticalLaneBudget,
      });
    }

    return {
      generatedAt: now.toISOString(),
      overallFlakeRate,
      overallWithinBudget: overallFlakeRate <= this.config.overallBudget,
      totalTests: allRecords.length,
      totalRuns,
      totalFailures,
      quarantineBacklog: quarantined.length,
      expiryBreaches: expiredQuarantines.length,
      expiredQuarantineIds: expiredQuarantines,
      laneBreakdown,
      topFlakers: allRecords
        .filter(r => r.flakeRate > 0)
        .sort((a, b) => b.flakeRate - a.flakeRate)
        .slice(0, 5)
        .map(r => ({ testId: r.testId, testName: r.testName, flakeRate: r.flakeRate })),
      config: { ...this.config },
    };
  }
}

// ============================================================================
// REPORT TYPES
// ============================================================================

export interface FlakeReport {
  generatedAt: string;
  overallFlakeRate: number;
  overallWithinBudget: boolean;
  totalTests: number;
  totalRuns: number;
  totalFailures: number;
  quarantineBacklog: number;
  expiryBreaches: number;
  expiredQuarantineIds: string[];
  laneBreakdown: LaneFlakeReport[];
  topFlakers: Array<{ testId: string; testName: string; flakeRate: number }>;
  config: FlakeGovernanceConfig;
}

export interface LaneFlakeReport {
  laneId: string;
  totalRuns: number;
  failures: number;
  flakeRate: number;
  withinBudget: boolean;
}
