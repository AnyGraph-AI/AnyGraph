/**
 * Structural Constraints + Micro Fixtures — Smoke Tests
 */
import { describe, it, expect } from 'vitest';
import { createEphemeralGraph } from '../index.js';
import { SINGLE_FUNCTION, CROSS_FILE_CALL, HIGH_RISK_HUB, STATEFUL_CLASS } from '../fixtures/micro/index.js';
import { SIMPLE_PLAN, PLAN_WITH_DRIFT, BLOCKED_CHAIN } from '../fixtures/micro/index.js';
import { applyConstraints, checkStructuralIntegrity, CORE_CONSTRAINTS } from '../structural-constraints.js';

describe('Structural Constraints + Micro Fixtures', () => {
  // ---- Micro Fixture Tests ----
  describe('Code Fixtures', () => {
    it('SINGLE_FUNCTION fixture seeds correctly', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(SINGLE_FUNCTION);
      const stats = await rt.stats();
      expect(stats.nodes).toBe(2);
      expect(stats.edges).toBe(1);
      await rt.teardown();
    });

    it('CROSS_FILE_CALL fixture has correct structure', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(CROSS_FILE_CALL);
      const result = await rt.run(`
        MATCH (a:Function {projectId:$projectId})-[:CALLS]->(b:Function)
        RETURN a.name AS caller, b.name AS callee
      `, { projectId: rt.projectId });
      expect(result.records).toHaveLength(1);
      expect(result.records[0].get('caller')).toBe('doWork');
      expect(result.records[0].get('callee')).toBe('helper');
      await rt.teardown();
    });

    it('HIGH_RISK_HUB fixture: hub has 3 callers', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(HIGH_RISK_HUB);
      const result = await rt.run(`
        MATCH (caller)-[:CALLS]->(hub:Function {name:'centralHub', projectId:$projectId})
        RETURN count(caller) AS callerCount
      `, { projectId: rt.projectId });
      const count = result.records[0].get('callerCount').toNumber();
      expect(count).toBe(3);
      await rt.teardown();
    });

    it('STATEFUL_CLASS fixture: state read/write edges', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(STATEFUL_CLASS);
      const reads = await rt.run(`
        MATCH (m:Method {projectId:$projectId})-[:READS_STATE]->(f:Field)
        RETURN m.name AS method, f.name AS field
      `, { projectId: rt.projectId });
      expect(reads.records).toHaveLength(1);
      expect(reads.records[0].get('method')).toBe('getUser');

      const writes = await rt.run(`
        MATCH (m:Method {projectId:$projectId})-[:WRITES_STATE]->(f:Field)
        RETURN m.name AS method, f.name AS field
      `, { projectId: rt.projectId });
      expect(writes.records).toHaveLength(1);
      expect(writes.records[0].get('method')).toBe('setUser');
      await rt.teardown();
    });
  });

  describe('Plan Fixtures', () => {
    it('SIMPLE_PLAN fixture: dependency chain', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(SIMPLE_PLAN);
      const deps = await rt.run(`
        MATCH (t:Task {projectId:$projectId})-[:DEPENDS_ON]->(dep:Task)
        RETURN t.name AS task, dep.name AS dependsOn
      `, { projectId: rt.projectId });
      expect(deps.records).toHaveLength(1);
      expect(deps.records[0].get('task')).toBe('Write core logic');
      await rt.teardown();
    });

    it('PLAN_WITH_DRIFT fixture: drift detection query', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(PLAN_WITH_DRIFT);
      const drift = await rt.run(`
        MATCH (t:Task {projectId:$projectId, status:'planned'})
        WHERE t.hasCodeEvidence = true
        RETURN t.name AS name
      `, { projectId: rt.projectId });
      expect(drift.records).toHaveLength(1);
      expect(drift.records[0].get('name')).toBe('Implement feature X');
      await rt.teardown();
    });

    it('BLOCKED_CHAIN fixture: transitive blocking', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(BLOCKED_CHAIN);
      const chain = await rt.run(`
        MATCH path = (final:Task {name:'Final integration', projectId:$projectId})
          -[:DEPENDS_ON*]->(root:Task)
        WHERE NOT (root)-[:DEPENDS_ON]->()
        RETURN length(path) AS depth, root.name AS rootTask
      `, { projectId: rt.projectId });
      expect(chain.records).toHaveLength(1);
      expect(chain.records[0].get('depth').toNumber()).toBe(2);
      expect(chain.records[0].get('rootTask')).toBe('Foundation task');
      await rt.teardown();
    });
  });

  describe('Structural Constraints', () => {
    it('applyConstraints creates constraints', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      const { applied } = await applyConstraints(rt.run);
      expect(applied).toBeGreaterThan(0);
      await rt.teardown();
    });

    it('checkStructuralIntegrity passes on clean fixture', async () => {
      const rt = await createEphemeralGraph({ setupSchema: false });
      await rt.seed(SINGLE_FUNCTION);
      const report = await checkStructuralIntegrity(rt.run, rt.projectId);
      const validationChecks = report.checks.filter(c =>
        !CORE_CONSTRAINTS.some(cc => cc.name === c.name)
      );
      for (const check of validationChecks) {
        expect(check.valid).toBe(true);
      }
      await rt.teardown();
    });
  });
});
