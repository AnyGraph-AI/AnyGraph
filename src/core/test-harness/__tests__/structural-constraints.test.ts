/**
 * Structural Constraints + Micro Fixtures — Smoke Tests
 */

import { createEphemeralGraph, type EphemeralGraphRuntime } from '../index.js';
import { SINGLE_FUNCTION, CROSS_FILE_CALL, HIGH_RISK_HUB, STATEFUL_CLASS } from '../fixtures/micro/index.js';
import { SIMPLE_PLAN, PLAN_WITH_DRIFT, BLOCKED_CHAIN } from '../fixtures/micro/index.js';
import { applyConstraints, checkStructuralIntegrity, CORE_CONSTRAINTS } from '../structural-constraints.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    // ---- Micro Fixture Tests ----
    ['SINGLE_FUNCTION fixture seeds correctly', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(SINGLE_FUNCTION);
      const stats = await rt.stats();
      assert(stats.nodes === 2, `expected 2 nodes, got ${stats.nodes}`);
      assert(stats.edges === 1, `expected 1 edge, got ${stats.edges}`);
      await rt.teardown();
    }],

    ['CROSS_FILE_CALL fixture has correct structure', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(CROSS_FILE_CALL);
      const result = await rt.run(`
        MATCH (a:Function {projectId:$projectId})-[:CALLS]->(b:Function)
        RETURN a.name AS caller, b.name AS callee
      `, { projectId: rt.projectId });
      assert(result.records.length === 1, `expected 1 call, got ${result.records.length}`);
      assert(result.records[0].get('caller') === 'doWork', 'wrong caller');
      assert(result.records[0].get('callee') === 'helper', 'wrong callee');
      await rt.teardown();
    }],

    ['HIGH_RISK_HUB fixture: hub has 3 callers', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(HIGH_RISK_HUB);
      const result = await rt.run(`
        MATCH (caller)-[:CALLS]->(hub:Function {name:'centralHub', projectId:$projectId})
        RETURN count(caller) AS callerCount
      `, { projectId: rt.projectId });
      const count = result.records[0].get('callerCount').toNumber();
      assert(count === 3, `expected 3 callers, got ${count}`);
      await rt.teardown();
    }],

    ['STATEFUL_CLASS fixture: state read/write edges', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(STATEFUL_CLASS);
      const reads = await rt.run(`
        MATCH (m:Method {projectId:$projectId})-[:READS_STATE]->(f:Field)
        RETURN m.name AS method, f.name AS field
      `, { projectId: rt.projectId });
      assert(reads.records.length === 1, `expected 1 read, got ${reads.records.length}`);
      assert(reads.records[0].get('method') === 'getUser', 'wrong reader');

      const writes = await rt.run(`
        MATCH (m:Method {projectId:$projectId})-[:WRITES_STATE]->(f:Field)
        RETURN m.name AS method, f.name AS field
      `, { projectId: rt.projectId });
      assert(writes.records.length === 1, `expected 1 write, got ${writes.records.length}`);
      assert(writes.records[0].get('method') === 'setUser', 'wrong writer');
      await rt.teardown();
    }],

    ['SIMPLE_PLAN fixture: dependency chain', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(SIMPLE_PLAN);
      const deps = await rt.run(`
        MATCH (t:Task {projectId:$projectId})-[:DEPENDS_ON]->(dep:Task)
        RETURN t.name AS task, dep.name AS dependsOn
      `, { projectId: rt.projectId });
      assert(deps.records.length === 1, `expected 1 dep, got ${deps.records.length}`);
      assert(deps.records[0].get('task') === 'Write core logic', 'wrong dependent');
      await rt.teardown();
    }],

    ['PLAN_WITH_DRIFT fixture: drift detection query', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(PLAN_WITH_DRIFT);
      const drift = await rt.run(`
        MATCH (t:Task {projectId:$projectId, status:'planned'})
        WHERE t.hasCodeEvidence = true
        RETURN t.name AS name
      `, { projectId: rt.projectId });
      assert(drift.records.length === 1, `expected 1 drift, got ${drift.records.length}`);
      assert(drift.records[0].get('name') === 'Implement feature X', 'wrong drifted task');
      await rt.teardown();
    }],

    ['BLOCKED_CHAIN fixture: transitive blocking', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(BLOCKED_CHAIN);
      const chain = await rt.run(`
        MATCH path = (final:Task {name:'Final integration', projectId:$projectId})
          -[:DEPENDS_ON*]->(root:Task)
        WHERE NOT (root)-[:DEPENDS_ON]->()
        RETURN length(path) AS depth, root.name AS rootTask
      `, { projectId: rt.projectId });
      assert(chain.records.length === 1, `expected 1 chain, got ${chain.records.length}`);
      assert(chain.records[0].get('depth').toNumber() === 2, 'expected depth 2');
      assert(chain.records[0].get('rootTask') === 'Foundation task', 'wrong root');
      await rt.teardown();
    }],

    // ---- Structural Constraint Tests ----
    ['applyConstraints creates constraints', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      const { applied, errors } = await applyConstraints(rt.run);
      assert(applied > 0, `expected some constraints, applied ${applied}`);
      // Some may already exist from previous runs — that's fine
      await rt.teardown();
    }],

    ['checkStructuralIntegrity passes on clean fixture', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(SINGLE_FUNCTION);
      const report = await checkStructuralIntegrity(rt.run, rt.projectId);
      // All validation queries should pass on a clean fixture
      const validationChecks = report.checks.filter(c =>
        !CORE_CONSTRAINTS.some(cc => cc.name === c.name)
      );
      for (const check of validationChecks) {
        assert(check.valid, `validation ${check.name} failed: ${check.error}`);
      }
      await rt.teardown();
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

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

runTests();
