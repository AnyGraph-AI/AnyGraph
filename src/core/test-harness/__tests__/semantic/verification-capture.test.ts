/**
 * N4 Semantic Test: Verification Capture Chain
 *
 * Tests that verification runs produce proper graph artifacts:
 * gate decisions, commit snapshots, working tree snapshots, artifacts.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N4
 */

import { setupReplay } from '../../index.js';
import type { TestFixture } from '../../ephemeral-graph.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

/** Fixture simulating a verification capture */
const VERIFICATION_FIXTURE: TestFixture = {
  nodes: [
    { labels: ['VerificationRun'], properties: {
      name: 'done-check-run-1',
      runId: 'vr:test:1',
      ranAt: '2026-01-01T00:00:00.000Z',
      status: 'pass',
      toolName: 'done-check',
    }, ref: 'vr' },
    { labels: ['GateDecision'], properties: {
      name: 'gate-decision-1',
      decision: 'pass',
      decisionHash: 'sha256:abc123',
    }, ref: 'gate' },
    { labels: ['CommitSnapshot'], properties: {
      name: 'commit-snap-1',
      headSha: 'abc123def456',
      branch: 'main',
    }, ref: 'commit' },
    { labels: ['WorkingTreeSnapshot'], properties: {
      name: 'wt-snap-1',
      isDirty: false,
      diffHash: 'sha256:000',
    }, ref: 'wt' },
    { labels: ['Artifact'], properties: {
      name: 'integrity-snapshot',
      artifactPath: 'artifacts/integrity-snapshots/2026-01-01.jsonl',
      artifactHash: 'sha256:fff',
    }, ref: 'artifact' },
  ],
  edges: [
    { fromRef: 'vr', toRef: 'gate', type: 'EMITS_GATE_DECISION' },
    { fromRef: 'vr', toRef: 'commit', type: 'CAPTURED_COMMIT' },
    { fromRef: 'vr', toRef: 'wt', type: 'CAPTURED_WORKTREE' },
    { fromRef: 'vr', toRef: 'artifact', type: 'GENERATED_ARTIFACT' },
  ],
};

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    // HAPPY: full capture chain exists
    ['verification run links to all artifacts', async () => {
      const ctx = await setupReplay({
        testName: 'capture-chain', lane: 'D',
        hermeticConfig: { blockNetwork: false }, fixture: VERIFICATION_FIXTURE,
      });
      // Check all edges from VerificationRun
      const result = await ctx.graph!.run(`
        MATCH (vr:VerificationRun {projectId: $pid})-[r]->(target)
        RETURN type(r) AS edgeType, labels(target)[0] AS targetLabel
        ORDER BY edgeType
      `, { pid: ctx.graph!.projectId });
      assert(result.records.length === 4, `expected 4 edges, got ${result.records.length}`);
      const types = result.records.map(r => r.get('edgeType')).sort();
      assert(types.includes('CAPTURED_COMMIT'), 'missing CAPTURED_COMMIT');
      assert(types.includes('CAPTURED_WORKTREE'), 'missing CAPTURED_WORKTREE');
      assert(types.includes('EMITS_GATE_DECISION'), 'missing EMITS_GATE_DECISION');
      assert(types.includes('GENERATED_ARTIFACT'), 'missing GENERATED_ARTIFACT');
      await ctx.finish();
    }],

    // FAIL: missing gate decision detected
    ['missing gate decision is detectable', async () => {
      const incompleteFixture: TestFixture = {
        nodes: [
          { labels: ['VerificationRun'], properties: { name: 'incomplete-run', runId: 'vr:test:2', status: 'pass' }, ref: 'vr' },
          { labels: ['CommitSnapshot'], properties: { name: 'cs-2', headSha: 'def456' }, ref: 'cs' },
        ],
        edges: [
          { fromRef: 'vr', toRef: 'cs', type: 'CAPTURED_COMMIT' },
        ],
      };
      const ctx = await setupReplay({
        testName: 'capture-missing-gate', lane: 'D',
        hermeticConfig: { blockNetwork: false }, fixture: incompleteFixture,
      });
      const result = await ctx.graph!.run(`
        MATCH (vr:VerificationRun {projectId: $pid})
        WHERE NOT (vr)-[:EMITS_GATE_DECISION]->()
        RETURN vr.name AS name
      `, { pid: ctx.graph!.projectId });
      assert(result.records.length === 1, 'should detect missing gate decision');
      await ctx.finish();
    }],

    // REPLAY
    ['replay: verification fixture deterministic', async () => {
      const config = {
        testName: 'capture-replay', lane: 'D',
        hermeticConfig: { frozenClock: '2026-01-01T00:00:00.000Z', blockNetwork: false },
        fixture: VERIFICATION_FIXTURE,
      };
      const ctx1 = await setupReplay(config);
      const s1 = await ctx1.graph!.stats();
      await ctx1.finish();

      const ctx2 = await setupReplay(config);
      const s2 = await ctx2.graph!.stats();
      await ctx2.finish();

      assert(s1.nodes === s2.nodes && s1.edges === s2.edges, 'replay stats should match');
    }],

    // IDEMPOTENCY
    ['idempotent: capture queries stable', async () => {
      const ctx = await setupReplay({
        testName: 'capture-idempotent', lane: 'D',
        hermeticConfig: { blockNetwork: false }, fixture: VERIFICATION_FIXTURE,
      });
      const q = `MATCH (vr:VerificationRun {projectId: $pid})-[r]->() RETURN count(r) AS edges`;
      const r1 = await ctx.graph!.run(q, { pid: ctx.graph!.projectId });
      const r2 = await ctx.graph!.run(q, { pid: ctx.graph!.projectId });
      assert(
        r1.records[0].get('edges').toNumber() === r2.records[0].get('edges').toNumber(),
        'idempotency failed'
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
