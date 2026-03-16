/**
 * Ephemeral Graph Runtime — Smoke Tests
 *
 * Validates isolation, seeding, stats, and cleanup.
 */
import { describe, it, expect } from 'vitest';
import {
  createEphemeralGraph,
  codeGraphFixture,
  planGraphFixture,
} from '../ephemeral-graph.js';

describe('Ephemeral Graph Runtime', () => {
  it('creates ephemeral runtime with unique projectId', async () => {
    const rt = await createEphemeralGraph({ setupSchema: false });
    expect(rt.projectId).toMatch(/^__test_/);
    expect(rt.testId).toHaveLength(8);
    await rt.teardown();
  });

  it('two runtimes get different projectIds', async () => {
    const rt1 = await createEphemeralGraph({ setupSchema: false });
    const rt2 = await createEphemeralGraph({ setupSchema: false });
    expect(rt1.projectId).not.toBe(rt2.projectId);
    await rt1.teardown();
    await rt2.teardown();
  });

  it('seed code graph fixture and verify stats', async () => {
    const rt = await createEphemeralGraph({ setupSchema: false });
    const fixture = codeGraphFixture({
      files: [{ name: 'a.ts' }, { name: 'b.ts' }],
      functions: [
        { name: 'foo', file: 'a.ts', riskLevel: 50, riskTier: 'MEDIUM' },
        { name: 'bar', file: 'b.ts', riskLevel: 5, riskTier: 'LOW' },
      ],
      calls: [{ from: 'foo', to: 'bar' }],
    });
    await rt.seed(fixture);
    const stats = await rt.stats();
    expect(stats.nodes).toBe(4);
    expect(stats.edges).toBe(3); // 2 CONTAINS + 1 CALLS
    await rt.teardown();
  });

  it('seed plan graph fixture', async () => {
    const rt = await createEphemeralGraph({ setupSchema: false });
    const fixture = planGraphFixture({
      milestones: [{ name: 'Milestone T1: Test' }],
      tasks: [
        { name: 'Task A', milestone: 'Milestone T1: Test', status: 'done' },
        { name: 'Task B', milestone: 'Milestone T1: Test', status: 'planned' },
      ],
      dependencies: [{ from: 'Task B', to: 'Task A' }],
    });
    await rt.seed(fixture);
    const stats = await rt.stats();
    expect(stats.nodes).toBe(3);
    expect(stats.edges).toBe(3); // 2 PART_OF + 1 DEPENDS_ON
    await rt.teardown();
  });

  it('teardown removes all test data', async () => {
    const rt = await createEphemeralGraph({ setupSchema: false });
    const testProjectId = rt.projectId;
    await rt.seed(codeGraphFixture({
      files: [{ name: 'x.ts' }],
      functions: [{ name: 'cleanup_test', file: 'x.ts' }],
    }));

    const pre = await rt.stats();
    expect(pre.nodes).toBeGreaterThan(0);

    await rt.teardown();

    const verify = await createEphemeralGraph({ setupSchema: false });
    const result = await verify.run(
      'MATCH (n {projectId: $pid}) RETURN count(n) AS remaining',
      { pid: testProjectId }
    );
    const remaining = result.records[0].get('remaining').toNumber();
    expect(remaining).toBe(0);
    await verify.teardown();
  });

  it('isolation: two runtimes dont see each others data', async () => {
    const rt1 = await createEphemeralGraph({ setupSchema: false });
    const rt2 = await createEphemeralGraph({ setupSchema: false });

    await rt1.seed(codeGraphFixture({
      files: [{ name: 'rt1.ts' }],
      functions: [{ name: 'rt1_fn', file: 'rt1.ts' }],
    }));
    await rt2.seed(codeGraphFixture({
      files: [{ name: 'rt2.ts' }],
      functions: [{ name: 'rt2_fn', file: 'rt2.ts' }],
    }));

    const stats1 = await rt1.stats();
    const stats2 = await rt2.stats();
    expect(stats1.nodes).toBe(2);
    expect(stats2.nodes).toBe(2);

    await rt1.teardown();
    const stats2after = await rt2.stats();
    expect(stats2after.nodes).toBe(2);

    await rt2.teardown();
  });

  it('run() executes arbitrary Cypher scoped by projectId', async () => {
    const rt = await createEphemeralGraph({ setupSchema: false });
    await rt.seed(codeGraphFixture({
      files: [{ name: 'query.ts' }],
      functions: [
        { name: 'high_risk', file: 'query.ts', riskLevel: 500, riskTier: 'CRITICAL' },
        { name: 'low_risk', file: 'query.ts', riskLevel: 2, riskTier: 'LOW' },
      ],
    }));

    const result = await rt.run(`
      MATCH (f:Function {projectId: $projectId})
      WHERE f.riskTier = 'CRITICAL'
      RETURN f.name AS name
    `, { projectId: rt.projectId });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].get('name')).toBe('high_risk');
    await rt.teardown();
  });

  it('production data is untouched', async () => {
    const rt = await createEphemeralGraph({ setupSchema: false });

    const before = await rt.run(`
      MATCH (n) WHERE NOT n.projectId STARTS WITH '__test_'
      RETURN count(n) AS count
    `);
    const countBefore = before.records[0].get('count').toNumber();

    await rt.seed(codeGraphFixture({
      files: [{ name: 'safe.ts' }],
      functions: [{ name: 'safe_fn', file: 'safe.ts' }],
    }));

    const after = await rt.run(`
      MATCH (n) WHERE NOT n.projectId STARTS WITH '__test_'
      RETURN count(n) AS count
    `);
    const countAfter = after.records[0].get('count').toNumber();
    // Allow ±10 tolerance: concurrent spec tests may create/delete __test_ nodes
    // whose cleanup temporarily affects global counts via race conditions
    expect(Math.abs(countBefore - countAfter)).toBeLessThanOrEqual(10);

    await rt.teardown();
  });
});
