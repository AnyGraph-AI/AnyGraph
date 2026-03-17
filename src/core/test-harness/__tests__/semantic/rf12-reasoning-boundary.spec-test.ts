/**
 * RF-12: Reasoning Boundary Layer — Spec tests
 */
import { describe, it, expect } from 'vitest';

describe('RF-12: Reasoning Boundary Layer', () => {
  it('introduces explicit boundary flow: Data Graph -> Reasoning Boundary -> Confidence Graph', async () => {
    const mod = await import('../../../verification/reasoning-boundary.js');
    expect(typeof mod.executeReasoningBoundary).toBe('function');

    const result = mod.executeReasoningBoundary({
      runId: 'rf12:test:1',
      dataGraph: {
        nodes: [{ id: 'n1', labels: ['VerificationRun'], props: { effectiveConfidence: 0.8 } }],
        edges: [],
      },
    });

    expect(result).toHaveProperty('boundarySnapshotId');
    expect(result).toHaveProperty('inputHash');
    expect(result).toHaveProperty('outputHash');
    expect(result).toHaveProperty('reasoningRunId');
  });

  it('enforces snapshot freeze + node/edge filtering before propagation', async () => {
    const { applyBoundaryFilter, assertSnapshotFrozen } = await import('../../../verification/reasoning-boundary.js');

    const input = {
      nodes: [
        { id: 'n1', labels: ['VerificationRun'], props: { effectiveConfidence: 0.8 } },
        { id: 'n2', labels: ['Task'], props: { status: 'done' } },
      ],
      edges: [
        { type: 'PRECEDES', from: 'n1', to: 'n1', props: {} },
        { type: 'PART_OF', from: 'n2', to: 'n2', props: {} },
      ],
    };

    const filtered = applyBoundaryFilter(input, {
      allowedNodeLabels: ['VerificationRun'],
      allowedEdgeTypes: ['PRECEDES'],
    });

    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.nodes[0].id).toBe('n1');
    expect(filtered.edges).toHaveLength(1);
    expect(filtered.edges[0].type).toBe('PRECEDES');

    // unchanged snapshot passes
    expect(() => assertSnapshotFrozen(filtered.snapshotHash, filtered)).not.toThrow();

    // mutation after freeze should fail
    const mutated = { ...filtered, nodes: [...filtered.nodes, { id: 'x', labels: ['VerificationRun'], props: {} }] };
    expect(() => assertSnapshotFrozen(filtered.snapshotHash, mutated)).toThrow();
  });

  it('blocks circular read/write loops from confidence graph back to evidence/trust in same cycle', async () => {
    const { validateReasoningCycle } = await import('../../../verification/reasoning-boundary.js');

    const ok = validateReasoningCycle({
      reads: ['evidence', 'trust'],
      writes: ['decision'],
    });
    expect(ok.valid).toBe(true);

    const bad = validateReasoningCycle({
      reads: ['evidence', 'trust'],
      writes: ['confidence', 'evidence'],
    });
    expect(bad.valid).toBe(false);
    expect(bad.violations.length).toBeGreaterThan(0);
  });

  it('persists boundary lineage fields: boundarySnapshotId/inputHash/reasoningRunId/outputHash', async () => {
    const { buildBoundaryLineage } = await import('../../../verification/reasoning-boundary.js');

    const lineage = buildBoundaryLineage({
      boundarySnapshotId: 'snap:rf12:1',
      inputHash: 'sha256:in',
      reasoningRunId: 'run:rf12:1',
      outputHash: 'sha256:out',
    });

    expect(lineage.boundarySnapshotId).toBe('snap:rf12:1');
    expect(lineage.inputHash).toBe('sha256:in');
    expect(lineage.reasoningRunId).toBe('run:rf12:1');
    expect(lineage.outputHash).toBe('sha256:out');
  });
});
