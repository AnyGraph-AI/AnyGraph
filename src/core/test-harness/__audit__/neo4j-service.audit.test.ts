import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSessionRun,
  mockSessionClose,
  mockDriverClose,
  mockDriverSession,
  mockNeo4jDriver,
  mockAuthBasic,
  mockGetTimeoutConfig,
  mockValidateProjectWrite,
} = vi.hoisted(() => {
  const sessionRun = vi.fn();
  const sessionClose = vi.fn();
  const driverClose = vi.fn();
  const driverSession = vi.fn(() => ({ run: sessionRun, close: sessionClose }));
  const neo4jDriver = vi.fn(() => ({
    session: driverSession,
    close: driverClose,
  }));
  const authBasic = vi.fn(() => ({ kind: 'basic-auth' }));
  const timeoutConfig = vi.fn(() => ({
    neo4j: {
      queryTimeoutMs: 12_345,
      connectionTimeoutMs: 6_789,
    },
    openai: {
      embeddingTimeoutMs: 60_000,
      assistantTimeoutMs: 120_000,
    },
  }));
  const validateProjectWrite = vi.fn();

  return {
    mockSessionRun: sessionRun,
    mockSessionClose: sessionClose,
    mockDriverClose: driverClose,
    mockDriverSession: driverSession,
    mockNeo4jDriver: neo4jDriver,
    mockAuthBasic: authBasic,
    mockGetTimeoutConfig: timeoutConfig,
    mockValidateProjectWrite: validateProjectWrite,
  };
});

vi.mock('neo4j-driver', () => ({
  default: {
    driver: mockNeo4jDriver,
    auth: {
      basic: mockAuthBasic,
    },
  },
}));

vi.mock('../../config/timeouts.js', () => ({
  getTimeoutConfig: mockGetTimeoutConfig,
}));

vi.mock('../../guards/project-write-guard.js', async () => {
  const actual = await vi.importActual<typeof import('../../guards/project-write-guard.js')>(
    '../../guards/project-write-guard.js',
  );

  return {
    ...actual,
    validateProjectWrite: mockValidateProjectWrite,
  };
});

import { Neo4jService, QUERIES } from '../../../storage/neo4j/neo4j.service.js';

const originalEnv = { ...process.env };

describe('AUD-TC-14-A1b | neo4j.service.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetTimeoutConfig.mockReturnValue({
      neo4j: {
        queryTimeoutMs: 12_345,
        connectionTimeoutMs: 6_789,
      },
      openai: {
        embeddingTimeoutMs: 60_000,
        assistantTimeoutMs: 120_000,
      },
    });

    mockValidateProjectWrite.mockResolvedValue(undefined);
    mockSessionRun.mockResolvedValue({ records: [] });
    mockSessionClose.mockResolvedValue(undefined);
    mockDriverClose.mockResolvedValue(undefined);

    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('B1: constructor env/default wiring', () => {
    it('uses env values when set and falls back to defaults when absent', () => {
      process.env.NEO4J_URI = 'bolt://custom-host:7777';
      process.env.NEO4J_USER = 'custom-user';
      process.env.NEO4J_PASSWORD = 'custom-pass';

      new Neo4jService();

      expect(mockAuthBasic).toHaveBeenCalledWith('custom-user', 'custom-pass');
      expect(mockNeo4jDriver).toHaveBeenCalledWith(
        'bolt://custom-host:7777',
        expect.anything(),
        expect.objectContaining({
          connectionTimeout: 6_789,
          maxTransactionRetryTime: 12_345,
        }),
      );

      vi.clearAllMocks();
      delete process.env.NEO4J_URI;
      delete process.env.NEO4J_USER;
      delete process.env.NEO4J_PASSWORD;

      new Neo4jService();

      expect(mockAuthBasic).toHaveBeenCalledWith('neo4j', 'PASSWORD');
      expect(mockNeo4jDriver).toHaveBeenCalledWith(
        'bolt://localhost:7687',
        expect.anything(),
        expect.objectContaining({
          connectionTimeout: 6_789,
          maxTransactionRetryTime: 12_345,
        }),
      );
    });
  });

  describe('B3: timeout propagation', () => {
    it('passes query timeout to session.run transaction config', async () => {
      const service = new Neo4jService();
      mockSessionRun.mockResolvedValueOnce({
        records: [{ toObject: () => ({ ok: true }) }],
      });

      await service.run('MATCH (n) RETURN n', {});

      expect(mockSessionRun).toHaveBeenCalledWith('MATCH (n) RETURN n', {}, { timeout: 12_345 });
    });
  });

  describe('B4: timeout error translation', () => {
    it('rethrows a descriptive timeout error when Neo4j terminates transaction', async () => {
      const service = new Neo4jService();
      mockSessionRun.mockRejectedValueOnce({ code: 'Neo.TransientError.Transaction.Terminated' });

      const thrown = await service.run('MATCH (n) RETURN n', {}).catch((err) => err as Error);

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.message).toMatch(/timed out/i);
      expect(thrown.message).toMatch(/ms|timeout/i);
    });
  });

  describe('B6: test-env bypass (default branch)', () => {
    it('skips project write validation in test env when force flag is not enabled', async () => {
      process.env.NODE_ENV = 'test';
      delete process.env.PROJECT_WRITE_GUARD_FORCE;

      const service = new Neo4jService();
      await service.run('CREATE (n:TestNode {projectId: $projectId}) RETURN n', { projectId: 'proj_1' });

      expect(mockValidateProjectWrite).not.toHaveBeenCalled();
      expect(mockSessionRun).toHaveBeenCalled();
    });
  });

  describe('B7: finally session close', () => {
    it('always closes the session even when query execution throws', async () => {
      const service = new Neo4jService();
      mockSessionRun.mockRejectedValueOnce(new Error('query failed'));

      await expect(service.run('MATCH (n) RETURN n', {})).rejects.toThrow('query failed');
      expect(mockSessionClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('B8: getSchema APOC contract', () => {
    it('runs APOC schema query and returns raw driver result', async () => {
      const service = new Neo4jService();
      const rawResult = {
        records: [{ get: () => ({ schema: 'value' }) }],
        summary: { queryType: 'r' },
      };
      mockSessionRun.mockResolvedValueOnce(rawResult);

      const result = await service.getSchema();

      expect(mockSessionRun).toHaveBeenCalledWith(QUERIES.APOC_SCHEMA, {}, { timeout: 12_345 });
      expect(result).toBe(rawResult);
    });
  });

  describe('B9: close idempotency', () => {
    it('calls driver.close only once across multiple close() calls', async () => {
      const service = new Neo4jService();

      await service.close();
      await service.close();

      expect(mockDriverClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('B10: getDriver passthrough', () => {
    it('returns the underlying Neo4j driver instance used by the service', () => {
      const service = new Neo4jService();
      const createdDriver = mockNeo4jDriver.mock.results.at(-1)?.value;

      expect(service.getDriver()).toBe(createdDriver);
    });
  });

  describe('B11: QUERIES export integrity', () => {
    it('exports APOC_SCHEMA as a non-empty query string', () => {
      expect(QUERIES).toBeDefined();
      expect(typeof QUERIES.APOC_SCHEMA).toBe('string');
      expect(QUERIES.APOC_SCHEMA.trim().length).toBeGreaterThan(0);
    });
  });

  describe('B12: connection timeout config', () => {
    it('uses timeout config values for connectionTimeout and maxTransactionRetryTime', () => {
      mockGetTimeoutConfig.mockReturnValueOnce({
        neo4j: {
          queryTimeoutMs: 30_001,
          connectionTimeoutMs: 9_999,
        },
        openai: {
          embeddingTimeoutMs: 60_000,
          assistantTimeoutMs: 120_000,
        },
      });

      new Neo4jService();

      const configArg = mockNeo4jDriver.mock.calls.at(-1)?.[2] as { connectionTimeout: number; maxTransactionRetryTime: number };
      expect(configArg.connectionTimeout).toBe(9_999);
      expect(configArg.maxTransactionRetryTime).toBe(30_001);
    });
  });
});
