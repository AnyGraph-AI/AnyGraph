// @ts-nocheck
/**
 * AUD-TC-VS-04: scan-and-import.ts — Behavioral Audit Tests
 *
 * Spec source: plans/audit-tc/domains/AUD-TC-VS.md §VS-04
 * Tests exported converter functions: parseTscOutput, tscToVerificationBundle,
 * npmAuditToVerificationBundle, mapNpmSeverity.
 *
 * The module auto-executes main() on import, so orchestration flow is tested
 * indirectly through the converter functions it calls.
 *
 * Gate: All tests green, ≥15 assertions
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  parseTscOutput,
  tscToVerificationBundle,
  npmAuditToVerificationBundle,
  mapNpmSeverity,
} from '../../../scripts/entry/scan-and-import.js';
import { VerificationFoundationBundleSchema } from '../../verification/verification-schema.js';

const PROJECT_ID = 'proj_test_vs04';

// ─── Helper: reproduce vrHash to verify fingerprints ─────────────────
function vrHash(...parts: Array<string | number | undefined>): string {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 20);
}

// ═══════════════════════════════════════════════════════════════════════
// Behavior 1: parseTscOutput correctly extracts file/line/code/message
// ═══════════════════════════════════════════════════════════════════════

describe('AUD-TC-VS-04 | parseTscOutput', () => {

  it('parses standard tsc --pretty false single-line error', () => {
    const input = `src/foo.ts(10,5): error TS2307: Cannot find module 'bar'`;
    const result = parseTscOutput(input);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/foo.ts');
    expect(result[0].line).toBe(10);
    expect(result[0].col).toBe(5);
    expect(result[0].code).toBe('TS2307');
    expect(result[0].message).toBe("Cannot find module 'bar'");
  });

  it('parses multiple errors from multiline output', () => {
    const input = [
      `src/a.ts(1,1): error TS2345: Argument not assignable`,
      `src/b.ts(20,10): error TS2322: Type mismatch`,
      `src/c.ts(100,3): error TS7006: Parameter implicitly has any type`,
    ].join('\n');
    const result = parseTscOutput(input);
    expect(result).toHaveLength(3);
    expect(result[0].code).toBe('TS2345');
    expect(result[1].file).toBe('src/b.ts');
    expect(result[2].line).toBe(100);
  });

  it('returns empty array for clean (no errors) output', () => {
    const result = parseTscOutput('');
    expect(result).toHaveLength(0);
  });

  it('ignores non-error lines (e.g. "Found X errors")', () => {
    const input = [
      `src/foo.ts(5,1): error TS1005: ';' expected`,
      ``,
      `Found 1 error in src/foo.ts:5`,
    ].join('\n');
    const result = parseTscOutput(input);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('TS1005');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Behavior 2: tscToVerificationBundle produces schema-valid bundles
// ═══════════════════════════════════════════════════════════════════════

describe('AUD-TC-VS-04 | tscToVerificationBundle', () => {

  const sampleDiagnostics = parseTscOutput(
    `src/index.ts(42,7): error TS2307: Cannot find module './missing'`
  );

  it('produces a bundle that passes VerificationFoundationBundleSchema.parse()', () => {
    const bundle = tscToVerificationBundle(sampleDiagnostics, PROJECT_ID);
    const parsed = VerificationFoundationBundleSchema.parse(bundle);
    expect(parsed.projectId).toBe(PROJECT_ID);
  });

  it('sets tool to "TypeScript" and confidence to 1.0', () => {
    const bundle = tscToVerificationBundle(sampleDiagnostics, PROJECT_ID);
    expect(bundle.verificationRuns[0].tool).toBe('TypeScript');
    expect(bundle.verificationRuns[0].confidence).toBe(1.0);
  });

  it('sets status to "violates" and criticality to "high"', () => {
    const bundle = tscToVerificationBundle(sampleDiagnostics, PROJECT_ID);
    expect(bundle.verificationRuns[0].status).toBe('violates');
    expect(bundle.verificationRuns[0].criticality).toBe('high');
  });

  it('maps targetFilePath and startLine from diagnostic', () => {
    const bundle = tscToVerificationBundle(sampleDiagnostics, PROJECT_ID);
    expect(bundle.verificationRuns[0].targetFilePath).toBe('src/index.ts');
    expect(bundle.verificationRuns[0].startLine).toBe(42);
  });

  it('returns empty verificationRuns for zero diagnostics', () => {
    const bundle = tscToVerificationBundle([], PROJECT_ID);
    expect(bundle.verificationRuns).toHaveLength(0);
    // Still schema-valid
    const parsed = VerificationFoundationBundleSchema.parse(bundle);
    expect(parsed.projectId).toBe(PROJECT_ID);
  });

  it('produces idempotent fingerprints — same input → same hash', () => {
    const bundle1 = tscToVerificationBundle(sampleDiagnostics, PROJECT_ID);
    const bundle2 = tscToVerificationBundle(sampleDiagnostics, PROJECT_ID);
    expect(bundle1.verificationRuns[0].resultFingerprint)
      .toBe(bundle2.verificationRuns[0].resultFingerprint);
  });

  it('fingerprint matches vrHash(projectId, "TypeScript", code, file, line)', () => {
    const bundle = tscToVerificationBundle(sampleDiagnostics, PROJECT_ID);
    const expected = vrHash(PROJECT_ID, 'TypeScript', 'TS2307', 'src/index.ts', 42);
    expect(bundle.verificationRuns[0].resultFingerprint).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Behavior 3: mapNpmSeverity correctly maps npm severity → criticality
// ═══════════════════════════════════════════════════════════════════════

describe('AUD-TC-VS-04 | mapNpmSeverity', () => {

  it('maps "critical" → "safety_critical"', () => {
    expect(mapNpmSeverity('critical')).toBe('safety_critical');
  });

  it('maps "high" → "high"', () => {
    expect(mapNpmSeverity('high')).toBe('high');
  });

  it('maps "moderate" → "medium" (npm uses "moderate" not "medium")', () => {
    expect(mapNpmSeverity('moderate')).toBe('medium');
  });

  it('maps "low" → "low"', () => {
    expect(mapNpmSeverity('low')).toBe('low');
  });

  it('maps "info" → "low"', () => {
    expect(mapNpmSeverity('info')).toBe('low');
  });

  it('maps unknown severity → "low" (fallback)', () => {
    expect(mapNpmSeverity('banana')).toBe('low');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Behavior 4: npmAuditToVerificationBundle — parsing + schema validity
// ═══════════════════════════════════════════════════════════════════════

describe('AUD-TC-VS-04 | npmAuditToVerificationBundle', () => {

  const sampleAuditJson = JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {
      'lodash': {
        name: 'lodash',
        severity: 'high',
        isDirect: true,
        via: [
          { source: 1234, url: 'https://github.com/advisories/GHSA-xxxx', severity: 'high', cwe: ['CWE-400'] },
          'underscore',  // plain string (transitive dep name)
        ],
        effects: [],
        range: '<4.17.21',
        nodes: ['node_modules/lodash'],
        fixAvailable: true,
      },
      'minimist': {
        name: 'minimist',
        severity: 'critical',
        isDirect: false,
        via: [
          { source: 5678, url: 'https://github.com/advisories/GHSA-yyyy', severity: 'critical' },
        ],
        effects: ['mkdirp'],
        range: '<1.2.6',
        nodes: ['node_modules/minimist'],
        fixAvailable: { name: 'mkdirp', version: '2.0.0', isSemVerMajor: true },
      },
    },
    metadata: {},
  });

  it('produces a bundle that passes VerificationFoundationBundleSchema.parse()', () => {
    const bundle = npmAuditToVerificationBundle(sampleAuditJson, PROJECT_ID, 'package.json');
    const parsed = VerificationFoundationBundleSchema.parse(bundle);
    expect(parsed.verificationRuns).toHaveLength(2);
  });

  it('maps severity correctly for each vulnerability', () => {
    const bundle = npmAuditToVerificationBundle(sampleAuditJson, PROJECT_ID, 'package.json');
    const lodash = bundle.verificationRuns.find(vr => vr.ruleId?.includes('GHSA-xxxx'));
    const minimist = bundle.verificationRuns.find(vr => vr.ruleId?.includes('GHSA-yyyy'));
    expect(lodash?.criticality).toBe('high');
    expect(minimist?.criticality).toBe('safety_critical');
  });

  it('extracts advisory URL as ruleId from via objects', () => {
    const bundle = npmAuditToVerificationBundle(sampleAuditJson, PROJECT_ID, 'package.json');
    const lodash = bundle.verificationRuns.find(vr => vr.ruleId?.includes('GHSA-xxxx'));
    expect(lodash?.ruleId).toBe('https://github.com/advisories/GHSA-xxxx');
  });

  it('sets tool to "npm-audit" and confidence to 0.9', () => {
    const bundle = npmAuditToVerificationBundle(sampleAuditJson, PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns[0].tool).toBe('npm-audit');
    expect(bundle.verificationRuns[0].confidence).toBe(0.9);
  });

  it('sets targetFilePath from parameter', () => {
    const bundle = npmAuditToVerificationBundle(sampleAuditJson, PROJECT_ID, 'ui/package.json');
    expect(bundle.verificationRuns[0].targetFilePath).toBe('ui/package.json');
  });

  it('returns empty VRs for empty vulnerabilities object', () => {
    const emptyJson = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} });
    const bundle = npmAuditToVerificationBundle(emptyJson, PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns).toHaveLength(0);
  });

  it('handles invalid JSON gracefully (npm error, not findings)', () => {
    const bundle = npmAuditToVerificationBundle('not valid json at all', PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns).toHaveLength(0);
    expect(bundle.projectId).toBe(PROJECT_ID);
  });

  it('handles npm audit exit code 1 output (findings exist, valid JSON)', () => {
    // exit code 1 still produces valid JSON — the function just receives the JSON string
    const findingsJson = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        'express': {
          name: 'express',
          severity: 'moderate',
          isDirect: true,
          via: [{ source: 9999, url: 'https://github.com/advisories/GHSA-zzzz' }],
          effects: [],
          range: '<4.19.0',
          nodes: ['node_modules/express'],
          fixAvailable: false,
        },
      },
    });
    const bundle = npmAuditToVerificationBundle(findingsJson, PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns).toHaveLength(1);
    expect(bundle.verificationRuns[0].criticality).toBe('medium');
  });

  it('produces idempotent fingerprints — same input → same hash', () => {
    const bundle1 = npmAuditToVerificationBundle(sampleAuditJson, PROJECT_ID, 'package.json');
    const bundle2 = npmAuditToVerificationBundle(sampleAuditJson, PROJECT_ID, 'package.json');
    // Fingerprints are based on projectId+tool+pkgName+ruleId, not timestamps
    expect(bundle1.verificationRuns[0].resultFingerprint)
      .toBe(bundle2.verificationRuns[0].resultFingerprint);
    expect(bundle1.verificationRuns[1].resultFingerprint)
      .toBe(bundle2.verificationRuns[1].resultFingerprint);
  });

  it('fingerprint matches vrHash(projectId, "npm-audit", pkgName, ruleId)', () => {
    const bundle = npmAuditToVerificationBundle(sampleAuditJson, PROJECT_ID, 'package.json');
    const expectedLodash = vrHash(PROJECT_ID, 'npm-audit', 'lodash', 'https://github.com/advisories/GHSA-xxxx');
    const lodashVr = bundle.verificationRuns.find(vr => vr.ruleId?.includes('GHSA-xxxx'));
    expect(lodashVr?.resultFingerprint).toBe(expectedLodash);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Behavior 5: All converter bundles pass full schema validation
// ═══════════════════════════════════════════════════════════════════════

describe('AUD-TC-VS-04 | Schema validation round-trip', () => {

  it('tsc bundle with multiple diagnostics passes schema', () => {
    const diags = parseTscOutput([
      `src/a.ts(1,1): error TS2345: Argument mismatch`,
      `src/b.ts(5,3): error TS2307: Cannot find module`,
      `ui/src/c.tsx(10,7): error TS7006: Implicit any`,
    ].join('\n'));
    const bundle = tscToVerificationBundle(diags, PROJECT_ID);
    expect(() => VerificationFoundationBundleSchema.parse(bundle)).not.toThrow();
    expect(bundle.verificationRuns).toHaveLength(3);
  });

  it('npm audit bundle with mixed via types passes schema', () => {
    const json = JSON.stringify({
      vulnerabilities: {
        'glob-parent': {
          name: 'glob-parent',
          severity: 'low',
          isDirect: false,
          via: ['chokidar'],  // all strings, no advisory objects
          effects: ['chokidar'],
          range: '<5.1.2',
          nodes: ['node_modules/glob-parent'],
          fixAvailable: false,
        },
      },
    });
    const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
    expect(() => VerificationFoundationBundleSchema.parse(bundle)).not.toThrow();
    // When all via entries are strings, ruleId falls back to `npm:pkgName`
    expect(bundle.verificationRuns[0].ruleId).toBe('npm:glob-parent');
  });
});
