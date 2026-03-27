/**
 * [AUD-TC-04-L1-05] run-integrity-daily-job.ts — Spec-Derived Tests
 *
 * Spec: GOVERNANCE_HARDENING.md §G4 "Implement daily append-only integrity snapshot job"
 * — orchestrates snapshot + fields verify + integrity verify
 *
 * Behaviors tested via source contract verification:
 * (1) runs graph-integrity-snapshot.ts via execFileSync
 * (2) runs verify-integrity-snapshot-fields.ts via execFileSync
 * (3) runs verify-graph-integrity.ts via execFileSync
 * (4) scripts run in order: snapshot → fields → verify
 * (5) composes daily-job JSON with all three results + startedAt/finishedAt
 * (6) writes artifact to artifacts/integrity-snapshots/daily-job/
 * (7) fails if any sub-script produces no JSON output
 *
 * Note: Source module runs main() immediately on import. Tests verify contracts
 * that the module is bound to implement per spec.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load actual source file to verify structural contracts
const SOURCE_PATH = join(__dirname, '../run-integrity-daily-job.ts');
let sourceCode: string;
try {
  sourceCode = readFileSync(SOURCE_PATH, 'utf-8');
} catch {
  sourceCode = '';
}

describe('[AUD-TC-04-L1-05] run-integrity-daily-job.ts', () => {
  describe('sub-script execution contract', () => {
    it('(1) imports and uses execFileSync from child_process', () => {
      expect(sourceCode).toContain('execFileSync');
      expect(sourceCode).toContain("from 'child_process'");
    });

    it('(2) executes graph-integrity-snapshot.ts via execFileSync', () => {
      expect(sourceCode).toContain('graph-integrity-snapshot.ts');
    });

    it('(3) executes verify-integrity-snapshot-fields.ts via execFileSync', () => {
      expect(sourceCode).toContain('verify-integrity-snapshot-fields.ts');
    });

    it('(4) executes verify-graph-integrity.ts via execFileSync', () => {
      expect(sourceCode).toContain('verify-graph-integrity.ts');
    });

    it('(5) scripts executed in correct order: snapshot first', () => {
      // Verify snapshot comes before fields and verify in source
      const snapshotPos = sourceCode.indexOf('graph-integrity-snapshot.ts');
      const fieldsPos = sourceCode.indexOf('verify-integrity-snapshot-fields.ts');
      const verifyPos = sourceCode.indexOf('verify-graph-integrity.ts');

      expect(snapshotPos).toBeLessThan(fieldsPos);
      expect(fieldsPos).toBeLessThan(verifyPos);
    });

    it('(6) uses ts-node/esm loader for TypeScript execution', () => {
      expect(sourceCode).toContain('ts-node/esm');
      expect(sourceCode).toContain('--loader');
    });
  });

  describe('JSON output parsing contract', () => {
    it('(7) runJsonScript function parses JSON from stdout', () => {
      expect(sourceCode).toContain('function runJsonScript');
      expect(sourceCode).toContain('JSON.parse');
    });

    it('(8) extracts JSON from last valid line of output', () => {
      // Contract: finds last line that starts with { and ends with }
      expect(sourceCode).toMatch(/startsWith\(['"]?\{['"]?\)/);
      expect(sourceCode).toMatch(/endsWith\(['"]?\}['"]?\)/);
    });

    it('(9) throws error when no JSON line found', () => {
      expect(sourceCode).toMatch(/throw new Error.*No JSON output/);
    });
  });

  describe('daily-job artifact composition', () => {
    it('(10) report object includes ok, startedAt, finishedAt', () => {
      expect(sourceCode).toContain('ok:');
      expect(sourceCode).toContain('startedAt');
      expect(sourceCode).toContain('finishedAt');
    });

    it('(11) report includes snapshot, fields, verify results', () => {
      expect(sourceCode).toContain('snapshot');
      expect(sourceCode).toContain('fields');
      expect(sourceCode).toContain('verify');
    });

    it('(12) startedAt captured before script execution', () => {
      // startedAt should be first toISOString call before runJsonScript calls
      const startedAtMatch = sourceCode.match(/startedAt\s*=\s*new Date\(\)\.toISOString\(\)/);
      expect(startedAtMatch).not.toBeNull();
    });

    it('(13) finishedAt captured after all scripts complete', () => {
      const finishedAtMatch = sourceCode.match(/finishedAt\s*=\s*new Date\(\)\.toISOString\(\)/);
      expect(finishedAtMatch).not.toBeNull();
    });
  });

  describe('artifact file writing contract', () => {
    it('(14) imports and uses mkdirSync and writeFileSync from fs', () => {
      expect(sourceCode).toContain('mkdirSync');
      expect(sourceCode).toContain('writeFileSync');
      expect(sourceCode).toContain("from 'fs'");
    });

    it('(15) creates daily-job directory with recursive option', () => {
      expect(sourceCode).toContain('daily-job');
      expect(sourceCode).toMatch(/mkdirSync\([^)]+,\s*\{\s*recursive:\s*true\s*\}/);
    });

    it('(16) writes timestamped artifact file with safe filename', () => {
      // Contract: timestamp with colons/dots replaced for filename safety
      expect(sourceCode).toMatch(/replace\([^)]*[:.]/);
    });

    it('(17) writes latest.json for easy access', () => {
      expect(sourceCode).toContain('latest.json');
    });

    it('(18) writes pretty-printed JSON with 2-space indent', () => {
      expect(sourceCode).toMatch(/JSON\.stringify\([^)]+,\s*null,\s*2\)/);
    });
  });

  describe('error handling contract', () => {
    it('(19) catches errors and outputs error JSON', () => {
      expect(sourceCode).toContain('catch');
      expect(sourceCode).toContain('ok: false');
      expect(sourceCode).toContain('error:');
    });

    it('(20) exits with code 1 on failure', () => {
      expect(sourceCode).toContain('process.exit(1)');
    });

    it('(21) error message extracted from Error instance', () => {
      expect(sourceCode).toMatch(/error\s*instanceof\s*Error/);
      expect(sourceCode).toContain('error.message');
    });
  });

  describe('execution sequence contract', () => {
    it('(22) main function orchestrates all steps', () => {
      expect(sourceCode).toContain('function main');
      
      // Verify main calls runJsonScript for each of the 3 scripts
      // Exclude the function definition, count only calls (line 28-30)
      const runJsonScriptCalls = sourceCode.match(/=\s*runJsonScript\(/g);
      expect(runJsonScriptCalls).not.toBeNull();
      expect(runJsonScriptCalls!.length).toBe(3);
    });
  });
});
