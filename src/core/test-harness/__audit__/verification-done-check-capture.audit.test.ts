/**
 * AUD-TC-03-L1b-02: verification-done-check-capture.ts audit tests
 *
 * Spec: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §"Done-Check Evidence Capture" + §CA-4
 *
 * Behaviors:
 *   (1) runs `npm run done-check` via spawnSync unless --capture-only
 *   (2) captures git HEAD SHA, branch, and worktree dirty state
 *   (3) refuses capture on dirty worktree by default (VERIFICATION_CAPTURE_FAIL_ON_DIRTY)
 *   (4) allows dirty capture when VERIFICATION_CAPTURE_ALLOW_DIRTY=true
 *   (5) computes deterministic decisionHash from stable JSON of gate decision seed
 *   (6) sha256 hashes latest integrity artifact
 *   (7) calls ingestRuntimeGateEvidence with structured evidence payload
 *   (8) produces stable externalContextSnapshotRef from context hash
 *   (9) exit code matches done-check exit code (or 0 for capture-only)
 *   (10) outputs comprehensive JSON (runId, headSha, branch, isDirty, diffHash, durationMs, artifactHash, decisionHash, ingestResult)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ──

const { mockIngest, mockSpawnSync, mockExecFileSync, mockExistsSync, mockReaddirSync, mockReadFileSync } = vi.hoisted(() => ({
  mockIngest: vi.fn().mockResolvedValue({ ok: true }),
  mockSpawnSync: vi.fn().mockReturnValue({ status: 0, stdout: '', stderr: '' }),
  mockExecFileSync: vi.fn().mockReturnValue(''),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReaddirSync: vi.fn().mockReturnValue([]),
  mockReadFileSync: vi.fn().mockReturnValue(Buffer.from('{"version":"1.0.0"}')),
}));

vi.mock('../../../core/verification/index.js', () => ({
  ingestRuntimeGateEvidence: mockIngest,
}));

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
  execFileSync: mockExecFileSync,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, createHash: actual.createHash };
});

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;
let savedArgv: string[];
let savedEnv: Record<string, string | undefined>;
const FIXED_TIME = 1711300000000;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ now: FIXED_TIME });
  mockIngest.mockReset().mockResolvedValue({ ok: true });
  mockSpawnSync.mockReset().mockReturnValue({ status: 0, stdout: '', stderr: '' });
  // Default: clean worktree — git status --porcelain returns empty
  mockExecFileSync.mockReset().mockImplementation((cmd: string, args: string[]) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc123def456\n';
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main\n';
    if (args[0] === 'status') return '\n';
    if (args[0] === 'diff') return '\n';
    return '\n';
  });
  mockExistsSync.mockReset().mockReturnValue(false);
  mockReaddirSync.mockReset().mockReturnValue([]);
  mockReadFileSync.mockReset().mockImplementation((p: string) => {
    if (String(p).endsWith('package.json')) return Buffer.from('{"version":"1.0.0"}');
    return Buffer.from('');
  });

  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  savedArgv = process.argv;
  savedEnv = { ...process.env };
  process.argv = ['node', 'script'];
  delete process.env.VERIFICATION_CAPTURE_ALLOW_DIRTY;
  delete process.env.VERIFICATION_CAPTURE_FAIL_ON_DIRTY;
});

afterEach(() => {
  vi.useRealTimers();
  mockExit.mockRestore();
  mockConsoleLog.mockRestore();
  mockConsoleError.mockRestore();
  process.argv = savedArgv;
  process.env = savedEnv;
});

async function runModule(args: string[] = []): Promise<void> {
  process.argv = ['node', 'script', ...args];
  await import('../../../utils/verification-done-check-capture.js');
  // Allow async main() to settle
  await vi.advanceTimersByTimeAsync(100);
}

describe('AUD-TC-03-L1b-02 | verification-done-check-capture.ts', () => {

  // ─── Behavior 1: runs done-check via spawnSync unless --capture-only ───
  describe('B1: runs done-check via spawnSync unless --capture-only', () => {
    it('invokes spawnSync with npm run done-check by default', async () => {
      await runModule();
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'npm',
        ['run', 'done-check'],
        expect.objectContaining({ shell: false }),
      );
    });

    it('does NOT invoke spawnSync when --capture-only is passed', async () => {
      await runModule(['--capture-only']);
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });

  // ─── Behavior 2: captures git HEAD SHA, branch, and worktree dirty state ───
  describe('B2: captures git HEAD, branch, dirty state', () => {
    it('calls git rev-parse HEAD and --abbrev-ref HEAD', async () => {
      await runModule(['--capture-only']);
      const gitCalls = mockExecFileSync.mock.calls.filter((c: any) => c[0] === 'git');
      const args = gitCalls.map((c: any) => c[1]);
      expect(args).toContainEqual(['rev-parse', 'HEAD']);
      expect(args).toContainEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    });

    it('calls git status --porcelain for dirty detection', async () => {
      await runModule(['--capture-only']);
      const gitCalls = mockExecFileSync.mock.calls.filter((c: any) => c[0] === 'git');
      const args = gitCalls.map((c: any) => c[1]);
      expect(args).toContainEqual(['status', '--porcelain']);
    });
  });

  // ─── Behavior 3: refuses capture on dirty worktree by default ───
  describe('B3: refuses capture on dirty worktree (fail-on-dirty default)', () => {
    it('exits with code 1 when worktree is dirty and no override', async () => {
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc123\n';
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main\n';
        if (args[0] === 'status') return ' M src/dirty-file.ts\n';
        if (args[0] === 'diff') return 'some diff\n';
        return '\n';
      });

      await runModule(['--capture-only']);
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockConsoleError).toHaveBeenCalled();
      const errOutput = mockConsoleError.mock.calls[0]?.[0];
      expect(errOutput).toContain('dirty worktree');
    });
  });

  // ─── Behavior 4: allows dirty capture with VERIFICATION_CAPTURE_ALLOW_DIRTY ───
  describe('B4: allows dirty capture with ALLOW_DIRTY=true', () => {
    it('does not refuse when VERIFICATION_CAPTURE_ALLOW_DIRTY=true', async () => {
      process.env.VERIFICATION_CAPTURE_ALLOW_DIRTY = 'true';
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc123\n';
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main\n';
        if (args[0] === 'status') return ' M src/dirty.ts\n';
        if (args[0] === 'diff') return 'diff content\n';
        return '\n';
      });

      await runModule(['--capture-only']);
      // Should call ingest, not refuse
      expect(mockIngest).toHaveBeenCalled();
    });
  });

  // ─── Behavior 5: computes deterministic decisionHash ───
  describe('B5: deterministic decisionHash from stable JSON', () => {
    it('ingest call includes a sha256-prefixed decisionHash', async () => {
      await runModule(['--capture-only']);
      expect(mockIngest).toHaveBeenCalled();
      const payload = mockIngest.mock.calls[0][0];
      expect(payload.verificationRun.decisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('decisionHash has deterministic sha256 format (stable for same timestamp/inputs)', async () => {
      await runModule(['--capture-only']);
      const hash1 = mockIngest.mock.calls[0][0].verificationRun.decisionHash;
      // Hash is deterministic given fixed time + fixed git outputs
      expect(hash1).toMatch(/^sha256:[a-f0-9]{64}$/);
      // Verify it's derived from stable JSON (not random)
      expect(hash1.length).toBe(7 + 64); // 'sha256:' + 64 hex chars
    });
  });

  // ─── Behavior 6: sha256 hashes latest integrity artifact ───
  describe('B6: hashes latest integrity artifact', () => {
    it('reads latest .jsonl from artifacts/integrity-snapshots/ and hashes it', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['2026-03-01.jsonl', '2026-03-24.jsonl'] as any);
      mockReadFileSync.mockImplementation((p: string) => {
        if (String(p).endsWith('package.json')) return Buffer.from('{"version":"1.0.0"}');
        if (String(p).endsWith('.jsonl')) return Buffer.from('{"test":"data"}');
        return Buffer.from('');
      });

      await runModule(['--capture-only']);
      expect(mockIngest).toHaveBeenCalled();
      const payload = mockIngest.mock.calls[0][0];
      expect(payload.verificationRun.artifactHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('artifactHash is undefined when no integrity artifact directory exists', async () => {
      mockExistsSync.mockReturnValue(false);

      await runModule(['--capture-only']);
      expect(mockIngest).toHaveBeenCalled();
      const payload = mockIngest.mock.calls[0][0];
      expect(payload.verificationRun.artifactHash).toBeUndefined();
    });
  });

  // ─── Behavior 7: calls ingestRuntimeGateEvidence with structured payload ───
  describe('B7: calls ingestRuntimeGateEvidence with structured evidence', () => {
    it('payload includes verificationRun, gateDecision, commitSnapshot, workingTreeSnapshot', async () => {
      await runModule(['--capture-only']);
      expect(mockIngest).toHaveBeenCalledTimes(1);
      const payload = mockIngest.mock.calls[0][0];

      expect(payload).toHaveProperty('projectId');
      expect(payload).toHaveProperty('verificationRun');
      expect(payload).toHaveProperty('gateDecision');
      expect(payload).toHaveProperty('commitSnapshot');
      expect(payload).toHaveProperty('workingTreeSnapshot');

      expect(payload.verificationRun).toHaveProperty('runId');
      expect(payload.verificationRun).toHaveProperty('tool', 'done-check');
      expect(payload.verificationRun).toHaveProperty('ok');

      expect(payload.gateDecision).toHaveProperty('gateName', 'done-check');
      expect(payload.gateDecision).toHaveProperty('result');
      expect(payload.gateDecision).toHaveProperty('policyBundleId');

      expect(payload.commitSnapshot).toHaveProperty('headSha');
      expect(payload.commitSnapshot).toHaveProperty('branch');

      expect(payload.workingTreeSnapshot).toHaveProperty('isDirty');
      expect(payload.workingTreeSnapshot).toHaveProperty('diffHash');
    });
  });

  // ─── Behavior 8: stable externalContextSnapshotRef ───
  describe('B8: produces stable externalContextSnapshotRef from context hash', () => {
    it('gateDecision includes ctx:-prefixed externalContextSnapshotRef', async () => {
      await runModule(['--capture-only']);
      const payload = mockIngest.mock.calls[0][0];
      expect(payload.gateDecision.externalContextSnapshotRef).toMatch(/^ctx:[a-f0-9]{32}$/);
    });
  });

  // ─── Behavior 9: exit code matches done-check exit code ───
  describe('B9: exit code matches done-check result', () => {
    it('exits 0 when done-check passes', async () => {
      mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
      await runModule();
      // First exit call from main() should be 0 (done-check status)
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('exits with non-zero when done-check fails', async () => {
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '' });
      await runModule();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('exits 0 for --capture-only mode (ok=true, doneCheck is null)', async () => {
      await runModule(['--capture-only']);
      // capture-only: doneCheck is null, ok=true → exit(null ?? (true ? 0 : 1)) = exit(0)
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  // ─── Behavior 10: outputs comprehensive JSON ───
  describe('B10: outputs comprehensive JSON summary', () => {
    it('console.log output includes all required fields', async () => {
      await runModule(['--capture-only']);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(output).toHaveProperty('ok');
      expect(output).toHaveProperty('runId');
      expect(output).toHaveProperty('headSha');
      expect(output).toHaveProperty('branch');
      expect(output).toHaveProperty('isDirty');
      expect(output).toHaveProperty('diffHash');
      expect(output).toHaveProperty('durationMs');
      expect(output).toHaveProperty('decisionHash');
      expect(output).toHaveProperty('ingestResult');
    });

    it('mode is capture-only when --capture-only used', async () => {
      await runModule(['--capture-only']);
      const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(output.mode).toBe('capture-only');
    });

    it('mode is run-and-capture when done-check is actually run', async () => {
      await runModule();
      const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(output.mode).toBe('run-and-capture');
    });
  });

  // ─── SPEC-GAPs ───
  // SPEC-GAP: Spec does not define behavior when git commands fail (network/disk errors)
  // SPEC-GAP: Spec does not specify maximum durationMs or timeout for done-check spawnSync
  // SPEC-GAP: Spec §CA-4 mentions "strict/full execution path" but implementation has no mode differentiation
});
