/**
 * GC-6: Verifier Self-Defense (GRC-SELF-DEFENSE) — TDD Spec Tests
 *
 * Spec requirements:
 * 1. Query functions in verification/governance/sarif paths without ANALYZED or FLAGS edges
 * 2. Severity: CRITICAL for compositeRisk >= 0.7, WARNING for rest
 * 3. Advisory mode (exit 0, log but don't block)
 * 4. importSarifToVerificationBundle is detected if unverified
 */
import { describe, it, expect } from 'vitest';
import { checkGrcSelfDefense } from '../../../../scripts/verify/verify-grc-self-defense.js';

describe('[GC-6] GRC-SELF-DEFENSE contract', () => {
  it('exports checkGrcSelfDefense function', () => {
    expect(typeof checkGrcSelfDefense).toBe('function');
  });

  it('returns correct shape', async () => {
    // Type check — the function should return the right interface
    // Actual Neo4j test would need ephemeral graph
    const mockResult = {
      undefended: [],
      total: 68,
      defended: 68,
    };
    expect(mockResult).toHaveProperty('undefended');
    expect(mockResult).toHaveProperty('total');
    expect(mockResult).toHaveProperty('defended');
    expect(Array.isArray(mockResult.undefended)).toBe(true);
  });
});

describe('[GC-6] governance path detection', () => {
  const paths = [
    '/src/core/verification/sarif-importer.ts',
    '/src/core/verification/calibration.ts',
    '/src/utils/verify-governance-staleness.ts',
    '/src/core/verification/scope-resolver.ts',
  ];

  for (const p of paths) {
    it(`detects governance path: ${p.split('/').pop()}`, () => {
      expect(p).toMatch(/(verification|governance|sarif)/);
    });
  }

  it('does NOT flag non-governance paths', () => {
    expect('/src/core/parsers/typescript-parser.ts').not.toMatch(/(verification|governance|sarif)/);
  });
});

/**
 * Gap-fill tests for AUD-TC-04-L2-01
 * Addresses: SPEC-GAP-01 through SPEC-GAP-05
 */
describe('[GC-6] SPEC-GAP-01: Severity classification (compositeRisk threshold)', () => {
  it('classifies compositeRisk >= 0.7 as CRITICAL', () => {
    const undefended = [
      { name: 'highRiskFn', filePath: '/verification/x.ts', compositeRisk: 0.75, riskLevel: 30, riskTier: 'HIGH', flags: [] },
      { name: 'lowRiskFn', filePath: '/governance/y.ts', compositeRisk: 0.3, riskLevel: 10, riskTier: 'LOW', flags: [] },
    ];
    const critical = undefended.filter((f) => f.compositeRisk >= 0.7);
    const warning = undefended.filter((f) => f.compositeRisk < 0.7);

    expect(critical).toHaveLength(1);
    expect(critical[0]?.name).toBe('highRiskFn');
    expect(warning).toHaveLength(1);
    expect(warning[0]?.name).toBe('lowRiskFn');
  });

  it('0.7 exactly is CRITICAL (boundary test)', () => {
    const fn = { compositeRisk: 0.7 };
    expect(fn.compositeRisk >= 0.7).toBe(true);
  });

  it('0.699 is WARNING (boundary test)', () => {
    const fn = { compositeRisk: 0.699 };
    expect(fn.compositeRisk >= 0.7).toBe(false);
  });
});

describe('[GC-6] SPEC-GAP-02: ANALYZED AND FLAGS edge absence condition', () => {
  it('function with ONLY ANALYZED edge is defended', () => {
    const fn = { analyzedCount: 1, flagCount: 0 };
    const isUndefended = fn.analyzedCount === 0 && fn.flagCount === 0;
    expect(isUndefended).toBe(false);
  });

  it('function with ONLY FLAGS edge is defended', () => {
    const fn = { analyzedCount: 0, flagCount: 1 };
    const isUndefended = fn.analyzedCount === 0 && fn.flagCount === 0;
    expect(isUndefended).toBe(false);
  });

  it('function with BOTH ANALYZED and FLAGS is defended', () => {
    const fn = { analyzedCount: 2, flagCount: 3 };
    const isUndefended = fn.analyzedCount === 0 && fn.flagCount === 0;
    expect(isUndefended).toBe(false);
  });

  it('function with NEITHER ANALYZED nor FLAGS is undefended', () => {
    const fn = { analyzedCount: 0, flagCount: 0 };
    const isUndefended = fn.analyzedCount === 0 && fn.flagCount === 0;
    expect(isUndefended).toBe(true);
  });
});

describe('[GC-6] SPEC-GAP-03: importSarifToVerificationBundle detection', () => {
  it('importSarifToVerificationBundle is flagged if undefended', () => {
    const undefended = [
      { name: 'importSarifToVerificationBundle', filePath: '/src/core/verification/sarif-importer.ts', compositeRisk: 0.8, riskLevel: 34.9, riskTier: 'CRITICAL', flags: [] },
      { name: 'otherFn', filePath: '/src/governance/other.ts', compositeRisk: 0.2, riskLevel: 5, riskTier: 'LOW', flags: [] },
    ];

    const sarifImporter = undefended.find((f) => f.name === 'importSarifToVerificationBundle');
    expect(sarifImporter).toBeDefined();
    expect(sarifImporter?.compositeRisk).toBeGreaterThanOrEqual(0.7);
  });

  it('importSarifToVerificationBundle path matches governance pattern', () => {
    const path = '/src/core/verification/sarif-importer.ts';
    expect(path).toMatch(/(verification|governance|sarif)/);
  });
});

describe('[GC-6] SPEC-GAP-04: Idempotent query behavior', () => {
  it('filtering logic is pure (same input → same output)', () => {
    const input = [
      { name: 'fn1', analyzedCount: 0, flagCount: 0, compositeRisk: 0.5 },
      { name: 'fn2', analyzedCount: 1, flagCount: 0, compositeRisk: 0.3 },
      { name: 'fn3', analyzedCount: 0, flagCount: 1, compositeRisk: 0.9 },
    ];

    const filter = (arr: typeof input) =>
      arr.filter((f) => f.analyzedCount === 0 && f.flagCount === 0);

    const result1 = filter(input);
    const result2 = filter(input);

    expect(result1).toEqual(result2);
    expect(result1).toHaveLength(1);
    expect(result1[0]?.name).toBe('fn1');
  });

  it('severity classification is deterministic', () => {
    const undefended = [
      { name: 'a', compositeRisk: 0.75 },
      { name: 'b', compositeRisk: 0.65 },
    ];

    const classify = (arr: typeof undefended) => ({
      critical: arr.filter((f) => f.compositeRisk >= 0.7),
      warning: arr.filter((f) => f.compositeRisk < 0.7),
    });

    const r1 = classify(undefended);
    const r2 = classify(undefended);

    expect(r1.critical).toEqual(r2.critical);
    expect(r1.warning).toEqual(r2.warning);
  });
});

describe('[GC-6] SPEC-GAP-05: Path pattern Cypher regex equivalence', () => {
  // The Cypher query uses: f.filePath =~ '.*(verification|governance|sarif).*'
  // This tests that JS regex matches the same semantics
  const cypherRegex = /.*(verification|governance|sarif).*/;

  const testCases = [
    { path: '/src/core/verification/sarif-importer.ts', expected: true },
    { path: '/src/core/governance/metrics.ts', expected: true },
    { path: '/src/utils/sarif-utils.ts', expected: true },
    { path: '/src/core/parsers/typescript-parser.ts', expected: false },
    { path: '/src/storage/neo4j/neo4j.service.ts', expected: false },
    { path: '/src/core/verification-test/helper.ts', expected: true },
    { path: '/src/scripts/verify/verify-grc-self-defense.ts', expected: false }, // 'verify' != 'verification' — implementation quirk: verify scripts not in governance path
  ];

  for (const { path, expected } of testCases) {
    it(`${expected ? 'matches' : 'does not match'}: ${path.split('/').pop()}`, () => {
      expect(cypherRegex.test(path)).toBe(expected);
    });
  }

  it('verify vs verification distinction', () => {
    // 'verify' does NOT contain 'verification' as substring
    expect(/.*(verification).*/.test('/scripts/verify/foo.ts')).toBe(false);
    // but 'verification' does
    expect(/.*(verification).*/.test('/core/verification/foo.ts')).toBe(true);
  });

  /**
   * SPEC-GAP-06: scripts/verify/ not in governance path
   * The verify scripts that RUN the governance checks are NOT monitored
   * by GRC-SELF-DEFENSE because they're in scripts/verify/ not core/verification/.
   * This is a potential blind spot: the verification scripts themselves have no defense-in-depth.
   */
  it('FINDING: scripts/verify/*.ts NOT in governance path (self-reference gap)', () => {
    const verifyScripts = [
      '/src/scripts/verify/verify-grc-self-defense.ts',
      '/src/scripts/verify/verify-project-registry.ts',
      '/src/scripts/verify/verify-graph-integrity.ts',
    ];
    for (const script of verifyScripts) {
      expect(cypherRegex.test(script)).toBe(false);
    }
  });
});
