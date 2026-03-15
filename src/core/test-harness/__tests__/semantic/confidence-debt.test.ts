/**
 * TC-5: Confidence Debt Tests
 */
import { describe, it, expect } from 'vitest';
import { generateDebtDashboard, verifyDebtFieldPresence, type DebtConfig } from '../../../verification/confidence-debt.js';

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

describe('Confidence Debt (TC-5)', () => {
  it('generates empty dashboard for project with no runs', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('SET r.requiredConfidence', [{ stamped: 0 }]);
    neo4j.setRunResult('ORDER BY r.confidenceDebt', []);

    const result = await generateDebtDashboard(neo4j as any, 'proj_test');
    expect(result.totalEntities).toBe(0);
    expect(result.alerts).toHaveLength(0);
  });

  it('identifies high-debt entities', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('SET r.requiredConfidence', [{ stamped: 2 }]);
    neo4j.setRunResult('ORDER BY r.confidenceDebt', [
      { id: 'run-1', name: 'done-check', kind: 'VerificationRun', required: 0.7, effective: 0.2, debt: 0.5 },
      { id: 'run-2', name: 'integrity', kind: 'VerificationRun', required: 0.7, effective: 0.6, debt: 0.1 },
    ]);

    const result = await generateDebtDashboard(neo4j as any, 'proj_test');
    expect(result.totalEntities).toBe(2);
    expect(result.entitiesWithDebt).toBe(2);
    expect(result.highDebtEntities).toHaveLength(1);
    expect(result.highDebtEntities[0].id).toBe('run-1');
    expect(result.maxDebt).toBe(0.5);
  });

  it('generates alerts for critical debt', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('SET r.requiredConfidence', [{ stamped: 1 }]);
    neo4j.setRunResult('ORDER BY r.confidenceDebt', [
      { id: 'run-1', name: 'test', kind: 'VerificationRun', required: 0.9, effective: 0.1, debt: 0.8 },
    ]);

    const result = await generateDebtDashboard(neo4j as any, 'proj_test');
    expect(result.alerts.length).toBeGreaterThan(0);
    expect(result.alerts[0]).toContain('Critical');
  });

  it('respects custom config thresholds', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('SET r.requiredConfidence', [{ stamped: 1 }]);
    neo4j.setRunResult('ORDER BY r.confidenceDebt', [
      { id: 'run-1', name: 'test', kind: 'VerificationRun', required: 0.5, effective: 0.4, debt: 0.1 },
    ]);

    const config: DebtConfig = { defaultRequired: 0.5, highDebtThreshold: 0.05, maxHighDebt: 10 };
    const result = await generateDebtDashboard(neo4j as any, 'proj_test', config);
    expect(result.highDebtEntities).toHaveLength(1); // 0.1 > 0.05
  });

  it('verifyDebtFieldPresence passes when all have debt', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('confidenceDebt IS NULL', [{ missing: 0 }]);
    neo4j.setRunResult('effectiveConfidence IS NOT NULL', [{ cnt: 5 }]);
    const result = await verifyDebtFieldPresence(neo4j as any, 'proj_test');
    expect(result.ok).toBe(true);
  });

  it('verifyDebtFieldPresence fails when debt missing', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('confidenceDebt IS NULL', [{ missing: 3 }]);
    neo4j.setRunResult('effectiveConfidence IS NOT NULL', [{ cnt: 5 }]);
    const result = await verifyDebtFieldPresence(neo4j as any, 'proj_test');
    expect(result.ok).toBe(false);
    expect(result.missingDebt).toBe(3);
  });

  it('includes project-level aggregation', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('SET r.requiredConfidence', [{ stamped: 2 }]);
    neo4j.setRunResult('ORDER BY r.confidenceDebt', [
      { id: 'r1', name: 'a', kind: 'VerificationRun', required: 0.7, effective: 0.5, debt: 0.2 },
      { id: 'r2', name: 'b', kind: 'VerificationRun', required: 0.7, effective: 0.3, debt: 0.4 },
    ]);

    const result = await generateDebtDashboard(neo4j as any, 'proj_test');
    expect(result.aggregations).toHaveLength(1);
    expect(result.aggregations[0].level).toBe('project');
    expect(result.aggregations[0].totalDebt).toBeCloseTo(0.6, 2);
  });
});
