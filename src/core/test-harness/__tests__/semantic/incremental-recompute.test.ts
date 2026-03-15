/**
 * TC-2: Incremental Confidence Recompute Tests
 */
import { describe, it, expect } from 'vitest';
import { incrementalRecompute, type RecomputeRequest } from '../../../verification/incremental-recompute.js';

// Mock Neo4jService for unit testing
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

describe('Incremental Confidence Recompute (TC-2)', () => {
  it('blocks full-scope recompute without override', async () => {
    const neo4j = new MockNeo4j();
    const result = await incrementalRecompute(neo4j as any, {
      projectId: 'proj_test',
      scope: 'full',
    });
    expect(result.bounded).toBe(false);
    expect(result.reason).toContain('BLOCKED');
    expect(result.updatedCount).toBe(0);
  });

  it('allows full-scope recompute with explicit override', async () => {
    const neo4j = new MockNeo4j();
    // Resolve phase returns 2 runs
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', observedAt: '2026-03-15T10:00:00Z', validFrom: '2026-03-15T10:00:00Z', validTo: null, supersededAt: null, oldTcf: null, oldVersion: null },
      { id: 'run-2', observedAt: '2026-03-15T11:00:00Z', validFrom: '2026-03-15T11:00:00Z', validTo: null, supersededAt: null, oldTcf: null, oldVersion: null },
    ]);
    // UNWIND update (no-op since mock)
    neo4j.setRunResult('UNWIND', []);

    const result = await incrementalRecompute(neo4j as any, {
      projectId: 'proj_test',
      scope: 'full',
      fullOverride: true,
      reason: 'test_full',
    });

    expect(result.bounded).toBe(true);
    expect(result.candidateCount).toBe(2);
    expect(result.updatedCount).toBe(2);
    expect(result.reason).toBe('test_full');
    expect(result.confidenceVersion).toBe(1);
  });

  it('skips runs with unchanged temporal factors', async () => {
    const neo4j = new MockNeo4j();
    // Run already has timeConsistencyFactor=1.0 (fresh, within default window)
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', observedAt: new Date().toISOString(), validFrom: new Date().toISOString(), validTo: null, supersededAt: null, oldTcf: 1.0, oldVersion: 1 },
    ]);

    const result = await incrementalRecompute(neo4j as any, {
      projectId: 'proj_test',
      scope: 'full',
      fullOverride: true,
    });

    expect(result.skippedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
  });

  it('returns empty result for node scope with no targets', async () => {
    const neo4j = new MockNeo4j();
    const result = await incrementalRecompute(neo4j as any, {
      projectId: 'proj_test',
      scope: 'node',
      targets: [],
    });
    expect(result.candidateCount).toBe(0);
    expect(result.reason).toBe('No candidates found');
  });

  it('includes confidenceInputsHash in result', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', observedAt: '2026-01-01T00:00:00Z', validFrom: '2026-01-01T00:00:00Z', validTo: '2026-01-15T00:00:00Z', supersededAt: null, oldTcf: null, oldVersion: null },
    ]);
    neo4j.setRunResult('UNWIND', []);

    const result = await incrementalRecompute(neo4j as any, {
      projectId: 'proj_test',
      scope: 'full',
      fullOverride: true,
    });

    expect(result.confidenceInputsHash).toHaveLength(32);
  });

  it('persists provenance fields via UNWIND batch', async () => {
    const neo4j = new MockNeo4j();
    neo4j.setRunResult('MATCH (r:VerificationRun', [
      { id: 'run-1', observedAt: '2026-03-01T00:00:00Z', validFrom: '2026-03-01T00:00:00Z', validTo: null, supersededAt: '2026-03-10T00:00:00Z', oldTcf: 1.0, oldVersion: 2 },
    ]);
    neo4j.setRunResult('SET r.timeConsistencyFactor', []);

    const result = await incrementalRecompute(neo4j as any, {
      projectId: 'proj_test',
      scope: 'full',
      fullOverride: true,
    });

    // Superseded → significant change from 1.0 → 0.1
    expect(result.updatedCount).toBe(1);
    expect(result.confidenceVersion).toBe(3);

    // Verify batch update query was issued with provenance fields
    const updateQuery = neo4j.queries.find(q => q.includes('SET r.timeConsistencyFactor'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery).toContain('confidenceVersion');
    expect(updateQuery).toContain('confidenceInputsHash');
    expect(updateQuery).toContain('lastRecomputeAt');
    expect(updateQuery).toContain('recomputeReason');
  });
});
