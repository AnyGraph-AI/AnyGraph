/**
 * GTH-7/8/9 Tests — Integrity Persistence, Hypothesis Generator, Claim Integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegrityPersistence } from '../../../ground-truth/integrity-persistence.js';
import { IntegrityHypothesisGenerator } from '../../../ground-truth/integrity-hypothesis-generator.js';
import type { IntegrityFinding } from '../../../ground-truth/types.js';

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

function makeFinding(overrides: Partial<IntegrityFinding> = {}): IntegrityFinding {
  return {
    definitionId: 'test_check',
    surface: 'schema',
    surfaceClass: 'core',
    severity: 'warning',
    description: 'Test finding',
    observedValue: 5,
    expectedValue: 0,
    pass: false,
    trend: 'new',
    tier: 'medium',
    observedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('IntegrityPersistence (GTH-7)', () => {
  let neo4j: ReturnType<typeof createMockNeo4j>;
  let persistence: IntegrityPersistence;

  beforeEach(() => {
    neo4j = createMockNeo4j();
    persistence = new IntegrityPersistence(neo4j);
  });

  it('persists definitions and observations for failing findings', async () => {
    const finding = makeFinding({ pass: false, observedValue: 5 });
    const result = await persistence.persistFindings([finding], 'proj_test');

    expect(result.definitionsMerged).toBe(1);
    expect(result.observationsCreated).toBe(1);
    expect(result.discrepanciesOpen).toBe(1);
    expect(result.discrepanciesResolved).toBe(0);

    // Batched: 4 calls — MERGE defs, fetch trends, CREATE observations, MERGE discrepancies
    expect(neo4j.run).toHaveBeenCalledTimes(4);
  });

  it('resolves discrepancies when findings pass', async () => {
    neo4j.run
      .mockResolvedValueOnce([])             // Step 1: batch MERGE definitions
      .mockResolvedValueOnce([])             // Step 2: batch fetch trends
      .mockResolvedValueOnce([])             // Step 3: batch CREATE observations
      .mockResolvedValueOnce([{ cnt: 1 }]);  // Step 5: batch resolve passing discrepancies

    const finding = makeFinding({ pass: true, observedValue: 0 });
    const result = await persistence.persistFindings([finding], 'proj_test');

    expect(result.discrepanciesResolved).toBe(1);
    expect(result.discrepanciesOpen).toBe(0);
  });

  it('computes trend from previous observation', async () => {
    neo4j.run
      .mockResolvedValueOnce([])                       // Step 1: batch MERGE definitions
      .mockResolvedValueOnce([{ defId: 'test_check', lastVal: 10 }])  // Step 2: batch fetch trends — previous was 10
      .mockResolvedValueOnce([])                       // Step 3: batch CREATE observations
      .mockResolvedValueOnce([]);                      // Step 4: batch MERGE discrepancies

    const finding = makeFinding({ observedValue: 5 }); // down from 10 = improving
    await persistence.persistFindings([finding], 'proj_test');

    // Step 3 (CREATE observations) is the 3rd call — obs params include trend
    const obsCall = neo4j.run.mock.calls[2];
    const obsParams = obsCall[1].obs as Array<{ trend: string }>;
    expect(obsParams[0].trend).toBe('improving');
  });

  it('classifies discrepancy type from surface', async () => {
    const schemas: Array<[IntegrityFinding['surface'], string]> = [
      ['schema', 'StructuralViolation'],
      ['referential', 'ReferentialDrift'],
      ['freshness', 'FreshnessBreach'],
      ['coverage', 'CoverageGap'],
      ['semantic', 'SemanticConflict'],
    ];

    for (const [surface, expectedType] of schemas) {
      const n = createMockNeo4j();
      const p = new IntegrityPersistence(n);
      await p.persistFindings([makeFinding({ surface, pass: false })], 'proj_test');
      // Step 4 (MERGE discrepancies) is the 4th call — failing params include discType
      const discCall = n.run.mock.calls[3];
      const failingParams = discCall[1].failing as Array<{ discType: string }>;
      expect(failingParams[0].discType).toBe(expectedType);
    }
  });

  it('links discrepancy to hypothesis via helper', async () => {
    await persistence.linkDiscrepancyToHypothesis('disc_1', 'hyp_1');
    expect(neo4j.run).toHaveBeenCalledTimes(1);
    expect(neo4j.run.mock.calls[0][0]).toContain('GENERATED_HYPOTHESIS');
  });

  it('links hypothesis to task via helper', async () => {
    await persistence.linkHypothesisToTask('hyp_1', 'task_1');
    expect(neo4j.run).toHaveBeenCalledTimes(1);
    expect(neo4j.run.mock.calls[0][0]).toContain('BECAME_TASK');
  });

  it('links task to commit via helper', async () => {
    await persistence.linkTaskToCommit('task_1', 'abc123');
    expect(neo4j.run).toHaveBeenCalledTimes(1);
    expect(neo4j.run.mock.calls[0][0]).toContain('RESOLVED_BY_COMMIT');
  });

  it('returns open discrepancies', async () => {
    neo4j.run.mockResolvedValueOnce([
      { props: { id: 'disc_1', type: 'StructuralViolation', status: 'open', runsSinceDetected: 7 } },
    ]);

    const discs = await persistence.getOpenDiscrepancies({ minRuns: 5 });
    expect(discs).toHaveLength(1);
    expect(discs[0].type).toBe('StructuralViolation');
  });

  it('returns early for empty findings', async () => {
    const result = await persistence.persistFindings([], 'proj_test');
    expect(result.definitionsMerged).toBe(0);
    expect(neo4j.run).not.toHaveBeenCalled();
  });

  it('generates unique obsIds within a batch', async () => {
    const findings = [
      makeFinding({ definitionId: 'check_a' }),
      makeFinding({ definitionId: 'check_b' }),
      makeFinding({ definitionId: 'check_a' }), // same defId, different index
    ];

    await persistence.persistFindings(findings, 'proj_test');

    // Step 3 (CREATE observations) — all obsIds should be unique
    const obsCall = neo4j.run.mock.calls[2];
    const obsParams = obsCall[1].obs as Array<{ obsId: string }>;
    const ids = obsParams.map(o => o.obsId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('IntegrityHypothesisGenerator (GTH-8)', () => {
  let neo4j: ReturnType<typeof createMockNeo4j>;
  let generator: IntegrityHypothesisGenerator;

  beforeEach(() => {
    neo4j = createMockNeo4j();
    generator = new IntegrityHypothesisGenerator(neo4j, { threshold: 5, severityFilter: ['critical', 'warning'] });
  });

  it('generates hypotheses for discrepancies at threshold', async () => {
    neo4j.run
      .mockResolvedValueOnce([{
        discId: 'disc_test_check',
        discType: 'StructuralViolation',
        description: 'Nodes missing labels',
        runs: 7,
        currentValue: 5,
        severity: 'warning',
      }])
      .mockResolvedValueOnce([]); // batched MERGE hypotheses

    const results = await generator.generateFromDiscrepancies();
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('hyp_integrity_disc_test_check');
    expect(results[0].runsSinceDetected).toBe(7);
  });

  it('skips discrepancies below threshold (query handles it)', async () => {
    neo4j.run.mockResolvedValueOnce([]); // no qualifying discrepancies
    const results = await generator.generateFromDiscrepancies();
    expect(results).toHaveLength(0);
  });

  it('lists open integrity hypotheses', async () => {
    neo4j.run.mockResolvedValueOnce([
      { id: 'hyp_1', discId: 'disc_1', name: 'Test hyp', type: 'EvidenceGap', runs: 10 },
    ]);

    const hyps = await generator.getOpenIntegrityHypotheses();
    expect(hyps).toHaveLength(1);
    expect(hyps[0].type).toBe('EvidenceGap');
  });
});

describe('Claim Layer Integration (GTH-9)', () => {
  it('SoftwareGovernancePack has claim chain method', async () => {
    const { SoftwareGovernancePack } = await import('../../../ground-truth/packs/software.js');
    expect(typeof SoftwareGovernancePack.prototype.queryClaimChainForTask).toBe('function');
  });

  it('SoftwareGovernancePack has contradictions method', async () => {
    const { SoftwareGovernancePack } = await import('../../../ground-truth/packs/software.js');
    expect(typeof SoftwareGovernancePack.prototype.queryContradictionsForMilestone).toBe('function');
  });

  it('SoftwareGovernancePack has hypotheses method', async () => {
    const { SoftwareGovernancePack } = await import('../../../ground-truth/packs/software.js');
    expect(typeof SoftwareGovernancePack.prototype.queryOpenHypothesesForMilestone).toBe('function');
  });

  it('Panel1Output includes contradictions and openHypotheses fields', () => {
    // Type-level test — if this compiles, the fields exist
    const panel1: import('../../../ground-truth/types.js').Panel1Output = {
      planStatus: [],
      governanceHealth: [],
      evidenceCoverage: [],
      relevantClaims: [],
      contradictions: [],
      openHypotheses: [],
      integrity: { core: [], domain: [], summary: { totalChecks: 0, passed: 0, failed: 0, criticalFailures: 0 } },
    };
    expect(panel1.contradictions).toBeDefined();
    expect(panel1.openHypotheses).toBeDefined();
  });
});
