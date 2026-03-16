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
  console.log(`[verification:scan] Scan complete (${scanMs}ms)`);

  console.log('[verification:scan] Importing SARIF...');
  const bundle = await importSarifToVerificationBundle({
    sarifPath,
    projectId,
    toolFilter: 'semgrep',
  });

  const result = await ingestVerificationFoundation(bundle);

  console.log(`[verification:scan] Imported: ${result.runsUpserted} VRs, ${result.scopesUpserted} scopes, ${result.adjudicationsUpserted} adjudications, ${result.pathWitnessesUpserted} witnesses (${result.hasScopeEdges} HAS_SCOPE edges)`);

  // Clean up SARIF file
  try { unlinkSync(sarifPath); } catch { /* ignore */ }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
