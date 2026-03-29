/**
 * AUD-TC-09 Batch C — Direct Behavioral Tests
 *
 * B6 (Health Witness) tests for:
 *   1. incremental-recompute.ts
 *   2. structural-drift.ts
 *   3. reasoning-boundary.ts
 *   4. temporal-confidence.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock for structural-drift (constructs Neo4jService internally) ────
const mockRun = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.close = mockClose;
  }),
}));

// ─── Imports ────────────────────────────────────────────────────────
import { incrementalRecompute, verifyReproducibility } from '../incremental-recompute.js';
import type { RecomputeRequest } from '../incremental-recompute.js';
import {
  computeDegreeDistribution,
  computeClusteringCoefficient,
  computeAveragePathLength,
  compareToBaseline,
  evaluateStructuralDrift,
  type GraphEdge,
  type StructuralMetrics,
} from '../structural-drift.js';
import {
  applyBoundaryFilter,
  assertSnapshotFrozen,
  validateReasoningCycle,
  buildBoundaryLineage,
  executeReasoningBoundary,
  type BoundaryGraph,
  type BoundaryFilterConfig,
} from '../reasoning-boundary.js';
import { computeTemporalFactors, type TemporalDecayConfig } from '../temporal-confidence.js';

// ─── Helper: mock Neo4j for incremental-recompute (param-injected) ──
function makeMockNeo4j() {
  return {
    run: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('[aud-tc-09] Batch C — direct behavioral tests', () => {
  // ═════════════════════════════════════════════════════════════════
  // 1. incremental-recompute.ts
  // ═════════════════════════════════════════════════════════════════
  describe('incremental-recompute', () => {
    it('blocks full-scope recompute when fullOverride is not set', async () => {
      const neo4j = makeMockNeo4j();
      const req: RecomputeRequest = { projectId: 'p1', scope: 'full' };
      const result = await incrementalRecompute(neo4j as any, req);

      expect(result.scope).toBe('full');
      expect(result.candidateCount).toBe(0);
      expect(result.updatedCount).toBe(0);
      expect(result.reason).toMatch(/fullOverride/);
      // Should NOT have called neo4j.run at all (blocked before resolution)
      expect(neo4j.run).not.toHaveBeenCalled();
    });

    it('allows full-scope recompute when fullOverride=true', async () => {
      const neo4j = makeMockNeo4j();
      // First call: resolve run IDs (full scope)
      neo4j.run.mockResolvedValueOnce([{ id: 'run1' }]);
      // Second call: fetch temporal fields
      neo4j.run.mockResolvedValueOnce([
        {
          id: 'run1',
          observedAt: new Date().toISOString(),
          validFrom: null,
          validTo: null,
          supersededAt: null,
          oldTcf: null,
          oldVersion: 0,
        },
      ]);
      // Third call: batch update
      neo4j.run.mockResolvedValueOnce([]);

      const req: RecomputeRequest = {
        projectId: 'p1',
        scope: 'full',
        fullOverride: true,
        reason: 'test-full',
      };
      const result = await incrementalRecompute(neo4j as any, req);

      expect(result.scope).toBe('full');
      expect(result.candidateCount).toBe(1);
      expect(result.updatedCount).toBe(1);
      expect(result.reason).toBe('test-full');
    });

    it('returns zero candidates for node scope with empty targets', async () => {
      const neo4j = makeMockNeo4j();
      const req: RecomputeRequest = { projectId: 'p1', scope: 'node', targets: [] };
      const result = await incrementalRecompute(neo4j as any, req);

      expect(result.candidateCount).toBe(0);
      expect(result.updatedCount).toBe(0);
      expect(result.reason).toBe('No candidates found');
      expect(result.bounded).toBe(true);
    });

    it('blocks scoped recompute when candidates exceed 500', async () => {
      const neo4j = makeMockNeo4j();
      const manyIds = Array.from({ length: 501 }, (_, i) => ({ id: `run${i}` }));
      neo4j.run.mockResolvedValueOnce(manyIds);

      const req: RecomputeRequest = {
        projectId: 'p1',
        scope: 'file',
        targets: ['bigfile.ts'],
      };
      const result = await incrementalRecompute(neo4j as any, req);

      expect(result.candidateCount).toBe(501);
      expect(result.updatedCount).toBe(0);
      expect(result.bounded).toBe(false);
      expect(result.reason).toMatch(/BLOCKED/);
      expect(result.reason).toMatch(/500/);
    });

    it('skips unchanged TCF values (within epsilon)', async () => {
      const neo4j = makeMockNeo4j();
      const now = new Date();
      const recentObserved = new Date(now.getTime() - 3600_000).toISOString(); // 1h ago

      // resolve run IDs (node scope returns targets directly, no query)
      // fetch temporal fields — oldTcf=1.0 (fresh evidence should also compute 1.0)
      neo4j.run.mockResolvedValueOnce([
        {
          id: 'runX',
          observedAt: recentObserved,
          validFrom: null,
          validTo: null,
          supersededAt: null,
          oldTcf: 1.0,
          oldVersion: 3,
        },
      ]);

      const req: RecomputeRequest = {
        projectId: 'p1',
        scope: 'node',
        targets: ['runX'],
      };
      const result = await incrementalRecompute(neo4j as any, req);

      expect(result.candidateCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.updatedCount).toBe(0);
    });

    it('persists provenance fields on update (version, inputsHash, timestamp, reason)', async () => {
      const neo4j = makeMockNeo4j();
      const longAgo = new Date(Date.now() - 365 * 24 * 3600_000).toISOString();

      // fetch temporal fields — expired evidence with null oldTcf
      neo4j.run.mockResolvedValueOnce([
        {
          id: 'runOld',
          observedAt: longAgo,
          validFrom: null,
          validTo: longAgo,
          supersededAt: null,
          oldTcf: null,
          oldVersion: 5,
        },
      ]);
      // batch update
      neo4j.run.mockResolvedValueOnce([]);

      const req: RecomputeRequest = {
        projectId: 'p1',
        scope: 'node',
        targets: ['runOld'],
        reason: 'audit-test',
      };
      const result = await incrementalRecompute(neo4j as any, req);

      expect(result.updatedCount).toBe(1);
      expect(result.confidenceVersion).toBe(6); // oldVersion(5) + 1
      expect(result.confidenceInputsHash).toBeTruthy();
      expect(result.confidenceInputsHash.length).toBe(32);
      expect(result.reason).toBe('audit-test');
    });

    it('inputsHash is deterministic for same inputs', async () => {
      const neo4j1 = makeMockNeo4j();
      const neo4j2 = makeMockNeo4j();
      const longAgo = new Date(Date.now() - 365 * 24 * 3600_000).toISOString();

      const makeRow = () => [{
        id: 'runD',
        observedAt: longAgo,
        validFrom: null,
        validTo: longAgo,
        supersededAt: null,
        oldTcf: null,
        oldVersion: 0,
      }];

      neo4j1.run.mockResolvedValueOnce(makeRow()).mockResolvedValueOnce([]);
      neo4j2.run.mockResolvedValueOnce(makeRow()).mockResolvedValueOnce([]);

      const req: RecomputeRequest = { projectId: 'p1', scope: 'node', targets: ['runD'] };
      const r1 = await incrementalRecompute(neo4j1 as any, req);
      const r2 = await incrementalRecompute(neo4j2 as any, req);

      expect(r1.confidenceInputsHash).toBe(r2.confidenceInputsHash);
    });

    it('verifyReproducibility detects divergences', async () => {
      const neo4j = makeMockNeo4j();
      // before snapshot
      neo4j.run.mockResolvedValueOnce([{ id: 'r1', ec: 0.8 }]);
      // incrementalRecompute: resolveRunIds (full)
      neo4j.run.mockResolvedValueOnce([{ id: 'r1' }]);
      // incrementalRecompute: fetch temporal fields
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', observedAt: null, validFrom: null, validTo: null, supersededAt: null, oldTcf: null, oldVersion: 0 },
      ]);
      // incrementalRecompute: batch update
      neo4j.run.mockResolvedValueOnce([]);
      // after snapshot (changed ec)
      neo4j.run.mockResolvedValueOnce([{ id: 'r1', ec: 0.5 }]);

      const result = await verifyReproducibility(neo4j as any, 'p1');
      expect(result.ok).toBe(false);
      expect(result.divergences).toHaveLength(1);
      expect(result.divergences[0].id).toBe('r1');
      expect(result.divergences[0].ec1).toBe(0.8);
      expect(result.divergences[0].ec2).toBe(0.5);
    });

    it('verifyReproducibility returns ok=true when values are stable', async () => {
      const neo4j = makeMockNeo4j();
      // before snapshot
      neo4j.run.mockResolvedValueOnce([{ id: 'r1', ec: 0.8 }]);
      // incrementalRecompute: resolveRunIds (full)
      neo4j.run.mockResolvedValueOnce([{ id: 'r1' }]);
      // incrementalRecompute: fetch temporal fields
      neo4j.run.mockResolvedValueOnce([
        { id: 'r1', observedAt: null, validFrom: null, validTo: null, supersededAt: null, oldTcf: 1.0, oldVersion: 1 },
      ]);
      // after snapshot (same ec within epsilon)
      neo4j.run.mockResolvedValueOnce([{ id: 'r1', ec: 0.8 }]);

      const result = await verifyReproducibility(neo4j as any, 'p1');
      expect(result.ok).toBe(true);
      expect(result.divergences).toHaveLength(0);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 2. structural-drift.ts
  // ═════════════════════════════════════════════════════════════════
  describe('structural-drift — pure functions', () => {
    const triangle: GraphEdge[] = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
      { source: 'A', target: 'C' },
    ];

    const star: GraphEdge[] = [
      { source: 'hub', target: 'a' },
      { source: 'hub', target: 'b' },
      { source: 'hub', target: 'c' },
      { source: 'hub', target: 'd' },
    ];

    describe('computeDegreeDistribution', () => {
      it('returns zeros for empty edges', () => {
        const result = computeDegreeDistribution([]);
        expect(result.mean).toBe(0);
        expect(result.variance).toBe(0);
        expect(result.skewness).toBe(0);
        expect(result.nodeCount).toBe(0);
      });

      it('computes correct mean for a triangle (all degree 2)', () => {
        const result = computeDegreeDistribution(triangle);
        expect(result.nodeCount).toBe(3);
        expect(result.mean).toBe(2);
        expect(result.variance).toBeCloseTo(0, 5);
      });

      it('computes positive skewness for star topology (hub has high degree)', () => {
        const result = computeDegreeDistribution(star);
        expect(result.nodeCount).toBe(5);
        // hub=4, leaves=1 → mean < hub degree, positive skew
        expect(result.skewness).toBeGreaterThan(0);
      });

      it('reports correct nodeCount with undirected adjacency', () => {
        const edges: GraphEdge[] = [{ source: 'X', target: 'Y' }];
        const result = computeDegreeDistribution(edges);
        expect(result.nodeCount).toBe(2);
        expect(result.mean).toBe(1); // each node degree 1
      });
    });

    describe('computeClusteringCoefficient', () => {
      it('returns zero for empty edges', () => {
        const result = computeClusteringCoefficient([]);
        expect(result.average).toBe(0);
        expect(Object.keys(result.perNode)).toHaveLength(0);
      });

      it('returns 1.0 for a perfect triangle (every neighbor connected)', () => {
        const result = computeClusteringCoefficient(triangle);
        expect(result.average).toBeCloseTo(1.0, 5);
        expect(result.perNode['A']).toBeCloseTo(1.0, 5);
        expect(result.perNode['B']).toBeCloseTo(1.0, 5);
        expect(result.perNode['C']).toBeCloseTo(1.0, 5);
      });

      it('returns 0 for star topology (no leaf-to-leaf connections)', () => {
        const result = computeClusteringCoefficient(star);
        // Hub has 4 neighbors, none connected to each other → 0
        expect(result.perNode['hub']).toBe(0);
        // Leaves have degree 1 → coefficient 0
        expect(result.perNode['a']).toBe(0);
        expect(result.average).toBe(0);
      });

      it('handles nodes with exactly one neighbor (degree < 2)', () => {
        const edges: GraphEdge[] = [{ source: 'P', target: 'Q' }];
        const result = computeClusteringCoefficient(edges);
        expect(result.perNode['P']).toBe(0);
        expect(result.perNode['Q']).toBe(0);
      });
    });

    describe('computeAveragePathLength', () => {
      it('returns zeros for empty edges', () => {
        const result = computeAveragePathLength([]);
        expect(result.average).toBe(0);
        expect(result.diameter).toBe(0);
        expect(result.reachablePairs).toBe(0);
      });

      it('computes correct path lengths for a line graph A-B-C', () => {
        const line: GraphEdge[] = [
          { source: 'A', target: 'B' },
          { source: 'B', target: 'C' },
        ];
        const result = computeAveragePathLength(line);
        // Pairs: A-B=1, A-C=2, B-C=1 → avg=(1+2+1)/3 ≈ 1.333
        expect(result.reachablePairs).toBe(3);
        expect(result.average).toBeCloseTo(4 / 3, 5);
        expect(result.diameter).toBe(2);
      });

      it('handles disconnected graph (single node with self-loop counts as 1 node)', () => {
        const edges: GraphEdge[] = [{ source: 'X', target: 'X' }];
        const result = computeAveragePathLength(edges);
        // X connects to X — undirected adj gives X→{X}, so just 1 node
        expect(result.reachablePairs).toBe(0);
      });
    });

    describe('compareToBaseline', () => {
      function makeMetrics(overrides: Partial<{
        mean: number; variance: number; clustering: number; pathLen: number;
      }> = {}): StructuralMetrics {
        return {
          degreeDistribution: {
            mean: overrides.mean ?? 2,
            variance: overrides.variance ?? 1,
            skewness: 0,
            nodeCount: 10,
          },
          clusteringCoefficient: { average: overrides.clustering ?? 0.5, perNode: {} },
          averagePathLength: { average: overrides.pathLen ?? 3, diameter: 5, reachablePairs: 45 },
          timestamp: new Date().toISOString(),
        };
      }

      it('detects no drift when metrics are identical', () => {
        const baseline = makeMetrics();
        const current = makeMetrics();
        const result = compareToBaseline(baseline, current);
        expect(result.drifted).toBe(false);
        expect(result.deltas.degreeMeanDelta).toBe(0);
      });

      it('detects drift when degree mean exceeds threshold', () => {
        const baseline = makeMetrics({ mean: 2 });
        const current = makeMetrics({ mean: 2.5 });
        const result = compareToBaseline(baseline, current, { degreeMeanThreshold: 0.25 });
        // delta = 0.5, threshold = 0.25 → drift
        expect(result.drifted).toBe(true);
        expect(result.deltas.degreeMeanDelta).toBeCloseTo(0.5, 5);
      });

      it('suppresses drift during suppression window', () => {
        const baseline = makeMetrics({ mean: 2 });
        const current = makeMetrics({ mean: 10 }); // extreme drift
        const now = new Date();
        const result = compareToBaseline(baseline, current, {
          suppressionWindows: [{
            start: new Date(now.getTime() - 60_000),
            end: new Date(now.getTime() + 60_000),
            reason: 'migration',
          }],
        });
        expect(result.drifted).toBe(false);
        expect(result.suppressed).toBe(true);
        expect(result.suppressionReason).toBe('migration');
      });

      it('uses default thresholds when none provided', () => {
        const baseline = makeMetrics();
        const current = makeMetrics();
        const result = compareToBaseline(baseline, current);
        expect(result.thresholds.degreeMeanThreshold).toBe(0.25);
        expect(result.thresholds.degreeVarianceThreshold).toBe(0.5);
        expect(result.thresholds.clusteringThreshold).toBe(0.2);
        expect(result.thresholds.pathLengthThreshold).toBe(0.3);
      });
    });

    describe('evaluateStructuralDrift (Neo4j constructor mock)', () => {
      beforeEach(() => {
        mockRun.mockReset();
        mockClose.mockReset().mockResolvedValue(undefined);
      });

      it('calls neo4j.run with projectId and closes afterward', async () => {
        mockRun.mockResolvedValueOnce([
          { source: 'A', target: 'B' },
        ]);

        const baseline: StructuralMetrics = {
          degreeDistribution: { mean: 1, variance: 0, skewness: 0, nodeCount: 2 },
          clusteringCoefficient: { average: 0, perNode: {} },
          averagePathLength: { average: 1, diameter: 1, reachablePairs: 1 },
          timestamp: new Date().toISOString(),
        };

        const result = await evaluateStructuralDrift({
          projectId: 'proj1',
          baseline,
        });

        expect(mockRun).toHaveBeenCalledTimes(1);
        const callArgs = mockRun.mock.calls[0];
        expect(callArgs[1]).toEqual({ projectId: 'proj1' });
        expect(mockClose).toHaveBeenCalledTimes(1);
        expect(result).toHaveProperty('drifted');
        expect(result).toHaveProperty('deltas');
      });

      it('closes neo4j even if run throws', async () => {
        mockRun.mockRejectedValueOnce(new Error('db down'));

        const baseline: StructuralMetrics = {
          degreeDistribution: { mean: 0, variance: 0, skewness: 0, nodeCount: 0 },
          clusteringCoefficient: { average: 0, perNode: {} },
          averagePathLength: { average: 0, diameter: 0, reachablePairs: 0 },
          timestamp: new Date().toISOString(),
        };

        await expect(evaluateStructuralDrift({ projectId: 'proj1', baseline }))
          .rejects.toThrow('db down');
        expect(mockClose).toHaveBeenCalledTimes(1);
      });

      it('filters out null/undefined source/target from edges', async () => {
        mockRun.mockResolvedValueOnce([
          { source: 'A', target: 'B' },
          { source: null, target: 'C' },
          { source: 'D', target: 'null' },
        ]);

        const baseline: StructuralMetrics = {
          degreeDistribution: { mean: 1, variance: 0, skewness: 0, nodeCount: 2 },
          clusteringCoefficient: { average: 0, perNode: {} },
          averagePathLength: { average: 1, diameter: 1, reachablePairs: 1 },
          timestamp: new Date().toISOString(),
        };

        const result = await evaluateStructuralDrift({ projectId: 'proj1', baseline });
        // Only A-B edge is valid; null and "null" filtered
        expect(result.drifted).toBe(false);
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 3. reasoning-boundary.ts
  // ═════════════════════════════════════════════════════════════════
  describe('reasoning-boundary', () => {
    const graph: BoundaryGraph = {
      nodes: [
        { id: 'n1', labels: ['VerificationRun'], props: {} },
        { id: 'n2', labels: ['Evidence'], props: {} },
        { id: 'n3', labels: ['CodeNode'], props: {} },
        { id: 'n4', labels: ['TrustSignal'], props: {} },
      ],
      edges: [
        { type: 'PRECEDES', from: 'n1', to: 'n2', props: {} },
        { type: 'CALLS', from: 'n1', to: 'n3', props: {} },
        { type: 'SUPPORTED_BY', from: 'n2', to: 'n4', props: {} },
      ],
    };

    const config: BoundaryFilterConfig = {
      allowedNodeLabels: ['VerificationRun', 'Evidence'],
      allowedEdgeTypes: ['PRECEDES'],
    };

    describe('applyBoundaryFilter', () => {
      it('filters nodes by allowed labels', () => {
        const result = applyBoundaryFilter(graph, config);
        expect(result.nodes).toHaveLength(2);
        expect(result.nodes.map(n => n.id).sort()).toEqual(['n1', 'n2']);
      });

      it('filters edges by type AND endpoint membership', () => {
        const result = applyBoundaryFilter(graph, config);
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].type).toBe('PRECEDES');
      });

      it('excludes edges whose endpoints are filtered out', () => {
        const configNarrow: BoundaryFilterConfig = {
          allowedNodeLabels: ['VerificationRun'],
          allowedEdgeTypes: ['PRECEDES'], // PRECEDES goes n1→n2, but n2 not in allowed
        };
        const result = applyBoundaryFilter(graph, configNarrow);
        expect(result.nodes).toHaveLength(1);
        expect(result.edges).toHaveLength(0);
      });

      it('returns a snapshotHash string', () => {
        const result = applyBoundaryFilter(graph, config);
        expect(result.snapshotHash).toBeTruthy();
        expect(typeof result.snapshotHash).toBe('string');
        expect(result.snapshotHash).toMatch(/^sha256:/);
      });

      it('produces deterministic snapshotHash for same input', () => {
        const r1 = applyBoundaryFilter(graph, config);
        const r2 = applyBoundaryFilter(graph, config);
        expect(r1.snapshotHash).toBe(r2.snapshotHash);
      });
    });

    describe('assertSnapshotFrozen', () => {
      it('does not throw when hash matches', () => {
        const filtered = applyBoundaryFilter(graph, config);
        expect(() => assertSnapshotFrozen(filtered.snapshotHash, {
          nodes: filtered.nodes,
          edges: filtered.edges,
        })).not.toThrow();
      });

      it('throws when graph has been mutated (hash mismatch)', () => {
        expect(() => assertSnapshotFrozen('sha256:badhash', graph)).toThrow(/Boundary snapshot mutated/);
      });
    });

    describe('validateReasoningCycle', () => {
      it('allows writes to confidence/decision when reads include evidence/trust', () => {
        const result = validateReasoningCycle({
          reads: ['evidence', 'trust'],
          writes: ['confidence', 'decision'],
        });
        expect(result.valid).toBe(true);
        expect(result.violations).toHaveLength(0);
      });

      it('blocks circular write-back to evidence when evidence was read', () => {
        const result = validateReasoningCycle({
          reads: ['evidence'],
          writes: ['evidence'],
        });
        expect(result.valid).toBe(false);
        expect(result.violations).toContain('circular_loop:evidence');
      });

      it('blocks circular write-back to trust when trust was read', () => {
        const result = validateReasoningCycle({
          reads: ['trust'],
          writes: ['trust'],
        });
        expect(result.valid).toBe(false);
        expect(result.violations).toContain('circular_loop:trust');
      });

      it('blocks circular write-back to data when data was read', () => {
        const result = validateReasoningCycle({
          reads: ['data'],
          writes: ['data'],
        });
        expect(result.valid).toBe(false);
        expect(result.violations).toContain('circular_loop:data');
      });

      it('allows write to confidence even when confidence was read (not in blocked set)', () => {
        const result = validateReasoningCycle({
          reads: ['confidence'],
          writes: ['confidence'],
        });
        expect(result.valid).toBe(true);
      });

      it('reports multiple violations when both evidence and trust are circular', () => {
        const result = validateReasoningCycle({
          reads: ['evidence', 'trust'],
          writes: ['evidence', 'trust'],
        });
        expect(result.valid).toBe(false);
        expect(result.violations).toHaveLength(2);
        expect(result.violations).toContain('circular_loop:evidence');
        expect(result.violations).toContain('circular_loop:trust');
      });
    });

    describe('buildBoundaryLineage', () => {
      it('returns a lineage record with all 4 required fields', () => {
        const lineage = buildBoundaryLineage({
          boundarySnapshotId: 'snap1',
          inputHash: 'hash1',
          reasoningRunId: 'run1',
          outputHash: 'hash2',
        });
        expect(lineage.boundarySnapshotId).toBe('snap1');
        expect(lineage.inputHash).toBe('hash1');
        expect(lineage.reasoningRunId).toBe('run1');
        expect(lineage.outputHash).toBe('hash2');
      });

      it('returns a copy (not the same reference)', () => {
        const input = {
          boundarySnapshotId: 'snap1',
          inputHash: 'hash1',
          reasoningRunId: 'run1',
          outputHash: 'hash2',
        };
        const result = buildBoundaryLineage(input);
        expect(result).toEqual(input);
        expect(result).not.toBe(input);
      });
    });

    describe('executeReasoningBoundary', () => {
      it('orchestrates freeze→filter→propagate→persist and returns all fields', () => {
        const result = executeReasoningBoundary({
          runId: 'testRun',
          dataGraph: graph,
        });
        expect(result.boundarySnapshotId).toBe('boundary:testRun');
        expect(result.reasoningRunId).toBe('testRun');
        expect(result.inputHash).toMatch(/^sha256:/);
        expect(result.outputHash).toMatch(/^sha256:/);
        expect(typeof result.filteredNodeCount).toBe('number');
        expect(typeof result.filteredEdgeCount).toBe('number');
        expect(result.snapshotHash).toMatch(/^sha256:/);
      });

      it('uses default filter when none provided', () => {
        const result = executeReasoningBoundary({
          runId: 'r1',
          dataGraph: graph,
        });
        // Default labels: VerificationRun, Evidence, TrustSignal
        // n1=VerificationRun, n2=Evidence, n4=TrustSignal → 3 nodes
        expect(result.filteredNodeCount).toBe(3);
      });

      it('uses custom filter when provided', () => {
        const result = executeReasoningBoundary({
          runId: 'r1',
          dataGraph: graph,
          filter: {
            allowedNodeLabels: ['CodeNode'],
            allowedEdgeTypes: ['CALLS'],
          },
        });
        // Only n3=CodeNode, but CALLS goes n1→n3 and n1 not in CodeNode
        expect(result.filteredNodeCount).toBe(1);
        expect(result.filteredEdgeCount).toBe(0);
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 4. temporal-confidence.ts
  // ═════════════════════════════════════════════════════════════════
  describe('temporal-confidence', () => {
    const config: TemporalDecayConfig = {
      decayWindowHours: 720,
      minimumFactor: 0.1,
      defaultValidityHours: 168,
    };

    it('returns TCF=1.0 for fresh evidence within validity window', () => {
      const now = new Date();
      const observedAt = new Date(now.getTime() - 3600_000).toISOString(); // 1h ago
      const validTo = new Date(now.getTime() + 24 * 3600_000).toISOString(); // tomorrow
      const result = computeTemporalFactors(observedAt, null, validTo, null, now, config);
      expect(result.timeConsistencyFactor).toBe(1.0);
      expect(result.retroactivePenalty).toBe(1.0);
    });

    it('decays linearly with age past validity window', () => {
      const now = new Date();
      const observedAt = new Date(now.getTime() - 1000 * 3600_000).toISOString();
      const validTo = new Date(now.getTime() - 360 * 3600_000).toISOString(); // 360h expired

      const result = computeTemporalFactors(observedAt, null, validTo, null, now, config);
      // 360h expired out of 720h window → decayRatio=0.5 → factor = 1.0 - 0.5*(1-0.1) = 0.55
      expect(result.timeConsistencyFactor).toBeCloseTo(0.55, 2);
      expect(result.retroactivePenalty).toBe(1.0);
    });

    it('floors at minimumFactor when fully decayed', () => {
      const now = new Date();
      const observedAt = new Date(now.getTime() - 5000 * 3600_000).toISOString();
      const validTo = new Date(now.getTime() - 2000 * 3600_000).toISOString(); // way expired

      const result = computeTemporalFactors(observedAt, null, validTo, null, now, config);
      expect(result.timeConsistencyFactor).toBe(config.minimumFactor);
      expect(result.retroactivePenalty).toBe(1.0);
    });

    it('returns minimumFactor + retroactivePenalty=0 for superseded evidence', () => {
      const now = new Date();
      const result = computeTemporalFactors(
        now.toISOString(), null, null,
        new Date(now.getTime() - 3600_000).toISOString(), // superseded 1h ago
        now, config,
      );
      expect(result.timeConsistencyFactor).toBe(config.minimumFactor);
      expect(result.retroactivePenalty).toBe(0.0);
    });

    it('returns TCF=1.0 when observedAt is null (no temporal signal)', () => {
      const result = computeTemporalFactors(null, null, null, null, new Date(), config);
      expect(result.timeConsistencyFactor).toBe(1.0);
      expect(result.retroactivePenalty).toBe(1.0);
    });

    it('uses defaultValidityHours when validTo is null', () => {
      const now = new Date();
      // Observed 100h ago, no validTo → default window = 168h → still valid
      const observedAt = new Date(now.getTime() - 100 * 3600_000).toISOString();
      const result = computeTemporalFactors(observedAt, null, null, null, now, config);
      expect(result.timeConsistencyFactor).toBe(1.0);
    });

    it('decays after defaultValidityHours when validTo is null', () => {
      const now = new Date();
      // Observed 200h ago, no validTo → default window = 168h → 32h expired
      const observedAt = new Date(now.getTime() - 200 * 3600_000).toISOString();
      const result = computeTemporalFactors(observedAt, null, null, null, now, config);
      // 32h expired / 720h window → decayRatio ≈ 0.0444 → factor ≈ 0.96
      expect(result.timeConsistencyFactor).toBeLessThan(1.0);
      expect(result.timeConsistencyFactor).toBeGreaterThan(0.9);
    });

    it('handles custom config with different minimumFactor', () => {
      const customConfig: TemporalDecayConfig = {
        decayWindowHours: 100,
        minimumFactor: 0.3,
        defaultValidityHours: 10,
      };
      const now = new Date();
      const observedAt = new Date(now.getTime() - 5000 * 3600_000).toISOString();
      const validTo = new Date(now.getTime() - 4000 * 3600_000).toISOString();

      const result = computeTemporalFactors(observedAt, null, validTo, null, now, customConfig);
      expect(result.timeConsistencyFactor).toBeCloseTo(0.3, 5); // custom minimum
    });

    it('superseded takes priority over fresh validity window', () => {
      const now = new Date();
      const observedAt = new Date(now.getTime() - 3600_000).toISOString();
      const validTo = new Date(now.getTime() + 3600_000).toISOString(); // still valid
      const supersededAt = new Date(now.getTime() - 1000).toISOString(); // but superseded

      const result = computeTemporalFactors(observedAt, null, validTo, supersededAt, now, config);
      expect(result.timeConsistencyFactor).toBe(config.minimumFactor);
      expect(result.retroactivePenalty).toBe(0.0);
    });

    it('returns TCF=1.0 exactly at the validity boundary', () => {
      const now = new Date();
      const observedAt = new Date(now.getTime() - 168 * 3600_000).toISOString();
      // validTo = exactly now
      const validTo = now.toISOString();

      const result = computeTemporalFactors(observedAt, null, validTo, null, now, config);
      expect(result.timeConsistencyFactor).toBe(1.0);
    });
  });
});
