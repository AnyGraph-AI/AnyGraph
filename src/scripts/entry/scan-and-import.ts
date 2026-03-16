#!/usr/bin/env npx tsx
/**
 * Scan & Import — Automated SARIF Pipeline
 *
 * Runs Semgrep against the codebase, imports findings into the verification graph.
 * Designed to run as part of done-check or standalone.
 *
 * Usage:
 *   npx tsx src/scripts/entry/scan-and-import.ts
 *   npm run verification:scan
 */

import 'dotenv/config';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';

import { importSarifToVerificationBundle } from '../../core/verification/sarif-importer.js';
import { ingestVerificationFoundation } from '../../core/verification/verification-ingest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

async function main() {
  const projectId = process.argv[2] ?? 'proj_c0d3e9a1f200';
  const sarifPath = resolve(ROOT, 'semgrep-results.sarif');

  console.log('[verification:scan] Running Semgrep...');
  const startScan = Date.now();

  try {
    execSync(
      `semgrep scan --config=auto --sarif --output=${sarifPath} src/`,
      { cwd: ROOT, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (err: any) {
    // Semgrep exits non-zero when it finds issues — that's expected
    if (!existsSync(sarifPath)) {
      console.error('[verification:scan] Semgrep failed to produce SARIF output');
      console.error(err.stderr?.toString() ?? err.message);
      process.exit(1);
    }
  }

  const scanMs = Date.now() - startScan;
  console.log(`[verification:scan] Semgrep complete (${scanMs}ms)`);

  console.log('[verification:scan] Importing Semgrep SARIF...');
  const semgrepBundle = await importSarifToVerificationBundle({
    sarifPath,
    projectId,
    toolFilter: 'semgrep',
  });

  const semgrepResult = await ingestVerificationFoundation(semgrepBundle);
  console.log(`[verification:scan] Semgrep: ${semgrepResult.runsUpserted} VRs, ${semgrepResult.scopesUpserted} scopes`);

  // Clean up Semgrep SARIF
  try { unlinkSync(sarifPath); } catch { /* ignore */ }

  // --- ESLint scan ---
  const eslintSarifPath = resolve(ROOT, 'eslint-results.sarif');
  console.log('[verification:scan] Running ESLint...');
  const startEslint = Date.now();

  try {
    execSync(
      `npx eslint src/ ` +
      `--rule 'prettier/prettier: off' ` +
      `--rule 'prefer-arrow/prefer-arrow-functions: off' ` +
      `--rule 'import/order: off' ` +
      `--rule '@typescript-eslint/prefer-nullish-coalescing: off' ` +
      `--rule '@typescript-eslint/prefer-optional-chain: off' ` +
      `-f @microsoft/eslint-formatter-sarif -o ${eslintSarifPath}`,
      { cwd: ROOT, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (err: any) {
    // ESLint exits non-zero when it finds issues — expected
    if (!existsSync(eslintSarifPath)) {
      console.warn('[verification:scan] ESLint failed to produce SARIF output, skipping');
    }
  }

  if (existsSync(eslintSarifPath)) {
    const eslintMs = Date.now() - startEslint;
    console.log(`[verification:scan] ESLint complete (${eslintMs}ms)`);

    console.log('[verification:scan] Importing ESLint SARIF...');
    const eslintBundle = await importSarifToVerificationBundle({
      sarifPath: eslintSarifPath,
      projectId,
      toolFilter: 'any',
    });

    const eslintResult = await ingestVerificationFoundation(eslintBundle);
    console.log(`[verification:scan] ESLint: ${eslintResult.runsUpserted} VRs, ${eslintResult.scopesUpserted} scopes`);

    // Clean up ESLint SARIF
    try { unlinkSync(eslintSarifPath); } catch { /* ignore */ }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
