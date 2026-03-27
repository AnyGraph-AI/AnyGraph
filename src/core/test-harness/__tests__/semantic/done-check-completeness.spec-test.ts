/**
 * [AUD-TC-16] done-check completeness contract
 *
 * Tests the post-run completeness probe that verifies enrichment state
 * after done-check. Gap 3: integrity:verify only checks node/edge drift,
 * not enrichment completeness.
 *
 * Tests:
 * 1. Integration: completeness probe passes on healthy graph state
 * 2. Unit (mock): reports failure when ANALYZED = 0
 * 3. Unit (mock): reports failure when SourceFiles missing confidenceScore
 * 4. Unit (mock): reports failure when avgConf below floor
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import neo4j, { type Driver } from 'neo4j-driver';
import {
  runCompletenessChecks,
  createNeo4jQueries,
  type CompletenessQueries,
} from '../../../../scripts/verify/verify-done-check-completeness.js';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';

let driver: Driver;
let neo4jService: Neo4jService;

beforeAll(() => {
  driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER ?? 'neo4j',
      process.env.NEO4J_PASSWORD ?? 'codegraph',
    ),
  );
  neo4jService = new Neo4jService();
});

afterAll(async () => {
  await driver.close();
  await neo4jService.getDriver().close();
});

describe('[AUD-TC-16] done-check completeness contract', () => {
  it(
    'completeness probe passes on healthy graph state',
    { timeout: 60_000 },
    async () => {
      // Integration test: run against real Neo4j
      const queries = createNeo4jQueries(neo4jService);
      const result = await runCompletenessChecks(queries);

      // On a healthy graph, all checks should pass
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
      expect(result.checks.length).toBe(5);

      // Verify each check reports passed
      for (const check of result.checks) {
        expect(check.passed).toBe(true);
      }
    },
  );

  it('completeness probe reports failure when ANALYZED = 0', async () => {
    // Unit test: mock queries
    const mockQueries: CompletenessQueries = {
      async analyzedCount() {
        return 0;
      },
      async missingConfidenceCount() {
        return 0;
      },
      async missingRiskTierCount() {
        return 0;
      },
      async possibleCallCount() {
        return 100;
      },
      async avgConfidence() {
        return 0.45;
      },
    };

    const result = await runCompletenessChecks(mockQueries);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      'ANALYZED edges = 0 — enrich:vr-scope did not complete',
    );

    const analyzedCheck = result.checks.find(
      (c) => c.name === 'ANALYZED_EDGES',
    );
    expect(analyzedCheck?.passed).toBe(false);
    expect(analyzedCheck?.value).toBe(0);
  });

  it('completeness probe reports failure when SourceFiles missing confidenceScore', async () => {
    // Unit test: mock queries
    const mockQueries: CompletenessQueries = {
      async analyzedCount() {
        return 786;
      },
      async missingConfidenceCount() {
        return 5;
      },
      async missingRiskTierCount() {
        return 0;
      },
      async possibleCallCount() {
        return 100;
      },
      async avgConfidence() {
        return 0.45;
      },
    };

    const result = await runCompletenessChecks(mockQueries);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      '5 SourceFiles missing confidenceScore — enrich:precompute-scores incomplete',
    );

    const confCheck = result.checks.find(
      (c) => c.name === 'SOURCEFILE_CONFIDENCE',
    );
    expect(confCheck?.passed).toBe(false);
    expect(confCheck?.value).toBe(5);
  });

  it('completeness probe reports failure when avgConf below floor', async () => {
    // Unit test: mock queries
    const mockQueries: CompletenessQueries = {
      async analyzedCount() {
        return 786;
      },
      async missingConfidenceCount() {
        return 0;
      },
      async missingRiskTierCount() {
        return 0;
      },
      async possibleCallCount() {
        return 100;
      },
      async avgConfidence() {
        return 0.05;
      },
    };

    const result = await runCompletenessChecks(mockQueries);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      'avgConf = 0.05 — catastrophically low, graph state suspect',
    );

    const avgConfCheck = result.checks.find(
      (c) => c.name === 'AVG_CONFIDENCE_FLOOR',
    );
    expect(avgConfCheck?.passed).toBe(false);
    expect(avgConfCheck?.value).toBe(0.05);
  });

  it('completeness probe reports failure when Functions missing riskTier', async () => {
    // Unit test: mock queries
    const mockQueries: CompletenessQueries = {
      async analyzedCount() {
        return 786;
      },
      async missingConfidenceCount() {
        return 0;
      },
      async missingRiskTierCount() {
        return 42;
      },
      async possibleCallCount() {
        return 100;
      },
      async avgConfidence() {
        return 0.45;
      },
    };

    const result = await runCompletenessChecks(mockQueries);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      '42 Functions missing riskTier — enrich:composite-risk incomplete',
    );

    const riskTierCheck = result.checks.find(
      (c) => c.name === 'FUNCTION_RISKTIER',
    );
    expect(riskTierCheck?.passed).toBe(false);
    expect(riskTierCheck?.value).toBe(42);
  });

  it('completeness probe reports failure when POSSIBLE_CALL = 0', async () => {
    // Unit test: mock queries
    const mockQueries: CompletenessQueries = {
      async analyzedCount() {
        return 786;
      },
      async missingConfidenceCount() {
        return 0;
      },
      async missingRiskTierCount() {
        return 0;
      },
      async possibleCallCount() {
        return 0;
      },
      async avgConfidence() {
        return 0.45;
      },
    };

    const result = await runCompletenessChecks(mockQueries);

    expect(result.ok).toBe(false);
    expect(result.failures).toContain(
      'POSSIBLE_CALL edges = 0 — enrich:possible-calls did not complete',
    );

    const possibleCallCheck = result.checks.find(
      (c) => c.name === 'POSSIBLE_CALL_EDGES',
    );
    expect(possibleCallCheck?.passed).toBe(false);
    expect(possibleCallCheck?.value).toBe(0);
  });
});
