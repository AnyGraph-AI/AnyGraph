// Spec source: plans/codegraph/TDD_ROADMAP.md §N2

import { describe, it, expect } from 'vitest';
import {
  createReplayPacket,
  setupReplay,
  replayFromPacket,
  verifyReplayDigest,
  type ReplayPacket,
} from '../replay.js';

describe('replay.ts audit', () => {
  it('createReplayPacket captures hermetic state configuration', () => {
    const packet = createReplayPacket({
      testName: 'capture-hermetic-config',
      lane: 'N2',
      hermeticConfig: {
        frozenClock: '2026-03-14T00:00:00.000Z',
        timezone: 'UTC',
        locale: 'en-CA',
        rngSeed: 'spec-seed',
        blockNetwork: true,
      },
    });

    expect(packet.schemaVersion).toBe(1);
    expect(packet.testName).toBe('capture-hermetic-config');
    expect(packet.lane).toBe('N2');
    expect(packet.hermeticConfig.frozenClock).toBe('2026-03-14T00:00:00.000Z');
    expect(packet.hermeticConfig.rngSeed).toBe('spec-seed');
    expect(packet.digest.length).toBeGreaterThan(0);
    expect(verifyReplayDigest(packet)).toBe(true);
  });

  it('setupReplay restores replayable hermetic runtime from packet config', async () => {
    const ctx = await setupReplay({
      testName: 'setup-replay-restores-state',
      lane: 'N2',
      hermeticConfig: {
        frozenClock: '2026-01-01T12:00:00.000Z',
        rngSeed: 'restored-seed',
        timezone: 'UTC',
        locale: 'en-US',
        blockNetwork: false,
      },
    });

    expect(ctx.hermeticState.clock?.frozenAt).toBe('2026-01-01T12:00:00.000Z');
    expect(ctx.hermeticState.rng?.seed).toBe('restored-seed');
    expect(ctx.packet.testName).toBe('setup-replay-restores-state');

    await ctx.finish();
  });

  it('replayFromPacket runs under replayed conditions and yields identical outputs', async () => {
    const original = await setupReplay({
      testName: 'identical-output-under-replay',
      lane: 'N2',
      hermeticConfig: {
        frozenClock: '2026-02-02T02:02:02.000Z',
        rngSeed: 'identical-seed',
        timezone: 'UTC',
        locale: 'en-US',
        blockNetwork: false,
      },
    });

    const baselineNow = Date.now();
    const baselineRand = Math.random();
    original.recordResult({ passed: true, assertions: 2, duration_ms: 5 });
    const packet = await original.finish();

    const replay = await replayFromPacket(packet);
    const replayNow = Date.now();
    const replayRand = Math.random();
    await replay.finish();

    expect(replayNow).toBe(baselineNow);
    expect(replayRand).toBe(baselineRand);
  });

  it('replay remains deterministic with the same packet across repeated runs', async () => {
    const packet = createReplayPacket({
      testName: 'stable-replay-from-same-packet',
      lane: 'N2',
      hermeticConfig: {
        frozenClock: '2026-05-05T05:05:05.000Z',
        rngSeed: 'repeatable-seed',
        timezone: 'UTC',
        locale: 'en-US',
        blockNetwork: false,
      },
    });

    const observed: Array<{ now: number; rand: number }> = [];

    for (let i = 0; i < 2; i++) {
      const ctx = await replayFromPacket(packet as ReplayPacket);
      observed.push({ now: Date.now(), rand: Math.random() });
      await ctx.finish();
    }

    expect(observed[0]?.now).toBe(observed[1]?.now);
    expect(observed[0]?.rand).toBe(observed[1]?.rand);
  });
});
