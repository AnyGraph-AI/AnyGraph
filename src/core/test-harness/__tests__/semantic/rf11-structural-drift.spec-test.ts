/**
 * RF-11: Structural Stability Drift Metrics — Spec Tests
 *
 * Tests written FROM the VERIFICATION_GRAPH_ROADMAP.md RF-11 spec.
 *
 * Spec requirements:
 * 1. Structural drift monitors on scoped graph projections:
 *    - Degree distribution moments (mean, variance, skewness)
 *    - Clustering coefficient
 *    - Average path length
 * 2. Baseline-versus-current comparison with drift thresholds and suppression windows
 * 3. Governance invariant: fail gate on unexplained structural drift beyond threshold
 */
import { describe, it, expect } from 'vitest';

// ── Task 1: Structural drift monitors ─────────────────────────────

describe('RF-11: Structural Stability Drift Metrics', () => {

  describe('Task 1: Structural drift monitors on scoped graph projections', () => {
    it('should export computeStructuralMetrics function', async () => {
      const mod = await import('../../../verification/structural-drift.js');
      expect(typeof mod.computeStructuralMetrics).toBe('function');
    });

    it('should compute degree distribution moments from an edge list', async () => {
      const { computeDegreeDistribution } = await import('../../../verification/structural-drift.js');
      // Simple graph: A→B, A→C, B→C (3 nodes, 3 edges)
      const edges = [
        { source: 'A', target: 'B' },
        { source: 'A', target: 'C' },
        { source: 'B', target: 'C' },
      ];
      const result = computeDegreeDistribution(edges);

      expect(result).toHaveProperty('mean');
      expect(result).toHaveProperty('variance');
      expect(result).toHaveProperty('skewness');
      expect(result).toHaveProperty('nodeCount');
      expect(result.nodeCount).toBe(3);
      // A: degree 2 (out), B: degree 2 (in+out), C: degree 2 (in)
      // Total degree (undirected): A=2, B=2, C=2 → mean=2, variance=0
      expect(result.mean).toBe(2);
      expect(result.variance).toBe(0);
    });

    it('should compute degree distribution with skewed graph', async () => {
      const { computeDegreeDistribution } = await import('../../../verification/structural-drift.js');
      // Hub graph: A→B, A→C, A→D, A→E (star topology)
      const edges = [
        { source: 'A', target: 'B' },
        { source: 'A', target: 'C' },
        { source: 'A', target: 'D' },
        { source: 'A', target: 'E' },
      ];
      const result = computeDegreeDistribution(edges);

      expect(result.nodeCount).toBe(5);
      // A: degree 4, B/C/D/E: degree 1 each → mean = 8/5 = 1.6
      expect(result.mean).toBeCloseTo(1.6, 5);
      expect(result.variance).toBeGreaterThan(0);
      // Right-skewed (one hub, many leaves)
      expect(result.skewness).toBeGreaterThan(0);
    });

    it('should compute clustering coefficient', async () => {
      const { computeClusteringCoefficient } = await import('../../../verification/structural-drift.js');
      // Triangle: A→B, B→C, A→C (fully connected = clustering 1.0)
      const edges = [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
        { source: 'A', target: 'C' },
      ];
      const result = computeClusteringCoefficient(edges);

      expect(result).toHaveProperty('average');
      expect(result).toHaveProperty('perNode');
      expect(result.average).toBeCloseTo(1.0, 5);
    });

    it('should compute clustering coefficient of 0 for star graph', async () => {
      const { computeClusteringCoefficient } = await import('../../../verification/structural-drift.js');
      // Star: A→B, A→C, A→D (no triangles)
      const edges = [
        { source: 'A', target: 'B' },
        { source: 'A', target: 'C' },
        { source: 'A', target: 'D' },
      ];
      const result = computeClusteringCoefficient(edges);

      // B, C, D have degree 1 → clustering undefined (treated as 0)
      // A's neighbors (B,C,D) have no edges between them → clustering 0
      expect(result.average).toBe(0);
    });

    it('should compute average path length', async () => {
      const { computeAveragePathLength } = await import('../../../verification/structural-drift.js');
      // Chain: A→B→C (path lengths: A→B=1, A→C=2, B→C=1)
      const edges = [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
      ];
      const result = computeAveragePathLength(edges);

      expect(result).toHaveProperty('average');
      expect(result).toHaveProperty('diameter');
      // Undirected: A-B=1, A-C=2, B-C=1 → average = (1+2+1)/3 = 1.333
      expect(result.average).toBeCloseTo(4 / 3, 5);
      expect(result.diameter).toBe(2);
    });

    it('should return all three metrics from computeStructuralMetrics', async () => {
      const { computeStructuralMetrics } = await import('../../../verification/structural-drift.js');
      const edges = [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
        { source: 'A', target: 'C' },
      ];
      const result = computeStructuralMetrics(edges);

      expect(result).toHaveProperty('degreeDistribution');
      expect(result).toHaveProperty('clusteringCoefficient');
      expect(result).toHaveProperty('averagePathLength');
      expect(result).toHaveProperty('timestamp');
      expect(result.degreeDistribution.nodeCount).toBe(3);
    });

    it('should handle empty edge list gracefully', async () => {
      const { computeStructuralMetrics } = await import('../../../verification/structural-drift.js');
      const result = computeStructuralMetrics([]);

      expect(result.degreeDistribution.nodeCount).toBe(0);
      expect(result.degreeDistribution.mean).toBe(0);
      expect(result.clusteringCoefficient.average).toBe(0);
      expect(result.averagePathLength.average).toBe(0);
    });
  });

  // ── Task 2: Baseline comparison with drift thresholds ───────────

  describe('Task 2: Baseline-versus-current comparison with drift thresholds', () => {
    it('should export compareToBaseline function', async () => {
      const mod = await import('../../../verification/structural-drift.js');
      expect(typeof mod.compareToBaseline).toBe('function');
    });

    it('should detect no drift when metrics are identical', async () => {
      const { compareToBaseline, computeStructuralMetrics } = await import('../../../verification/structural-drift.js');
      const edges = [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
      ];
      const baseline = computeStructuralMetrics(edges);
      const current = computeStructuralMetrics(edges);
      const result = compareToBaseline(baseline, current);

      expect(result.drifted).toBe(false);
      expect(result.deltas).toHaveProperty('degreeMeanDelta');
      expect(result.deltas).toHaveProperty('clusteringDelta');
      expect(result.deltas).toHaveProperty('pathLengthDelta');
      expect(result.deltas.degreeMeanDelta).toBe(0);
    });

    it('should detect drift when degree distribution changes significantly', async () => {
      const { compareToBaseline, computeStructuralMetrics } = await import('../../../verification/structural-drift.js');

      const baseline = computeStructuralMetrics([
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
      ]);
      // Add a hub node — significant structural change
      const current = computeStructuralMetrics([
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
        { source: 'D', target: 'A' },
        { source: 'D', target: 'B' },
        { source: 'D', target: 'C' },
        { source: 'D', target: 'E' },
        { source: 'D', target: 'F' },
      ]);

      const result = compareToBaseline(baseline, current);
      expect(result.drifted).toBe(true);
      expect(Math.abs(result.deltas.degreeMeanDelta)).toBeGreaterThan(0);
    });

    it('should respect custom drift thresholds', async () => {
      const { compareToBaseline, computeStructuralMetrics } = await import('../../../verification/structural-drift.js');

      const baseline = computeStructuralMetrics([
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
      ]);
      const current = computeStructuralMetrics([
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
        { source: 'C', target: 'D' },
      ]);

      // Very loose thresholds — should not drift
      const loose = compareToBaseline(baseline, current, {
        degreeMeanThreshold: 10.0,
        degreeVarianceThreshold: 10.0,
        clusteringThreshold: 10.0,
        pathLengthThreshold: 10.0,
      });
      expect(loose.drifted).toBe(false);

      // Very tight threshold on one metric — should drift
      const tight = compareToBaseline(baseline, current, { degreeMeanThreshold: 0.001 });
      expect(tight.drifted).toBe(true);
    });

    it('should support suppression windows', async () => {
      const { compareToBaseline, computeStructuralMetrics } = await import('../../../verification/structural-drift.js');

      const baseline = computeStructuralMetrics([
        { source: 'A', target: 'B' },
      ]);
      const current = computeStructuralMetrics([
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
        { source: 'C', target: 'D' },
        { source: 'D', target: 'E' },
        { source: 'E', target: 'F' },
      ]);

      // Without suppression — should drift
      const noSuppress = compareToBaseline(baseline, current);
      expect(noSuppress.drifted).toBe(true);

      // With suppression window covering now — drift suppressed
      const now = new Date();
      const suppressionWindows = [{
        start: new Date(now.getTime() - 3600_000),
        end: new Date(now.getTime() + 3600_000),
        reason: 'Active refactoring sprint',
      }];
      const suppressed = compareToBaseline(baseline, current, { suppressionWindows });
      expect(suppressed.drifted).toBe(false);
      expect(suppressed.suppressed).toBe(true);
      expect(suppressed.suppressionReason).toBe('Active refactoring sprint');
    });
  });

  // ── Task 3: Governance invariant ────────────────────────────────

  describe('Task 3: Governance invariant for structural drift', () => {
    it('should export STRUCTURAL_DRIFT_INVARIANT', async () => {
      const mod = await import('../../../verification/structural-drift.js');
      expect(mod.STRUCTURAL_DRIFT_INVARIANT).toBeDefined();
      expect(mod.STRUCTURAL_DRIFT_INVARIANT).toHaveProperty('id');
      expect(mod.STRUCTURAL_DRIFT_INVARIANT).toHaveProperty('scope');
      expect(mod.STRUCTURAL_DRIFT_INVARIANT).toHaveProperty('severity');
      expect(mod.STRUCTURAL_DRIFT_INVARIANT.id).toBe('structural_drift_threshold');
    });

    it('should be registered in INVARIANT_REGISTRY', async () => {
      // After implementation, the invariant should be in the registry
      const { INVARIANT_REGISTRY } = await import('../../../config/invariant-registry-schema.js');
      const found = INVARIANT_REGISTRY.find(
        (inv: { invariantId: string }) => inv.invariantId === 'structural_drift_threshold'
      );
      expect(found).toBeDefined();
      expect(found!.enforcementMode).toBe('enforced');
    });

    it('should produce a drift report with pass/fail and evidence', async () => {
      const { evaluateStructuralDrift, computeStructuralMetrics } = await import('../../../verification/structural-drift.js');

      const baseline = computeStructuralMetrics([]);
      const report = await evaluateStructuralDrift({
        projectId: 'proj_rf11_nonexistent_for_spec_test',
        baseline,
      });

      expect(report).toEqual(
        expect.objectContaining({
          drifted: expect.any(Boolean),
          suppressed: expect.any(Boolean),
          deltas: expect.objectContaining({
            degreeMeanDelta: expect.any(Number),
            degreeVarianceDelta: expect.any(Number),
            clusteringDelta: expect.any(Number),
            pathLengthDelta: expect.any(Number),
          }),
          thresholds: expect.objectContaining({
            degreeMeanThreshold: expect.any(Number),
            degreeVarianceThreshold: expect.any(Number),
            clusteringThreshold: expect.any(Number),
            pathLengthThreshold: expect.any(Number),
          }),
        }),
      );

      expect(report.drifted).toBe(false);
      expect(report.suppressed).toBe(false);
      expect(report.deltas).toMatchObject({
        degreeMeanDelta: 0,
        degreeVarianceDelta: 0,
        clusteringDelta: 0,
        pathLengthDelta: 0,
      });
    });
  });
});
