/**
 * Deterministic Replay — Smoke Tests
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

const REPLAY_DIR = '/tmp/codegraph-test-replays';

describe('Deterministic Replay', () => {
  beforeAll(() => {
    if (existsSync(REPLAY_DIR)) rmSync(REPLAY_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(REPLAY_DIR)) rmSync(REPLAY_DIR, { recursive: true });
  });

  it('setupReplay creates hermetic env + graph', async () => {
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
        blockNetwork: false,
      },
      fixture,
    });

    expect(ctx.hermeticState.clock?.frozenAt).toBe('2026-06-01T00:00:00.000Z');
    expect(ctx.hermeticState.rng?.seed).toBe('replay-seed');
    expect(ctx.graph).toBeDefined();

    const stats = await ctx.graph!.stats();
    expect(stats.nodes).toBe(2);

    ctx.recordResult({ passed: true, assertions: 3, duration_ms: 42 });
    const packet = await ctx.finish();
    expect(packet.result?.passed).toBe(true);
    expect(packet.result?.assertions).toBe(3);
  });

  it('replay from packet reproduces identical state', async () => {
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

    const ctx2 = await replayFromPacket(packet);
    const time2 = Date.now();
    const rand2 = Math.random();
    await ctx2.finish();

    expect(time1).toBe(time2);
    expect(rand1).toBe(rand2);
  });

  it('save and load replay packet', async () => {
    const ctx = await setupReplay({
      testName: 'test-persistence',
      lane: 'B',
      hermeticConfig: { blockNetwork: false },
    });
    ctx.recordResult({ passed: true, assertions: 2, duration_ms: 5 });
    const packet = await ctx.finish();

    const filepath = saveReplayPacket(packet, REPLAY_DIR);
    expect(existsSync(filepath)).toBe(true);

    const loaded = loadReplayPacket(filepath);
    expect(loaded.replayId).toBe(packet.replayId);
    expect(loaded.testName).toBe('test-persistence');
    expect(loaded.result?.passed).toBe(true);
  });

  it('digest verification', async () => {
    const ctx = await setupReplay({
      testName: 'test-digest',
      lane: 'C1',
      hermeticConfig: { blockNetwork: false },
    });
    const packet = await ctx.finish();

    expect(verifyReplayDigest(packet)).toBe(true);

    const tampered: ReplayPacket = { ...packet, testName: 'tampered' };
    expect(verifyReplayDigest(tampered)).toBe(false);
  });

  it('replay with fixture reproduces graph state', async () => {
    const fixture = codeGraphFixture({
      files: [{ name: 'det.ts' }],
      functions: [
        { name: 'detFnA', file: 'det.ts', riskLevel: 100, riskTier: 'HIGH' },
        { name: 'detFnB', file: 'det.ts', riskLevel: 5, riskTier: 'LOW' },
      ],
      calls: [{ from: 'detFnA', to: 'detFnB' }],
    });

    const ctx1 = await setupReplay({
      testName: 'test-graph-replay',
      lane: 'A',
      hermeticConfig: { blockNetwork: false },
      fixture,
    });
    const stats1 = await ctx1.graph!.stats();
    const packet = await ctx1.finish();

    const ctx2 = await replayFromPacket(packet);
    const stats2 = await ctx2.graph!.stats();
    await ctx2.finish();

    expect(stats1.nodes).toBe(stats2.nodes);
    expect(stats1.edges).toBe(stats2.edges);
  });
});
