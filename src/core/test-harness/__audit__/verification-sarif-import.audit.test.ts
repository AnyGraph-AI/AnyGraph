/**
 * AUD-TC-03-L1b-09: verification-sarif-import.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §VG-2
 * "Implement SARIF importer for CodeQL/Semgrep"
 *
 * Role: B6 (Health Witness)
 * Accept: 6 behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockImportSarif, mockIngestFoundation } = vi.hoisted(() => ({
  mockImportSarif: vi.fn(),
  mockIngestFoundation: vi.fn(),
}));

vi.mock('../../../core/verification/sarif-importer.js', () => ({
  importSarifToVerificationBundle: mockImportSarif,
}));

vi.mock('../../../core/verification/verification-ingest.js', () => ({
  ingestVerificationFoundation: mockIngestFoundation,
}));

const originalArgv = [...process.argv];

describe('AUD-TC-03-L1b-09 | verification-sarif-import.ts', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const defaultBundle = {
    projectId: 'proj_test123456',
    verificationRuns: [{ id: 'run1' }],
    analysisScopes: [{ id: 'scope1' }],
    adjudications: [{ id: 'adj1' }],
    pathWitnesses: [{ id: 'pw1' }],
  };

  beforeEach(() => {
    mockImportSarif.mockReset().mockResolvedValue(defaultBundle);
    mockIngestFoundation.mockReset().mockResolvedValue({ ingested: true });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  async function runCLI(args: string[] = []) {
    process.argv = ['node', 'verification-sarif-import.ts', ...args];
    vi.resetModules();
    await import('../../../utils/verification-sarif-import.js');
    await new Promise((r) => setTimeout(r, 100));
  }

  // ─── B1: requires sarifPath + projectId, exits with usage on missing ───
  it('B1a: exits with usage when no sarifPath provided', async () => {
    await runCLI([]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  it('B1b: exits with usage when only sarifPath provided (no projectId)', async () => {
    await runCLI(['/tmp/scan.sarif']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  // ─── B2: accepts optional tool filter (default codeql) ───
  it('B2a: defaults tool filter to codeql', async () => {
    await runCLI(['/tmp/scan.sarif', 'proj_test123456']);
    expect(mockImportSarif).toHaveBeenCalledWith(
      expect.objectContaining({ toolFilter: 'codeql' }),
    );
  });

  it('B2b: accepts custom tool filter from argv[4]', async () => {
    await runCLI(['/tmp/scan.sarif', 'proj_test123456', 'semgrep']);
    expect(mockImportSarif).toHaveBeenCalledWith(
      expect.objectContaining({ toolFilter: 'semgrep' }),
    );
  });

  // ─── B3: resolves SARIF path to absolute ───
  it('B3: resolves SARIF path to absolute', async () => {
    await runCLI(['relative/scan.sarif', 'proj_test123456']);
    const callArg = mockImportSarif.mock.calls[0][0];
    expect(callArg.sarifPath).not.toBe('relative/scan.sarif');
    expect(callArg.sarifPath).toContain('/');
  });

  // ─── B4: calls importSarifToVerificationBundle ───
  it('B4: calls importSarifToVerificationBundle with path/projectId/toolFilter', async () => {
    await runCLI(['/tmp/scan.sarif', 'proj_test123456', 'any']);
    expect(mockImportSarif).toHaveBeenCalledWith({
      sarifPath: '/tmp/scan.sarif',
      projectId: 'proj_test123456',
      toolFilter: 'any',
    });
  });

  // ─── B5: calls ingestVerificationFoundation with bundle ───
  it('B5: calls ingestVerificationFoundation with imported bundle', async () => {
    await runCLI(['/tmp/scan.sarif', 'proj_test123456']);
    expect(mockIngestFoundation).toHaveBeenCalledWith(defaultBundle);
  });

  // ─── B6: outputs JSON with imported counts + ingested result ───
  it('B6: outputs JSON with imported counts and ingested result', async () => {
    await runCLI(['/tmp/scan.sarif', 'proj_test123456']);

    const jsonCall = logSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok"'),
    );
    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0]);
    expect(output).toEqual(
      expect.objectContaining({
        ok: true,
        projectId: 'proj_test123456',
        toolFilter: 'codeql',
        imported: expect.objectContaining({
          runs: 1,
          scopes: 1,
          adjudications: 1,
          pathWitnesses: 1,
        }),
        ingested: { ingested: true },
      }),
    );
  });

  // ─── Error handling ───
  it('exits code 1 + JSON error on import failure', async () => {
    mockImportSarif.mockRejectedValue(new Error('SARIF parse error'));
    await runCLI(['/tmp/scan.sarif', 'proj_test123456']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
