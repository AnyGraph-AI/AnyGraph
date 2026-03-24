// @ts-nocheck
/**
 * VS-06: Spec-derived audit tests for the npm-audit→SARIF converter.
 *
 * Tests npmAuditToVerificationBundle() and mapNpmSeverity() from scan-and-import.ts.
 * Module auto-executes main() on import, so we mock side-effect modules first.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ─── Mock side-effect modules BEFORE dynamic import ────────────────
vi.mock('dotenv/config', () => ({}));
vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  unlinkSync: vi.fn(),
}));
vi.mock('../../../core/verification/sarif-importer.js', () => ({
  importSarifToVerificationBundle: vi.fn(async () => ({
    projectId: '', verificationRuns: [], analysisScopes: [], adjudications: [], pathWitnesses: [],
  })),
}));
vi.mock('../../../core/verification/verification-ingest.js', () => ({
  ingestVerificationFoundation: vi.fn(async () => ({ runsUpserted: 0, scopesUpserted: 0 })),
}));

// ─── Dynamic import to get exported functions ──────────────────────
let npmAuditToVerificationBundle: typeof import('../../../scripts/entry/scan-and-import.js')['npmAuditToVerificationBundle'];
let mapNpmSeverity: typeof import('../../../scripts/entry/scan-and-import.js')['mapNpmSeverity'];

beforeAll(async () => {
  const mod = await import('../../../scripts/entry/scan-and-import.js');
  npmAuditToVerificationBundle = mod.npmAuditToVerificationBundle;
  mapNpmSeverity = mod.mapNpmSeverity;
});

const PROJECT_ID = 'proj_test_vs06';

// Helper: build a minimal npm audit JSON string
function makeAuditJson(vulns: Record<string, any> = {}): string {
  return JSON.stringify({ auditReportVersion: 2, vulnerabilities: vulns, metadata: {} });
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('VS-06: npm-audit→SARIF converter', () => {

  // ── 1. Parses vulnerability object → correct VR fields ──
  it('parses a vulnerability into correct VR fields', () => {
    const json = makeAuditJson({
      lodash: {
        name: 'lodash',
        severity: 'high',
        isDirect: true,
        via: [{ source: 1234, url: 'https://github.com/advisories/GHSA-xxxx', severity: 'high' }],
        effects: [],
        range: '<4.17.21',
        nodes: ['node_modules/lodash'],
        fixAvailable: true,
      },
    });

    const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');

    expect(bundle.verificationRuns).toHaveLength(1);
    const vr = bundle.verificationRuns[0];
    expect(vr.projectId).toBe(PROJECT_ID);
    expect(vr.tool).toBe('npm-audit');
    expect(vr.status).toBe('violates');
    expect(vr.confidence).toBe(0.9);
    expect(vr.criticality).toBe('high');
    expect(vr.ruleId).toBe('https://github.com/advisories/GHSA-xxxx');
    expect(vr.targetFilePath).toBe('package.json');
    expect(vr.startLine).toBe(1);
  });

  // ── 2. Severity mapping ──
  describe('severity mapping', () => {
    it('maps critical → safety_critical', () => {
      expect(mapNpmSeverity('critical')).toBe('safety_critical');
    });
    it('maps high → high', () => {
      expect(mapNpmSeverity('high')).toBe('high');
    });
    it('maps moderate → medium (npm says "moderate")', () => {
      expect(mapNpmSeverity('moderate')).toBe('medium');
    });
    it('maps low → low', () => {
      expect(mapNpmSeverity('low')).toBe('low');
    });
    it('maps info → low', () => {
      expect(mapNpmSeverity('info')).toBe('low');
    });
  });

  // ── 3. fixAvailable variants ──
  describe('fixAvailable handling', () => {
    it('handles fixAvailable: true', () => {
      const json = makeAuditJson({
        pkg1: { name: 'pkg1', severity: 'low', isDirect: true, via: ['dep'], effects: [], range: '*', nodes: [], fixAvailable: true },
      });
      const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
      expect(bundle.verificationRuns).toHaveLength(1);
    });

    it('handles fixAvailable: false', () => {
      const json = makeAuditJson({
        pkg2: { name: 'pkg2', severity: 'moderate', isDirect: false, via: ['dep'], effects: [], range: '*', nodes: [], fixAvailable: false },
      });
      const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
      expect(bundle.verificationRuns).toHaveLength(1);
      expect(bundle.verificationRuns[0].criticality).toBe('medium');
    });

    it('handles fixAvailable as object { name, version, isSemVerMajor }', () => {
      const json = makeAuditJson({
        pkg3: { name: 'pkg3', severity: 'critical', isDirect: true, via: [{ url: 'https://nvd.nist.gov/CVE-2099-0001' }], effects: [], range: '*', nodes: [], fixAvailable: { name: 'pkg3', version: '2.0.0', isSemVerMajor: true } },
      });
      const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
      expect(bundle.verificationRuns).toHaveLength(1);
      expect(bundle.verificationRuns[0].criticality).toBe('safety_critical');
    });
  });

  // ── 4. via[] mixed types ──
  it('handles via[] with mixed advisory objects and plain strings', () => {
    const json = makeAuditJson({
      mixedpkg: {
        name: 'mixedpkg',
        severity: 'high',
        isDirect: true,
        via: [
          { source: 99, url: 'https://github.com/advisories/GHSA-yyyy', severity: 'high', cwe: ['CWE-79'] },
          'transitive-dep-name',
          'another-transitive',
        ],
        effects: ['downstream-pkg'],
        range: '>=1.0.0',
        nodes: ['node_modules/mixedpkg'],
        fixAvailable: true,
      },
    });

    const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns).toHaveLength(1);
    // Should extract URL from advisory object, not from string entries
    expect(bundle.verificationRuns[0].ruleId).toBe('https://github.com/advisories/GHSA-yyyy');
  });

  it('falls back to npm:packageName when via[] has only strings (no advisory URL)', () => {
    const json = makeAuditJson({
      transonly: {
        name: 'transonly',
        severity: 'low',
        isDirect: false,
        via: ['parent-pkg', 'other-parent'],
        effects: [],
        range: '*',
        nodes: [],
        fixAvailable: false,
      },
    });

    const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns).toHaveLength(1);
    expect(bundle.verificationRuns[0].ruleId).toBe('npm:transonly');
  });

  // ── 5. Empty vulnerabilities → empty VR array ──
  it('returns empty VR array for empty vulnerabilities object', () => {
    const json = makeAuditJson({});
    const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns).toHaveLength(0);
    expect(bundle.projectId).toBe(PROJECT_ID);
  });

  // ── 6. Invalid JSON → empty bundle (not crash) ──
  it('returns empty bundle for invalid JSON (does not crash)', () => {
    const bundle = npmAuditToVerificationBundle('NOT VALID JSON {{{', PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns).toHaveLength(0);
    expect(bundle.projectId).toBe(PROJECT_ID);
  });

  it('returns empty bundle for completely empty string', () => {
    const bundle = npmAuditToVerificationBundle('', PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns).toHaveLength(0);
  });

  // ── 7. Fingerprint determinism ──
  it('produces deterministic fingerprint for same package+advisory', () => {
    const json = makeAuditJson({
      detpkg: {
        name: 'detpkg',
        severity: 'high',
        isDirect: true,
        via: [{ url: 'https://example.com/advisory/1' }],
        effects: [], range: '*', nodes: [],
        fixAvailable: false,
      },
    });

    const bundle1 = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
    const bundle2 = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');

    expect(bundle1.verificationRuns[0].resultFingerprint).toBe(
      bundle2.verificationRuns[0].resultFingerprint,
    );
    expect(bundle1.verificationRuns[0].id).toBe(bundle2.verificationRuns[0].id);
  });

  // ── 8. confidence: 0.9 and tool: 'npm-audit' on every VR ──
  it('sets confidence 0.9 and tool npm-audit on all VRs', () => {
    const json = makeAuditJson({
      a: { name: 'a', severity: 'low', isDirect: true, via: ['x'], effects: [], range: '*', nodes: [], fixAvailable: true },
      b: { name: 'b', severity: 'critical', isDirect: false, via: ['y'], effects: [], range: '*', nodes: [], fixAvailable: false },
    });

    const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
    expect(bundle.verificationRuns).toHaveLength(2);
    for (const vr of bundle.verificationRuns) {
      expect(vr.confidence).toBe(0.9);
      expect(vr.tool).toBe('npm-audit');
    }
  });

  // ── Schema validation: output passes VerificationFoundationBundleSchema ──
  it('output passes VerificationFoundationBundleSchema.parse()', async () => {
    const { VerificationFoundationBundleSchema } = await import('../../../core/verification/verification-schema.js');
    const json = makeAuditJson({
      schemapkg: {
        name: 'schemapkg',
        severity: 'moderate',
        isDirect: true,
        via: [{ url: 'https://example.com/adv/2', severity: 'moderate' }],
        effects: [], range: '*', nodes: [],
        fixAvailable: true,
      },
    });

    const bundle = npmAuditToVerificationBundle(json, PROJECT_ID, 'package.json');
    // Should not throw
    const parsed = VerificationFoundationBundleSchema.parse(bundle);
    expect(parsed.verificationRuns).toHaveLength(1);
  });
});
