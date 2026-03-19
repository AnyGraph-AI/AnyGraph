import { describe, expect, it, vi } from 'vitest';

import {
  collectMismatches,
  fail,
  main,
  toNum,
  verifyProjectRegistry,
} from '../../../../scripts/verify/verify-project-registry.js';
import {
  CONTRACT_QUERY_Q14_PROJECT_COUNTS,
  CONTRACT_QUERY_Q15_PROJECT_STATUS,
} from '../../../../utils/query-contract.js';

type FakeNeo4j = {
  run: ReturnType<typeof vi.fn>;
  getDriver: () => { close: ReturnType<typeof vi.fn> };
};

describe('[REGISTRY] verify-project-registry full function coverage', () => {
  it('toNum handles neo4j integers, numbers, strings, and invalid values', () => {
    expect(toNum({ toNumber: () => 42 })).toBe(42);
    expect(toNum(7)).toBe(7);
    expect(toNum('9')).toBe(9);
    expect(toNum('not-a-number')).toBe(-1);
    expect(toNum(undefined)).toBe(-1);
  });

  it('collectMismatches returns only projects with real count drift', async () => {
    const neo4j = {
      run: vi.fn(async (query: string) => {
        if (query === CONTRACT_QUERY_Q14_PROJECT_COUNTS) {
          return [
            { projectId: 'proj_ok', nodeCount: 10, edgeCount: 20 },
            { projectId: 'proj_bad', nodeCount: 11, edgeCount: 21 },
            { projectId: 'proj_missing_status', nodeCount: 1, edgeCount: 1 },
          ];
        }
        if (query === CONTRACT_QUERY_Q15_PROJECT_STATUS) {
          return [
            { projectId: 'proj_ok', nodeCount: 10, edgeCount: 20 },
            { projectId: 'proj_bad', nodeCount: 10, edgeCount: 20 },
          ];
        }
        return [];
      }),
    } as Pick<FakeNeo4j, 'run'> as any;

    const mismatches = await collectMismatches(neo4j);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.projectId).toBe('proj_bad');
  });

  it('fail writes message and exits with code 1', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as any);

    expect(() => fail('boom')).toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith('PROJECT_REGISTRY_CHECK_FAILED: boom');

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('verifyProjectRegistry succeeds after reconcile clears mismatch', async () => {
    let phase: 'before' | 'after' = 'before';

    const neo4j = {
      run: vi.fn(async (query: string) => {
        if (query.includes('WHERE NOT EXISTS')) return [{ missingIds: [] }];
        if (query.includes('SET p.nodeCount = nodeCount')) {
          phase = 'after';
          return [];
        }
        if (query === CONTRACT_QUERY_Q14_PROJECT_COUNTS) {
          return phase === 'before'
            ? [{ projectId: 'proj_a', nodeCount: 5, edgeCount: 10 }]
            : [{ projectId: 'proj_a', nodeCount: 5, edgeCount: 9 }];
        }
        if (query === CONTRACT_QUERY_Q15_PROJECT_STATUS) {
          return [{ projectId: 'proj_a', nodeCount: 5, edgeCount: 9 }];
        }
        return [];
      }),
    } as Pick<FakeNeo4j, 'run'> as any;

    const result = await verifyProjectRegistry(neo4j);
    expect(result.reconciled).toBe(true);
    expect(result.persistentMismatchCount).toBe(0);
  });

  it('verifyProjectRegistry fails when mismatch persists after retries', async () => {
    const neo4j = {
      run: vi.fn(async (query: string) => {
        if (query.includes('WHERE NOT EXISTS')) return [{ missingIds: [] }];
        if (query === CONTRACT_QUERY_Q14_PROJECT_COUNTS) return [{ projectId: 'proj_a', nodeCount: 5, edgeCount: 10 }];
        if (query === CONTRACT_QUERY_Q15_PROJECT_STATUS) return [{ projectId: 'proj_a', nodeCount: 5, edgeCount: 9 }];
        return [];
      }),
    } as Pick<FakeNeo4j, 'run'> as any;

    await expect(
      verifyProjectRegistry(neo4j, (message) => {
        throw new Error(message);
      }),
    ).rejects.toThrow('persistent project metric mismatch');
  });

  it('verifyProjectRegistry fails when missing project IDs exist', async () => {
    const neo4j = {
      run: vi.fn(async (query: string) => {
        if (query.includes('WHERE NOT EXISTS')) return [{ missingIds: ['proj_orphan'] }];
        return [];
      }),
    } as Pick<FakeNeo4j, 'run'> as any;

    await expect(
      verifyProjectRegistry(neo4j, (message) => {
        throw new Error(message);
      }),
    ).rejects.toThrow('Missing :Project rows for: proj_orphan');
  });

  it('main closes driver and logs success payload', async () => {
    const close = vi.fn(async () => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const fakeNeo4j = {
      run: vi.fn(async (query: string) => {
        if (query.includes('WHERE NOT EXISTS')) return [{ missingIds: [] }];
        if (query === CONTRACT_QUERY_Q14_PROJECT_COUNTS) return [{ projectId: 'proj_a', nodeCount: 5, edgeCount: 9 }];
        if (query === CONTRACT_QUERY_Q15_PROJECT_STATUS) return [{ projectId: 'proj_a', nodeCount: 5, edgeCount: 9 }];
        return [];
      }),
      getDriver: () => ({ close }),
    } as any;

    await main(() => fakeNeo4j);

    expect(close).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
  });
});
