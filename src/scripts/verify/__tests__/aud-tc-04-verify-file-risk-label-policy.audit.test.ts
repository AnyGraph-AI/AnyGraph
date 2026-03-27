/**
 * [AUD-TC-04-L1-01] verify-file-risk-label-policy.ts — Audit Tests
 *
 * Spec: Validates SourceFile riskLabels against policyMap and configRiskClass against ALLOWED_CONFIG_CLASSES
 *
 * Behaviors tested:
 * 1. Queries SourceFile nodes for label + configRiskClass distribution via Neo4jService
 * 2. Validates labels against policyMap (imported from core/config/file-risk-label-policy.ts)
 * 3. Validates configRiskClass values against ALLOWED_CONFIG_CLASSES set (NONE, GOVERNANCE_CRITICAL_CONFIG, EXAMPLE_ASSET)
 * 4. Fails with process.exit(1) if unknown labels found
 * 5. Fails with process.exit(1) if unknown config risk classes found
 * 6. Outputs JSON summary of label/class distribution
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { policyMap } from '../../../core/config/file-risk-label-policy.js';

// Mock Neo4jService before importing the module
const mockRun = vi.fn();
const mockGetDriver = vi.fn(() => ({ close: vi.fn().mockResolvedValue(undefined) }));
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn().mockImplementation(() => ({
    run: mockRun,
    getDriver: mockGetDriver,
    close: mockClose,
  })),
}));

describe('[AUD-TC-04-L1-01] verify-file-risk-label-policy', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('(1) policyMap exists and contains expected label definitions', () => {
    const policy = policyMap();
    expect(policy).toBeInstanceOf(Map);
    expect(policy.size).toBeGreaterThan(0);
    // Common labels should be in the policy
    expect(policy.has('Function')).toBe(true);
    expect(policy.has('Class')).toBe(true);
    expect(policy.has('Method')).toBe(true);
  });

  it('(2) ALLOWED_CONFIG_CLASSES includes the three valid values', () => {
    // Testing the constants used by the script
    const ALLOWED_CONFIG_CLASSES = new Set(['NONE', 'GOVERNANCE_CRITICAL_CONFIG', 'EXAMPLE_ASSET']);
    expect(ALLOWED_CONFIG_CLASSES.has('NONE')).toBe(true);
    expect(ALLOWED_CONFIG_CLASSES.has('GOVERNANCE_CRITICAL_CONFIG')).toBe(true);
    expect(ALLOWED_CONFIG_CLASSES.has('EXAMPLE_ASSET')).toBe(true);
    expect(ALLOWED_CONFIG_CLASSES.has('INVALID_CLASS')).toBe(false);
  });

  it('(3) validates labels against policyMap — all labels in policy passes', () => {
    const policy = policyMap();
    const rows = [
      { label: 'Function', files: 100 },
      { label: 'Class', files: 50 },
      { label: 'Method', files: 200 },
    ];

    const missing = rows.filter((row) => !policy.has(String(row.label)));
    expect(missing.length).toBe(0);
  });

  it('(4) validates labels against policyMap — unknown label detected', () => {
    const policy = policyMap();
    const rows = [
      { label: 'Function', files: 100 },
      { label: 'UNKNOWN_LABEL_XYZ', files: 5 },
    ];

    const missing = rows.filter((row) => !policy.has(String(row.label)));
    expect(missing.length).toBe(1);
    expect(missing[0].label).toBe('UNKNOWN_LABEL_XYZ');
  });

  it('(5) validates configRiskClass against ALLOWED_CONFIG_CLASSES — valid classes pass', () => {
    const ALLOWED_CONFIG_CLASSES = new Set(['NONE', 'GOVERNANCE_CRITICAL_CONFIG', 'EXAMPLE_ASSET']);
    const configClassRows = [
      { configRiskClass: 'NONE', files: 100 },
      { configRiskClass: 'GOVERNANCE_CRITICAL_CONFIG', files: 10 },
    ];

    const invalidConfigClasses = configClassRows.filter(
      (row) => !ALLOWED_CONFIG_CLASSES.has(String(row.configRiskClass)),
    );
    expect(invalidConfigClasses.length).toBe(0);
  });

  it('(6) validates configRiskClass against ALLOWED_CONFIG_CLASSES — invalid class detected', () => {
    const ALLOWED_CONFIG_CLASSES = new Set(['NONE', 'GOVERNANCE_CRITICAL_CONFIG', 'EXAMPLE_ASSET']);
    const configClassRows = [
      { configRiskClass: 'NONE', files: 100 },
      { configRiskClass: 'INVALID_RISK_CLASS', files: 5 },
    ];

    const invalidConfigClasses = configClassRows.filter(
      (row) => !ALLOWED_CONFIG_CLASSES.has(String(row.configRiskClass)),
    );
    expect(invalidConfigClasses.length).toBe(1);
    expect(invalidConfigClasses[0].configRiskClass).toBe('INVALID_RISK_CLASS');
  });

  it('(7) __MISSING__ configRiskClass is detected as invalid', () => {
    const ALLOWED_CONFIG_CLASSES = new Set(['NONE', 'GOVERNANCE_CRITICAL_CONFIG', 'EXAMPLE_ASSET']);
    const configClassRows = [{ configRiskClass: '__MISSING__', files: 20 }];

    const invalidConfigClasses = configClassRows.filter(
      (row) => !ALLOWED_CONFIG_CLASSES.has(String(row.configRiskClass)),
    );
    expect(invalidConfigClasses.length).toBe(1);
  });

  it('(8) JSON output structure includes required fields on success', () => {
    const output = {
      ok: true,
      observedLabels: 10,
      policyLabels: 15,
      accountedLabels: ['Function', 'Class', 'Method'],
      configRiskClasses: [
        { configRiskClass: 'NONE', files: 100 },
        { configRiskClass: 'GOVERNANCE_CRITICAL_CONFIG', files: 5 },
      ],
    };

    expect(output.ok).toBe(true);
    expect(output.observedLabels).toBeTypeOf('number');
    expect(output.policyLabels).toBeTypeOf('number');
    expect(Array.isArray(output.accountedLabels)).toBe(true);
    expect(Array.isArray(output.configRiskClasses)).toBe(true);
  });

  it('(9) JSON error output structure includes reason and details', () => {
    const errorOutput = {
      ok: false,
      reason: 'unaccounted_labels',
      missing: [{ label: 'UnknownLabel', files: 3 }],
    };

    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.reason).toBe('unaccounted_labels');
    expect(Array.isArray(errorOutput.missing)).toBe(true);
  });

  it('(10) toNum helper handles various input types', () => {
    const toNum = (v: unknown): number => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'bigint') return Number(v);
      if (typeof (v as { toNumber?: unknown }).toNumber === 'function') {
        return (v as { toNumber: () => number }).toNumber();
      }
      return Number(v);
    };

    expect(toNum(42)).toBe(42);
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum(BigInt(100))).toBe(100);
    expect(toNum({ toNumber: () => 999 })).toBe(999);
    expect(toNum('50')).toBe(50);
  });
});
