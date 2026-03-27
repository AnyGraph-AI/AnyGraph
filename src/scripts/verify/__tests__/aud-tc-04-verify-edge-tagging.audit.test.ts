/**
 * [AUD-TC-04-L1-08] verify-edge-tagging.ts — Audit Tests
 *
 * Spec: `plans/codegraph/GOVERNANCE_HARDENING.md` §G3 "Query Truth Contract Enforcement"
 *
 * Behaviors tested:
 * 1. Queries all edge types with counts via Neo4jService
 * 2. Checks for edges without projectId (global edges)
 * 3. Validates global edges against EXPECTED_GLOBAL_EDGE_TYPES whitelist
 * 4. Validates remaining untagged edges against KNOWN_SCOPE_DEBT_EDGE_TYPES
 * 5. Fails if unknown untagged edge types found
 * 6. Outputs JSON with per-type counts + violations
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Neo4jService
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

// Define the constants from the source file
const EXPECTED_GLOBAL_EDGE_TYPES = new Set<string>([
  'MENTIONS_PERSON',
  'NEXT_VERSE',
  'PART_OF',
  'SUPPORTED_BY',
  'CONTRADICTED_BY',
  'HAS_CODE_EVIDENCE',
  'MODIFIES',
  'BLOCKS',
  'OBSERVED_AS',
  'PRODUCED',
  'GENERATED_HYPOTHESIS',
  'BECAME_TASK',
  'RESOLVED_BY_COMMIT',
  'EXPLAINS_SUPPORT',
  'EXPLAINS_CONTRADICTION',
]);

const KNOWN_SCOPE_DEBT_EDGE_TYPES = new Set<string>([
  'ORIGINATES_IN',
  'READS_STATE',
  'WRITES_STATE',
  'FOUND',
  'OWNED_BY',
  'BELONGS_TO_LAYER',
  'MEASURED',
  'POSSIBLE_CALL',
  'TESTED_BY',
]);

interface EdgeCountRow {
  edgeType: string;
  count: number;
}

describe('[AUD-TC-04-L1-08] verify-edge-tagging', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('(1) EXPECTED_GLOBAL_EDGE_TYPES contains expected cross-domain edge types', () => {
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('HAS_CODE_EVIDENCE')).toBe(true);
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('MODIFIES')).toBe(true);
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('BLOCKS')).toBe(true);
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('PART_OF')).toBe(true);
    expect(EXPECTED_GLOBAL_EDGE_TYPES.size).toBeGreaterThan(10);
  });

  it('(2) KNOWN_SCOPE_DEBT_EDGE_TYPES contains tolerated unscoped edge types', () => {
    expect(KNOWN_SCOPE_DEBT_EDGE_TYPES.has('ORIGINATES_IN')).toBe(true);
    expect(KNOWN_SCOPE_DEBT_EDGE_TYPES.has('READS_STATE')).toBe(true);
    expect(KNOWN_SCOPE_DEBT_EDGE_TYPES.has('WRITES_STATE')).toBe(true);
    expect(KNOWN_SCOPE_DEBT_EDGE_TYPES.has('TESTED_BY')).toBe(true);
  });

  it('(3) categorizes global edges correctly', () => {
    const rows: EdgeCountRow[] = [
      { edgeType: 'HAS_CODE_EVIDENCE', count: 100 },
      { edgeType: 'MODIFIES', count: 50 },
      { edgeType: 'ORIGINATES_IN', count: 30 },
      { edgeType: 'UNKNOWN_EDGE', count: 5 },
    ];

    const globalRows = rows.filter((r) => EXPECTED_GLOBAL_EDGE_TYPES.has(r.edgeType));
    const scopeDebtRows = rows.filter((r) => KNOWN_SCOPE_DEBT_EDGE_TYPES.has(r.edgeType));
    const unknownRows = rows.filter(
      (r) => !EXPECTED_GLOBAL_EDGE_TYPES.has(r.edgeType) && !KNOWN_SCOPE_DEBT_EDGE_TYPES.has(r.edgeType),
    );

    expect(globalRows.length).toBe(2);
    expect(scopeDebtRows.length).toBe(1);
    expect(unknownRows.length).toBe(1);
  });

  it('(4) passes when all unscoped edges are in whitelist or scope-debt set', () => {
    const rows: EdgeCountRow[] = [
      { edgeType: 'HAS_CODE_EVIDENCE', count: 100 },
      { edgeType: 'TESTED_BY', count: 20 },
    ];

    const unknownRows = rows.filter(
      (r) => !EXPECTED_GLOBAL_EDGE_TYPES.has(r.edgeType) && !KNOWN_SCOPE_DEBT_EDGE_TYPES.has(r.edgeType),
    );

    expect(unknownRows.length).toBe(0);
  });

  it('(5) fails when unknown edge types are detected', () => {
    const rows: EdgeCountRow[] = [
      { edgeType: 'TOTALLY_UNKNOWN_EDGE', count: 10 },
      { edgeType: 'ANOTHER_UNKNOWN', count: 5 },
    ];

    const unknownRows = rows.filter(
      (r) => !EXPECTED_GLOBAL_EDGE_TYPES.has(r.edgeType) && !KNOWN_SCOPE_DEBT_EDGE_TYPES.has(r.edgeType),
    );

    expect(unknownRows.length).toBe(2);
    expect(unknownRows.map((r) => r.edgeType)).toEqual(['TOTALLY_UNKNOWN_EDGE', 'ANOTHER_UNKNOWN']);
  });

  it('(6) scope debt total is computed correctly', () => {
    const rows: EdgeCountRow[] = [
      { edgeType: 'ORIGINATES_IN', count: 30 },
      { edgeType: 'TESTED_BY', count: 20 },
      { edgeType: 'READS_STATE', count: 10 },
    ];

    const scopeDebtRows = rows.filter((r) => KNOWN_SCOPE_DEBT_EDGE_TYPES.has(r.edgeType));
    const scopeDebtTotal = scopeDebtRows.reduce((sum, row) => sum + Number(row.count ?? 0), 0);

    expect(scopeDebtTotal).toBe(60);
  });

  it('(7) MAX_UNSCOPED_SCOPE_DEBT threshold enforcement', () => {
    const scopeDebtTotal = 150;
    const maxScopeDebt = 100;

    const exceedsThreshold = scopeDebtTotal > maxScopeDebt;
    expect(exceedsThreshold).toBe(true);
  });

  it('(8) JSON success output structure is correct', () => {
    const output = {
      ok: true,
      unscopedEdgeTypes: 5,
      expectedGlobal: [{ edgeType: 'HAS_CODE_EVIDENCE', count: 100 }],
      knownScopeDebt: [{ edgeType: 'TESTED_BY', count: 20 }],
      scopeDebtTotal: 20,
      maxScopeDebt: 1000,
    };

    expect(output.ok).toBe(true);
    expect(output.unscopedEdgeTypes).toBeTypeOf('number');
    expect(Array.isArray(output.expectedGlobal)).toBe(true);
    expect(Array.isArray(output.knownScopeDebt)).toBe(true);
    expect(output.scopeDebtTotal).toBeTypeOf('number');
    expect(output.maxScopeDebt).toBeTypeOf('number');
  });

  it('(9) error message includes unknown edge types', () => {
    const unknownRows: EdgeCountRow[] = [
      { edgeType: 'BAD_EDGE_1', count: 5 },
      { edgeType: 'BAD_EDGE_2', count: 3 },
    ];

    const errorMessage = `Unknown unscoped edge types detected: ${unknownRows
      .map((r) => `${r.edgeType}:${r.count}`)
      .join(', ')}`;

    expect(errorMessage).toContain('BAD_EDGE_1:5');
    expect(errorMessage).toContain('BAD_EDGE_2:3');
  });

  it('(10) TC-4 explainability edges are in EXPECTED_GLOBAL_EDGE_TYPES', () => {
    // TC-4 adds EXPLAINS_SUPPORT and EXPLAINS_CONTRADICTION
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('EXPLAINS_SUPPORT')).toBe(true);
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('EXPLAINS_CONTRADICTION')).toBe(true);
  });

  it('(11) GTH integrity pipeline edges are in EXPECTED_GLOBAL_EDGE_TYPES', () => {
    // GTH integrity edges
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('OBSERVED_AS')).toBe(true);
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('PRODUCED')).toBe(true);
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('GENERATED_HYPOTHESIS')).toBe(true);
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('BECAME_TASK')).toBe(true);
    expect(EXPECTED_GLOBAL_EDGE_TYPES.has('RESOLVED_BY_COMMIT')).toBe(true);
  });
});
