/**
 * TC-3: Shadow Propagation Tests
 */
import { describe, it, expect } from 'vitest';

// Test the pure computation logic by importing indirectly
// We test via the full engine with a mock Neo4j

/**
 * ⚠️ MOCK FRAGILITY WARNING
 * This mock uses substring-based query matching. Tests may pass even if:
 * - Cypher variable names change (e.g., r → run)
 * - WHERE clause logic inverts (IS NULL → IS NOT NULL)
 * - Query structure changes but keywords remain
 * - Return shape differs from real Neo4j
 *
 * For production-grade validation, see tc-integration.test.ts (real Neo4j).
 * Fragility analysis: audits/tc_test_audit_agent5a_mock.md
 */
class MockNeo4j {
  private data: Record<string, any[]> = {};
  public queries: string[] = [];
  public paramLog: Array<{ query: string; params: any }> = [];

  setRunResult(querySubstring: string, result: any[]) {
    this.data[querySubstring] = result;
  }

  async run(query: string, params?: any): Promise<any[]> {
    this.queries.push(query);
    this.paramLog.push({ query, params });
    for (const [key, val] of Object.entries(this.data)) {
      if (query.includes(key)) return val;
    }
    return [];
  }

  async close() {}
}

// Import after mock definition
import { runShadowPropagation, verifyShadowIsolation, type ShadowPropagationConfig } from '../../../verification/shadow-propagation.js';

describe('Shadow Propagation (TC-3)', () => {
  it('returns empty result for project with no runs', async () => {
    const neo4j = new MockNeo4j();
    const result = await runShadowPropagation(neo4j as any, 'proj_test');
    expect(result.updated).toBe(0);
    expect(result.promotionReady).toBe(true);
  });

  it('computes shadow confidence for isolated runs', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', tcf: 0.8, penalty: 1.0, prodConf: null, neighbors: [] },
      { id: 'run-2', tcf: 1.0, penalty: 0.5, prodConf: null, neighbors: [] },
    ]);
    neo4j.setRunResult('UNWIND $updates', []);

    const result = await runShadowPropagation(neo4j as any, 'proj_test');
    expect(result.updated).toBe(2);
  });

  it('propagates confidence through PRECEDES chain', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', tcf: 0.5, penalty: 1.0, prodConf: null, neighbors: ['run-2'] },
      { id: 'run-2', tcf: 1.0, penalty: 1.0, prodConf: null, neighbors: ['run-1'] },
    ]);
    neo4j.setRunResult('UNWIND $updates', []);

    const result = await runShadowPropagation(neo4j as any, 'proj_test');
    expect(result.updated).toBe(2);

    // Verify computed shadow values from the UNWIND update params
    const unwindCall = neo4j.paramLog.find(p => p.query.includes('UNWIND $updates'));
    expect(unwindCall).toBeDefined();
    const updates = unwindCall!.params.updates as Array<{ id: string; shadowEffectiveConfidence: number }>;
    expect(updates).toHaveLength(2);

    const shadow1 = updates.find(u => u.id === 'run-1')!.shadowEffectiveConfidence;
    const shadow2 = updates.find(u => u.id === 'run-2')!.shadowEffectiveConfidence;

    // Hand-computed (damping=0.85, linear, maxHops=3):
    // run-1: own=0.5, neighbor run-2 at hop 1 sees run-1 in visited at hop 2 → base 0.5
    //   run-2 at hop 1: own=1.0, avg=0.5, shadow=1.0*0.15+0.5*0.85=0.575
    //   run-1: avg=0.575, shadow=0.5*0.15+0.575*0.85=0.56375
    // run-2: own=1.0, neighbor run-1 at hop 1 sees run-2 in visited at hop 2 → base 1.0
    //   run-1 at hop 1: own=0.5, avg=1.0, shadow=0.5*0.15+1.0*0.85=0.925
    //   run-2: avg=0.925, shadow=1.0*0.15+0.925*0.85=0.93625
    expect(shadow1).toBeCloseTo(0.56375, 3);
    expect(shadow2).toBeCloseTo(0.93625, 3);
  });

  it('never persists to effectiveConfidence field', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', tcf: 0.8, penalty: 1.0, prodConf: 0.9, neighbors: [] },
    ]);
    neo4j.setRunResult('UNWIND $updates', []);

    await runShadowPropagation(neo4j as any, 'proj_test');

    // Verify no query writes to effectiveConfidence
    const updateQuery = neo4j.queries.find(q => q.includes('UNWIND $updates'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery).not.toContain('effectiveConfidence =');
    expect(updateQuery).toContain('shadowEffectiveConfidence');
  });

  it('detects promotion blockers when divergence is high', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', tcf: 0.2, penalty: 1.0, prodConf: 0.9, neighbors: [] },
    ]);
    neo4j.setRunResult('UNWIND $updates', []);

    const result = await runShadowPropagation(neo4j as any, 'proj_test');
    expect(result.promotionReady).toBe(false);
    expect(result.promotionBlockers.length).toBeGreaterThan(0);
    expect(result.maxDivergence).toBeGreaterThan(0.3);
  });

  it('reports promotion-ready when divergence is low', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', tcf: 0.9, penalty: 1.0, prodConf: 0.9, neighbors: [] },
    ]);
    neo4j.setRunResult('UNWIND $updates', []);

    const result = await runShadowPropagation(neo4j as any, 'proj_test');
    expect(result.promotionReady).toBe(true);
    expect(result.maxDivergence).toBeLessThan(0.3);
  });

  it('verifyShadowIsolation passes when no leaks', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('WHERE r.shadowEffectiveConfidence', [{ cnt: 0 }]);
    const result = await verifyShadowIsolation(neo4j as any, 'proj_test');
    expect(result.ok).toBe(true);
    expect(result.violations).toBe(0);
  });

  it('verifyShadowIsolation fails when shadow leaked to production', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('WHERE r.shadowEffectiveConfidence', [{ cnt: 3 }]);
    const result = await verifyShadowIsolation(neo4j as any, 'proj_test');
    expect(result.ok).toBe(false);
    expect(result.violations).toBe(3);
  });

  it('respects custom config', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', tcf: 0.5, penalty: 1.0, prodConf: null, neighbors: ['run-2'] },
      { id: 'run-2', tcf: 0.5, penalty: 1.0, prodConf: null, neighbors: ['run-1'] },
    ]);
    neo4j.setRunResult('UNWIND $updates', []);

    const config: ShadowPropagationConfig = {
      dampingFactor: 0.5,
      maxHops: 1,
      normalizationMode: 'softmax',
      minInfluence: 0.01,
    };

    const result = await runShadowPropagation(neo4j as any, 'proj_test', config);
    expect(result.updated).toBe(2);
  });

  it('filters out neighbors below minInfluence threshold', async () => {
    const neo4j = new MockNeo4j();
    // run-2 has tcf=0.005 (below default minInfluence=0.01)
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', tcf: 0.9, penalty: 1.0, prodConf: null, neighbors: ['run-2'] },
      { id: 'run-2', tcf: 0.005, penalty: 1.0, prodConf: null, neighbors: [] },
    ]);
    neo4j.setRunResult('UNWIND $updates', []);

    const result = await runShadowPropagation(neo4j as any, 'proj_test');
    expect(result.updated).toBe(2);

    const unwindCall = neo4j.paramLog.find(p => p.query.includes('UNWIND $updates'));
    const updates = unwindCall!.params.updates as Array<{ id: string; shadowEffectiveConfidence: number }>;

    const shadow1 = updates.find(u => u.id === 'run-1')!.shadowEffectiveConfidence;
    // run-2's score at hop 1: own=0.005*1.0=0.005. No neighbors → returns 0.005.
    // 0.005 < minInfluence(0.01) → filtered out → neighborCount=0 → shadow = ownScore = 0.9
    expect(shadow1).toBeCloseTo(0.9, 3);

    // run-2 itself: no neighbors → shadow = own score = 0.005
    const shadow2 = updates.find(u => u.id === 'run-2')!.shadowEffectiveConfidence;
    expect(shadow2).toBeCloseTo(0.005, 3);
  });
});
