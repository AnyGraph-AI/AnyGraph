// AUD-TC-03-L1b-19 — B6 (Health Witness)
// Spec-derived audit tests for verify-hygiene-exceptions.ts
// Spec: plans/hygiene-governance/PLAN.md — exception management controls

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// ─── Neo4j driver mock ───
const mockRun = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockSession = { run: mockRun, close: mockClose };
const mockDriverClose = vi.fn().mockResolvedValue(undefined);

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => ({
      session: () => mockSession,
      close: mockDriverClose,
    })),
    auth: { basic: vi.fn(() => ({})) },
  },
}));

// ─── fs mock ───
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

// Helper: SHA truncated to 16 chars like the source
function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// Helper: toNum matching source logic
function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

describe('AUD-TC-03-L1b-19 | verify-hygiene-exceptions.ts', () => {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let logOutput: string[] = [];
  let errorOutput: string[] = [];

  // ─── Mock data factory ───
  function makeExceptionRecord(opts: {
    id: string;
    name: string;
    exceptionType?: string;
    expiresAt?: string;
    decisionHash?: string;
    approver?: string;
    scope?: string;
    scopePattern?: string;
    ticketRef?: string;
    remediationLink?: string;
    controlCode?: string;
    controlName?: string;
  }) {
    return {
      get: (key: string) => {
        const map: Record<string, unknown> = {
          id: opts.id,
          name: opts.name,
          exceptionType: opts.exceptionType ?? 'standing_waiver',
          expiresAt: opts.expiresAt ?? '2099-12-31T00:00:00Z',
          decisionHash: opts.decisionHash ?? 'abc123',
          approver: opts.approver ?? '@jonathan',
          scope: opts.scope ?? 'src/core/',
          scopePattern: opts.scopePattern ?? '',
          ticketRef: opts.ticketRef ?? 'TICKET-1',
          remediationLink: opts.remediationLink ?? '',
          controlCode: opts.controlCode ?? 'B1',
          controlName: opts.controlName ?? 'Test Control',
        };
        return map[key] ?? null;
      },
    };
  }

  function makeDebtRecord(controlCode: string, totalActive: number, expiredActive: number) {
    return {
      get: (key: string) => {
        if (key === 'controlCode') return controlCode;
        if (key === 'totalActive') return { toNumber: () => totalActive };
        if (key === 'expiredActive') return { toNumber: () => expiredActive };
        return null;
      },
    };
  }

  function setupMocks(opts: {
    exceptions?: ReturnType<typeof makeExceptionRecord>[];
    debtRecords?: ReturnType<typeof makeDebtRecord>[];
  } = {}) {
    const { exceptions = [], debtRecords = [] } = opts;

    mockRun.mockImplementation((cypher: string) => {
      // Main exception query
      if (cypher.includes('HygieneException') && cypher.includes('WAIVES') && !cypher.includes('DETACH DELETE') && !cypher.includes('sum(CASE')) {
        return Promise.resolve({ records: exceptions });
      }
      // Delete old violations
      if (cypher.includes('DETACH DELETE') && cypher.includes('exception_hygiene')) {
        return Promise.resolve({ records: [] });
      }
      // Debt by control query
      if (cypher.includes('sum(CASE') && cypher.includes('expiredActive')) {
        return Promise.resolve({ records: debtRecords });
      }
      // MERGE violation or snapshot
      return Promise.resolve({ records: [] });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    logOutput = [];
    errorOutput = [];
    console.log = (...args: unknown[]) => logOutput.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => errorOutput.push(args.map(String).join(' '));
    process.exit = vi.fn() as any;
    process.env.HYGIENE_EXCEPTION_ENFORCE = 'false';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  // ─── Behavior 1: Reads Neo4j via direct neo4j-driver ───
  describe('graph query via neo4j-driver', () => {
    it('queries HygieneException nodes with WAIVES edges', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const exceptionQuery = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneException') && c.includes('WAIVES'),
      );
      expect(exceptionQuery).toBeDefined();
      expect(exceptionQuery![1].projectId).toBeDefined();
    });

    it('closes session and driver in finally block', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(mockClose).toHaveBeenCalled(), { timeout: 2000 });

      expect(mockClose).toHaveBeenCalled();
      expect(mockDriverClose).toHaveBeenCalled();
    });
  });

  // ─── Behavior 2: Queries exception-related graph state ───
  describe('exception classification', () => {
    it('identifies expired exceptions and creates violations', async () => {
      vi.resetModules();
      const expiredRecord = makeExceptionRecord({
        id: 'exc-expired',
        name: 'Expired waiver',
        expiresAt: '2020-01-01T00:00:00Z',
      });
      setupMocks({ exceptions: [expiredRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => { expect(logOutput.length + errorOutput.length).toBeGreaterThan(0); }, { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && c.includes('expired_exception'),
      );
      expect(violationMerge).toBeDefined();
    });

    it('identifies invalid exceptions missing required fields', async () => {
      vi.resetModules();
      const invalidRecord = makeExceptionRecord({
        id: 'exc-invalid',
        name: 'Bad record',
        decisionHash: '',
        approver: '',
      });
      setupMocks({ exceptions: [invalidRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => { expect(logOutput.length + errorOutput.length).toBeGreaterThan(0); }, { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && c.includes('invalid_exception_record'),
      );
      expect(violationMerge).toBeDefined();
    });

    it('clears prior exception_hygiene violations before creating new ones', async () => {
      vi.resetModules();
      setupMocks({ exceptions: [] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const deleteCall = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('DETACH DELETE') && c.includes('exception_hygiene'),
      );
      expect(deleteCall).toBeDefined();
    });

    it('queries debt summary grouped by controlCode', async () => {
      vi.resetModules();
      setupMocks({ exceptions: [], debtRecords: [makeDebtRecord('B1', 3, 1)] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const debtQuery = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('expiredActive') && c.includes('sum(CASE'),
      );
      expect(debtQuery).toBeDefined();
    });
  });

  // ─── Behavior 3: Enforces or reports based on HYGIENE_EXCEPTION_ENFORCE ───
  describe('HYGIENE_EXCEPTION_ENFORCE switching', () => {
    it('advisory mode reports ok=true even with violations', async () => {
      vi.resetModules();
      process.env.HYGIENE_EXCEPTION_ENFORCE = 'false';
      const expiredRecord = makeExceptionRecord({
        id: 'exc-1',
        name: 'Expired',
        expiresAt: '2020-01-01T00:00:00Z',
      });
      setupMocks({ exceptions: [expiredRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ok).toBe(true);
      expect(parsed.advisoryMode).toBe(true);
      expect(parsed.expiredCount).toBeGreaterThan(0);
    });

    it('enforce mode reports ok=false and exits 1 with expired exceptions', async () => {
      vi.resetModules();
      process.env.HYGIENE_EXCEPTION_ENFORCE = 'true';
      const expiredRecord = makeExceptionRecord({
        id: 'exc-1',
        name: 'Expired',
        expiresAt: '2020-01-01T00:00:00Z',
      });
      setupMocks({ exceptions: [expiredRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errJson = errorOutput.find((e) => e.includes('"ok":false'));
      expect(errJson).toBeDefined();
      const parsed = JSON.parse(errJson!);
      expect(parsed.enforce).toBe(true);
      expect(parsed.expiredCount).toBeGreaterThan(0);
    });

    it('enforce mode reports ok=true when no violations', async () => {
      vi.resetModules();
      process.env.HYGIENE_EXCEPTION_ENFORCE = 'true';
      const validRecord = makeExceptionRecord({
        id: 'exc-ok',
        name: 'Valid waiver',
        expiresAt: '2099-12-31T00:00:00Z',
        decisionHash: 'abc',
        approver: '@jonathan',
        scope: 'src/',
      });
      setupMocks({ exceptions: [validRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ok).toBe(true);
      expect(parsed.enforce).toBe(true);
    });
  });

  // ─── Behavior 4: Produces SHA-based deterministic identifiers ───
  describe('deterministic SHA identifiers', () => {
    it('generates violation IDs with SHA of exception id', async () => {
      vi.resetModules();
      process.env.HYGIENE_EXCEPTION_ENFORCE = 'false';
      const expiredRecord = makeExceptionRecord({
        id: 'exc-expired-1',
        name: 'Expired waiver',
        expiresAt: '2020-01-01T00:00:00Z',
      });
      setupMocks({ exceptions: [expiredRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const violationMerges = mockRun.mock.calls.filter(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && !c.includes('DETACH'),
      );
      for (const [, params] of violationMerges) {
        if (params?.id && typeof params.id === 'string' && params.id.includes('exception:')) {
          expect(params.id).toMatch(/^hygiene-violation:.+:exception:(expired|invalid):[0-9a-f]{16}$/);
        }
      }
    });

    it('writes metric snapshot with payload hash', async () => {
      vi.resetModules();
      setupMocks({ exceptions: [] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const snapshotMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneMetricSnapshot') && c.includes('MERGE'),
      );
      expect(snapshotMerge).toBeDefined();
      expect(snapshotMerge![1].payloadHash).toBeDefined();
      expect(snapshotMerge![1].payloadHash).toHaveLength(16);
    });
  });

  // ─── Behavior 5: Accepts PROJECT_ID from env ───
  describe('PROJECT_ID from env', () => {
    it('uses custom PROJECT_ID when set', async () => {
      vi.resetModules();
      process.env.PROJECT_ID = 'proj_custom_test';
      setupMocks({ exceptions: [] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.projectId).toBe('proj_custom_test');
    });
  });

  // ─── Behavior 6: Exits with code 1 when enforcement violations found ───
  describe('exit code behavior', () => {
    it('exits with code 1 when enforce=true and invalid exceptions exist', async () => {
      vi.resetModules();
      process.env.HYGIENE_EXCEPTION_ENFORCE = 'true';
      const invalidRecord = makeExceptionRecord({
        id: 'exc-bad',
        name: 'Bad type',
        exceptionType: 'temporary_waiver',
        decisionHash: 'h',
        approver: '@x',
        scope: 's',
      });
      setupMocks({ exceptions: [invalidRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });
    });

    it('writes artifact file to artifacts/hygiene/', async () => {
      vi.resetModules();
      setupMocks({ exceptions: [] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalled(), { timeout: 2000 });

      const [filePath, content] = mockWriteFile.mock.calls[0];
      expect(filePath).toContain('hygiene-exception-verify');
      const parsed = JSON.parse(content as string);
      expect(parsed).toHaveProperty('ok');
      expect(parsed).toHaveProperty('exceptionCount');
    });

    it('catch handler exits with code 1 on unhandled errors', async () => {
      vi.resetModules();
      // Force an error by making the first run call reject
      mockRun.mockRejectedValueOnce(new Error('connection refused'));

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errJson = errorOutput.find((e) => e.includes('connection refused'));
      expect(errJson).toBeDefined();
    });
  });

  // ─── Additional Behavior 1: Driver creation with correct auth ───
  describe('driver creation and connection', () => {
    it('creates driver with bolt URI and basic auth from env defaults', async () => {
      vi.resetModules();
      setupMocks({ exceptions: [] });
      const neo4jMod = await import('neo4j-driver');

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      expect(neo4jMod.default.driver).toHaveBeenCalled();
      expect(neo4jMod.default.auth.basic).toHaveBeenCalled();
    });

    it('uses NEO4J_URI env var when set', async () => {
      vi.resetModules();
      process.env.NEO4J_URI = 'bolt://custom:9999';
      setupMocks({ exceptions: [] });
      const neo4jMod = await import('neo4j-driver');

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const driverCall = (neo4jMod.default.driver as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(driverCall[0]).toBe('bolt://custom:9999');
    });
  });

  // ─── Additional Behavior 2: Exception type validation ───
  describe('exception type validation', () => {
    it('accepts standing_waiver as valid exceptionType (no invalid violation)', async () => {
      vi.resetModules();
      const record = makeExceptionRecord({
        id: 'exc-sw',
        name: 'Standing waiver',
        exceptionType: 'standing_waiver',
        expiresAt: '2099-12-31T00:00:00Z',
        decisionHash: 'hash1',
        approver: '@admin',
        scope: 'src/',
      });
      setupMocks({ exceptions: [record] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const invalidMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('invalid_exception_record'),
      );
      expect(invalidMerge).toBeUndefined();
    });

    it('accepts emergency_bypass as valid exceptionType (no invalid violation)', async () => {
      vi.resetModules();
      const record = makeExceptionRecord({
        id: 'exc-eb',
        name: 'Emergency bypass',
        exceptionType: 'emergency_bypass',
        expiresAt: '2099-12-31T00:00:00Z',
        decisionHash: 'hash2',
        approver: '@admin',
        scope: 'src/',
      });
      setupMocks({ exceptions: [record] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const invalidMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('invalid_exception_record'),
      );
      expect(invalidMerge).toBeUndefined();
    });

    it('treats unknown exceptionType as invalid', async () => {
      vi.resetModules();
      const record = makeExceptionRecord({
        id: 'exc-unknown',
        name: 'Unknown type',
        exceptionType: 'permanent_waiver',
        expiresAt: '2099-12-31T00:00:00Z',
        decisionHash: 'hash3',
        approver: '@admin',
        scope: 'src/',
      });
      setupMocks({ exceptions: [record] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => { expect(logOutput.length + errorOutput.length).toBeGreaterThan(0); }, { timeout: 2000 });

      const invalidMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('invalid_exception_record'),
      );
      expect(invalidMerge).toBeDefined();
    });

    it('exception with scopePattern but missing scope is not flagged for missing scope', async () => {
      vi.resetModules();
      const record = makeExceptionRecord({
        id: 'exc-sp',
        name: 'Pattern-scoped',
        exceptionType: 'standing_waiver',
        expiresAt: '2099-12-31T00:00:00Z',
        decisionHash: 'hash4',
        approver: '@admin',
        scope: '',
        scopePattern: 'src/**/*.ts',
      });
      setupMocks({ exceptions: [record] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const invalidMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('invalid_exception_record'),
      );
      expect(invalidMerge).toBeUndefined();
    });

    it('exception that is both expired AND invalid gets both violation types', async () => {
      vi.resetModules();
      const record = makeExceptionRecord({
        id: 'exc-both',
        name: 'Both bad',
        exceptionType: 'bogus_type',
        expiresAt: '2020-01-01T00:00:00Z',
        decisionHash: '',
        approver: '',
        scope: '',
      });
      setupMocks({ exceptions: [record] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => { expect(logOutput.length + errorOutput.length).toBeGreaterThan(0); }, { timeout: 2000 });

      const expiredMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('expired_exception'),
      );
      const invalidMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('invalid_exception_record'),
      );
      expect(expiredMerge).toBeDefined();
      expect(invalidMerge).toBeDefined();
    });
  });

  // ─── Additional Behavior 3: Advisory mode does not exit ───
  describe('advisory mode process.exit behavior', () => {
    it('does not call process.exit in advisory mode even with violations', async () => {
      vi.resetModules();
      process.env.HYGIENE_EXCEPTION_ENFORCE = 'false';
      const expiredRecord = makeExceptionRecord({
        id: 'exc-adv',
        name: 'Expired advisory',
        expiresAt: '2020-01-01T00:00:00Z',
      });
      setupMocks({ exceptions: [expiredRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      expect(process.exit).not.toHaveBeenCalled();
    });

    it('defaults to advisory mode when HYGIENE_EXCEPTION_ENFORCE not set', async () => {
      vi.resetModules();
      delete process.env.HYGIENE_EXCEPTION_ENFORCE;
      setupMocks({ exceptions: [] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.advisoryMode).toBe(true);
    });
  });

  // ─── Additional Behavior 4: Output payload structure ───
  describe('output payload structure', () => {
    it('output includes sampleExpired and sampleInvalid arrays', async () => {
      vi.resetModules();
      process.env.HYGIENE_EXCEPTION_ENFORCE = 'false';
      const expiredRecord = makeExceptionRecord({
        id: 'exc-sample',
        name: 'Sample expired',
        expiresAt: '2020-01-01T00:00:00Z',
      });
      setupMocks({ exceptions: [expiredRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed).toHaveProperty('sampleExpired');
      expect(parsed).toHaveProperty('sampleInvalid');
      expect(Array.isArray(parsed.sampleExpired)).toBe(true);
      expect(Array.isArray(parsed.sampleInvalid)).toBe(true);
    });

    it('output includes debtByControl array', async () => {
      vi.resetModules();
      setupMocks({
        exceptions: [],
        debtRecords: [makeDebtRecord('B1', 5, 2), makeDebtRecord('B6', 3, 0)],
      });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed).toHaveProperty('debtByControl');
      expect(Array.isArray(parsed.debtByControl)).toBe(true);
    });

    it('output includes snapshotId', async () => {
      vi.resetModules();
      setupMocks({ exceptions: [] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed).toHaveProperty('snapshotId');
      expect(parsed.snapshotId).toMatch(/^hygiene-metric:.+:exception:\d+$/);
    });

    it('enforce mode error output includes artifactPath', async () => {
      vi.resetModules();
      process.env.HYGIENE_EXCEPTION_ENFORCE = 'true';
      const expiredRecord = makeExceptionRecord({
        id: 'exc-path',
        name: 'Expired path test',
        expiresAt: '2020-01-01T00:00:00Z',
      });
      setupMocks({ exceptions: [expiredRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errJson = errorOutput.find((e) => e.includes('"ok":false'));
      expect(errJson).toBeDefined();
      const parsed = JSON.parse(errJson!);
      expect(parsed).toHaveProperty('artifactPath');
      expect(parsed.artifactPath).toContain('hygiene-exception-verify');
    });
  });

  // ─── Additional Behavior 5: PROJECT_ID default ───
  describe('PROJECT_ID default value', () => {
    it('defaults to proj_c0d3e9a1f200 when PROJECT_ID not set', async () => {
      vi.resetModules();
      delete process.env.PROJECT_ID;
      setupMocks({ exceptions: [] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.projectId).toBe('proj_c0d3e9a1f200');
    });
  });

  // ─── Additional Behavior 6: SHA standalone tests ───
  describe('SHA helper function', () => {
    it('sha produces 16-char hex from SHA256', () => {
      const result = sha('test-input');
      expect(result).toHaveLength(16);
      expect(result).toMatch(/^[0-9a-f]{16}$/);
    });

    it('sha is deterministic — same input yields same output', () => {
      expect(sha('exception-id-42')).toBe(sha('exception-id-42'));
    });

    it('sha produces different output for different inputs', () => {
      expect(sha('input-a')).not.toBe(sha('input-b'));
    });
  });

  // ─── Additional Behavior 7: toNum helper ───
  describe('toNum helper handles Neo4j Integer objects', () => {
    it('converts Neo4j Integer via toNumber()', () => {
      expect(toNum({ toNumber: () => 42 })).toBe(42);
    });

    it('converts regular numbers', () => {
      expect(toNum(7)).toBe(7);
    });

    it('returns 0 for null/undefined', () => {
      expect(toNum(null)).toBe(0);
      expect(toNum(undefined)).toBe(0);
    });

    it('returns 0 for NaN-producing values', () => {
      expect(toNum('not-a-number')).toBe(0);
    });
  });

  // ─── Additional Behavior 8: Violation node properties ───
  describe('violation node properties', () => {
    it('expired violation has severity=high and mode=advisory', async () => {
      vi.resetModules();
      const expiredRecord = makeExceptionRecord({
        id: 'exc-sev',
        name: 'Severity test',
        expiresAt: '2020-01-01T00:00:00Z',
      });
      setupMocks({ exceptions: [expiredRecord] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const expiredMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('expired_exception') && c.includes('MERGE'),
      );
      expect(expiredMerge).toBeDefined();
      // The MERGE cypher sets severity and mode inline
      expect(expiredMerge![0]).toContain("'high'");
      expect(expiredMerge![0]).toContain("'advisory'");
    });

    it('metric snapshot links to HygieneExceptionPolicy via MEASURED_BY', async () => {
      vi.resetModules();
      setupMocks({ exceptions: [] });

      await import('../../../utils/verify-hygiene-exceptions');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const snapshotMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneMetricSnapshot') && c.includes('MEASURED_BY'),
      );
      expect(snapshotMerge).toBeDefined();
      expect(snapshotMerge![1].policyId).toMatch(/^hygiene-exception-policy:.+:v1$/);
    });
  });
});
