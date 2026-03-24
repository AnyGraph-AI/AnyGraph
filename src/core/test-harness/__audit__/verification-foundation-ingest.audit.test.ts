/**
 * AUD-TC-03-L1b-05: verification-foundation-ingest.ts — Behavioral Audit Tests
 *
 * Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §VG-2
 * SARIF importer + verification ingestion
 *
 * Role: B6 (Health Witness)
 * Accept: 6 behavioral assertions, all green
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockIngest, mockParse, mockReadFile } = vi.hoisted(() => ({
  mockIngest: vi.fn(),
  mockParse: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock('../../../core/verification/index.js', () => ({
  VerificationFoundationBundleSchema: { parse: mockParse },
  ingestVerificationFoundation: mockIngest,
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

const originalArgv = [...process.argv];

describe('AUD-TC-03-L1b-05 | verification-foundation-ingest.ts', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const sampleBundle = {
    projectId: 'proj_test123456',
    verificationRuns: [],
    analysisScopes: [],
    adjudications: [],
  };

  beforeEach(() => {
    mockReadFile.mockReset().mockResolvedValue(JSON.stringify(sampleBundle));
    mockParse.mockReset().mockImplementation((x: any) => x);
    mockIngest.mockReset().mockResolvedValue({ count: 3 });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  async function runCLI(args: string[] = []) {
    process.argv = ['node', 'verification-foundation-ingest.ts', ...args];
    vi.resetModules();
    await import('../../../utils/verification-foundation-ingest.js');
    await new Promise((r) => setTimeout(r, 100));
  }

  // ─── B1: requires inputPath from argv[2] (exits with usage if missing) ───
  it('B1: exits with usage message when no inputPath provided', async () => {
    await runCLI([]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
  });

  // ─── B2: resolves path to absolute, reads and parses JSON ───
  it('B2: resolves path to absolute and reads file', async () => {
    await runCLI(['/tmp/test-bundle.json']);
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('test-bundle.json'),
      'utf8',
    );
  });

  // ─── B3: validates bundle with Zod VerificationFoundationBundleSchema ───
  it('B3: validates bundle through Zod schema parse', async () => {
    await runCLI(['/tmp/test-bundle.json']);
    expect(mockParse).toHaveBeenCalledWith(sampleBundle);
  });

  it('B3b: Zod validation rejection causes error exit', async () => {
    mockParse.mockImplementation(() => {
      throw new Error('Zod validation failed: invalid field');
    });
    await runCLI(['/tmp/bad-bundle.json']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // ─── B4: calls ingestVerificationFoundation with parsed bundle ───
  it('B4: calls ingestVerificationFoundation with validated bundle', async () => {
    const bundle = { projectId: 'proj_x', verificationRuns: [{ id: 'run1' }] };
    mockReadFile.mockResolvedValue(JSON.stringify(bundle));
    mockParse.mockReturnValue(bundle);
    await runCLI(['/tmp/test-bundle.json']);
    expect(mockIngest).toHaveBeenCalledWith(bundle);
  });

  // ─── B5: outputs JSON with ok/input/projectId/result on success ───
  it('B5: outputs JSON with ok/input/projectId/result on success', async () => {
    mockIngest.mockResolvedValue({ count: 3 });
    await runCLI(['/tmp/test-bundle.json']);

    const jsonCall = logSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok"'),
    );
    expect(jsonCall).toBeDefined();
    const output = JSON.parse(jsonCall![0]);
    expect(output).toEqual(
      expect.objectContaining({
        ok: true,
        projectId: 'proj_test123456',
        result: { count: 3 },
      }),
    );
    expect(output.input).toBeDefined();
  });

  // ─── B6: exits with code 1 on error ───
  it('B6: exits code 1 + JSON error on ingest failure', async () => {
    mockIngest.mockRejectedValue(new Error('Ingest failed'));
    await runCLI(['/tmp/test-bundle.json']);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errCall = errSpy.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('"ok":false'),
    );
    expect(errCall).toBeDefined();
  });
});
