/**
 * GTH-1: Core Runtime + Pack Interface Tests
 *
 * Tests the GroundTruthRuntime with a mock pack, verifying:
 * - Pack interface contract (all methods exist and return correct types)
 * - Runtime panel orchestration (all three panels)
 * - Check tiering (fast/medium/heavy)
 * - Core integrity checks run and produce IntegrityFinding objects
 * - Observation type has full provenance envelope
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroundTruthPack } from '../../../ground-truth/pack-interface.js';
import { GroundTruthRuntime } from '../../../ground-truth/runtime.js';
import type {
  Observation,
  IntegrityFinding,
  TransitiveImpactClaim,
  CandidateEdge,
  CheckTier,
  FreshnessState,
  ConfidenceClass,
} from '../../../ground-truth/types.js';

// ─── Mock Pack ──────────────────────────────────────────────────────

function createMockPack(): GroundTruthPack {
  return {
    domain: 'test-pack',
    version: '1.0.0',
    queryPlanStatus: vi.fn().mockResolvedValue([
      makeObservation({ done: 297, planned: 135 }, 'Task', 'exact'),
    ]),
    queryGovernanceHealth: vi.fn().mockResolvedValue([
      makeObservation({ interceptionRate: 1.0 }, 'GovernanceMetricSnapshot', 'exact'),
    ]),
    queryEvidenceCoverage: vi.fn().mockResolvedValue([
      makeObservation({ withEvidence: 82, total: 297, pct: 27.6 }, 'HAS_CODE_EVIDENCE', 'exact'),
    ]),
    queryRelevantClaims: vi.fn().mockResolvedValue([]),
    queryIntegritySurfaces: vi.fn().mockResolvedValue([
      makeFinding('test_coverage', 'coverage', 'domain', 'warning', 72.4, 0, false),
    ]),
    queryTransitiveImpact: vi.fn().mockResolvedValue([]),
    queryCandidateModifies: vi.fn().mockResolvedValue([]),
  };
}

function makeObservation(
  value: unknown,
  source: string,
  confidenceClass: ConfidenceClass,
  freshnessState: FreshnessState = 'fresh',
): Observation {
  return {
    value,
    observedAt: new Date().toISOString(),
    source,
    freshnessState,
    confidenceClass,
  };
}

function makeFinding(
  definitionId: string,
  surface: IntegrityFinding['surface'],
  surfaceClass: IntegrityFinding['surfaceClass'],
  severity: IntegrityFinding['severity'],
  observedValue: number,
  expectedValue: number,
  pass: boolean,
): IntegrityFinding {
  return {
    definitionId,
    surface,
    surfaceClass,
    severity,
    description: `Test check: ${definitionId}`,
    observedValue,
    expectedValue,
    pass,
    trend: 'new',
    tier: 'medium',
    observedAt: new Date().toISOString(),
  };
}

// ─── Mock Neo4j ─────────────────────────────────────────────────────

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([{ cnt: 0 }]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('GTH-1: Core Runtime + Pack Interface', () => {
  let pack: GroundTruthPack;
  let neo4j: any;
  let runtime: GroundTruthRuntime;

  beforeEach(() => {
    pack = createMockPack();
    neo4j = createMockNeo4j();
    runtime = new GroundTruthRuntime(pack, neo4j);
  });

  // ─── Pack Interface Contract ──────────────────────────────────
  describe('GroundTruthPack interface', () => {
    it('has all required properties', () => {
      expect(pack.domain).toBe('test-pack');
      expect(pack.version).toBe('1.0.0');
    });

    it('has all Panel 1A methods', () => {
      expect(typeof pack.queryPlanStatus).toBe('function');
      expect(typeof pack.queryGovernanceHealth).toBe('function');
      expect(typeof pack.queryEvidenceCoverage).toBe('function');
      expect(typeof pack.queryRelevantClaims).toBe('function');
    });

    it('has Panel 1B method', () => {
      expect(typeof pack.queryIntegritySurfaces).toBe('function');
    });

    it('has Panel 3 methods', () => {
      expect(typeof pack.queryTransitiveImpact).toBe('function');
      expect(typeof pack.queryCandidateModifies).toBe('function');
    });
  });

  // ─── Observation Type ─────────────────────────────────────────
  describe('Observation type', () => {
    it('carries full provenance envelope', () => {
      const obs = makeObservation({ count: 42 }, 'Task', 'exact', 'fresh');
      expect(obs.value).toEqual({ count: 42 });
      expect(obs.observedAt).toBeTruthy();
      expect(obs.source).toBe('Task');
      expect(obs.freshnessState).toBe('fresh');
      expect(obs.confidenceClass).toBe('exact');
    });

    it('supports all freshness states', () => {
      const states: FreshnessState[] = ['fresh', 'stale', 'unknown'];
      for (const state of states) {
        const obs = makeObservation(null, 'test', 'exact', state);
        expect(obs.freshnessState).toBe(state);
      }
    });

    it('supports all confidence classes', () => {
      const classes: ConfidenceClass[] = ['exact', 'derived', 'predicted'];
      for (const cls of classes) {
        const obs = makeObservation(null, 'test', cls);
        expect(obs.confidenceClass).toBe(cls);
      }
    });
  });

  // ─── IntegrityFinding Type ────────────────────────────────────
  describe('IntegrityFinding type', () => {
    it('has all required fields', () => {
      const finding = makeFinding('test_id', 'schema', 'core', 'warning', 5, 0, false);
      expect(finding.definitionId).toBe('test_id');
      expect(finding.surface).toBe('schema');
      expect(finding.surfaceClass).toBe('core');
      expect(finding.severity).toBe('warning');
      expect(finding.observedValue).toBe(5);
      expect(finding.expectedValue).toBe(0);
      expect(finding.pass).toBe(false);
      expect(finding.trend).toBe('new');
    });
  });

  // ─── Runtime Panel Orchestration ──────────────────────────────
  describe('GroundTruthRuntime.run()', () => {
    it('returns all three panels + meta', async () => {
      const output = await runtime.run({
        projectId: 'proj_test',
        planProjectId: 'plan_test',
        depth: 'fast',
      });

      expect(output.panel1).toBeDefined();
      expect(output.panel2).toBeDefined();
      expect(output.panel3).toBeDefined();
      expect(output.meta).toBeDefined();
      expect(output.meta.projectId).toBe('proj_test');
      expect(output.meta.depth).toBe('fast');
      expect(output.meta.runAt).toBeTruthy();
      expect(output.meta.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('Panel 1 includes plan status, governance, evidence, claims, integrity', async () => {
      const output = await runtime.run({
        projectId: 'proj_test',
        planProjectId: 'plan_test',
        currentTaskId: 'task_1',
        depth: 'fast',
      });

      expect(output.panel1.planStatus).toHaveLength(1);
      expect(output.panel1.governanceHealth).toHaveLength(1);
      expect(output.panel1.evidenceCoverage).toHaveLength(1);
      expect(output.panel1.integrity).toBeDefined();
      expect(output.panel1.integrity.summary).toBeDefined();
    });

    it('Panel 2 returns IDLE when no agentId', async () => {
      const output = await runtime.run({
        projectId: 'proj_test',
        depth: 'fast',
      });

      expect(output.panel2.status).toBe('IDLE');
      expect(output.panel2.currentTaskId).toBeNull();
      expect(output.panel2.sessionBookmark).toBeNull();
    });

    it('Panel 3 returns deltas computed from graph/agent state', async () => {
      const output = await runtime.run({
        projectId: 'proj_test',
        depth: 'fast',
      });

      // Deltas are now computed by the delta engine (GTH-3)
      // Even with no task/files, derived deltas may appear (e.g., evidence coverage)
      expect(output.panel3.transitiveImpact).toEqual([]);
      expect(output.panel3.candidateModifies).toEqual([]);
      expect(Array.isArray(output.panel3.deltas)).toBe(true);
    });

    it('calls pack methods with correct arguments', async () => {
      await runtime.run({
        projectId: 'proj_test',
        planProjectId: 'plan_test',
        currentTaskId: 'task_42',
        filesTouched: ['src/foo.ts'],
        depth: 'fast',
      });

      expect(pack.queryPlanStatus).toHaveBeenCalledWith('plan_test');
      expect(pack.queryGovernanceHealth).toHaveBeenCalledWith('proj_test');
      expect(pack.queryEvidenceCoverage).toHaveBeenCalledWith('plan_test');
      expect(pack.queryRelevantClaims).toHaveBeenCalledWith('task_42', ['src/foo.ts'], 'proj_test');
    });
  });

  // ─── Check Tiering ────────────────────────────────────────────
  describe('Check tiering', () => {
    it('fast depth runs only fast checks', async () => {
      const report = await runtime.panel1B('proj_test', 'fast');

      // All core findings should be fast tier
      for (const finding of report.core) {
        expect(finding.tier).toBe('fast');
      }
    });

    it('medium depth runs fast + medium checks', async () => {
      const report = await runtime.panel1B('proj_test', 'medium');

      const tiers = new Set(report.core.map(f => f.tier));
      // Should have fast and medium, but not heavy
      expect(tiers.has('heavy')).toBe(false);
    });

    it('heavy depth runs all checks', async () => {
      const report = await runtime.panel1B('proj_test', 'heavy');

      const tiers = new Set(report.core.map(f => f.tier));
      // Should include all three tiers
      expect(report.core.length).toBeGreaterThan(0);
      // Heavy tier should be present
      expect(tiers.has('heavy')).toBe(true);
    });

    it('combines core + domain findings in report', async () => {
      const report = await runtime.panel1B('proj_test', 'medium');

      expect(report.core.length).toBeGreaterThan(0);
      expect(report.domain).toHaveLength(1); // from mock pack
      expect(report.domain[0].surfaceClass).toBe('domain');
      expect(report.summary.totalChecks).toBe(report.core.length + report.domain.length);
    });
  });

  // ─── Core Integrity Checks ───────────────────────────────────
  describe('Core integrity checks', () => {
    it('produces IntegrityFinding objects with correct shape', async () => {
      const report = await runtime.panel1B('proj_test', 'medium');

      for (const finding of report.core) {
        expect(finding.definitionId).toBeTruthy();
        expect(['schema', 'referential', 'provenance', 'freshness']).toContain(finding.surface);
        expect(finding.surfaceClass).toBe('core');
        expect(['critical', 'warning', 'info']).toContain(finding.severity);
        expect(typeof finding.observedValue).toBe('number');
        expect(typeof finding.expectedValue).toBe('number');
        expect(typeof finding.pass).toBe('boolean');
        expect(finding.observedAt).toBeTruthy();
      }
    });

    it('marks passing checks correctly (mock returns 0 for all)', async () => {
      const report = await runtime.panel1B('proj_test', 'medium');

      for (const finding of report.core) {
        expect(finding.pass).toBe(true);
        expect(finding.observedValue).toBe(0);
      }
    });

    it('marks failing checks correctly when neo4j returns non-zero', async () => {
      neo4j.run.mockResolvedValue([{ cnt: 42 }]);

      const report = await runtime.panel1B('proj_test', 'medium');

      // At least one check should fail (all return 42 instead of expected 0)
      const failures = report.core.filter(f => !f.pass);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].observedValue).toBe(42);
    });

    it('handles neo4j errors gracefully', async () => {
      neo4j.run.mockRejectedValue(new Error('Connection refused'));

      const report = await runtime.panel1B('proj_test', 'fast');

      // Errors should produce critical findings, not throw
      const errorFindings = report.core.filter(
        f => f.description.includes('CHECK FAILED TO EXECUTE'),
      );
      expect(errorFindings.length).toBeGreaterThan(0);
      expect(errorFindings[0].severity).toBe('critical');
      expect(errorFindings[0].pass).toBe(false);
    });

    it('summary counts are correct', async () => {
      const report = await runtime.panel1B('proj_test', 'medium');

      expect(report.summary.totalChecks).toBe(report.core.length + report.domain.length);
      expect(report.summary.passed + report.summary.failed).toBe(report.summary.totalChecks);
    });
  });

  // ─── Project ID derivation ───────────────────────────────────
  describe('Project ID derivation', () => {
    it('uses provided planProjectId', async () => {
      await runtime.run({
        projectId: 'proj_test',
        planProjectId: 'plan_custom',
        depth: 'fast',
      });

      expect(pack.queryPlanStatus).toHaveBeenCalledWith('plan_custom');
    });

    it('derives planProjectId from projectId when not provided', async () => {
      await runtime.run({
        projectId: 'proj_c0d3e9a1f200',
        depth: 'fast',
      });

      expect(pack.queryPlanStatus).toHaveBeenCalledWith('plan_codegraph');
    });
  });
});
