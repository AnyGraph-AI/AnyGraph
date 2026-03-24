#!/usr/bin/env npx tsx
/**
 * Scan & Import — Automated SARIF Pipeline
 *
 * Runs verification tools against the codebase, imports findings into the verification graph.
 * Tools: Semgrep, ESLint (src + ui), TypeScript (src + ui), npm audit (root + ui)
 * Designed to run as part of done-check or standalone.
 *
 * Usage:
 *   npx tsx src/scripts/entry/scan-and-import.ts
 *   npm run verification:scan
 */

import 'dotenv/config';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';

import { importSarifToVerificationBundle } from '../../core/verification/sarif-importer.js';
import { ingestVerificationFoundation } from '../../core/verification/verification-ingest.js';
import type { VerificationFoundationBundle } from '../../core/verification/verification-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const UI_ROOT = resolve(ROOT, 'ui');

// ─── Shared helpers ────────────────────────────────────────────────

function vrHash(...parts: Array<string | number | undefined>): string {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 20);
}

// ─── tsc → VerificationRun converter (VS-01) ──────────────────────

interface TscDiagnostic {
  file: string;
  line: number;
  col: number;
  code: string;    // e.g. 'TS2307'
  message: string;
}

/**
 * Parse `tsc --noEmit --pretty false` stdout into structured diagnostics.
 * Format: `file(line,col): error TSXXXX: message`
 * Each line is self-contained (no continuation lines in --pretty false mode).
 */
export function parseTscOutput(stdout: string): TscDiagnostic[] {
  const diagnostics: TscDiagnostic[] = [];
  if (!stdout) return diagnostics;
  const lines = stdout.split('\n');
  // Pattern: file(line,col): error TSXXXX: message
  const re = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      diagnostics.push({
        file: m[1],
        line: parseInt(m[2], 10),
        col: parseInt(m[3], 10),
        code: m[4],
        message: m[5],
      });
    }
  }
  return diagnostics;
}

/**
 * Convert tsc diagnostics into a VerificationFoundationBundle for ingestion.
 * Each diagnostic = one VerificationRun with confidence 1.0 (compiler errors are certain).
 */
export function tscToVerificationBundle(
  diagnostics: TscDiagnostic[],
  projectId: string,
): VerificationFoundationBundle {
  const now = new Date().toISOString();
  const verificationRuns: VerificationFoundationBundle['verificationRuns'] = [];

  for (const d of diagnostics) {
    const fingerprint = vrHash(projectId, 'TypeScript', d.code, d.file, d.line);
    const rid = `vr:${projectId}:typescript:${fingerprint}`;

    verificationRuns.push({
      id: rid,
      projectId,
      tool: 'TypeScript',
      status: 'violates',
      criticality: 'high',        // compiler errors are definitive
      confidence: 1.0,             // compiler errors are certain
      evidenceGrade: 'A1',         // machine-verifiable, deterministic
      freshnessTs: now,
      reproducible: true,
      resultFingerprint: fingerprint,
      lifecycleState: 'open',
      firstSeenTs: now,
      lastSeenTs: now,
      ruleId: d.code,
      createdAt: now,
      updatedAt: now,
      targetFilePath: d.file,
      startLine: d.line,
      endLine: d.line,
    });
  }

  return {
    projectId,
    verificationRuns,
    analysisScopes: [],
    adjudications: [],
    pathWitnesses: [],
  };
}

// ─── npm audit → VerificationRun converter (VS-02) ────────────────

/** npm audit JSON shape (vulnerabilities object) */
interface NpmAuditVulnerability {
  name: string;
  severity: string;  // critical, high, moderate, low, info
  isDirect: boolean;
  via: Array<NpmAuditAdvisory | string>;  // mixed types!
  effects: string[];
  range: string;
  nodes: string[];
  fixAvailable: boolean | { name: string; version: string; isSemVerMajor: boolean };
}

interface NpmAuditAdvisory {
  source?: number;
  url?: string;
  severity?: string;
  cwe?: string[];
  cvss?: { score: number; vectorString: string };
  name?: string;
  dependency?: string;
  title?: string;
  range?: string;
}

interface NpmAuditOutput {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
  metadata?: Record<string, unknown>;
}

/**
 * Map npm audit severity to our criticality levels.
 * Note: npm uses "moderate" not "medium".
 */
export function mapNpmSeverity(severity: string): 'low' | 'medium' | 'high' | 'safety_critical' {
  switch (severity.toLowerCase()) {
    case 'critical': return 'safety_critical';
    case 'high': return 'high';
    case 'moderate': return 'medium';
    case 'low': return 'low';
    case 'info': return 'low';
    default: return 'low';
  }
}

/**
 * Extract the best ruleId from a vulnerability's via array.
 * Prefers advisory URLs from object entries; falls back to package name.
 */
function extractRuleId(vuln: NpmAuditVulnerability): string {
  for (const v of vuln.via) {
    if (typeof v === 'object' && v.url) return v.url;
  }
  return `npm:${vuln.name}`;
}

/**
 * Convert npm audit JSON output into a VerificationFoundationBundle.
 * Each vulnerability = one VerificationRun with confidence 0.9.
 */
export function npmAuditToVerificationBundle(
  jsonOutput: string,
  projectId: string,
  targetFile: string,  // 'package.json' or 'ui/package.json'
): VerificationFoundationBundle {
  const now = new Date().toISOString();
  const verificationRuns: VerificationFoundationBundle['verificationRuns'] = [];

  let audit: NpmAuditOutput;
  try {
    audit = JSON.parse(jsonOutput) as NpmAuditOutput;
  } catch {
    // Invalid JSON = npm error, not audit findings
    return { projectId, verificationRuns: [], analysisScopes: [], adjudications: [], pathWitnesses: [] };
  }

  const vulns = audit.vulnerabilities ?? {};

  for (const [pkgName, vuln] of Object.entries(vulns)) {
    const ruleId = extractRuleId(vuln);
    const fingerprint = vrHash(projectId, 'npm-audit', pkgName, ruleId);
    const rid = `vr:${projectId}:npm-audit:${fingerprint}`;

    verificationRuns.push({
      id: rid,
      projectId,
      tool: 'npm-audit',
      status: 'violates',
      criticality: mapNpmSeverity(vuln.severity),
      confidence: 0.9,
      evidenceGrade: 'A2',
      freshnessTs: now,
      reproducible: true,
      resultFingerprint: fingerprint,
      lifecycleState: 'open',
      firstSeenTs: now,
      lastSeenTs: now,
      ruleId,
      createdAt: now,
      updatedAt: now,
      targetFilePath: targetFile,
      startLine: 1,
      endLine: 1,
    });
  }

  return {
    projectId,
    verificationRuns,
    analysisScopes: [],
    adjudications: [],
    pathWitnesses: [],
  };
}

// ─── Orchestration ─────────────────────────────────────────────────

async function main() {
  const projectId = process.argv[2] ?? 'proj_c0d3e9a1f200';

  // ── 1. Semgrep ──
  const sarifPath = resolve(ROOT, 'semgrep-results.sarif');
  console.log('[verification:scan] Running Semgrep...');
  const startSemgrep = Date.now();

  try {
    execSync(
      `semgrep scan --config=auto --sarif --output=${sarifPath} src/`,
      { cwd: ROOT, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (err: any) {
    if (!existsSync(sarifPath)) {
      console.error('[verification:scan] Semgrep failed to produce SARIF output');
      console.error(err.stderr?.toString() ?? err.message);
      // Non-blocking: continue to other tools
    }
  }

  if (existsSync(sarifPath)) {
    console.log(`[verification:scan] Semgrep complete (${Date.now() - startSemgrep}ms)`);
    const semgrepBundle = await importSarifToVerificationBundle({
      sarifPath,
      projectId,
      toolFilter: 'semgrep',
    });
    const semgrepResult = await ingestVerificationFoundation(semgrepBundle);
    console.log(`[verification:scan] Semgrep: ${semgrepResult.runsUpserted} VRs, ${semgrepResult.scopesUpserted} scopes`);
    try { unlinkSync(sarifPath); } catch { /* ignore */ }
  }

  // ── 2. ESLint (src/) ──
  const eslintSarifPath = resolve(ROOT, 'eslint-results.sarif');
  console.log('[verification:scan] Running ESLint (src)...');
  const startEslintSrc = Date.now();

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
    if (!existsSync(eslintSarifPath)) {
      console.warn('[verification:scan] ESLint (src) failed to produce SARIF output, skipping');
    }
  }

  if (existsSync(eslintSarifPath)) {
    console.log(`[verification:scan] ESLint (src) complete (${Date.now() - startEslintSrc}ms)`);
    const eslintBundle = await importSarifToVerificationBundle({
      sarifPath: eslintSarifPath,
      projectId,
      toolFilter: 'any',
    });
    const eslintResult = await ingestVerificationFoundation(eslintBundle);
    console.log(`[verification:scan] ESLint (src): ${eslintResult.runsUpserted} VRs, ${eslintResult.scopesUpserted} scopes`);
    try { unlinkSync(eslintSarifPath); } catch { /* ignore */ }
  }

  // ── 3. ESLint (ui/) — VS-03 ──
  const eslintUiSarifPath = resolve(ROOT, 'eslint-ui-results.sarif');
  console.log('[verification:scan] Running ESLint (ui)...');
  const startEslintUi = Date.now();

  try {
    execSync(
      `npx eslint src/ ` +
      `-f @microsoft/eslint-formatter-sarif -o ${eslintUiSarifPath}`,
      { cwd: UI_ROOT, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } catch (err: any) {
    if (!existsSync(eslintUiSarifPath)) {
      console.warn('[verification:scan] ESLint (ui) failed to produce SARIF output, skipping');
    }
  }

  if (existsSync(eslintUiSarifPath)) {
    console.log(`[verification:scan] ESLint (ui) complete (${Date.now() - startEslintUi}ms)`);
    const eslintUiBundle = await importSarifToVerificationBundle({
      sarifPath: eslintUiSarifPath,
      projectId,
      toolFilter: 'any',
    });
    const eslintUiResult = await ingestVerificationFoundation(eslintUiBundle);
    console.log(`[verification:scan] ESLint (ui): ${eslintUiResult.runsUpserted} VRs, ${eslintUiResult.scopesUpserted} scopes`);
    try { unlinkSync(eslintUiSarifPath); } catch { /* ignore */ }
  }

  // ── 4. TypeScript (src/) — VS-01 ──
  console.log('[verification:scan] Running TypeScript (src)...');
  const startTscSrc = Date.now();

  try {
    let tscSrcOutput = '';
    try {
      const raw = execSync('npx tsc --noEmit --pretty false', {
        cwd: ROOT,
        timeout: 120000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      tscSrcOutput = raw ?? '';
    } catch (err: any) {
      // Exit code 1 = DiagnosticsPresent_OutputsSkipped (errors with --noEmit)
      // Exit code 2 = DiagnosticsPresent_OutputsGenerated (errors with --outDir)
      // Both mean "errors found" — stdout has the diagnostics.
      if (err.status === 1 || err.status === 2) {
        tscSrcOutput = err.stdout?.toString() ?? '';
      } else {
        console.warn(`[verification:scan] TypeScript (src) unexpected exit ${err.status}, skipping`);
      }
    }

    const tscSrcDiags = parseTscOutput(tscSrcOutput);
    if (tscSrcDiags.length > 0 || tscSrcOutput !== '') {
      const tscSrcBundle = tscToVerificationBundle(tscSrcDiags, projectId);
      const tscSrcResult = await ingestVerificationFoundation(tscSrcBundle);
      console.log(`[verification:scan] TypeScript (src): ${tscSrcDiags.length} errors, ${tscSrcResult.runsUpserted} VRs (${Date.now() - startTscSrc}ms)`);
    } else {
      console.log(`[verification:scan] TypeScript (src): clean (${Date.now() - startTscSrc}ms)`);
    }
  } catch (err: any) {
    console.warn(`[verification:scan] TypeScript (src) unexpected error: ${err.message}`);
  }

  // ── 5. TypeScript (ui/) — VS-01 ──
  console.log('[verification:scan] Running TypeScript (ui)...');
  const startTscUi = Date.now();

  try {
    let tscUiOutput = '';
    try {
      const raw = execSync('npx tsc --noEmit --pretty false', {
        cwd: UI_ROOT,
        timeout: 120000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      tscUiOutput = raw ?? '';
    } catch (err: any) {
      if (err.status === 1 || err.status === 2) {
        tscUiOutput = err.stdout?.toString() ?? '';
      } else {
        console.warn(`[verification:scan] TypeScript (ui) unexpected exit ${err.status}, skipping`);
      }
    }

    const tscUiDiags = parseTscOutput(tscUiOutput);
    if (tscUiDiags.length > 0 || tscUiOutput !== '') {
      const tscUiBundle = tscToVerificationBundle(tscUiDiags, projectId);
      const tscUiResult = await ingestVerificationFoundation(tscUiBundle);
      console.log(`[verification:scan] TypeScript (ui): ${tscUiDiags.length} errors, ${tscUiResult.runsUpserted} VRs (${Date.now() - startTscUi}ms)`);
    } else {
      console.log(`[verification:scan] TypeScript (ui): clean (${Date.now() - startTscUi}ms)`);
    }
  } catch (err: any) {
    console.warn(`[verification:scan] TypeScript (ui) unexpected error: ${err.message}`);
  }

  // ── 6. npm audit (root) — VS-02 ──
  console.log('[verification:scan] Running npm audit (root)...');
  const startAuditRoot = Date.now();

  try {
    let auditRootOutput = '';
    try {
      auditRootOutput = execSync('npm audit --json', {
        cwd: ROOT,
        timeout: 60000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      // Exit code 1 = findings exist (expected, not an error)
      auditRootOutput = err.stdout?.toString() ?? '';
    }

    if (auditRootOutput) {
      const auditRootBundle = npmAuditToVerificationBundle(auditRootOutput, projectId, 'package.json');
      const auditRootResult = await ingestVerificationFoundation(auditRootBundle);
      console.log(`[verification:scan] npm audit (root): ${auditRootResult.runsUpserted} VRs (${Date.now() - startAuditRoot}ms)`);
    } else {
      console.log(`[verification:scan] npm audit (root): clean (${Date.now() - startAuditRoot}ms)`);
    }
  } catch (err: any) {
    console.warn(`[verification:scan] npm audit (root) unexpected error: ${err.message}`);
  }

  // ── 7. npm audit (ui/) — VS-02 ──
  console.log('[verification:scan] Running npm audit (ui)...');
  const startAuditUi = Date.now();

  try {
    let auditUiOutput = '';
    try {
      auditUiOutput = execSync('npm audit --json', {
        cwd: UI_ROOT,
        timeout: 60000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      auditUiOutput = err.stdout?.toString() ?? '';
    }

    if (auditUiOutput) {
      const auditUiBundle = npmAuditToVerificationBundle(auditUiOutput, projectId, 'ui/package.json');
      const auditUiResult = await ingestVerificationFoundation(auditUiBundle);
      console.log(`[verification:scan] npm audit (ui): ${auditUiResult.runsUpserted} VRs (${Date.now() - startAuditUi}ms)`);
    } else {
      console.log(`[verification:scan] npm audit (ui): clean (${Date.now() - startAuditUi}ms)`);
    }
  } catch (err: any) {
    console.warn(`[verification:scan] npm audit (ui) unexpected error: ${err.message}`);
  }

  console.log('[verification:scan] All tool passes complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
