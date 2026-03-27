/**
 * [AUD-TC-16] Destructive step guard — Pre-run/post-run edge count verification
 *
 * Tests that create-analyzed-edges.ts properly detects when it deletes edges
 * but fails to recreate them, throwing an error instead of silently continuing.
 *
 * Addresses CORR-10: Timed-out done-check = Destructive Partial Enrichment
 * Root cause from AUD-TC-01a: 445 ANALYZED edges deleted, 0 recreated,
 * confidence collapsed from 0.458 → 0.197.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock neo4j-driver before importing the module under test
vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(),
    auth: { basic: vi.fn() },
  },
}));

// Import after mocking
import { enrichAnalyzedEdges } from '../create-analyzed-edges.js';

/**
 * Creates a mock Neo4j record with a get() method that returns values based on key.
 */
function createMockRecord(data: { [key: string]: unknown }) {
  return {
    get: (key: string) => {
      const value = data[key];
      // Simulate Neo4j Integer wrapper with toNumber()
      if (typeof value === 'number') {
        return { toNumber: () => value };
      }
      return value;
    },
    keys: Object.keys(data),
    length: Object.keys(data).length,
    toObject: () => data,
    forEach: vi.fn(),
    map: vi.fn(),
    has: vi.fn(),
    values: vi.fn(),
    entries: vi.fn(),
  };
}

/**
 * Creates a mock Result with specified records.
 */
function createMockResult(records: ReturnType<typeof createMockRecord>[]) {
  return {
    records,
    summary: { counters: {} },
  };
}

type MockTransaction = {
  run: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
};

type MockDriver = {
  session: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type MockSession = {
  run: ReturnType<typeof vi.fn>;
  beginTransaction: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

describe('[AUD-TC-16] destructive step guard', () => {
  let mockTx: MockTransaction;
  let mockSession: MockSession;
  let mockDriver: MockDriver;
  let runResponses: Map<string, ReturnType<typeof createMockResult>>;

  beforeEach(() => {
    runResponses = new Map();

    // tx.run handles DELETE + MERGE (inside transaction boundary)
    mockTx = {
      run: vi.fn().mockImplementation((query: string) => {
        if (query.includes('DELETE r RETURN count(r) AS deleted')) {
          return Promise.resolve(runResponses.get('deleted') ||
            createMockResult([createMockRecord({ deleted: 0 })]));
        }
        if (query.includes('MERGE (vr)-[r:ANALYZED]->(sf)')) {
          return Promise.resolve(runResponses.get('created') ||
            createMockResult([createMockRecord({ created: 0 })]));
        }
        return Promise.resolve(createMockResult([]));
      }),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };

    // session.run handles all read-only queries (pre/post count, sourceFiles, scopes)
    mockSession = {
      run: vi.fn().mockImplementation((query: string) => {
        if (query.includes('RETURN count(r) AS preRunCount')) {
          return Promise.resolve(runResponses.get('preRunCount') ||
            createMockResult([createMockRecord({ preRunCount: 0 })]));
        }
        if (query.includes('RETURN sf.filePath AS filePath')) {
          return Promise.resolve(runResponses.get('sourceFiles') ||
            createMockResult([]));
        }
        if (query.includes('RETURN vr.id AS vrId')) {
          return Promise.resolve(runResponses.get('scopes') ||
            createMockResult([]));
        }
        if (query.includes('RETURN count(r) AS postRunCount')) {
          return Promise.resolve(runResponses.get('postRunCount') ||
            createMockResult([createMockRecord({ postRunCount: 0 })]));
        }
        // noScopeResult and any other read queries
        return Promise.resolve(createMockResult([]));
      }),
      beginTransaction: vi.fn().mockReturnValue(mockTx),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockDriver = {
      session: vi.fn().mockReturnValue(mockSession),
      close: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('records pre-run and post-run counts', async () => {
    // Setup: pre-run = 10, post-run = 8 (some edges recreated)
    runResponses.set('preRunCount', createMockResult([createMockRecord({ preRunCount: 10 })]));
    runResponses.set('deleted', createMockResult([createMockRecord({ deleted: 10 })]));
    runResponses.set('postRunCount', createMockResult([createMockRecord({ postRunCount: 8 })]));
    // Need some source files to prevent early return
    runResponses.set('sourceFiles', createMockResult([
      createMockRecord({ filePath: '/src/a.ts' }),
    ]));

    // Execute — should NOT throw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await enrichAnalyzedEdges(mockDriver as any, 'proj_test');
    
    // Verify we queried for counts
    const runCalls = mockSession.run.mock.calls;
    const preRunQuery = runCalls.find(([q]: [string]) => q.includes('preRunCount'));
    const postRunQuery = runCalls.find(([q]: [string]) => q.includes('postRunCount'));
    
    expect(preRunQuery).toBeDefined();
    expect(postRunQuery).toBeDefined();
    expect(result).toBeDefined();
  });

  it('throws when post-run count is 0 and pre-run count was > 0', async () => {
    // Setup: pre-run = 10, post-run = 0 (DESTRUCTIVE FAILURE)
    runResponses.set('preRunCount', createMockResult([createMockRecord({ preRunCount: 10 })]));
    runResponses.set('deleted', createMockResult([createMockRecord({ deleted: 10 })]));
    runResponses.set('postRunCount', createMockResult([createMockRecord({ postRunCount: 0 })]));
    runResponses.set('sourceFiles', createMockResult([
      createMockRecord({ filePath: '/src/a.ts' }),
    ]));

    // Execute — SHOULD throw
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(enrichAnalyzedEdges(mockDriver as any, 'proj_test'))
      .rejects
      .toThrow('DESTRUCTIVE FAILURE');
  });

  it('does not throw when pre-run count was also 0', async () => {
    // Setup: pre-run = 0, post-run = 0 (fresh graph state, valid)
    runResponses.set('preRunCount', createMockResult([createMockRecord({ preRunCount: 0 })]));
    runResponses.set('deleted', createMockResult([createMockRecord({ deleted: 0 })]));
    runResponses.set('postRunCount', createMockResult([createMockRecord({ postRunCount: 0 })]));
    runResponses.set('sourceFiles', createMockResult([
      createMockRecord({ filePath: '/src/a.ts' }),
    ]));

    // Execute — should NOT throw (0→0 is valid for fresh graphs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await enrichAnalyzedEdges(mockDriver as any, 'proj_test');
    expect(result).toBeDefined();
  });

  it('error message includes recovery chain instructions', async () => {
    // Setup: destructive scenario
    runResponses.set('preRunCount', createMockResult([createMockRecord({ preRunCount: 10 })]));
    runResponses.set('deleted', createMockResult([createMockRecord({ deleted: 10 })]));
    runResponses.set('postRunCount', createMockResult([createMockRecord({ postRunCount: 0 })]));
    runResponses.set('sourceFiles', createMockResult([
      createMockRecord({ filePath: '/src/a.ts' }),
    ]));

    // Execute and capture error
    let thrownError: Error | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await enrichAnalyzedEdges(mockDriver as any, 'proj_test');
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError!.message).toContain('enrich:vr-scope');
    expect(thrownError!.message).toContain('enrich:composite-risk');
    expect(thrownError!.message).toContain('enrich:precompute-scores');
  });
});
