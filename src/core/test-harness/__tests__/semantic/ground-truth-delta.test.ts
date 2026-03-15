/**
 * GTH-3: Delta Computation Tests
 *
 * Tests exact/derived/predicted tier classification and mirror/policy boundary.
 */
import { describe, it, expect } from 'vitest';
import { computeDelta, generateRecoveryAppendix } from '../../../ground-truth/delta.js';
import type {
  Panel1Output,
  Panel2Output,
  IntegrityReport,
  Observation,
  IntegrityFinding,
} from '../../../ground-truth/types.js';

function makePanel1(overrides: Partial<Panel1Output> = {}): Panel1Output {
  const defaultIntegrity: IntegrityReport = {
    core: [],
    domain: [],
    summary: { totalChecks: 0, passed: 0, failed: 0, criticalFailures: 0 },
  };
  return {
    planStatus: [
      { value: { done: 297, planned: 135, total: 432 }, observedAt: new Date().toISOString(), source: 'Task', freshnessState: 'fresh', confidenceClass: 'exact' },
      { value: [], observedAt: new Date().toISOString(), source: 'Milestone', freshnessState: 'fresh', confidenceClass: 'exact' },
      { value: [], observedAt: new Date().toISOString(), source: 'DEPENDS_ON', freshnessState: 'fresh', confidenceClass: 'exact' },
    ],
    governanceHealth: [
      { value: { interceptionRate: 1.0, ageHours: 1 }, observedAt: new Date().toISOString(), source: 'GovernanceMetricSnapshot', freshnessState: 'fresh', confidenceClass: 'exact' },
    ],
    evidenceCoverage: [
      { value: { withEvidence: 82, withoutEvidence: 215, total: 297, pct: 27.6 }, observedAt: new Date().toISOString(), source: 'HAS_CODE_EVIDENCE', freshnessState: 'fresh', confidenceClass: 'exact' },
    ],
    relevantClaims: [],
    integrity: defaultIntegrity,
    ...overrides,
  };
}

function makePanel2(overrides: Partial<Panel2Output> = {}): Panel2Output {
  return {
    agentId: 'watson-main',
    status: 'idle',
    currentTaskId: null,
    currentMilestone: null,
    sessionBookmark: null,
    ...overrides,
  };
}

function makeFinding(pass: boolean, severity: 'critical' | 'warning' | 'info' = 'warning'): IntegrityFinding {
  return {
    definitionId: 'test',
    surface: 'schema',
    surfaceClass: 'core',
    severity,
    description: `Test finding (${severity})`,
    observedValue: pass ? 0 : 5,
    expectedValue: 0,
    pass,
    trend: 'new',
    tier: 'medium',
    observedAt: new Date().toISOString(),
  };
}

describe('GTH-3: Delta Computation', () => {
  describe('exact tier', () => {
    it('detects idle agent with stale currentTaskId', () => {
      const result = computeDelta({
        panel1: makePanel1(),
        panel2: makePanel2({ status: 'idle', currentTaskId: 'task_orphan' }),
        transitiveImpact: [],
        candidateModifies: [],
      });

      const exact = result.deltas.filter(d => d.tier === 'exact');
      expect(exact.length).toBeGreaterThan(0);
      expect(exact[0].description).toContain('IDLE');
      expect(exact[0].description).toContain('currentTaskId');
    });

    it('surfaces critical integrity failures as exact deltas', () => {
      const panel1 = makePanel1({
        integrity: {
          core: [makeFinding(false, 'critical')],
          domain: [],
          summary: { totalChecks: 1, passed: 0, failed: 1, criticalFailures: 1 },
        },
      });

      const result = computeDelta({
        panel1,
        panel2: makePanel2(),
        transitiveImpact: [],
        candidateModifies: [],
      });

      const critical = result.deltas.filter(d => d.severity === 'critical');
      expect(critical.length).toBe(1);
      expect(critical[0].tier).toBe('exact');
    });
  });

  describe('derived tier', () => {
    it('flags low evidence coverage', () => {
      const result = computeDelta({
        panel1: makePanel1(),
        panel2: makePanel2(),
        transitiveImpact: [],
        candidateModifies: [],
      });

      const evDelta = result.deltas.find(d => d.description.includes('Evidence coverage'));
      expect(evDelta).toBeDefined();
      expect(evDelta!.tier).toBe('derived');
      expect(evDelta!.description).toContain('27.6%');
    });

    it('flags stale governance', () => {
      const panel1 = makePanel1({
        governanceHealth: [{
          value: { ageHours: 6 },
          observedAt: new Date().toISOString(),
          source: 'GovernanceMetricSnapshot',
          freshnessState: 'stale',
          confidenceClass: 'exact',
        }],
      });

      const result = computeDelta({
        panel1,
        panel2: makePanel2(),
        transitiveImpact: [],
        candidateModifies: [],
      });

      const staleDelta = result.deltas.find(d => d.description.includes('stale'));
      expect(staleDelta).toBeDefined();
      expect(staleDelta!.tier).toBe('derived');
    });

    it('reports transitive impact claim count', () => {
      const result = computeDelta({
        panel1: makePanel1(),
        panel2: makePanel2(),
        transitiveImpact: [
          { claimId: 'c1', statement: 'test', confidence: 0.9, affectedFiles: ['f.ts'], matchMethod: 'structural' },
        ],
        candidateModifies: [],
      });

      const impactDelta = result.deltas.find(d => d.description.includes('transitive impact'));
      expect(impactDelta).toBeDefined();
      expect(impactDelta!.tier).toBe('derived');
    });
  });

  describe('predicted tier', () => {
    it('reports candidate MODIFIES when task is active', () => {
      const result = computeDelta({
        panel1: makePanel1(),
        panel2: makePanel2({ currentTaskId: 'task_1', status: 'in_progress' }),
        transitiveImpact: [],
        candidateModifies: [
          { taskId: 'task_1', taskName: 'Test', targetFilePath: 'src/foo.ts', confidence: 0.5, source: 'keyword_match' },
        ],
      });

      const predicted = result.deltas.filter(d => d.tier === 'predicted');
      expect(predicted.length).toBeGreaterThan(0);
    });

    it('reports keyword-only claim matches', () => {
      const panel1 = makePanel1({
        relevantClaims: [{
          value: { claimId: 'c1', matchMethod: 'keyword' },
          observedAt: new Date().toISOString(),
          source: 'Claim',
          freshnessState: 'fresh',
          confidenceClass: 'predicted',
        }],
      });

      const result = computeDelta({
        panel1,
        panel2: makePanel2(),
        transitiveImpact: [],
        candidateModifies: [],
      });

      const kwDelta = result.deltas.find(d => d.description.includes('keyword only'));
      expect(kwDelta).toBeDefined();
      expect(kwDelta!.tier).toBe('predicted');
    });
  });

  describe('mirror/policy boundary', () => {
    it('deltas contain no action verbs or instructions', () => {
      const result = computeDelta({
        panel1: makePanel1({
          integrity: {
            core: [makeFinding(false, 'critical')],
            domain: [makeFinding(false, 'warning')],
            summary: { totalChecks: 2, passed: 0, failed: 2, criticalFailures: 1 },
          },
        }),
        panel2: makePanel2({ status: 'idle', currentTaskId: 'stale' }),
        transitiveImpact: [{ claimId: 'c1', statement: 'x', confidence: 0.5, affectedFiles: [], matchMethod: 'structural' }],
        candidateModifies: [{ taskId: 't1', taskName: 'x', targetFilePath: 'f.ts', confidence: 0.3, source: 'keyword_match' }],
      });

      const actionVerbs = ['should', 'must', 'fix', 'run', 'execute', 'update', 'please'];
      for (const delta of result.deltas) {
        for (const verb of actionVerbs) {
          expect(delta.description.toLowerCase()).not.toContain(verb);
        }
      }
    });

    it('recovery appendix is separate from deltas', () => {
      const deltas = [
        { description: 'Critical integrity failure: test', tier: 'exact' as const, panel: 'graph' as const, severity: 'critical' as const },
        { description: 'Evidence coverage at 27.6%', tier: 'derived' as const, panel: 'graph' as const, severity: 'info' as const },
      ];

      const appendix = generateRecoveryAppendix(deltas);

      expect(appendix.length).toBeGreaterThan(0);
      // Appendix items are references, not instructions
      for (const ref of appendix) {
        expect(ref).toContain('→ See:');
      }
    });
  });

  describe('output structure', () => {
    it('passes through transitiveImpact and candidateModifies', () => {
      const impact = [{ claimId: 'c1', statement: 'test', confidence: 0.9, affectedFiles: ['a.ts'], matchMethod: 'structural' as const }];
      const modifies = [{ taskId: 't1', taskName: 'test', targetFilePath: 'b.ts', confidence: 0.5, source: 'keyword_match' as const }];

      const result = computeDelta({
        panel1: makePanel1(),
        panel2: makePanel2(),
        transitiveImpact: impact,
        candidateModifies: modifies,
      });

      expect(result.transitiveImpact).toBe(impact);
      expect(result.candidateModifies).toBe(modifies);
    });
  });
});
