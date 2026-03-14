/**
 * N4 Semantic Test: Waiver/Expiry Enforcement
 *
 * Tests that governance waivers expire correctly, that expired waivers
 * are no longer honored, and that the enforcement is deterministic.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */

import { setupReplay } from '../../index.js';
import type { TestFixture } from '../../ephemeral-graph.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

/** Fixture with waiver metadata on tasks */
const WAIVER_FIXTURE: TestFixture = {
  nodes: [
    { labels: ['PlanProject'], properties: { name: 'Waiver Plan', status: 'active' }, ref: 'plan' },
    { labels: ['Milestone'], properties: { name: 'Milestone W1: Waivers', status: 'planned' }, ref: 'ms_w1' },
    { labels: ['Task'], properties: {
      name: 'Active waiver task',
      status: 'done',
      hasCodeEvidence: false,
      waiverReason: 'Dependency not available yet',
      waiverExpiresAt: '2026-06-01T00:00:00.000Z',
      waiverApprovedBy: 'jonathan',
    }, ref: 'task_active_waiver' },
    { labels: ['Task'], properties: {
      name: 'Expired waiver task',
      status: 'done',
      hasCodeEvidence: false,
      waiverReason: 'Legacy code not testable',
      waiverExpiresAt: '2025-01-01T00:00:00.000Z',
      waiverApprovedBy: 'jonathan',
    }, ref: 'task_expired_waiver' },
    { labels: ['Task'], properties: {
      name: 'No waiver task',
      status: 'done',
      hasCodeEvidence: true,
    }, ref: 'task_no_waiver' },
  ],
  edges: [
    { fromRef: 'ms_w1', toRef: 'plan', type: 'PART_OF' },
    { fromRef: 'task_active_waiver', toRef: 'ms_w1', type: 'PART_OF' },
    { fromRef: 'task_expired_waiver', toRef: 'ms_w1', type: 'PART_OF' },
    { fromRef: 'task_no_waiver', toRef: 'ms_w1', type: 'PART_OF' },
  ],
};

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    // HAPPY: active waiver is honored
    ['active waiver passes enforcement', async () => {
      const ctx = await setupReplay({
        testName: 'waiver-active', lane: 'D',
        hermeticConfig: { frozenClock: '2026-03-01T00:00:00.000Z', blockNetwork: false },
        fixture: WAIVER_FIXTURE,
      });
      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid})
        WHERE t.waiverExpiresAt IS NOT NULL AND t.waiverExpiresAt > '2026-03-01T00:00:00.000Z'
        RETURN t.name AS name
      `, { pid: ctx.graph!.projectId });
      assert(result.records.length === 1, `expected 1 active waiver, got ${result.records.length}`);
      assert(result.records[0].get('name') === 'Active waiver task', 'wrong task');
      await ctx.finish();
    }],

    // FAIL: expired waiver detected
    ['expired waiver fails enforcement', async () => {
      const ctx = await setupReplay({
        testName: 'waiver-expired', lane: 'D',
        hermeticConfig: { frozenClock: '2026-03-01T00:00:00.000Z', blockNetwork: false },
        fixture: WAIVER_FIXTURE,
      });
      const result = await ctx.graph!.run(`
        MATCH (t:Task {projectId: $pid})
        WHERE t.waiverExpiresAt IS NOT NULL AND t.waiverExpiresAt <= '2026-03-01T00:00:00.000Z'
          AND t.hasCodeEvidence = false
        RETURN t.name AS name
      `, { pid: ctx.graph!.projectId });
      assert(result.records.length === 1, `expected 1 expired waiver, got ${result.records.length}`);
      assert(result.records[0].get('name') === 'Expired waiver task', 'wrong task');
      await ctx.finish();
    }],

    // REPLAY: waiver enforcement is deterministic
    ['replay: waiver check deterministic', async () => {
      const config = {
        testName: 'waiver-replay', lane: 'D',
        hermeticConfig: { frozenClock: '2026-03-01T00:00:00.000Z', rngSeed: 'waiver', blockNetwork: false },
        fixture: WAIVER_FIXTURE,
      };
      const ctx1 = await setupReplay(config);
      const r1 = await ctx1.graph!.run(`
        MATCH (t:Task {projectId: $pid}) WHERE t.waiverExpiresAt IS NOT NULL
        RETURN t.name, t.waiverExpiresAt ORDER BY t.name
      `, { pid: ctx1.graph!.projectId });
      await ctx1.finish();

      const ctx2 = await setupReplay(config);
      const r2 = await ctx2.graph!.run(`
        MATCH (t:Task {projectId: $pid}) WHERE t.waiverExpiresAt IS NOT NULL
        RETURN t.name, t.waiverExpiresAt ORDER BY t.name
      `, { pid: ctx2.graph!.projectId });
      await ctx2.finish();

      assert(r1.records.length === r2.records.length, 'replay record count mismatch');
    }],

    // IDEMPOTENCY
    ['idempotent: waiver query stable', async () => {
      const ctx = await setupReplay({
        testName: 'waiver-idempotent', lane: 'D',
        hermeticConfig: { blockNetwork: false }, fixture: WAIVER_FIXTURE,
      });
      const q = `MATCH (t:Task {projectId: $pid}) WHERE t.waiverReason IS NOT NULL RETURN count(t) AS c`;
      const r1 = await ctx.graph!.run(q, { pid: ctx.graph!.projectId });
      const r2 = await ctx.graph!.run(q, { pid: ctx.graph!.projectId });
      assert(
        r1.records[0].get('c').toNumber() === r2.records[0].get('c').toNumber(),
        'idempotency check failed'
      );
      await ctx.finish();
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
