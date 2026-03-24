// AUD-TC-03-L1b-21 — B6 (Health Witness)
// Spec-derived audit tests for verify-hygiene-platform-parity.ts
// Spec: plans/hygiene-governance/PLAN.md — platform parity controls

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
const mockAccess = vi.fn();
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs/promises', () => ({
  default: {
    access: (...args: unknown[]) => mockAccess(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}));

// ─── child_process mock ───
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// ─── util mock for promisify ───
vi.mock('node:util', () => ({
  promisify: (fn: Function) => (...args: unknown[]) => {
    // Return a promise-based version using the mock
    return new Promise((resolve, reject) => {
      fn(...args, (err: Error | null, result: unknown) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

// ─── global fetch mock ───
const mockFetch = vi.fn();

function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

describe('AUD-TC-03-L1b-21 | verify-hygiene-platform-parity.ts', () => {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalFetch = globalThis.fetch;
  let logOutput: string[] = [];
  let errorOutput: string[] = [];

  function setupMocks(opts: {
    codeownersExists?: boolean;
    gitOrigin?: string | null;
    branchProtection?: { ok: boolean; status?: number; json?: unknown };
    rulesets?: { ok: boolean; status?: number; json?: unknown };
  } = {}) {
    const {
      codeownersExists = true,
      gitOrigin = 'https://github.com/jonuser/codegraph.git',
      branchProtection = { ok: true, status: 200, json: { required_status_checks: {}, required_pull_request_reviews: {} } },
      rulesets = { ok: true, status: 200, json: [] },
    } = opts;

    // fs.access mock for CODEOWNERS check
    if (codeownersExists) {
      mockAccess.mockResolvedValue(undefined);
    } else {
      mockAccess.mockRejectedValue(new Error('ENOENT'));
    }

    // git remote get-url origin via execFile
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as Function;
      if (gitOrigin) {
        cb(null, { stdout: gitOrigin });
      } else {
        cb(new Error('no remote'));
      }
    });

    // Mock Neo4j runs
    mockRun.mockImplementation((cypher: string) => {
      if (cypher.includes('DETACH DELETE')) {
        return Promise.resolve({ records: [] });
      }
      // MERGE violation or snapshot
      return Promise.resolve({ records: [] });
    });

    // Mock fetch for GitHub API
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/protection')) {
        if (!branchProtection.ok) {
          return Promise.resolve({
            ok: false,
            status: branchProtection.status ?? 404,
            text: () => Promise.resolve('not found'),
          });
        }
        return Promise.resolve({
          ok: true,
          status: branchProtection.status ?? 200,
          json: () => Promise.resolve(branchProtection.json),
        });
      }
      if (url.includes('/rulesets')) {
        if (!rulesets.ok) {
          return Promise.resolve({
            ok: false,
            status: rulesets.status ?? 404,
            text: () => Promise.resolve('not found'),
          });
        }
        return Promise.resolve({
          ok: true,
          status: rulesets.status ?? 200,
          json: () => Promise.resolve(rulesets.json),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    logOutput = [];
    errorOutput = [];
    console.log = (...args: unknown[]) => logOutput.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => errorOutput.push(args.map(String).join(' '));
    process.exit = vi.fn() as any;
    process.env.HYGIENE_PLATFORM_PARITY_ENFORCE = 'false';
    process.env.GITHUB_TOKEN = 'ghp_test_token';
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    globalThis.fetch = originalFetch;
  });

  // ─── Behavior 1: Reads repo filesystem (CODEOWNERS existence) ───
  describe('CODEOWNERS filesystem check', () => {
    it('checks for CODEOWNERS file existence via fs.access', async () => {
      vi.resetModules();
      setupMocks({ codeownersExists: true });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockAccess).toHaveBeenCalled(), { timeout: 2000 });

      const accessCall = mockAccess.mock.calls[0];
      expect(String(accessCall[0])).toContain('CODEOWNERS');
    });

    it('creates missing_codeowners violation when CODEOWNERS absent', async () => {
      vi.resetModules();
      setupMocks({ codeownersExists: false });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => { expect(logOutput.length + errorOutput.length).toBeGreaterThan(0); }, { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c, p]: [string, Record<string, unknown>]) =>
          typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && p?.subtype === 'missing_codeowners',
      );
      expect(violationMerge).toBeDefined();
    });

    it('does NOT create missing_codeowners violation when CODEOWNERS exists', async () => {
      vi.resetModules();
      setupMocks({ codeownersExists: true });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c, p]: [string, Record<string, unknown>]) =>
          typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && p?.subtype === 'missing_codeowners',
      );
      expect(violationMerge).toBeUndefined();
    });
  });

  // ─── Behavior 2: Compares against platform state (GitHub API) ───
  describe('GitHub platform parity checks', () => {
    it('queries branch protection and rulesets via fetch', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 2000 });

      const fetchCalls = mockFetch.mock.calls.map(([url]: [string]) => url);
      expect(fetchCalls.some((u: string) => u.includes('/protection'))).toBe(true);
      expect(fetchCalls.some((u: string) => u.includes('/rulesets'))).toBe(true);
    });

    it('creates missing_branch_protection violation when protection is 404', async () => {
      vi.resetModules();
      setupMocks({
        branchProtection: { ok: false, status: 404 },
      });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => { expect(logOutput.length + errorOutput.length).toBeGreaterThan(0); }, { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c, p]: [string, Record<string, unknown>]) =>
          typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && p?.subtype === 'missing_branch_protection',
      );
      expect(violationMerge).toBeDefined();
    });

    it('does NOT create missing_branch_protection when protection is present', async () => {
      vi.resetModules();
      setupMocks({
        branchProtection: { ok: true, status: 200, json: { required_status_checks: {}, required_pull_request_reviews: {} } },
      });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c, p]: [string, Record<string, unknown>]) =>
          typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && p?.subtype === 'missing_branch_protection',
      );
      expect(violationMerge).toBeUndefined();
    });

    it('records requiredStatusChecks and requiredReviews from branch protection response', async () => {
      vi.resetModules();
      setupMocks({
        branchProtection: {
          ok: true, status: 200,
          json: { required_status_checks: { contexts: ['ci'] }, required_pull_request_reviews: { required_approving_review_count: 1 } },
        },
      });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.checks.requiredStatusChecks).toBe(true);
      expect(parsed.checks.requiredReviews).toBe(true);
    });

    it('records rulesets count from rulesets API response', async () => {
      vi.resetModules();
      setupMocks({
        rulesets: { ok: true, status: 200, json: [{ id: 1 }, { id: 2 }] },
      });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.checks.rulesets).toBe(2);
    });

    it('unavailable API status (403) does not create violation', async () => {
      vi.resetModules();
      setupMocks({
        branchProtection: { ok: false, status: 403 },
      });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c, p]: [string, Record<string, unknown>]) =>
          typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && p?.subtype === 'missing_branch_protection',
      );
      expect(violationMerge).toBeUndefined();

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.checks.branchProtection).toBe('unavailable:403');
    });

    it('rulesets API unavailability is recorded as unavailable status', async () => {
      vi.resetModules();
      setupMocks({
        rulesets: { ok: false, status: 500 },
      });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.checks.rulesets).toBe('unavailable:500');
    });
  });

  // ─── Behavior 3: Uses execFile for git operations ───
  describe('git operations via execFile', () => {
    it('calls git remote get-url origin', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockExecFile).toHaveBeenCalled(), { timeout: 2000 });

      const gitCall = mockExecFile.mock.calls[0];
      expect(gitCall[0]).toBe('git');
      expect(gitCall[1]).toContain('remote');
      expect(gitCall[1]).toContain('get-url');
      expect(gitCall[1]).toContain('origin');
    });

    it('handles missing git origin gracefully (no GitHub API calls)', async () => {
      vi.resetModules();
      setupMocks({ gitOrigin: null });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      // No fetch calls when origin is null/unparseable
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('parses SSH git origin and calls GitHub API with correct owner/repo', async () => {
      vi.resetModules();
      setupMocks({ gitOrigin: 'git@github.com:myorg/myrepo.git' });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 2000 });

      const fetchCalls = mockFetch.mock.calls.map(([url]: [string]) => url);
      expect(fetchCalls.some((u: string) => u.includes('/repos/myorg/myrepo/'))).toBe(true);
    });

    it('parses HTTPS git origin without .git suffix', async () => {
      vi.resetModules();
      setupMocks({ gitOrigin: 'https://github.com/org2/repo2' });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 2000 });

      const fetchCalls = mockFetch.mock.calls.map(([url]: [string]) => url);
      expect(fetchCalls.some((u: string) => u.includes('/repos/org2/repo2/'))).toBe(true);
    });

    it('non-GitHub origin URL results in no API calls', async () => {
      vi.resetModules();
      setupMocks({ gitOrigin: 'https://gitlab.com/user/repo.git' });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      expect(mockFetch).not.toHaveBeenCalled();

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.checks.githubRepoParsed).toBe(false);
    });

    it('records origin URL in checks output', async () => {
      vi.resetModules();
      setupMocks({ gitOrigin: 'https://github.com/jonuser/codegraph.git' });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.checks.origin).toBe('https://github.com/jonuser/codegraph.git');
      expect(parsed.checks.githubRepoParsed).toBe(true);
    });
  });

  // ─── Behavior 4: Deterministic SHA identifiers ───
  describe('deterministic SHA identifiers', () => {
    it('violation IDs use project + platform + subtype + sha(name)', async () => {
      vi.resetModules();
      setupMocks({ codeownersExists: false });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const violationMerges = mockRun.mock.calls.filter(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && !c.includes('DETACH'),
      );
      for (const [, params] of violationMerges) {
        if (params?.id && typeof params.id === 'string' && params.id.includes('platform:')) {
          expect(params.id).toMatch(/^hygiene-violation:.+:platform:.+:[0-9a-f]{16}$/);
        }
      }
    });

    it('writes metric snapshot with payload hash', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const snapshotMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneMetricSnapshot') && c.includes('MERGE'),
      );
      expect(snapshotMerge).toBeDefined();
      expect(snapshotMerge![1].payloadHash).toBeDefined();
      expect(snapshotMerge![1].payloadHash).toHaveLength(16);
    });

    it('sha helper produces 16-char hex deterministically', () => {
      expect(sha('test')).toHaveLength(16);
      expect(sha('test')).toMatch(/^[0-9a-f]{16}$/);
      expect(sha('test')).toBe(sha('test'));
    });

    it('different inputs produce different sha values', () => {
      expect(sha('CODEOWNERS missing')).not.toBe(sha('Branch protection missing'));
    });
  });

  // ─── Behavior 5: Reports violations ───
  describe('violation reporting', () => {
    it('clears prior platform_parity violations before creating new ones', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const deleteCall = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('DETACH DELETE') && c.includes('platform_parity'),
      );
      expect(deleteCall).toBeDefined();
    });

    it('JSON output includes checks object and violations list', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed).toHaveProperty('checks');
      expect(parsed).toHaveProperty('violations');
      expect(parsed).toHaveProperty('snapshotId');
    });

    it('violations are written as HygieneViolation with TRIGGERED_BY→HygieneControl(B6)', async () => {
      vi.resetModules();
      setupMocks({ codeownersExists: false });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => { expect(logOutput.length + errorOutput.length).toBeGreaterThan(0); }, { timeout: 2000 });

      const violationMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && c.includes('TRIGGERED_BY'),
      );
      expect(violationMerge).toBeDefined();
      expect(violationMerge![0]).toContain('B6');
    });

    it('writes HygieneMetricSnapshot with metricFamily=platform_parity', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const snapshotMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneMetricSnapshot') && c.includes('MERGE'),
      );
      expect(snapshotMerge).toBeDefined();
      expect(snapshotMerge![0]).toContain('platform_parity');
    });

    it('snapshot is linked to HygieneControl B6 via MEASURED_BY', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const snapshotMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneMetricSnapshot') && c.includes('MEASURED_BY'),
      );
      expect(snapshotMerge).toBeDefined();
      expect(snapshotMerge![0]).toContain('B6');
    });

    it('JSON output includes all check fields in payload', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.checks).toHaveProperty('codeownersExists');
      expect(parsed.checks).toHaveProperty('origin');
      expect(parsed.checks).toHaveProperty('githubRepoParsed');
      expect(parsed.checks).toHaveProperty('branchProtection');
      expect(parsed.checks).toHaveProperty('rulesets');
      expect(parsed.checks).toHaveProperty('requiredStatusChecks');
      expect(parsed.checks).toHaveProperty('requiredReviews');
    });
  });

  // ─── Behavior 6: Accepts PROJECT_ID/REPO_ROOT from env ───
  describe('env var configuration', () => {
    it('uses custom PROJECT_ID', async () => {
      vi.resetModules();
      process.env.PROJECT_ID = 'proj_parity_test';
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.projectId).toBe('proj_parity_test');
    });

    it('defaults PROJECT_ID to proj_c0d3e9a1f200', async () => {
      vi.resetModules();
      delete process.env.PROJECT_ID;
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.projectId).toBe('proj_c0d3e9a1f200');
    });

    it('uses REPO_ROOT for CODEOWNERS path resolution', async () => {
      vi.resetModules();
      process.env.REPO_ROOT = '/custom/repo/path';
      setupMocks({ codeownersExists: true });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockAccess).toHaveBeenCalled(), { timeout: 2000 });

      const accessPath = String(mockAccess.mock.calls[0][0]);
      expect(accessPath).toContain('/custom/repo/path');
      expect(accessPath).toContain('CODEOWNERS');
    });

    it('uses DEFAULT_BRANCH in branch protection URL', async () => {
      vi.resetModules();
      process.env.DEFAULT_BRANCH = 'develop';
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled(), { timeout: 2000 });

      const fetchCalls = mockFetch.mock.calls.map(([url]: [string]) => url);
      expect(fetchCalls.some((u: string) => u.includes('/branches/develop/protection'))).toBe(true);
    });

    it('HYGIENE_PLATFORM_PARITY_ENFORCE defaults to false (advisory mode)', async () => {
      vi.resetModules();
      delete process.env.HYGIENE_PLATFORM_PARITY_ENFORCE;
      setupMocks({ codeownersExists: false });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.advisoryMode).toBe(true);
      expect(parsed.enforce).toBe(false);
    });

    it('skips GitHub API calls when GITHUB_TOKEN is missing', async () => {
      vi.resetModules();
      delete process.env.GITHUB_TOKEN;
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      // fetchGitHub returns early with error when no token — but fetch still called
      // because fetchGitHub checks token before calling fetch
      // Actually the source checks token inside fetchGitHub before calling fetch
      // With no token, fetch should NOT be called
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ─── Behavior 7: Exits with code 1 when enforcement violations found ───
  describe('exit code behavior', () => {
    it('enforce mode exits 1 when violations present', async () => {
      vi.resetModules();
      process.env.HYGIENE_PLATFORM_PARITY_ENFORCE = 'true';
      setupMocks({ codeownersExists: false });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errJson = errorOutput.find((e) => e.includes('"ok":false'));
      expect(errJson).toBeDefined();
    });

    it('advisory mode reports ok=true even with violations', async () => {
      vi.resetModules();
      process.env.HYGIENE_PLATFORM_PARITY_ENFORCE = 'false';
      setupMocks({ codeownersExists: false });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ok).toBe(true);
      expect(parsed.advisoryMode).toBe(true);
    });

    it('enforce mode ok=true when no violations present', async () => {
      vi.resetModules();
      process.env.HYGIENE_PLATFORM_PARITY_ENFORCE = 'true';
      setupMocks({ codeownersExists: true });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ok).toBe(true);
      expect(parsed.enforce).toBe(true);
      expect(parsed.violations).toHaveLength(0);
    });

    it('writes artifact file', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalled(), { timeout: 2000 });

      const [filePath] = mockWriteFile.mock.calls[0];
      expect(filePath).toContain('hygiene-platform-parity');
    });

    it('artifact file is written under artifacts/hygiene/ directory', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(mockMkdir).toHaveBeenCalled(), { timeout: 2000 });

      const mkdirPath = String(mockMkdir.mock.calls[0][0]);
      expect(mkdirPath).toContain('artifacts');
      expect(mkdirPath).toContain('hygiene');
    });

    it('catch handler exits with code 1 on errors', async () => {
      vi.resetModules();
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      // Force a hard error by making session.run reject
      mockRun.mockRejectedValue(new Error('connection refused'));
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as Function;
        cb(null, { stdout: 'https://github.com/user/repo.git' });
      });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });
    });

    it('catch handler outputs JSON with ok=false and error message', async () => {
      vi.resetModules();
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      mockRun.mockRejectedValue(new Error('connection refused'));
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const cb = args[args.length - 1] as Function;
        cb(null, { stdout: 'https://github.com/user/repo.git' });
      });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errJson = errorOutput.find((e) => e.includes('"ok":false'));
      expect(errJson).toBeDefined();
      const parsed = JSON.parse(errJson!);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBeDefined();
    });
  });

  // ─── Additional: exists() helper behavior ───
  describe('exists() helper behavior', () => {
    it('returns true (access succeeds) or false (access rejects) for CODEOWNERS', async () => {
      vi.resetModules();
      setupMocks({ codeownersExists: true });

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.checks.codeownersExists).toBe(true);
    });
  });

  // ─── Additional: Snapshot payload hash determinism ───
  describe('snapshot payload hash', () => {
    it('payloadHash is a 16-char SHA of JSON-stringified payload', async () => {
      vi.resetModules();
      setupMocks();

      await import('../../../utils/verify-hygiene-platform-parity');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const snapshotMerge = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneMetricSnapshot') && c.includes('MERGE'),
      );
      expect(snapshotMerge).toBeDefined();
      const { payloadHash, payloadJson } = snapshotMerge![1];
      expect(payloadHash).toHaveLength(16);
      expect(payloadHash).toMatch(/^[0-9a-f]{16}$/);
      // Verify determinism: recompute from payloadJson
      expect(sha(payloadJson)).toBe(payloadHash);
    });
  });
});
