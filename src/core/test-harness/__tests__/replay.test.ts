/**
 * Deterministic Replay — Smoke Tests
 */

import { existsSync, rmSync } from 'node:fs';
import {
  setupReplay,
  replayFromPacket,
  saveReplayPacket,
  loadReplayPacket,
  verifyReplayDigest,
  codeGraphFixture,
  type ReplayPacket,
} from '../index.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

const REPLAY_DIR = '/tmp/codegraph-test-replays';

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  // Cleanup before tests
  if (existsSync(REPLAY_DIR)) rmSync(REPLAY_DIR, { recursive: true });

  const tests: [string, () => Promise<void>][] = [
    ['setupReplay creates hermetic env + graph', async () => {
      const fixture = codeGraphFixture({
        files: [{ name: 'replay.ts' }],
        functions: [{ name: 'replayFn', file: 'replay.ts' }],
      });
      const ctx = await setupReplay({
        testName: 'test-replay-basic',
        lane: 'A',
        hermeticConfig: {
          frozenClock: '2026-06-01T00:00:00.000Z',
          rngSeed: 'replay-seed',
          blockNetwork: false, // don't block for this test — we need Neo4j
        },
        fixture,
      });

      // Verify hermetic state
      assert(ctx.hermeticState.clock?.frozenAt === '2026-06-01T00:00:00.000Z', 'wrong clock');
      assert(ctx.hermeticState.rng?.seed === 'replay-seed', 'wrong seed');

      // Verify graph has data
      assert(ctx.graph !== undefined, 'graph should exist');
      const stats = await ctx.graph!.stats();
      assert(stats.nodes === 2, `expected 2 nodes, got ${stats.nodes}`);

      // Record result and finish
      ctx.recordResult({ passed: true, assertions: 3, duration_ms: 42 });
      const packet = await ctx.finish();
      assert(packet.result?.passed === true, 'result should be passed');
      assert(packet.result?.assertions === 3, 'wrong assertion count');
    }],

    ['replay from packet reproduces identical state', async () => {
      // Create original
      const ctx1 = await setupReplay({
        testName: 'test-determinism',
        lane: 'A',
        hermeticConfig: {
          frozenClock: '2026-01-01T12:00:00.000Z',
          rngSeed: 'deterministic',
          blockNetwork: false,
        },
      });
      const time1 = Date.now();
      const rand1 = Math.random();
      ctx1.recordResult({ passed: true, assertions: 1, duration_ms: 10 });
      const packet = await ctx1.finish();

      // Replay from packet
      const ctx2 = await replayFromPacket(packet);
      const time2 = Date.now();
      const rand2 = Math.random();
      await ctx2.finish();

      assert(time1 === time2, `clocks differ: ${time1} vs ${time2}`);
      assert(rand1 === rand2, `RNG differs: ${rand1} vs ${rand2}`);
    }],

    ['save and load replay packet', async () => {
      const ctx = await setupReplay({
        testName: 'test-persistence',
        lane: 'B',
        hermeticConfig: { blockNetwork: false },
      });
      ctx.recordResult({ passed: true, assertions: 2, duration_ms: 5 });
      const packet = await ctx.finish();

      const filepath = saveReplayPacket(packet, REPLAY_DIR);
      assert(existsSync(filepath), 'file should exist');

      const loaded = loadReplayPacket(filepath);
      assert(loaded.replayId === packet.replayId, 'replayId mismatch');
      assert(loaded.testName === 'test-persistence', 'testName mismatch');
      assert(loaded.result?.passed === true, 'result mismatch');
    }],

    ['digest verification', async () => {
      const ctx = await setupReplay({
        testName: 'test-digest',
        lane: 'C1',
        hermeticConfig: { blockNetwork: false },
      });
      const packet = await ctx.finish();

      // Valid digest
      assert(verifyReplayDigest(packet), 'digest should verify');

      // Tampered packet
      const tampered: ReplayPacket = { ...packet, testName: 'tampered' };
      assert(!verifyReplayDigest(tampered), 'tampered digest should fail');
    }],

    ['replay with fixture reproduces graph state', async () => {
      const fixture = codeGraphFixture({
        files: [{ name: 'det.ts' }],
        functions: [
          { name: 'detFnA', file: 'det.ts', riskLevel: 100, riskTier: 'HIGH' },
          { name: 'detFnB', file: 'det.ts', riskLevel: 5, riskTier: 'LOW' },
        ],
        calls: [{ from: 'detFnA', to: 'detFnB' }],
      });

      // Record
      const ctx1 = await setupReplay({
        testName: 'test-graph-replay',
        lane: 'A',
        hermeticConfig: { blockNetwork: false },
        fixture,
      });
      const stats1 = await ctx1.graph!.stats();
      const packet = await ctx1.finish();

      // Replay
      const ctx2 = await replayFromPacket(packet);
      const stats2 = await ctx2.graph!.stats();
      await ctx2.finish();

      assert(stats1.nodes === stats2.nodes, `node count differ: ${stats1.nodes} vs ${stats2.nodes}`);
      assert(stats1.edges === stats2.edges, `edge count differ: ${stats1.edges} vs ${stats2.edges}`);
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

  // Cleanup
  if (existsSync(REPLAY_DIR)) rmSync(REPLAY_DIR, { recursive: true });

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

runTests();
