/**
 * N4 Semantic Test: Status Resolver Logic
 *
 * Tests how task status should be determined from graph evidence.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */
import { describe, it, expect } from 'vitest';
import { setupReplay } from '../../index.js';
import { SIMPLE_PLAN, BLOCKED_CHAIN } from '../../fixtures/micro/index.js';
import { CODE_PLAN_CROSS_DOMAIN } from '../../fixtures/scenario/index.js';

describe('N4: Status Resolver Logic', () => {
  it('unblocked task: all dependencies satisfied', async () => {
    const ctx = await setupReplay({
      testName: 'resolver-unblocked', lane: 'A',
      hermeticConfig: { blockNetwork: false }, fixture: SIMPLE_PLAN,
    });
    const result = await ctx.graph!.run(`
      MATCH (t:Task {projectId: $pid, status: 'planned'})
      WHERE ALL(dep IN [(t)-[:DEPENDS_ON]->(d) | d] WHERE dep.status = 'done')
      RETURN t.name AS name
    `, { pid: ctx.graph!.projectId });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].get('name')).toBe('Write core logic');
    await ctx.finish();
  });

  it('blocked task: dependency not done', async () => {
    const ctx = await setupReplay({
      testName: 'resolver-blocked', lane: 'A',
      hermeticConfig: { blockNetwork: false }, fixture: BLOCKED_CHAIN,
    });
    const result = await ctx.graph!.run(`
      MATCH (t:Task {projectId: $pid, name: 'Final integration'})
      OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep)
      WHERE dep.status <> 'done'
      RETURN count(dep) AS blockers
    `, { pid: ctx.graph!.projectId });
    expect(result.records[0].get('blockers').toNumber()).toBe(1);
    await ctx.finish();
  });

  it('replay: resolver produces deterministic results', async () => {
    const config = { testName: 'resolver-replay', lane: 'A',
      hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', rngSeed: 'resolver', blockNetwork: false },
      fixture: CODE_PLAN_CROSS_DOMAIN };

    const ctx1 = await setupReplay(config);
    const r1 = await ctx1.graph!.run(`
      MATCH (t:Task {projectId: $pid})-[:HAS_CODE_EVIDENCE]->(sf)
      RETURN t.name AS task, sf.name AS evidence ORDER BY t.name
    `, { pid: ctx1.graph!.projectId });
    const data1 = r1.records.map(r => `${r.get('task')}→${r.get('evidence')}`);
    await ctx1.finish();

    const ctx2 = await setupReplay(config);
    const r2 = await ctx2.graph!.run(`
      MATCH (t:Task {projectId: $pid})-[:HAS_CODE_EVIDENCE]->(sf)
      RETURN t.name AS task, sf.name AS evidence ORDER BY t.name
    `, { pid: ctx2.graph!.projectId });
    const data2 = r2.records.map(r => `${r.get('task')}→${r.get('evidence')}`);
    await ctx2.finish();

    expect(data1).toEqual(data2);
  });

  it('idempotent: resolver query returns same result on repeated calls', async () => {
    const ctx = await setupReplay({
      testName: 'resolver-idempotent', lane: 'A',
      hermeticConfig: { blockNetwork: false }, fixture: SIMPLE_PLAN,
    });
    const query = `MATCH (t:Task {projectId: $pid}) RETURN t.name, t.status ORDER BY t.name`;
    const r1 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });
    const r2 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });
    const r3 = await ctx.graph!.run(query, { pid: ctx.graph!.projectId });

    const s1 = JSON.stringify(r1.records.map(r => r.toObject()));
    const s2 = JSON.stringify(r2.records.map(r => r.toObject()));
    const s3 = JSON.stringify(r3.records.map(r => r.toObject()));

    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
    await ctx.finish();
  });
});
