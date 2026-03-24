// @ts-nocheck
// AUD-TC Audit — B2 (Verification Specialist)
// VS-05: Spec-derived tests for tsc→SARIF converter (parseTscOutput, tscToVerificationBundle)
// Source: src/scripts/entry/scan-and-import.ts

import { describe, it, expect, vi, beforeAll } from 'vitest';

// ─── Mock all side-effect imports BEFORE importing the module ───

// Mock child_process so execSync doesn't run real commands
vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => ''),
}));

// Mock fs so file operations are no-ops
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}));

// Mock dotenv
vi.mock('dotenv/config', () => ({}));

// Mock sarif-importer so it doesn't try to read files
vi.mock('../../../core/verification/sarif-importer.js', () => ({
  importSarifToVerificationBundle: vi.fn(async () => ({
    projectId: 'test',
    verificationRuns: [],
    analysisScopes: [],
    adjudications: [],
    pathWitnesses: [],
  })),
}));

// Mock verification-ingest so it doesn't hit Neo4j
vi.mock('../../../core/verification/verification-ingest.js', () => ({
  ingestVerificationFoundation: vi.fn(async () => ({
    runsUpserted: 0,
    scopesUpserted: 0,
    adjudicationsUpserted: 0,
    pathWitnessesUpserted: 0,
  })),
}));

// Now dynamically import the functions we want to test
let parseTscOutput: (stdout: string) => Array<{ file: string; line: number; col: number; code: string; message: string }>;
let tscToVerificationBundle: (diagnostics: any[], projectId: string) => any;

beforeAll(async () => {
  const mod = await import('../../../scripts/entry/scan-and-import.js');
  parseTscOutput = mod.parseTscOutput;
  tscToVerificationBundle = mod.tscToVerificationBundle;
});

// ─── Test Suite ─────────────────────────────────────────────────────

describe('tsc→SARIF converter audit tests (VS-05)', () => {

  // ─── Behavior 1: Parse standard tsc output line ───
  describe('parseTscOutput — standard line parsing', () => {
    it('parses file, line, col, ruleId, message from a standard tsc error line', () => {
      const output = `src/foo.ts(10,5): error TS2307: Cannot find module 'x'`;
      const result = parseTscOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe('src/foo.ts');
      expect(result[0].line).toBe(10);
      expect(result[0].col).toBe(5);
      expect(result[0].code).toBe('TS2307');
      expect(result[0].message).toBe("Cannot find module 'x'");
    });

    it('parses multiple error lines correctly', () => {
      const output = [
        `src/a.ts(1,1): error TS2304: Cannot find name 'foo'`,
        `src/b.ts(20,15): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`,
      ].join('\n');
      const result = parseTscOutput(output);

      expect(result).toHaveLength(2);
      expect(result[0].file).toBe('src/a.ts');
      expect(result[0].code).toBe('TS2304');
      expect(result[1].file).toBe('src/b.ts');
      expect(result[1].line).toBe(20);
      expect(result[1].col).toBe(15);
      expect(result[1].code).toBe('TS2345');
    });
  });

  // ─── Behavior 2: Single-line format — no continuation ───
  describe('parseTscOutput — single-line format', () => {
    it('ignores non-error lines (continuation lines, blank lines, info messages)', () => {
      const output = [
        `src/foo.ts(10,5): error TS2307: Cannot find module 'x'`,
        `    10 import { thing } from 'x';`,
        `       ~~~~~~~~~~~~~~~~~~~~~~~~~`,
        ``,
        `Found 1 error.`,
      ].join('\n');
      const result = parseTscOutput(output);

      // Only the actual error line is parsed — continuation/context lines are ignored
      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('TS2307');
    });
  });

  // ─── Behavior 3: Zero errors → empty array ───
  describe('parseTscOutput — zero errors', () => {
    it('returns empty array for empty string (tsc exit 0, no output)', () => {
      const result = parseTscOutput('');
      expect(result).toEqual([]);
    });

    it('returns empty array for output with no error lines', () => {
      const result = parseTscOutput('Some informational message\nAnother line\n');
      expect(result).toEqual([]);
    });
  });

  // ─── Behavior 4: --pretty false format (no ANSI codes) ───
  describe('parseTscOutput — --pretty false format', () => {
    it('parses clean --pretty false output without ANSI escape codes', () => {
      // --pretty false produces plain text, no color codes
      const output = `src/core/types.ts(42,10): error TS2339: Property 'name' does not exist on type '{}'.`;
      const result = parseTscOutput(output);

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe('src/core/types.ts');
      expect(result[0].line).toBe(42);
      expect(result[0].col).toBe(10);
    });

    it('does NOT parse lines with ANSI escape codes (--pretty true format)', () => {
      // --pretty true wraps file/line in color codes — our parser expects clean format
      const ansiOutput = `\x1b[96msrc/foo.ts\x1b[0m:\x1b[93m10\x1b[0m:\x1b[93m5\x1b[0m - \x1b[91merror\x1b[0m \x1b[90mTS2307\x1b[0m: Cannot find module 'x'`;
      const result = parseTscOutput(ansiOutput);

      // Pretty-true format uses different syntax (colon-separated, not parenthesized)
      // Our parser only handles --pretty false format
      expect(result).toHaveLength(0);
    });
  });

  // ─── Behavior 5: Fingerprint determinism ───
  describe('tscToVerificationBundle — fingerprint determinism', () => {
    it('produces identical fingerprints for identical inputs across calls', () => {
      const diags = [{ file: 'src/x.ts', line: 5, col: 1, code: 'TS2307', message: 'test' }];
      const bundle1 = tscToVerificationBundle(diags, 'proj_test');
      const bundle2 = tscToVerificationBundle(diags, 'proj_test');

      expect(bundle1.verificationRuns[0].resultFingerprint).toBe(
        bundle2.verificationRuns[0].resultFingerprint,
      );
      expect(bundle1.verificationRuns[0].id).toBe(bundle2.verificationRuns[0].id);
    });

    it('produces different fingerprints for different inputs', () => {
      const diag1 = [{ file: 'src/a.ts', line: 1, col: 1, code: 'TS2307', message: 'x' }];
      const diag2 = [{ file: 'src/b.ts', line: 1, col: 1, code: 'TS2307', message: 'x' }];
      const bundle1 = tscToVerificationBundle(diag1, 'proj_test');
      const bundle2 = tscToVerificationBundle(diag2, 'proj_test');

      expect(bundle1.verificationRuns[0].resultFingerprint).not.toBe(
        bundle2.verificationRuns[0].resultFingerprint,
      );
    });
  });

  // ─── Behavior 6: confidence: 1.0 ───
  describe('tscToVerificationBundle — confidence', () => {
    it('sets confidence to 1.0 for every VR (compiler errors are certain)', () => {
      const diags = [
        { file: 'src/a.ts', line: 1, col: 1, code: 'TS2304', message: 'err1' },
        { file: 'src/b.ts', line: 5, col: 3, code: 'TS2345', message: 'err2' },
      ];
      const bundle = tscToVerificationBundle(diags, 'proj_test');

      for (const vr of bundle.verificationRuns) {
        expect(vr.confidence).toBe(1.0);
      }
    });
  });

  // ─── Behavior 7: tool and status ───
  describe('tscToVerificationBundle — tool and status', () => {
    it('sets tool to "TypeScript" and status to "violates" for every VR', () => {
      const diags = [
        { file: 'src/x.ts', line: 1, col: 1, code: 'TS9999', message: 'test' },
      ];
      const bundle = tscToVerificationBundle(diags, 'proj_test');

      expect(bundle.verificationRuns[0].tool).toBe('TypeScript');
      expect(bundle.verificationRuns[0].status).toBe('violates');
    });

    it('sets ruleId to the TS error code', () => {
      const diags = [
        { file: 'src/x.ts', line: 1, col: 1, code: 'TS2307', message: 'test' },
      ];
      const bundle = tscToVerificationBundle(diags, 'proj_test');

      expect(bundle.verificationRuns[0].ruleId).toBe('TS2307');
    });
  });

  // ─── Behavior 8: Exit code handling (behavioral documentation) ───
  describe('tscToVerificationBundle — exit code semantics', () => {
    it('exit code 2 (errors found): parseTscOutput extracts diagnostics from stdout', () => {
      // When tsc exits with code 2, stdout contains the error lines
      const stdout = `src/foo.ts(10,5): error TS2307: Cannot find module 'x'`;
      const diags = parseTscOutput(stdout);
      expect(diags).toHaveLength(1);
      const bundle = tscToVerificationBundle(diags, 'proj_test');
      expect(bundle.verificationRuns).toHaveLength(1);
    });

    it('exit code 0 (clean): empty stdout → empty bundle', () => {
      // When tsc exits with 0, stdout is empty (no errors)
      const diags = parseTscOutput('');
      expect(diags).toHaveLength(0);
      const bundle = tscToVerificationBundle(diags, 'proj_test');
      expect(bundle.verificationRuns).toHaveLength(0);
      expect(bundle.projectId).toBe('proj_test');
    });

    it('exit code 1 (config error): typically no parseable error lines in stdout', () => {
      // Config errors (bad tsconfig) produce messages like "error TS5023: ..."
      // without a file(line,col) prefix — these are NOT parseable as diagnostics
      const configErrorOutput = `error TS5023: Unknown compiler option 'badOption'.`;
      const diags = parseTscOutput(configErrorOutput);
      // No file(line,col) prefix → not parsed
      expect(diags).toHaveLength(0);
    });
  });

  // ─── Behavior 9: Output from stdout (documentation/behavioral note) ───
  describe('tsc output source — stdout not stderr', () => {
    it('documents that tsc --pretty false sends diagnostics to stdout', () => {
      // This is a behavioral contract note:
      // In scan-and-import.ts, execSync captures stdout (encoding: 'utf-8').
      // On exit code 2 (errors), err.stdout contains the diagnostics.
      // stderr contains nothing useful for --pretty false mode.
      // parseTscOutput operates on the stdout string.
      const stdoutContent = `src/test.ts(1,1): error TS2304: Cannot find name 'x'`;
      const result = parseTscOutput(stdoutContent);
      expect(result).toHaveLength(1);
      expect(result[0].message).toBe("Cannot find name 'x'");
    });
  });

  // ─── Additional: Bundle structure correctness ───
  describe('tscToVerificationBundle — bundle structure', () => {
    it('returns correct bundle shape with empty arrays for non-VR fields', () => {
      const diags = [{ file: 'src/a.ts', line: 1, col: 1, code: 'TS2304', message: 'test' }];
      const bundle = tscToVerificationBundle(diags, 'proj_test');

      expect(bundle.projectId).toBe('proj_test');
      expect(bundle.analysisScopes).toEqual([]);
      expect(bundle.adjudications).toEqual([]);
      expect(bundle.pathWitnesses).toEqual([]);
      expect(bundle.verificationRuns).toHaveLength(1);
    });

    it('sets targetFilePath and startLine/endLine from diagnostics', () => {
      const diags = [{ file: 'src/deep/file.ts', line: 42, col: 7, code: 'TS2339', message: 'prop' }];
      const bundle = tscToVerificationBundle(diags, 'proj_test');
      const vr = bundle.verificationRuns[0];

      expect(vr.targetFilePath).toBe('src/deep/file.ts');
      expect(vr.startLine).toBe(42);
      expect(vr.endLine).toBe(42);
    });

    it('VR id follows the naming convention vr:{projectId}:typescript:{fingerprint}', () => {
      const diags = [{ file: 'src/x.ts', line: 1, col: 1, code: 'TS2304', message: 'test' }];
      const bundle = tscToVerificationBundle(diags, 'proj_abc');
      const vr = bundle.verificationRuns[0];

      expect(vr.id).toMatch(/^vr:proj_abc:typescript:[a-f0-9]+$/);
    });
  });

  // ─── Schema validation: bundle passes VerificationFoundationBundleSchema ───
  describe('tscToVerificationBundle — schema validation', () => {
    it('output passes VerificationFoundationBundleSchema.parse()', async () => {
      const { VerificationFoundationBundleSchema } = await import(
        '../../verification/verification-schema.js'
      );
      const diags = [
        { file: 'src/a.ts', line: 1, col: 1, code: 'TS2304', message: 'err' },
        { file: 'src/b.ts', line: 10, col: 5, code: 'TS2307', message: 'mod' },
      ];
      const bundle = tscToVerificationBundle(diags, 'proj_c0d3e9a1f200');

      // Should not throw
      const parsed = VerificationFoundationBundleSchema.parse(bundle);
      expect(parsed.verificationRuns).toHaveLength(2);
      expect(parsed.projectId).toBe('proj_c0d3e9a1f200');
    });
  });
});
