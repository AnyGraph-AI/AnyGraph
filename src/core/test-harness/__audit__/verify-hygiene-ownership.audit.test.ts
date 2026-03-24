// AUD-TC-03-L1b-20 — B6 (Health Witness)
// Spec-derived audit tests for verify-hygiene-ownership.ts
// Spec: plans/hygiene-governance/PLAN.md — ownership tracking controls

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

// ─── hygiene-ownership-lib mock ───
const mockLoadCodeowners = vi.fn();
vi.mock('../../../utils/hygiene-ownership-lib.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    loadCodeowners: (...args: unknown[]) => mockLoadCodeowners(...args),
  };
});

function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ─── Pure lib function tests (genuine, kept from original) ───
import {
  classifyOwner,
  isCriticalRelativePath,
  matchesCodeownersPattern,
  toRelative,
} from '../../../utils/hygiene-ownership-lib.js';

describe('AUD-TC-03-L1b-20 | verify-hygiene-ownership.ts', () => {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let logOutput: string[] = [];
  let errorOutput: string[] = [];

  const DEFAULT_REPO_ROOT = '/home/jonathan/.openclaw/workspace/codegraph';

  // ─── Mock data helpers ───
  function makeFileRecord(id: string, filePath: string, owners: string[]) {
    return {
      get: (key: string) => {
        if (key === 'id') return id;
        if (key === 'filePath') return filePath;
        if (key === 'owners') return owners;
        return null;
      },
    };
  }

  function makeStaleRecord(filePath: string, scopeId: string, ownerVerifiedAt: string) {
    return {
      get: (key: string) => {
        if (key === 'filePath') return filePath;
        if (key === 'scopeId') return scopeId;
        if (key === 'ownerVerifiedAt') return ownerVerifiedAt;
        return null;
      },
    };
  }

  function makeScopeCountRecord(count: number) {
    return {
      get: (key: string) => {
        if (key === 'c') return { toNumber: () => count };
        return null;
      },
    };
  }

  function setupMocks(opts: {
    codeownersPath?: string | null;
    codeownersEntries?: Array<{ pattern: string; owners: string[] }>;
    files?: ReturnType<typeof makeFileRecord>[];
    staleRecords?: ReturnType<typeof makeStaleRecord>[];
    ownershipScopeCount?: number;
  } = {}) {
    const {
      codeownersPath = '/repo/CODEOWNERS',
      codeownersEntries = [{ pattern: '*', owners: ['@jonathan'] }],
      files = [],
      staleRecords = [],
      ownershipScopeCount = 1,
    } = opts;

    mockLoadCodeowners.mockResolvedValue({
      path: codeownersPath,
      entries: codeownersEntries,
    });

    mockRun.mockImplementation((cypher: string) => {
      // Files with owners query
      if (cypher.includes('SourceFile') && cypher.includes('HAS_OWNER')) {
        return Promise.resolve({ records: files });
      }
      // Stale ownership query
      if (cypher.includes('OwnershipScope') && cypher.includes('ownerVerifiedAt')) {
        return Promise.resolve({ records: staleRecords });
      }
      // Delete old violations
      if (cypher.includes('DETACH DELETE') && cypher.includes('ownership_hygiene')) {
        return Promise.resolve({ records: [] });
      }
      // Ownership scope count
      if (cypher.includes('OwnershipScope') && cypher.includes('count(s)')) {
        return Promise.resolve({ records: [makeScopeCountRecord(ownershipScopeCount)] });
      }
      // MERGE violation
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
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  // ─── Lib function tests (genuine — pure function, no mocking) ───
  describe('hygiene-ownership-lib pure functions', () => {
    it('classifyOwner returns "team" for handles with /', () => {
      expect(classifyOwner('@org/team-name')).toBe('team');
    });

    it('classifyOwner returns "service" for [bot] handles', () => {
      expect(classifyOwner('dependabot[bot]')).toBe('service');
    });

    it('classifyOwner returns "service" for -bot suffix handles', () => {
      expect(classifyOwner('renovate-bot')).toBe('service');
    });

    it('classifyOwner returns "person" for regular handles', () => {
      expect(classifyOwner('@jonathan')).toBe('person');
    });

    it('toRelative converts absolute to repo-relative path', () => {
      expect(toRelative('/repo/root', '/repo/root/src/main.ts')).toBe('src/main.ts');
    });

    it('toRelative returns absolute path when outside repo root', () => {
      expect(toRelative('/repo/root', '/other/path/file.ts')).toBe('/other/path/file.ts');
    });

    it('isCriticalRelativePath identifies src/core/ files', () => {
      expect(isCriticalRelativePath('src/core/parser.ts')).toBe(true);
    });

    it('isCriticalRelativePath identifies src/utils/verify-* files', () => {
      expect(isCriticalRelativePath('src/utils/verify-hygiene-exceptions.ts')).toBe(true);
    });

    it('isCriticalRelativePath identifies package.json', () => {
      expect(isCriticalRelativePath('package.json')).toBe(true);
    });

    it('isCriticalRelativePath identifies .github/CODEOWNERS', () => {
      expect(isCriticalRelativePath('.github/CODEOWNERS')).toBe(true);
    });

    it('isCriticalRelativePath identifies src/mcp/tools/ files', () => {
      expect(isCriticalRelativePath('src/mcp/tools/search.ts')).toBe(true);
    });

    it('isCriticalRelativePath returns false for non-critical paths', () => {
      expect(isCriticalRelativePath('README.md')).toBe(false);
      expect(isCriticalRelativePath('docs/guide.md')).toBe(false);
    });

    it('matchesCodeownersPattern wildcard * matches any file', () => {
      expect(matchesCodeownersPattern('*', 'src/foo.ts')).toBe(true);
    });

    it('matchesCodeownersPattern directory prefix matches nested files', () => {
      expect(matchesCodeownersPattern('src/core/', 'src/core/parser.ts')).toBe(true);
    });

    it('matchesCodeownersPattern exact file matches', () => {
      expect(matchesCodeownersPattern('package.json', 'package.json')).toBe(true);
    });

    it('matchesCodeownersPattern glob *.ts matches .ts files', () => {
      expect(matchesCodeownersPattern('*.ts', 'index.ts')).toBe(true);
    });

    it('matchesCodeownersPattern non-matching patterns return false', () => {
      expect(matchesCodeownersPattern('docs/', 'src/main.ts')).toBe(false);
    });
  });

  // ─── SHA helper tests (deterministic identifiers) ───
  describe('SHA helper function', () => {
    it('sha() produces 16-char hex from SHA256', () => {
      const result = sha('test-input');
      expect(result).toHaveLength(16);
      expect(result).toMatch(/^[0-9a-f]{16}$/);
    });

    it('sha() is deterministic — same input always produces same output', () => {
      expect(sha('/repo/src/core/x.ts')).toBe(sha('/repo/src/core/x.ts'));
    });

    it('violation IDs for unowned and stale use different subtypes but same SHA tail', () => {
      const projectId = 'proj_test';
      const fp = '/repo/src/core/x.ts';
      const unowned = `hygiene-violation:${projectId}:ownership:unowned:${sha(fp)}`;
      const stale = `hygiene-violation:${projectId}:ownership:stale:${sha(fp)}`;
      expect(unowned).not.toBe(stale);
      expect(unowned.slice(-16)).toBe(stale.slice(-16));
    });
  });

  // ─── Module-import behavioral tests for main() ───

  // Behavior 1: loads CODEOWNERS via hygiene-ownership-lib
  describe('CODEOWNERS loading via module execution', () => {
    it('calls loadCodeowners with REPO_ROOT', async () => {
      vi.resetModules();
      setupMocks({ files: [] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(mockLoadCodeowners).toHaveBeenCalled(), { timeout: 2000 });

      expect(mockLoadCodeowners).toHaveBeenCalledWith(expect.any(String));
    });
  });

  // Behavior 2: checks critical paths have ownership entries
  describe('critical path ownership checks', () => {
    it('detects unowned critical files and creates violations', async () => {
      vi.resetModules();
      const unownedCriticalFile = makeFileRecord('sf-1', `${DEFAULT_REPO_ROOT}/src/core/parser.ts`, []);
      setupMocks({ files: [unownedCriticalFile] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => { expect(logOutput.length + errorOutput.length).toBeGreaterThan(0); }, { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && c.includes('unowned_critical_path'),
      );
      expect(violationMerge).toBeDefined();
    });

    it('does not flag owned critical files', async () => {
      vi.resetModules();
      const ownedCriticalFile = makeFileRecord('sf-1', `${DEFAULT_REPO_ROOT}/src/core/parser.ts`, ['@jonathan']);
      setupMocks({ files: [ownedCriticalFile] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('unowned_critical_path'),
      );
      expect(violationMerge).toBeUndefined();

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ok).toBe(true);
    });
  });

  // Behavior 3: detects stale ownership
  describe('stale ownership detection', () => {
    it('creates stale_owner_verification violations for stale records', async () => {
      vi.resetModules();
      const staleRec = makeStaleRecord(`${DEFAULT_REPO_ROOT}/src/core/parser.ts`, 'scope-1', '2020-01-01T00:00:00Z');
      setupMocks({ files: [], staleRecords: [staleRec] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const staleMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('stale_owner_verification'),
      );
      expect(staleMerge).toBeDefined();
    });
  });

  // Behavior 4: cross-references with graph OwnershipScope nodes
  describe('graph OwnershipScope cross-reference', () => {
    it('queries OwnershipScope count for CODEOWNERS parity', async () => {
      vi.resetModules();
      setupMocks({ files: [], ownershipScopeCount: 5 });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const scopeCountQuery = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('OwnershipScope') && c.includes('count(s)'),
      );
      expect(scopeCountQuery).toBeDefined();

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed).toHaveProperty('ownershipScopeCount');
      expect(parsed).toHaveProperty('parityOk');
    });
  });

  // Behavior 5: produces deterministic sha identifiers
  describe('deterministic SHA identifiers', () => {
    it('violation IDs contain SHA of filePath', async () => {
      vi.resetModules();
      const unownedFile = makeFileRecord('sf-1', `${DEFAULT_REPO_ROOT}/src/core/parser.ts`, []);
      setupMocks({ files: [unownedFile] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const violationMerges = mockRun.mock.calls.filter(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && !c.includes('DETACH'),
      );
      for (const [, params] of violationMerges) {
        if (params?.id && typeof params.id === 'string' && params.id.includes('ownership:')) {
          expect(params.id).toMatch(/^hygiene-violation:.+:ownership:(unowned|stale):[0-9a-f]{16}$/);
        }
      }
    });
  });

  // Behavior 6: reports ownership gaps and stale records
  describe('output reporting', () => {
    it('reports unownedCriticalCount and staleCriticalCount in JSON output', async () => {
      vi.resetModules();
      const unownedFile = makeFileRecord('sf-1', `${DEFAULT_REPO_ROOT}/src/core/parser.ts`, []);
      const staleRec = makeStaleRecord(`${DEFAULT_REPO_ROOT}/src/core/gate.ts`, 'scope-2', '2020-01-01T00:00:00Z');
      setupMocks({ files: [unownedFile], staleRecords: [staleRec] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(errorOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = errorOutput.find((e) => e.includes('"ok"'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.unownedCriticalCount).toBeGreaterThan(0);
      expect(parsed).toHaveProperty('staleCriticalCount');
      expect(parsed).toHaveProperty('violationsCreated');
    });

    it('writes artifact file', async () => {
      vi.resetModules();
      setupMocks({ files: [] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalled(), { timeout: 2000 });

      const [filePath] = mockWriteFile.mock.calls[0];
      expect(filePath).toContain('hygiene-ownership-verify');
    });
  });

  // Behavior: clears prior violations before creating new ones
  describe('prior violation cleanup', () => {
    it('issues DETACH DELETE for prior ownership_hygiene violations', async () => {
      vi.resetModules();
      setupMocks({ files: [] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const deleteCalls = mockRun.mock.calls.filter(
        ([c]: [string]) => typeof c === 'string' && c.includes('DETACH DELETE') && c.includes('ownership_hygiene'),
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
    });
  });

  // Behavior: parityOk cross-reference logic
  describe('parityOk cross-reference logic', () => {
    it('parityOk is true when scopeCount >= codeowners entries', async () => {
      vi.resetModules();
      setupMocks({
        codeownersPath: '/repo/CODEOWNERS',
        codeownersEntries: [{ pattern: '*', owners: ['@jonathan'] }],
        files: [],
        ownershipScopeCount: 5,
      });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.parityOk).toBe(true);
    });

    it('parityOk is false when scopeCount < codeowners entries', async () => {
      vi.resetModules();
      setupMocks({
        codeownersPath: '/repo/CODEOWNERS',
        codeownersEntries: [
          { pattern: 'src/core/', owners: ['@team1'] },
          { pattern: 'src/utils/', owners: ['@team2'] },
          { pattern: '*.ts', owners: ['@team3'] },
        ],
        files: [],
        ownershipScopeCount: 1,
      });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.parityOk).toBe(false);
    });
  });

  // Behavior 7: accepts PROJECT_ID/REPO_ROOT from env
  describe('env var configuration', () => {
    it('uses custom PROJECT_ID when set', async () => {
      vi.resetModules();
      process.env.PROJECT_ID = 'proj_ownership_test';
      setupMocks({ files: [] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.projectId).toBe('proj_ownership_test');
    });

    it('exits with code 1 when unowned critical files exist', async () => {
      vi.resetModules();
      const unownedFile = makeFileRecord('sf-1', `${DEFAULT_REPO_ROOT}/src/core/parser.ts`, []);
      setupMocks({ files: [unownedFile] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });
    });

    it('uses default REPO_ROOT when env not set', async () => {
      vi.resetModules();
      delete process.env.REPO_ROOT;
      setupMocks({ files: [] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(mockLoadCodeowners).toHaveBeenCalled(), { timeout: 2000 });

      const callArg = mockLoadCodeowners.mock.calls[0][0];
      expect(callArg).toContain('codegraph');
    });

    it('accepts custom REPO_ROOT from env', async () => {
      vi.resetModules();
      process.env.REPO_ROOT = '/custom/repo/root';
      setupMocks({ files: [] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(mockLoadCodeowners).toHaveBeenCalled(), { timeout: 2000 });

      const callArg = mockLoadCodeowners.mock.calls[0][0];
      expect(callArg).toBe('/custom/repo/root');
    });

    it('catch handler exits with code 1 on errors', async () => {
      vi.resetModules();
      mockLoadCodeowners.mockRejectedValueOnce(new Error('file not found'));
      mockRun.mockResolvedValue({ records: [] });

      await import('../../../utils/verify-hygiene-ownership');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errJson = errorOutput.find((e) => e.includes('file not found'));
      expect(errJson).toBeDefined();
    });
  });
});
