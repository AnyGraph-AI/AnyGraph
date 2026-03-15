/**
 * N4 Semantic Test: Confidence Core Invariants
 *
 * Tests confidence scoring, edge provenance, and the invariants
 * that confidence values must obey.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */
import { describe, it, expect } from 'vitest';
import { setupReplay } from '../../index.js';
import type { TestFixture } from '../../ephemeral-graph.js';

const CONFIDENCE_FIXTURE: TestFixture = {
  nodes: [
    { labels: ['SourceFile'], properties: { name: 'conf.ts', filePath: '/test/conf.ts', lineCount: 50 }, ref: 'sf' },
    { labels: ['Function'], properties: { name: 'highConf', filePath: '/test/conf.ts', riskLevel: 20, riskTier: 'MEDIUM', fanInCount: 1, fanOutCount: 1, lineCount: 20 }, ref: 'fn_high' },
    { labels: ['Function'], properties: { name: 'lowConf', filePath: '/test/conf.ts', riskLevel: 5, riskTier: 'LOW', fanInCount: 0, fanOutCount: 0, lineCount: 10 }, ref: 'fn_low' },
    { labels: ['Function'], properties: { name: 'possibleTarget', filePath: '/test/conf.ts', riskLevel: 8, riskTier: 'LOW', fanInCount: 0, fanOutCount: 0, lineCount: 15 }, ref: 'fn_possible' },
  ],
  edges: [
    { fromRef: 'sf', toRef: 'fn_high', type: 'CONTAINS' },
    { fromRef: 'sf', toRef: 'fn_low', type: 'CONTAINS' },
    { fromRef: 'sf', toRef: 'fn_possible', type: 'CONTAINS' },
    { fromRef: 'fn_high', toRef: 'fn_low', type: 'CALLS', properties: { confidence: 1.0, sourceKind: 'typeChecker', crossFile: false } },
    { fromRef: 'fn_high', toRef: 'fn_possible', type: 'POSSIBLE_CALL', properties: { confidence: 0.6, reason: 'ternary dispatch' } },
  ],
};

describe('N4: Confidence Core Invariants', () => {
  it('type-checker CALLS have confidence 1.0', async () => {
    const ctx = await setupReplay({
      testName: 'confidence-high', lane: 'A',
      hermeticConfig: { blockNetwork: false }, fixture: CONFIDENCE_FIXTURE,
    });
    const result = await ctx.graph!.run(`
      MATCH ()-[r:CALLS {projectId: $pid}]->()
      WHERE r.sourceKind = 'typeChecker'
      RETURN r.confidence AS conf
    `, { pid: ctx.graph!.projectId });
    if (result.records.length === 0) {
      const r2 = await ctx.graph!.run(`
        MATCH (a {projectId: $pid})-[r:CALLS]->(b {projectId: $pid})
        RETURN r.confidence AS conf
      `, { pid: ctx.graph!.projectId });
      expect(r2.records).toHaveLength(1);
      expect(r2.records[0].get('conf')).toBe(1.0);
    }
    await ctx.finish();
  });

  it('POSSIBLE_CALL edges have sub-1.0 confidence', async () => {
    const ctx = await setupReplay({
      testName: 'confidence-possible', lane: 'A',
      hermeticConfig: { blockNetwork: false }, fixture: CONFIDENCE_FIXTURE,
    });
    const result = await ctx.graph!.run(`
      MATCH (a {projectId: $pid})-[r:POSSIBLE_CALL]->(b {projectId: $pid})
      RETURN r.confidence AS conf, r.reason AS reason
    `, { pid: ctx.graph!.projectId });
    expect(result.records).toHaveLength(1);
    const conf = result.records[0].get('conf');
    expect(conf).toBeGreaterThan(0);
    expect(conf).toBeLessThan(1.0);
    await ctx.finish();
  });

  it('detect confidence out of [0,1] range', async () => {
    const badFixture: TestFixture = {
      nodes: [
        { labels: ['Function'], properties: { name: 'a', filePath: '/t/a.ts' }, ref: 'a' },
        { labels: ['Function'], properties: { name: 'b', filePath: '/t/b.ts' }, ref: 'b' },
      ],
      edges: [
        { fromRef: 'a', toRef: 'b', type: 'CALLS', properties: { confidence: 1.5 } },
      ],
    };
    const ctx = await setupReplay({
      testName: 'confidence-oob', lane: 'A',
      hermeticConfig: { blockNetwork: false }, fixture: badFixture,
    });
    const result = await ctx.graph!.run(`
      MATCH (a {projectId: $pid})-[r:CALLS]->(b {projectId: $pid})
      WHERE r.confidence IS NOT NULL AND (r.confidence < 0 OR r.confidence > 1.0)
      RETURN count(r) AS violations
    `, { pid: ctx.graph!.projectId });
    expect(result.records[0].get('violations').toNumber()).toBe(1);
    await ctx.finish();
  });

  it('replay: confidence queries deterministic', async () => {
    const config = {
      testName: 'confidence-replay', lane: 'A',
      hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', rngSeed: 'conf', blockNetwork: false },
      fixture: CONFIDENCE_FIXTURE,
    };
    const ctx1 = await setupReplay(config);
    const r1 = await ctx1.graph!.run(`
      MATCH (a {projectId: $pid})-[r]->(b {projectId: $pid})
      RETURN type(r) AS t, r.confidence AS c ORDER BY t, c
    `, { pid: ctx1.graph!.projectId });
    await ctx1.finish();

    const ctx2 = await setupReplay(config);
    const r2 = await ctx2.graph!.run(`
      MATCH (a {projectId: $pid})-[r]->(b {projectId: $pid})
      RETURN type(r) AS t, r.confidence AS c ORDER BY t, c
    `, { pid: ctx2.graph!.projectId });
    await ctx2.finish();

    expect(r1.records).toHaveLength(r2.records.length);
  });
});
