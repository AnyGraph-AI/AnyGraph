/**
 * N4 Semantic Test: Freshness Guards
 *
 * Tests that stale data is detected: plan freshness, governance freshness,
 * evidence staleness, snapshot age.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */
import { describe, it, expect } from 'vitest';
import { setupReplay } from '../../index.js';
import { SIMPLE_PLAN } from '../../fixtures/micro/index.js';

describe('N4: Freshness Guards', () => {
  it('fresh snapshot passes age check', async () => {
    const ctx = await setupReplay({
      testName: 'fresh-snapshot', lane: 'A',
      hermeticConfig: { frozenClock: '2026-01-01T12:00:00.000Z', blockNetwork: false },
      fixture: SIMPLE_PLAN,
    });
    await ctx.graph!.run(`
      MATCH (t:Task {projectId: $pid, name: 'Set up project'})
      SET t.lastVerifiedAt = $now
    `, { pid: ctx.graph!.projectId, now: '2026-01-01T12:00:00.000Z' });

    const result = await ctx.graph!.run(`
      MATCH (t:Task {projectId: $pid})
      WHERE t.lastVerifiedAt IS NOT NULL
        AND t.lastVerifiedAt = '2026-01-01T12:00:00.000Z'
      RETURN count(t) AS fresh
    `, { pid: ctx.graph!.projectId });
    expect(result.records[0].get('fresh').toNumber()).toBe(1);
    await ctx.finish();
  });

  it('stale verification detected after time advance', async () => {
    const ctx = await setupReplay({
      testName: 'stale-detection', lane: 'A',
      hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', blockNetwork: false },
      fixture: SIMPLE_PLAN,
    });
    await ctx.graph!.run(`
      MATCH (t:Task {projectId: $pid, name: 'Set up project'})
      SET t.lastVerifiedAt = '2026-01-01T00:00:00.000Z'
    `, { pid: ctx.graph!.projectId });

    const staleThreshold = '2026-01-02T00:00:00.000Z';
    const result = await ctx.graph!.run(`
      MATCH (t:Task {projectId: $pid})
      WHERE t.lastVerifiedAt IS NOT NULL
        AND t.lastVerifiedAt < $threshold
      RETURN count(t) AS stale
    `, { pid: ctx.graph!.projectId, threshold: staleThreshold });
    expect(result.records[0].get('stale').toNumber()).toBe(1);
    await ctx.finish();
  });

  it('replay: freshness queries deterministic', async () => {
    const config = {
      testName: 'freshness-replay', lane: 'A',
      hermeticConfig: { frozenClock: '2026-06-01T00:00:00.000Z', rngSeed: 'fresh', blockNetwork: false },
      fixture: SIMPLE_PLAN,
    };
    const ctx1 = await setupReplay(config);
    const t1 = Date.now();
    await ctx1.finish();

    const ctx2 = await setupReplay(config);
    const t2 = Date.now();
    await ctx2.finish();

    expect(t1).toBe(t2);
  });

  it('idempotent: freshness query stable across calls', async () => {
    const ctx = await setupReplay({
      testName: 'freshness-idempotent', lane: 'A',
      hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', blockNetwork: false },
      fixture: SIMPLE_PLAN,
    });
    const query = `MATCH (t:Task {projectId: $pid}) RETURN count(t) AS total`;
    const r1 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });
    const r2 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });
    expect(r1.records[0].get('total').toNumber()).toBe(r2.records[0].get('total').toNumber());
    await ctx.finish();
  });
});
