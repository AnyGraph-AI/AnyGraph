// AUD-TC-03-L1b-24: audit-anchor-resolve.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: VERIFICATION_GRAPH_ROADMAP.md §CA-4 cross-repo audit anchor mapping

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFileSync = vi.fn();
vi.mock('node:child_process', () => ({
  execFileSync: (...a: unknown[]) => mockExecFileSync(...a),
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
vi.mock('fs', () => ({
  default: {
    existsSync: (...a: unknown[]) => mockExistsSync(...a),
    readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
  },
  existsSync: (...a: unknown[]) => mockExistsSync(...a),
  readFileSync: (...a: unknown[]) => mockReadFileSync(...a),
}));

const origArgv = process.argv;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});

function makeConfig(overrides?: {
  current?: string;
  pairs?: Record<string, { label: string; codegraphCommit: string; workspaceCommit: string; updatedAt?: string; note?: string }>;
}): string {
  return JSON.stringify({
    current: overrides?.current ?? 'v1',
    pairs: overrides?.pairs ?? {
      v1: {
        label: 'v1',
        codegraphCommit: 'abc1234567890abc1234567890abc1234567890ab',
        workspaceCommit: 'def1234567890def1234567890def1234567890de',
        updatedAt: '2026-03-20T12:00:00Z',
        note: 'test anchor',
      },
    },
  });
}

function defaultMocks() {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(makeConfig());
  mockExecFileSync.mockReturnValue(Buffer.from(''));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.argv = origArgv.slice();
  defaultMocks();
});

async function runModule() {
  vi.resetModules();
  await import('../../../utils/audit-anchor-resolve.js');
  await new Promise((r) => setTimeout(r, 50));
}

describe('audit-anchor-resolve audit tests (AUD-TC-03-L1b-24)', () => {
  // ─── Behavior 1: reads config/audit-anchor-pairs.json ───
  describe('reads anchor pair config', () => {
    it('throws with structured error when config file not found', async () => {
      process.argv = ['node', 'script.ts'];
      mockExistsSync.mockReturnValue(false);
      await runModule();
      expect(mockErr).toHaveBeenCalled();
      const parsed = JSON.parse(mockErr.mock.calls[0][0] as string);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain('Anchor pair config not found');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('reads and parses JSON from config path', async () => {
      process.argv = ['node', 'script.ts'];
      await runModule();
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining('audit-anchor-pairs.json'),
        'utf8',
      );
    });
  });

  // ─── Behavior 2: resolves git commits via execFileSync ───
  describe('resolves git commits', () => {
    it('calls git cat-file -e for both codegraph and workspace commits', async () => {
      process.argv = ['node', 'script.ts'];
      await runModule();
      const gitCalls = mockExecFileSync.mock.calls.filter(
        (c: unknown[]) => c[0] === 'git' && (c[1] as string[]).includes('cat-file'),
      );
      expect(gitCalls.length).toBe(2);
      for (const call of gitCalls) {
        const args = call[1] as string[];
        expect(args).toContain('-e');
        expect(args.some((a: string) => a.endsWith('^{commit}'))).toBe(true);
      }
    });

    it('reports ok=true when both commits exist', async () => {
      process.argv = ['node', 'script.ts'];
      await runModule();
      expect(mockLog).toHaveBeenCalled();
      const out = JSON.parse(mockLog.mock.calls[0][0] as string);
      expect(out.ok).toBe(true);
      expect(out.codegraphExists).toBe(true);
      expect(out.workspaceExists).toBe(true);
    });

    it('reports ok=false when workspace commit does not exist', async () => {
      process.argv = ['node', 'script.ts'];
      mockExecFileSync
        .mockReturnValueOnce(Buffer.from(''))  // codegraph OK
        .mockImplementationOnce(() => { throw new Error('not found'); });  // workspace missing
      await runModule();
      const out = JSON.parse(mockLog.mock.calls[0][0] as string);
      expect(out.ok).toBe(false);
      expect(out.codegraphExists).toBe(true);
      expect(out.workspaceExists).toBe(false);
    });
  });

  // ─── Behavior 3: validates anchor pair format (label lookup) ───
  describe('validates anchor pair format', () => {
    it('errors when --label points to nonexistent pair', async () => {
      process.argv = ['node', 'script.ts', '--label', 'nonexistent'];
      await runModule();
      const parsed = JSON.parse(mockErr.mock.calls[0][0] as string);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain('Anchor label not found');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('uses cfg.current label when no --label provided', async () => {
      process.argv = ['node', 'script.ts'];
      mockReadFileSync.mockReturnValue(makeConfig({ current: 'v1' }));
      await runModule();
      const out = JSON.parse(mockLog.mock.calls[0][0] as string);
      expect(out.label).toBe('v1');
    });

    it('errors when neither --label nor cfg.current is set', async () => {
      process.argv = ['node', 'script.ts'];
      mockReadFileSync.mockReturnValue(JSON.stringify({ pairs: { v1: { label: 'v1', codegraphCommit: 'a', workspaceCommit: 'b' } } }));
      await runModule();
      const parsed = JSON.parse(mockErr.mock.calls[0][0] as string);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain('Anchor label not found');
    });

    // SPEC-GAP: Spec says "validates anchor pair format" but implementation only
    // checks label existence in pairs map. No schema validation of commit SHA
    // format (40-char hex). Only git cat-file checks existence post-hoc.
  });

  // ─── Behavior 4: CLI args for different modes ───
  describe('CLI args', () => {
    it('accepts --config to override config path', async () => {
      const customPath = '/tmp/custom-anchors.json';
      process.argv = ['node', 'script.ts', '--config', customPath];
      mockExistsSync.mockImplementation((p: unknown) => p === customPath);
      mockReadFileSync.mockReturnValue(makeConfig());
      await runModule();
      expect(mockReadFileSync).toHaveBeenCalledWith(customPath, 'utf8');
    });

    it('--best-effort suppresses exit(1) on missing commits', async () => {
      process.argv = ['node', 'script.ts', '--best-effort'];
      mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
      await runModule();
      const out = JSON.parse(mockLog.mock.calls[0][0] as string);
      expect(out.ok).toBe(false);
      // With --best-effort, should NOT exit(1)
      expect(mockExit).not.toHaveBeenCalledWith(1);
    });

    it('exits(1) without --best-effort when commits missing', async () => {
      process.argv = ['node', 'script.ts'];
      mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
      await runModule();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ─── Behavior 5: structured JSON output ───
  describe('structured JSON output', () => {
    it('success output contains all required fields', async () => {
      process.argv = ['node', 'script.ts'];
      await runModule();
      const out = JSON.parse(mockLog.mock.calls[0][0] as string);
      expect(out).toHaveProperty('ok');
      expect(out).toHaveProperty('label');
      expect(out).toHaveProperty('codegraphRepo');
      expect(out).toHaveProperty('workspaceRepo');
      expect(out).toHaveProperty('codegraphCommit');
      expect(out).toHaveProperty('workspaceCommit');
      expect(out).toHaveProperty('codegraphExists');
      expect(out).toHaveProperty('workspaceExists');
      expect(out).toHaveProperty('configPath');
    });

    it('includes updatedAt and note from anchor pair', async () => {
      process.argv = ['node', 'script.ts'];
      await runModule();
      const out = JSON.parse(mockLog.mock.calls[0][0] as string);
      expect(out.updatedAt).toBe('2026-03-20T12:00:00Z');
      expect(out.note).toBe('test anchor');
    });

    it('error output is JSON with ok=false and error field', async () => {
      process.argv = ['node', 'script.ts'];
      mockExistsSync.mockReturnValue(false);
      await runModule();
      const parsed = JSON.parse(mockErr.mock.calls[0][0] as string);
      expect(parsed.ok).toBe(false);
      expect(typeof parsed.error).toBe('string');
    });
  });
});
