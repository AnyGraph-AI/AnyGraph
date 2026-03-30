// Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §7, §19
//
// AUD-TC-05 Agent C1 — Entry Points Audit: scan-and-import.ts (L1-08)
//
// Spec-derived tests for:
//   L1-08: scan-and-import.ts (467 lines) — 8+ behavioral assertions
//
// Behaviors tested:
//   (1) parseTscOutput parses TypeScript diagnostics from tsc --noEmit output
//   (2) parseTscOutput returns empty array on empty/no-match input
//   (3) tscToVerificationBundle converts diagnostics to VerificationFoundationBundle
//   (4) mapNpmSeverity maps npm audit severity strings to internal criticality levels
//   (5) npmAuditToVerificationBundle converts npm audit JSON to VerificationFoundationBundle
//   (6) npmAuditToVerificationBundle handles invalid JSON without throwing
//   (7) main() runs Semgrep via execSync and calls importSarifToVerificationBundle when SARIF exists
//   (8) main() calls ingestVerificationFoundation after importSarifToVerificationBundle
//   (9) main() cleans up the SARIF file via unlinkSync after processing
//  (10) main() handles Semgrep execSync failure gracefully (no SARIF → non-blocking, continues)
//  (11) main() skips SARIF processing when execSync fails and SARIF is not produced

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Stable mock fn instances ─────────────────────────────────────────────────

const mockExecSync = vi.fn();
const mockExistsSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockImportSarif = vi.fn();
const mockIngestFoundation = vi.fn();

// ─── Module-level mocks (hoisted) ─────────────────────────────────────────────

vi.mock('dotenv/config', () => ({}));

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../../../core/verification/sarif-importer.js', () => ({
  importSarifToVerificationBundle: (...args: unknown[]) => mockImportSarif(...args),
}));

vi.mock('../../../core/verification/verification-ingest.js', () => ({
  ingestVerificationFoundation: (...args: unknown[]) => mockIngestFoundation(...args),
}));

// ─── Default mock behaviours (no-op, keeps main() silent) ─────────────────────

function setDefaultMocks() {
  mockExecSync.mockReturnValue('');
  mockExistsSync.mockReturnValue(false);
  mockUnlinkSync.mockReturnValue(undefined);
  mockImportSarif.mockResolvedValue({
    projectId: 'proj_test',
    verificationRuns: [],
    analysisScopes: [],
    adjudications: [],
    pathWitnesses: [],
  });
  mockIngestFoundation.mockResolvedValue({ runsUpserted: 0, scopesUpserted: 0 });
}

// Helper: flush microtasks so that main()'s async body settles after import
async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
}

// ─── Static import for exported-function tests ────────────────────────────────
// main() fires on import; mocks above silence all side effects.

setDefaultMocks();

// These are imported at module eval time after mocks are registered.
const {
  parseTscOutput,
  tscToVerificationBundle,
  mapNpmSeverity,
  npmAuditToVerificationBundle,
} = await import('../scan-and-import.js');

// ─── Tests for exported pure/converter functions ──────────────────────────────

describe('parseTscOutput', () => {
  it('returns empty array for empty string input', () => {
    const result = parseTscOutput('');
    expect(result).toEqual([]);
  });

  it('parses a valid tsc diagnostic line into structured fields', () => {
    const line = 'src/foo/bar.ts(12,5): error TS2307: Cannot find module \'./baz\'';
    const result = parseTscOutput(line);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/foo/bar.ts');
    expect(result[0].line).toBe(12);
    expect(result[0].col).toBe(5);
    expect(result[0].code).toBe('TS2307');
    expect(result[0].message).toBe("Cannot find module './baz'");
  });

  it('ignores lines that do not match the tsc error format', () => {
    const input = [
      'Found 3 errors in 2 files.',
      '',
      'Errors  Files',
      '     1  src/foo.ts',
    ].join('\n');
    const result = parseTscOutput(input);
    expect(result).toEqual([]);
  });

  it('parses multiple diagnostic lines from a single output blob', () => {
    const input = [
      'src/a.ts(1,1): error TS2304: Cannot find name \'x\'',
      'src/b.ts(20,8): error TS2345: Argument of type \'number\' is not assignable',
    ].join('\n');
    const result = parseTscOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0].code).toBe('TS2304');
    expect(result[1].code).toBe('TS2345');
  });
});

describe('tscToVerificationBundle', () => {
  it('returns a bundle with empty verificationRuns for zero diagnostics', () => {
    const bundle = tscToVerificationBundle([], 'proj_abc');
    expect(bundle.projectId).toBe('proj_abc');
    expect(bundle.verificationRuns).toHaveLength(0);
    expect(bundle.analysisScopes).toHaveLength(0);
  });

  it('converts a diagnostic to a VerificationRun with correct shape', () => {
    const diag = { file: 'src/x.ts', line: 5, col: 3, code: 'TS2307', message: 'Module not found' };
    const bundle = tscToVerificationBundle([diag], 'proj_xyz');
    expect(bundle.verificationRuns).toHaveLength(1);
    const vr = bundle.verificationRuns[0];
    expect(vr.tool).toBe('TypeScript');
    expect(vr.status).toBe('violates');
    expect(vr.criticality).toBe('high');
    expect(vr.confidence).toBe(1.0);
    expect(vr.evidenceGrade).toBe('A1');
    expect(vr.ruleId).toBe('TS2307');
    expect(vr.targetFilePath).toBe('src/x.ts');
    expect(vr.startLine).toBe(5);
    expect(vr.projectId).toBe('proj_xyz');
    expect(vr.resultFingerprint).toBeTruthy();
  });
});

describe('mapNpmSeverity', () => {
  it.each([
    ['critical', 'safety_critical'],
    ['high', 'high'],
    ['moderate', 'medium'],
    ['low', 'low'],
    ['info', 'low'],
    ['unknown-value', 'low'],
  ])('maps "%s" → "%s"', (input, expected) => {
    expect(mapNpmSeverity(input)).toBe(expected);
  });
});

describe('npmAuditToVerificationBundle', () => {
  it('returns empty bundle for invalid JSON', () => {
    const bundle = npmAuditToVerificationBundle('not-json', 'proj_p', 'package.json');
    expect(bundle.verificationRuns).toHaveLength(0);
    expect(bundle.projectId).toBe('proj_p');
  });

  it('converts a vulnerability entry to a VerificationRun', () => {
    const auditJson = JSON.stringify({
      vulnerabilities: {
        'some-pkg': {
          name: 'some-pkg',
          severity: 'high',
          isDirect: true,
          via: [{ url: 'https://example.com/advisory/123', severity: 'high' }],
          effects: [],
          range: '>=1.0.0',
          nodes: [],
          fixAvailable: false,
        },
      },
    });
    const bundle = npmAuditToVerificationBundle(auditJson, 'proj_p', 'package.json');
    expect(bundle.verificationRuns).toHaveLength(1);
    const vr = bundle.verificationRuns[0];
    expect(vr.tool).toBe('npm-audit');
    expect(vr.status).toBe('violates');
    expect(vr.criticality).toBe('high');
    expect(vr.confidence).toBe(0.9);
    expect(vr.evidenceGrade).toBe('A2');
    expect(vr.targetFilePath).toBe('package.json');
    expect(vr.ruleId).toBe('https://example.com/advisory/123');
  });

  it('returns empty bundle when vulnerabilities object is empty', () => {
    const auditJson = JSON.stringify({ vulnerabilities: {} });
    const bundle = npmAuditToVerificationBundle(auditJson, 'proj_q', 'ui/package.json');
    expect(bundle.verificationRuns).toHaveLength(0);
  });
});

// ─── main() orchestration tests (dynamic import after vi.resetModules) ────────

describe('main() orchestration — Semgrep pipeline', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockUnlinkSync.mockReset();
    mockImportSarif.mockReset();
    mockIngestFoundation.mockReset();
  });

  it('runs Semgrep via execSync with --sarif flag and calls importSarifToVerificationBundle when SARIF file exists', async () => {
    // execSync succeeds, SARIF file appears after scan
    mockExecSync.mockReturnValue('');
    mockExistsSync.mockImplementation((p: string) => p.endsWith('semgrep-results.sarif'));
    mockImportSarif.mockResolvedValue({
      projectId: 'proj_c0d3e9a1f200',
      verificationRuns: [{ id: 'vr:1' }],
      analysisScopes: [],
      adjudications: [],
      pathWitnesses: [],
    });
    mockIngestFoundation.mockResolvedValue({ runsUpserted: 1, scopesUpserted: 0 });

    await import('../scan-and-import.js');
    await flushPromises();

    const semgrepCall = mockExecSync.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('semgrep'),
    );
    expect(semgrepCall).toBeDefined();
    expect(semgrepCall![0]).toMatch(/--sarif/);

    expect(mockImportSarif).toHaveBeenCalledWith(
      expect.objectContaining({ toolFilter: 'semgrep' }),
    );
  });

  it('calls ingestVerificationFoundation with the bundle returned by importSarifToVerificationBundle', async () => {
    const fakeBundle = {
      projectId: 'proj_c0d3e9a1f200',
      verificationRuns: [{ id: 'vr:abc' }],
      analysisScopes: [],
      adjudications: [],
      pathWitnesses: [],
    };
    mockExecSync.mockReturnValue('');
    mockExistsSync.mockImplementation((p: string) => p.endsWith('semgrep-results.sarif'));
    mockImportSarif.mockResolvedValue(fakeBundle);
    mockIngestFoundation.mockResolvedValue({ runsUpserted: 1, scopesUpserted: 0 });

    await import('../scan-and-import.js');
    await flushPromises();

    expect(mockIngestFoundation).toHaveBeenCalledWith(fakeBundle);
  });

  it('cleans up the SARIF file via unlinkSync after processing', async () => {
    mockExecSync.mockReturnValue('');
    mockExistsSync.mockImplementation((p: string) => p.endsWith('semgrep-results.sarif'));
    mockImportSarif.mockResolvedValue({
      projectId: 'proj_c0d3e9a1f200',
      verificationRuns: [],
      analysisScopes: [],
      adjudications: [],
      pathWitnesses: [],
    });
    mockIngestFoundation.mockResolvedValue({ runsUpserted: 0, scopesUpserted: 0 });

    await import('../scan-and-import.js');
    await flushPromises();

    const unlinkCalls = mockUnlinkSync.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(unlinkCalls.some((p) => p.endsWith('semgrep-results.sarif'))).toBe(true);
  });

  it('handles Semgrep execSync failure gracefully — no SARIF produced, no importSarif called', async () => {
    // execSync throws (binary not found or scan error) AND no SARIF file on disk
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('semgrep')) {
        const err: NodeJS.ErrnoException = Object.assign(new Error('command not found: semgrep'), {
          stderr: Buffer.from('command not found: semgrep'),
          status: 127,
        });
        throw err;
      }
      return '';
    });
    mockExistsSync.mockReturnValue(false);
    mockImportSarif.mockResolvedValue({
      projectId: 'proj_c0d3e9a1f200',
      verificationRuns: [],
      analysisScopes: [],
      adjudications: [],
      pathWitnesses: [],
    });
    mockIngestFoundation.mockResolvedValue({ runsUpserted: 0, scopesUpserted: 0 });

    // Should not throw — main() catches execSync errors
    await expect(import('../scan-and-import.js')).resolves.toBeDefined();
    await flushPromises();

    // importSarif should NOT have been called with semgrep toolFilter
    const semgrepImportCall = mockImportSarif.mock.calls.find(
      (c: unknown[]) =>
        c[0] !== null &&
        typeof c[0] === 'object' &&
        (c[0] as Record<string, unknown>)['toolFilter'] === 'semgrep',
    );
    expect(semgrepImportCall).toBeUndefined();
  });

  it('skips Semgrep ingest entirely when SARIF file does not exist after scan attempt', async () => {
    mockExecSync.mockReturnValue('');
    // SARIF never appears
    mockExistsSync.mockReturnValue(false);
    mockImportSarif.mockResolvedValue({
      projectId: 'proj_c0d3e9a1f200',
      verificationRuns: [],
      analysisScopes: [],
      adjudications: [],
      pathWitnesses: [],
    });
    mockIngestFoundation.mockResolvedValue({ runsUpserted: 0, scopesUpserted: 0 });

    await import('../scan-and-import.js');
    await flushPromises();

    // importSarif called zero times with semgrep toolFilter
    const semgrepImportCalls = mockImportSarif.mock.calls.filter(
      (c: unknown[]) =>
        c[0] !== null &&
        typeof c[0] === 'object' &&
        (c[0] as Record<string, unknown>)['toolFilter'] === 'semgrep',
    );
    expect(semgrepImportCalls).toHaveLength(0);
  });
});
