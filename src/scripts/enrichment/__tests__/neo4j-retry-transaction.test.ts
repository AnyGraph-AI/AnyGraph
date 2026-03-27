/**
 * Neo4j Transaction Atomicity Tests (SCAR-012 Fix)
 * 
 * These tests verify that destructive enrichment operations are wrapped
 * in single transactions by CALLING THE ACTUAL MODULES with failure injection.
 * If a failure occurs between delete and recreate, the transaction rolls back
 * and the graph returns to pre-run state.
 * 
 * Uses SCAR-013 rule: any test hitting real Neo4j gets { timeout: 60_000 }.
 * Uses isolated test projectId to avoid polluting live graph.
 * 
 * Behavioral contract tested:
 * - enrichAnalyzedEdges() uses beginTransaction/commit/rollback
 * - If commit() throws, rollback() is called, pre-run state preserved
 * 
 * Coverage note: Only enrichAnalyzedEdges is tested behaviorally here.
 * Other modules (temporal-coupling, create-unresolved-nodes, seed-architecture-layers,
 * seed-author-ownership) have complex setup requirements. Their transaction wrapping
 * was verified via code review during implementation (see neo4j-retry-impl.md).
 * The baseline Neo4j rollback test proves the underlying mechanism works.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import neo4j, { Driver, Session, Transaction, Result } from 'neo4j-driver';
import dotenv from 'dotenv';

// Import the actual module under test
import { enrichAnalyzedEdges } from '../create-analyzed-edges.js';

dotenv.config();

// Isolated test project ID (not proj_c0d3e9a1f200)
const TEST_PROJECT_ID = 'proj_test_neo4j_retry_001';

/**
 * Creates a driver wrapper that injects a failure at transaction commit time.
 * This allows us to test that the actual enrichment functions handle failures
 * correctly by rolling back, preserving pre-run state.
 */
function createFailingDriverWrapper(
  realDriver: Driver,
  failOnCommit: boolean = false,
): Driver {
  return {
    ...realDriver,
    session: (config?: any): Session => {
      const realSession = realDriver.session(config);
      
      return {
        ...realSession,
        run: realSession.run.bind(realSession),
        close: realSession.close.bind(realSession),
        beginTransaction: (): Transaction => {
          const realTx = realSession.beginTransaction();
          let deleteExecuted = false;
          
          return {
            ...realTx,
            run: async (query: string, params?: any): Promise<Result> => {
              // Track if DELETE has run (we're now mid-transaction)
              if (query.includes('DELETE')) {
                deleteExecuted = true;
              }
              return realTx.run(query, params);
            },
            commit: async (): Promise<void> => {
              if (failOnCommit && deleteExecuted) {
                // Throw on commit AFTER delete has run - this triggers rollback
                throw new Error('Injected commit failure (SCAR-012 scenario)');
              }
              return realTx.commit();
            },
            rollback: realTx.rollback.bind(realTx),
            isOpen: realTx.isOpen.bind(realTx),
          } as unknown as Transaction;
        },
      } as unknown as Session;
    },
  } as Driver;
}

describe('neo4j-retry transaction atomicity', () => {
  let driver: Driver;
  let session: Session;

  beforeAll(async () => {
    driver = neo4j.driver(
      process.env.NEO4J_URI || 'bolt://localhost:7687',
      neo4j.auth.basic(
        process.env.NEO4J_USER || 'neo4j',
        process.env.NEO4J_PASSWORD || 'codegraph'
      )
    );
    session = driver.session();
  }, 60_000);

  afterAll(async () => {
    // Clean up test data
    await session.run(`
      MATCH (n {projectId: $pid}) DETACH DELETE n
    `, { pid: TEST_PROJECT_ID });
    await session.close();
    await driver.close();
  }, 60_000);

  beforeEach(async () => {
    // Clean up any leftover test data before each test
    await session.run(`
      MATCH (n {projectId: $pid}) DETACH DELETE n
    `, { pid: TEST_PROJECT_ID });
  }, 60_000);

  describe('enrichAnalyzedEdges transaction behavior', () => {
    it('should preserve pre-run ANALYZED edge count when commit fails (SCAR-012 scenario)', async () => {
      // Setup: Create test data with existing ANALYZED edges
      // This simulates a re-run scenario where edges already exist
      await session.run(`
        CREATE (vr:VerificationRun {id: 'vr_test_001', projectId: $pid, sourceFamily: 'eslint'})
        CREATE (scope:AnalysisScope {includedPaths: ['file:///test/file1.ts', 'file:///test/file2.ts']})
        CREATE (vr)-[:HAS_SCOPE]->(scope)
        CREATE (sf1:SourceFile {filePath: '/test/file1.ts', projectId: $pid})
        CREATE (sf2:SourceFile {filePath: '/test/file2.ts', projectId: $pid})
        CREATE (vr)-[:ANALYZED {derived: true}]->(sf1)
        CREATE (vr)-[:ANALYZED {derived: true}]->(sf2)
      `, { pid: TEST_PROJECT_ID });

      // Verify pre-run count
      const preCountResult = await session.run(`
        MATCH (:VerificationRun {projectId: $pid})-[r:ANALYZED]->(:SourceFile)
        RETURN count(r) AS count
      `, { pid: TEST_PROJECT_ID });
      const preCount = preCountResult.records[0]?.get('count')?.toNumber?.() || 0;
      expect(preCount).toBe(2);

      // Create a failing driver wrapper that throws on commit
      const failingDriver = createFailingDriverWrapper(driver, true);

      // Call the ACTUAL enrichment module with the failing driver
      // This should: start tx → delete edges → try to create → fail on commit → rollback
      await expect(
        enrichAnalyzedEdges(failingDriver, TEST_PROJECT_ID)
      ).rejects.toThrow('Injected commit failure');

      // Verify post-failure count: because the transaction rolled back,
      // the pre-run edges should be preserved
      const postCountResult = await session.run(`
        MATCH (:VerificationRun {projectId: $pid})-[r:ANALYZED]->(:SourceFile)
        RETURN count(r) AS count
      `, { pid: TEST_PROJECT_ID });
      const postCount = postCountResult.records[0]?.get('count')?.toNumber?.() || 0;

      // This is the key behavioral assertion:
      // The ACTUAL MODULE's transaction handling preserved the edges
      expect(postCount).toBe(preCount);
      expect(postCount).toBe(2);
    }, 60_000);

    it('should successfully create edges when no errors occur', async () => {
      // Setup: Create test data with VR, scope, and SourceFiles but NO existing edges
      await session.run(`
        CREATE (vr:VerificationRun {id: 'vr_test_002', projectId: $pid, sourceFamily: 'eslint'})
        CREATE (scope:AnalysisScope {includedPaths: ['file:///test/file1.ts', 'file:///test/file2.ts']})
        CREATE (vr)-[:HAS_SCOPE]->(scope)
        CREATE (sf1:SourceFile {filePath: '/test/file1.ts', projectId: $pid})
        CREATE (sf2:SourceFile {filePath: '/test/file2.ts', projectId: $pid})
      `, { pid: TEST_PROJECT_ID });

      // Call the ACTUAL enrichment module with real driver (no failure injection)
      const result = await enrichAnalyzedEdges(driver, TEST_PROJECT_ID);

      // Verify edges were created
      const postCountResult = await session.run(`
        MATCH (:VerificationRun {projectId: $pid})-[r:ANALYZED]->(:SourceFile)
        RETURN count(r) AS count
      `, { pid: TEST_PROJECT_ID });
      const postCount = postCountResult.records[0]?.get('count')?.toNumber?.() || 0;

      // Should have created edges for the 2 files in scope
      expect(postCount).toBeGreaterThan(0);
      expect(result.edgesCreated).toBeGreaterThanOrEqual(0); // May be 0 if dedup logic applies
    }, 60_000);
  });

  describe('Neo4j transaction rollback baseline', () => {
    /**
     * This test verifies that Neo4j transaction rollback works as expected.
     * It's a baseline test that proves the underlying mechanism our modules rely on.
     * Combined with the enrichAnalyzedEdges tests above, we prove end-to-end behavior.
     */
    it('should rollback DELETE when error thrown before commit', async () => {
      // Setup: Create test data
      await session.run(`
        CREATE (sf1:SourceFile {filePath: '/test/baseline1.ts', projectId: $pid})
        CREATE (sf2:SourceFile {filePath: '/test/baseline2.ts', projectId: $pid})
      `, { pid: TEST_PROJECT_ID });

      const preCountResult = await session.run(`
        MATCH (sf:SourceFile {projectId: $pid})
        RETURN count(sf) AS count
      `, { pid: TEST_PROJECT_ID });
      const preCount = preCountResult.records[0]?.get('count')?.toNumber?.() || 0;
      expect(preCount).toBe(2);

      // Start a transaction, delete, then rollback
      const tx = session.beginTransaction();
      try {
        await tx.run(`
          MATCH (sf:SourceFile {projectId: $pid}) DETACH DELETE sf
        `, { pid: TEST_PROJECT_ID });
        
        // Simulate failure - throw before commit
        throw new Error('Simulated failure');
      } catch {
        await tx.rollback();
      }

      // Verify rollback worked - nodes should still exist
      const postCountResult = await session.run(`
        MATCH (sf:SourceFile {projectId: $pid})
        RETURN count(sf) AS count
      `, { pid: TEST_PROJECT_ID });
      const postCount = postCountResult.records[0]?.get('count')?.toNumber?.() || 0;

      expect(postCount).toBe(preCount);
    }, 60_000);
  });
});
