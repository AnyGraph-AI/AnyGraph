/**
 * Snapshot Digest — Smoke Tests
 */

import {
  createEphemeralGraph,
  codeGraphFixture,
  takeGraphSnapshot,
  computeSnapshotDigest,
  compareDigests,
  assertDeterministic,
} from '../index.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    ['snapshot captures nodes and edges', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(codeGraphFixture({
        files: [{ name: 'snap.ts' }],
        functions: [{ name: 'snapFn', file: 'snap.ts' }],
      }));

      const snapshot = await takeGraphSnapshot(rt);
      assert(snapshot.nodeCount === 2, `expected 2 nodes, got ${snapshot.nodeCount}`);
      assert(snapshot.edgeCount === 1, `expected 1 edge, got ${snapshot.edgeCount}`);
      assert(snapshot.nodes.length === 2, 'nodes array wrong');
      assert(snapshot.edges.length === 1, 'edges array wrong');
      await rt.teardown();
    }],

    ['same fixture produces same digest', async () => {
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
      assert(match, `digests should match: ${dig1.sha256.slice(0,16)} vs ${dig2.sha256.slice(0,16)}`);
    }],

    ['different fixtures produce different digests', async () => {
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
      assert(!match, 'digests should differ');
    }],

    ['assertDeterministic passes on match', async () => {
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

      // Should not throw
      assertDeterministic(dig1, dig2);
    }],

    ['assertDeterministic throws on mismatch', async () => {
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

      let threw = false;
      try {
        assertDeterministic(dig1, dig2);
      } catch (e) {
        threw = (e as Error).message.includes('Non-deterministic');
      }
      assert(threw, 'should have thrown');
    }],
  ];

  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${name}: ${(e as Error).message}`);
    }
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

runTests();
