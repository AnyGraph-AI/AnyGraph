/**
 * Snapshot Digest — Smoke Tests
 */
import { describe, it, expect } from 'vitest';
import {
  createEphemeralGraph,
  codeGraphFixture,
  takeGraphSnapshot,
  computeSnapshotDigest,
  compareDigests,
  assertDeterministic,
} from '../index.js';

describe('Snapshot Digest', () => {
  it('snapshot captures nodes and edges', async () => {
    const rt = await createEphemeralGraph({ setupSchema: false });
    await rt.seed(codeGraphFixture({
      files: [{ name: 'snap.ts' }],
      functions: [{ name: 'snapFn', file: 'snap.ts' }],
    }));

    const snapshot = await takeGraphSnapshot(rt);
    expect(snapshot.nodeCount).toBe(2);
    expect(snapshot.edgeCount).toBe(1);
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.edges).toHaveLength(1);
    await rt.teardown();
  });

  it('same fixture produces same digest', async () => {
    const fixture = codeGraphFixture({
      files: [{ name: 'det.ts' }],
      functions: [{ name: 'detA', file: 'det.ts' }, { name: 'detB', file: 'det.ts' }],
      calls: [{ from: 'detA', to: 'detB' }],
    });

    const rt1 = await createEphemeralGraph({ setupSchema: false });
    await rt1.seed(fixture);
    const snap1 = await takeGraphSnapshot(rt1);
    const dig1 = computeSnapshotDigest(snap1, rt1.projectId);
    await rt1.teardown();

    const rt2 = await createEphemeralGraph({ setupSchema: false });
    await rt2.seed(fixture);
    const snap2 = await takeGraphSnapshot(rt2);
    const dig2 = computeSnapshotDigest(snap2, rt2.projectId);
    await rt2.teardown();

    const { match } = compareDigests(dig1, dig2);
    expect(match).toBe(true);
  });

  it('different fixtures produce different digests', async () => {
    const rt1 = await createEphemeralGraph({ setupSchema: false });
    await rt1.seed(codeGraphFixture({
      files: [{ name: 'a.ts' }],
      functions: [{ name: 'fnA', file: 'a.ts' }],
    }));
    const dig1 = computeSnapshotDigest(await takeGraphSnapshot(rt1), rt1.projectId);
    await rt1.teardown();

    const rt2 = await createEphemeralGraph({ setupSchema: false });
    await rt2.seed(codeGraphFixture({
      files: [{ name: 'b.ts' }],
      functions: [{ name: 'fnB', file: 'b.ts' }],
    }));
    const dig2 = computeSnapshotDigest(await takeGraphSnapshot(rt2), rt2.projectId);
    await rt2.teardown();

    const { match } = compareDigests(dig1, dig2);
    expect(match).toBe(false);
  });

  it('assertDeterministic passes on match', async () => {
    const fixture = codeGraphFixture({
      files: [{ name: 'assert.ts' }],
      functions: [{ name: 'assertFn', file: 'assert.ts' }],
    });

    const rt1 = await createEphemeralGraph({ setupSchema: false });
    await rt1.seed(fixture);
    const dig1 = computeSnapshotDigest(await takeGraphSnapshot(rt1), rt1.projectId);
    await rt1.teardown();

    const rt2 = await createEphemeralGraph({ setupSchema: false });
    await rt2.seed(fixture);
    const dig2 = computeSnapshotDigest(await takeGraphSnapshot(rt2), rt2.projectId);
    await rt2.teardown();

    expect(() => assertDeterministic(dig1, dig2)).not.toThrow();
  });

  it('assertDeterministic throws on mismatch', async () => {
    const rt1 = await createEphemeralGraph({ setupSchema: false });
    await rt1.seed(codeGraphFixture({
      files: [{ name: 'x.ts' }],
    }));
    const dig1 = computeSnapshotDigest(await takeGraphSnapshot(rt1), rt1.projectId);
    await rt1.teardown();

    const rt2 = await createEphemeralGraph({ setupSchema: false });
    await rt2.seed(codeGraphFixture({
      files: [{ name: 'x.ts' }, { name: 'y.ts' }],
    }));
    const dig2 = computeSnapshotDigest(await takeGraphSnapshot(rt2), rt2.projectId);
    await rt2.teardown();

    expect(() => assertDeterministic(dig1, dig2)).toThrow('Non-deterministic');
  });
});
