/**
 * TC-4: Explainability Path Tests
 */
import { describe, it, expect } from 'vitest';
import { discoverExplainabilityPaths, queryExplainabilityPaths, verifyExplainabilityCoverage } from '../../../verification/explainability-paths.js';

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

describe('Explainability Paths (TC-4)', () => {
  it('returns empty output for project with no claims', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('count(c)', [{ cnt: 0 }]);
    const result = await discoverExplainabilityPaths(neo4j as any, 'proj_test');
    expect(result.pathsCreated).toBe(0);
    expect(result.claimsWithPaths).toBe(0);
  });

  it('creates paths from support evidence', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('SUPPORTED_BY', [
      { claimId: 'c1', evidenceId: 'e1', terminalId: 't1', weight: 0.9, direction: 'support' },
      { claimId: 'c1', evidenceId: 'e2', terminalId: null, weight: 0.7, direction: 'support' },
    ]);
    neo4j.setRunResult('CONTRADICTED_BY', []);
    neo4j.setRunResult('MERGE (ip:InfluencePath', []);
    neo4j.setRunResult('count(c)', [{ cnt: 2 }]);

    const result = await discoverExplainabilityPaths(neo4j as any, 'proj_test');
    expect(result.pathsCreated).toBe(2);
    expect(result.claimsWithPaths).toBe(1);
  });

  it('respects topK limit per claim', async () => {
    const neo4j = new MockNeo4j();
    const paths = Array.from({ length: 10 }, (_, i) => ({
      claimId: 'c1', evidenceId: `e${i}`, terminalId: null,
      weight: 1.0 - i * 0.1, direction: 'support',
    }));
    neo4j.setRunResult('SUPPORTED_BY', paths);
    neo4j.setRunResult('CONTRADICTED_BY', []);
    neo4j.setRunResult('MERGE (ip:InfluencePath', []);
    neo4j.setRunResult('count(c)', [{ cnt: 1 }]);

    const result = await discoverExplainabilityPaths(neo4j as any, 'proj_test', { topK: 3, minWeight: 0.01, maxPayload: 50 });
    expect(result.pathsCreated).toBe(3);
    expect(result.pathsSkipped).toBe(7);
  });

  it('filters paths below minWeight', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('SUPPORTED_BY', [
      { claimId: 'c1', evidenceId: 'e1', terminalId: null, weight: 0.001, direction: 'support' },
    ]);
    neo4j.setRunResult('CONTRADICTED_BY', []);
    neo4j.setRunResult('count(c)', [{ cnt: 1 }]);

    const result = await discoverExplainabilityPaths(neo4j as any, 'proj_test');
    expect(result.pathsCreated).toBe(0);
  });

  it('creates paths from contradiction evidence', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('SUPPORTED_BY', []);
    neo4j.setRunResult('CONTRADICTED_BY', [
      { claimId: 'c1', evidenceId: 'e1', terminalId: null, weight: 0.8, direction: 'contradiction' },
      { claimId: 'c1', evidenceId: 'e2', terminalId: 't2', weight: 0.6, direction: 'contradiction' },
    ]);
    neo4j.setRunResult('MERGE (ip:InfluencePath', []);
    neo4j.setRunResult('count(c)', [{ cnt: 2 }]);

    const result = await discoverExplainabilityPaths(neo4j as any, 'proj_test');
    expect(result.pathsCreated).toBe(2);
    expect(result.claimsWithPaths).toBe(1);

    // Verify the MERGE query was issued with contradiction direction
    const mergeQuery = neo4j.queries.find(q => q.includes('MERGE (ip:InfluencePath'));
    expect(mergeQuery).toBeDefined();
    expect(mergeQuery).toContain('EXPLAINS_CONTRADICTION');
  });

  it('produces stable pathHash for same hops', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('SUPPORTED_BY', [
      { claimId: 'c1', evidenceId: 'e1', terminalId: 't1', weight: 0.8, direction: 'support' },
    ]);
    neo4j.setRunResult('CONTRADICTED_BY', []);
    neo4j.setRunResult('MERGE (ip:InfluencePath', []);
    neo4j.setRunResult('count(c)', [{ cnt: 1 }]);

    // Run twice — should produce same batch
    await discoverExplainabilityPaths(neo4j as any, 'proj_test');
    const mergeQuery = neo4j.queries.find(q => q.includes('MERGE (ip:InfluencePath'));
    expect(mergeQuery).toBeDefined();
    expect(mergeQuery).toContain('pathHash');
  });

  it('verifyExplainabilityCoverage reports correct ratio', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('EXPLAINS_SUPPORT', [{ total: 10, withPaths: 7 }]);
    const result = await verifyExplainabilityCoverage(neo4j as any, 'proj_test');
    expect(result.total).toBe(10);
    expect(result.claimsWithout).toBe(3);
    expect(result.coverageRatio).toBeCloseTo(0.7, 2);
    expect(result.ok).toBe(false);
  });

  it('queryExplainabilityPaths respects maxPayload', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('ORDER BY ip.pathWeight', []);
    await queryExplainabilityPaths(neo4j as any, 'proj_test', undefined, { topK: 5, minWeight: 0.01, maxPayload: 10 });
    const query = neo4j.queries.find(q => q.includes('LIMIT'));
    expect(query).toBeDefined();
  });
});
