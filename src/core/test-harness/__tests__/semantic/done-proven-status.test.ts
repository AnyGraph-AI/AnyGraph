/**
 * N4 Semantic Test: Done/Proven Status Semantics
 *
 * Tests the relationship between task status (done/planned),
 * hasCodeEvidence flag, and actual HAS_CODE_EVIDENCE edges.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */
import { describe, it, expect } from 'vitest';
import { setupReplay, createEphemeralGraph } from '../../index.js';
import { SIMPLE_PLAN, PLAN_WITH_DRIFT, BLOCKED_CHAIN } from '../../fixtures/micro/index.js';

describe('N4: Done/Proven Status Semantics', () => {
  describe('Happy Path', () => {
    it('done task with evidence: consistent state', async () => {
      const ctx = await setupReplay({
        testName: 'done-with-evidence', lane: 'A',
        hermeticConfig: { blockNetwork: false }, fixture: SIMPLE_PLAN,
      });
      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, status: 'done'})
        WHERE t.hasCodeEvidence = true
        RETURN t.name AS name
      `, { pid: ctx.graph!.projectId });
      expect(result.records).toHaveLength(1);
      expect(result.records[0].get('name')).toBe('Set up project');
      await ctx.finish();
    });

    it('planned task without evidence: consistent state', async () => {
      const ctx = await setupReplay({
        testName: 'planned-no-evidence', lane: 'A',
        hermeticConfig: { blockNetwork: false }, fixture: SIMPLE_PLAN,
      });
      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, status: 'planned'})
        WHERE t.hasCodeEvidence = false
        RETURN t.name AS name
      `, { pid: ctx.graph!.projectId });
      expect(result.records).toHaveLength(1);
      await ctx.finish();
    });
  });

  describe('Failure Cases', () => {
    it('drift detection: planned task WITH evidence flags as drift', async () => {
      const ctx = await setupReplay({
        testName: 'drift-detection', lane: 'A',
        hermeticConfig: { blockNetwork: false }, fixture: PLAN_WITH_DRIFT,
      });
      const drift = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid, status: 'planned'})
        WHERE t.hasCodeEvidence = true
        RETURN t.name AS name
      `, { pid: ctx.graph!.projectId });
      expect(drift.records).toHaveLength(1);
      expect(drift.records[0].get('name')).toBe('Implement feature X');
      await ctx.finish();
    });

    it('blocked chain: downstream tasks cant be done before upstream', async () => {
      const ctx = await setupReplay({
        testName: 'blocked-chain-semantics', lane: 'A',
        hermeticConfig: { blockNetwork: false }, fixture: BLOCKED_CHAIN,
      });
      const chain = await ctx.graph!.run(`
        MATCH path = (final:Task {name: 'Final integration', projectId: $pid})
          -[:DEPENDS_ON*]->(root:Task {status: 'done'})
        RETURN length(path) AS depth
      `, { pid: ctx.graph!.projectId });
      expect(chain.records).toHaveLength(1);
      expect(chain.records[0].get('depth').toNumber()).toBe(2);
      await ctx.finish();
    });
  });

  describe('Replay Determinism', () => {
    it('replay produces identical query results', async () => {
      const config = {
        testName: 'replay-status', lane: 'A',
        hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', rngSeed: 'status-replay', blockNetwork: false },
        fixture: SIMPLE_PLAN,
      };
      const ctx1 = await setupReplay(config);
      const r1 = await ctx1.graph!.run(`
        MATCH (t:Task {projectId: $pid})
        RETURN t.name AS name, t.status AS status ORDER BY t.name
      `, { pid: ctx1.graph!.projectId });
      const names1 = r1.records.map(r => r.get('name'));
      await ctx1.finish();

      const ctx2 = await setupReplay(config);
      const r2 = await ctx2.graph!.run(`
        MATCH (t:Task {projectId: $pid})
        RETURN t.name AS name, t.status AS status ORDER BY t.name
      `, { pid: ctx2.graph!.projectId });
      const names2 = r2.records.map(r => r.get('name'));
      await ctx2.finish();

      expect(names1).toEqual(names2);
    });
  });

  describe('Idempotency', () => {
    it('seeding same fixture twice yields same state', async () => {
      const rt1 = await createEphemeralGraph({ setupSchema: false });
      await rt1.seed(SIMPLE_PLAN);
      const s1 = await rt1.stats();
      await rt1.teardown();

      const rt2 = await createEphemeralGraph({ setupSchema: false });
      await rt2.seed(SIMPLE_PLAN);
      const s2 = await rt2.stats();
      await rt2.teardown();

      expect(s1.nodes).toBe(s2.nodes);
      expect(s1.edges).toBe(s2.edges);
    });
  });
});
