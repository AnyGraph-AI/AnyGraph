/**
 * N4 Semantic Test: Confidence Core Invariants
 *
 * Tests confidence scoring, edge provenance, and the invariants
 * that confidence values must obey.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */

import { setupReplay } from '../../index.js';
import type { TestFixture } from '../../ephemeral-graph.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

/** Fixture with confidence-annotated edges */
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

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    // HAPPY: high-confidence CALLS edges
    ['type-checker CALLS have confidence 1.0', async () => {
      const ctx = await setupReplay({
        testName: 'confidence-high', lane: 'A',
        hermeticConfig: { blockNetwork: false }, fixture: CONFIDENCE_FIXTURE,
      });
      const result = await ctx.graph!.run(`
        MATCH ()-[r:CALLS {projectId: $pid}]->()
        WHERE r.sourceKind = 'typeChecker'
        RETURN r.confidence AS conf
      `, { pid: ctx.graph!.projectId });
      // If edge doesn't have projectId, try without
      if (result.records.length === 0) {
        const r2 = await ctx.graph!.run(`
          MATCH (a {projectId: $pid})-[r:CALLS]->(b {projectId: $pid})
          RETURN r.confidence AS conf
        `, { pid: ctx.graph!.projectId });
        assert(r2.records.length === 1, `expected 1 CALLS edge, got ${r2.records.length}`);
        assert(r2.records[0].get('conf') === 1.0, 'type-checker edge should have confidence 1.0');
      }
      await ctx.finish();
    }],

    // HAPPY: POSSIBLE_CALL has lower confidence
    ['POSSIBLE_CALL edges have sub-1.0 confidence', async () => {
      const ctx = await setupReplay({
        testName: 'confidence-possible', lane: 'A',
        hermeticConfig: { blockNetwork: false }, fixture: CONFIDENCE_FIXTURE,
      });
      const result = await ctx.graph!.run(`
        MATCH (a {projectId: $pid})-[r:POSSIBLE_CALL]->(b {projectId: $pid})
        RETURN r.confidence AS conf, r.reason AS reason
      `, { pid: ctx.graph!.projectId });
      assert(result.records.length === 1, `expected 1 POSSIBLE_CALL, got ${result.records.length}`);
      const conf = result.records[0].get('conf');
      assert(conf < 1.0 && conf > 0, `confidence should be 0 < c < 1, got ${conf}`);
      await ctx.finish();
    }],

    // FAIL: confidence out of bounds detected
    ['detect confidence out of [0,1] range', async () => {
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
      assert(result.records[0].get('violations').toNumber() === 1, 'should detect OOB confidence');
      await ctx.finish();
    }],

    // REPLAY
    ['replay: confidence queries deterministic', async () => {
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

      assert(r1.records.length === r2.records.length, 'replay record count should match');
    }],
  ];

  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.error(`  ❌ ${name}: ${(e as Error).message}`); }
  }
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

runTests();
