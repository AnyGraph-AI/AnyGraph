/**
 * TC-3: Shadow Propagation Tests
 */
import { describe, it, expect } from 'vitest';

// Test the pure computation logic by importing indirectly
// We test via the full engine with a mock Neo4j

class MockNeo4j {
  private data: Record<string, any[]> = {};
  public queries: string[] = [];

  setRunResult(querySubstring: string, result: any[]) {
    this.data[querySubstring] = result;
  }

  async run(query: string, params?: any): Promise<any[]> {
    this.queries.push(query);
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
    // Shadow should be different from raw tcf due to neighbor influence
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
});
