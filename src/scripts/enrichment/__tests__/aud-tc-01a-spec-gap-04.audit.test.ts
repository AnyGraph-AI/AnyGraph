/**
 * AUD-TC-01a SPEC-GAP-04: Flag-based exclusion from confidenceScore population
 *
 * Files with productionRiskExcluded = true (set by parser for TEST_FILE, EXAMPLE_ASSET,
 * and GOVERNANCE_CRITICAL_CONFIG classifications) are excluded from confidenceScore
 * computation. They can never earn evidence (no VRs target them, no TESTED_BY edges
 * point at them), so their score is structurally zero. Including them drags the
 * production average down artificially.
 *
 * This test verifies that:
 *   (1) Files with productionRiskExcluded = true receive no confidenceScore
 *   (2) Files with productionRiskExcluded = false receive confidenceScore normally
 *   (3) Enrichment preserves parser authority (never overwrites true → false)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import neo4j, { type Driver, type Session } from 'neo4j-driver';

const TEST_PROJECT_ID = 'proj_spec_gap_04_test';

// Files that should be excluded (productionRiskExcluded = true)
const EXCLUDED_FILES = [
  { path: 'src/__tests__/example.ts', reason: 'TEST_FILE: in __tests__ directory' },
  { path: 'src/foo.test.ts', reason: 'TEST_FILE: .test.ts suffix' },
  { path: 'src/bar.spec.ts', reason: 'TEST_FILE: .spec.ts suffix' },
  { path: 'examples/demo.ts', reason: 'EXAMPLE_ASSET: in examples directory' },
  { path: 'vitest.config.ts', reason: 'GOVERNANCE_CRITICAL_CONFIG: vitest config' },
];

// Production files that should be included (productionRiskExcluded = false)
const PRODUCTION_FILES = [
  'src/index.ts',
  'src/utils/helper.ts',
  'src/core/service.ts',
];

describe('SPEC-GAP-04: Flag-based exclusion from confidenceScore population', () => {
  let driver: Driver;
  let session: Session;

  beforeAll(async () => {
    driver = neo4j.driver(
      process.env.NEO4J_URI ?? 'bolt://localhost:7687',
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? 'neo4j',
        process.env.NEO4J_PASSWORD ?? 'codegraph',
      ),
    );
    session = driver.session();

    // Clean up any prior test data
    await session.run(
      `MATCH (n {projectId: $projectId}) DETACH DELETE n`,
      { projectId: TEST_PROJECT_ID },
    );

    // Create excluded files with productionRiskExcluded = true (simulating parser output)
    for (const file of EXCLUDED_FILES) {
      await session.run(
        `CREATE (sf:CodeNode:SourceFile {
          id: $id,
          projectId: $projectId,
          filePath: $filePath,
          productionRiskExcluded: true,
          gitChangeFrequency: 0,
          churnTotal: 0
        })`,
        {
          id: `${TEST_PROJECT_ID}:${file.path}`,
          projectId: TEST_PROJECT_ID,
          filePath: file.path,
        },
      );

      // Create a Function child so there's something to potentially score
      await session.run(
        `MATCH (sf:SourceFile {id: $sfId})
         CREATE (f:CodeNode:Function {
           id: $fnId,
           projectId: $projectId,
           name: 'testFn',
           fanInCount: 1,
           fanOutCount: 1,
           compositeRisk: 0.5
         })
         CREATE (sf)-[:CONTAINS]->(f)`,
        {
          sfId: `${TEST_PROJECT_ID}:${file.path}`,
          fnId: `${TEST_PROJECT_ID}:${file.path}:fn`,
          projectId: TEST_PROJECT_ID,
        },
      );
    }

    // Create production files with productionRiskExcluded = false
    for (const filePath of PRODUCTION_FILES) {
      await session.run(
        `CREATE (sf:CodeNode:SourceFile {
          id: $id,
          projectId: $projectId,
          filePath: $filePath,
          productionRiskExcluded: false,
          gitChangeFrequency: 0,
          churnTotal: 0
        })`,
        {
          id: `${TEST_PROJECT_ID}:${filePath}`,
          projectId: TEST_PROJECT_ID,
          filePath,
        },
      );

      // Create a Function child for enrichment scoring
      await session.run(
        `MATCH (sf:SourceFile {id: $sfId})
         CREATE (f:CodeNode:Function {
           id: $fnId,
           projectId: $projectId,
           name: 'prodFn',
           fanInCount: 2,
           fanOutCount: 1,
           compositeRisk: 0.6
         })
         CREATE (sf)-[:CONTAINS]->(f)`,
        {
          sfId: `${TEST_PROJECT_ID}:${filePath}`,
          fnId: `${TEST_PROJECT_ID}:${filePath}:fn`,
          projectId: TEST_PROJECT_ID,
        },
      );
    }

    // Create a Project node (required for max value storage)
    await session.run(
      `CREATE (p:Project {projectId: $projectId, name: 'spec-gap-04-test'})`,
      { projectId: TEST_PROJECT_ID },
    );
  });

  afterAll(async () => {
    // Clean up test data
    await session.run(
      `MATCH (n {projectId: $projectId}) DETACH DELETE n`,
      { projectId: TEST_PROJECT_ID },
    );
    await session.close();
    await driver.close();
  });

  it('(1) files with productionRiskExcluded = true receive no confidenceScore', async () => {
    // Import dynamically to use built module
    const { enrichPrecomputeScores } = await import('../precompute-scores.js');

    // Run enrichment
    await enrichPrecomputeScores(driver, TEST_PROJECT_ID);

    // Check excluded files - should NOT have confidenceScore
    for (const file of EXCLUDED_FILES) {
      const result = await session.run(
        `MATCH (sf:SourceFile {projectId: $projectId, filePath: $filePath})
         RETURN sf.confidenceScore AS confidenceScore, sf.productionRiskExcluded AS excluded`,
        { projectId: TEST_PROJECT_ID, filePath: file.path },
      );
      const record = result.records[0];
      const confidenceScore = record?.get('confidenceScore');
      const excluded = record?.get('excluded');

      expect(excluded, `${file.path} should have productionRiskExcluded = true`).toBe(true);
      expect(confidenceScore, `Excluded file ${file.path} (${file.reason}) should NOT have confidenceScore`).toBeNull();
    }
  });

  it('(2) files with productionRiskExcluded = false receive confidenceScore normally', async () => {
    // Check production files - should HAVE confidenceScore
    for (const filePath of PRODUCTION_FILES) {
      const result = await session.run(
        `MATCH (sf:SourceFile {projectId: $projectId, filePath: $filePath})
         RETURN sf.confidenceScore AS confidenceScore, sf.productionRiskExcluded AS excluded`,
        { projectId: TEST_PROJECT_ID, filePath },
      );
      const record = result.records[0];
      const confidenceScore = record?.get('confidenceScore');
      const excluded = record?.get('excluded');

      expect(excluded, `${filePath} should have productionRiskExcluded = false`).toBe(false);
      expect(confidenceScore, `Production file ${filePath} should have confidenceScore`).not.toBeNull();
      expect(typeof confidenceScore).toBe('number');
    }
  });

  it('(3) enrichment preserves parser authority (does not overwrite true → false)', async () => {
    // The enrichment should NOT change productionRiskExcluded from true to false
    // (it may add true for EXAMPLE_ASSET as a safety net, but never removes exclusion)
    const result = await session.run(
      `MATCH (sf:SourceFile {projectId: $projectId})
       WHERE sf.productionRiskExcluded = true
       RETURN count(sf) AS excludedCount`,
      { projectId: TEST_PROJECT_ID },
    );
    const excludedCount = result.records[0]?.get('excludedCount')?.toNumber() ?? 0;

    // Should still have all excluded files marked as excluded
    expect(excludedCount).toBe(EXCLUDED_FILES.length);
  });

  it('(4) avgConf calculation excludes flagged files', async () => {
    // Calculate totals
    const statsResult = await session.run(
      `MATCH (sf:SourceFile {projectId: $projectId})
       RETURN count(sf) AS totalFiles,
              sum(CASE WHEN sf.confidenceScore IS NOT NULL THEN 1 ELSE 0 END) AS scoredFiles,
              sum(CASE WHEN sf.productionRiskExcluded = true THEN 1 ELSE 0 END) AS excludedFiles`,
      { projectId: TEST_PROJECT_ID },
    );
    const record = statsResult.records[0];
    const totalFiles = record?.get('totalFiles')?.toNumber() ?? 0;
    const scoredFiles = record?.get('scoredFiles')?.toNumber() ?? 0;
    const excludedFiles = record?.get('excludedFiles')?.toNumber() ?? 0;

    // Verify: only production files are scored
    expect(scoredFiles).toBe(PRODUCTION_FILES.length);
    expect(excludedFiles).toBe(EXCLUDED_FILES.length);
    expect(totalFiles).toBe(PRODUCTION_FILES.length + EXCLUDED_FILES.length);

    console.log(`[SPEC-GAP-04] Total: ${totalFiles}, Scored: ${scoredFiles}, Excluded: ${excludedFiles}`);
  });
});
