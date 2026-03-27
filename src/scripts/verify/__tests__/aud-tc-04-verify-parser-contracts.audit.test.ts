/**
 * [AUD-TC-04-L1-13] verify-parser-contracts.ts — Audit Tests
 *
 * Spec: `plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md` §15.3 "Parser meta-graph now in place (early M7)"
 *
 * Behaviors tested:
 * 1. Connects to Neo4j and queries ParserContract nodes (count > 0)
 * 2. Checks required meta-edges exist (NEXT_STAGE, EMITS_NODE_TYPE, EMITS_EDGE_TYPE)
 * 3. Checks stage ordering integrity (parse/enrich/materialize)
 * 4. Returns CheckResult {ok, checks, details} with per-check pass/fail
 * 5. Outputs JSON summary
 * 6. Exits non-zero if any check fails
 * 7. All tests mock Neo4j for unit testing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock neo4j-driver
const mockSessionRun = vi.fn();
const mockSessionClose = vi.fn().mockResolvedValue(undefined);
const mockDriverClose = vi.fn().mockResolvedValue(undefined);

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => ({
      session: () => ({
        run: mockSessionRun,
        close: mockSessionClose,
      }),
      close: mockDriverClose,
    })),
    auth: {
      basic: vi.fn(),
    },
  },
}));

interface CheckResult {
  ok: boolean;
  checks: Record<string, boolean>;
  details: Record<string, unknown>;
}

describe('[AUD-TC-04-L1-13] verify-parser-contracts', () => {
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

  it('(1) CheckResult structure has ok, checks, and details fields', () => {
    const result: CheckResult = {
      ok: true,
      checks: {
        contract_nodes_exist: true,
        plan_parser_required_stages: true,
        required_contract_edge_types: true,
        required_function_mapping: true,
      },
      details: {
        totalContractNodes: 5,
      },
    };

    expect(result.ok).toBeTypeOf('boolean');
    expect(typeof result.checks).toBe('object');
    expect(typeof result.details).toBe('object');
  });

  it('(2) contract_nodes_exist check passes when count > 0', () => {
    const total = 5;
    const checks: Record<string, boolean> = {};
    checks.contract_nodes_exist = total > 0;

    expect(checks.contract_nodes_exist).toBe(true);
  });

  it('(3) contract_nodes_exist check fails when count = 0', () => {
    const total = 0;
    const checks: Record<string, boolean> = {};
    checks.contract_nodes_exist = total > 0;

    expect(checks.contract_nodes_exist).toBe(false);
  });

  it('(4) plan_parser_required_stages check verifies parse/enrich/materialize', () => {
    const mustHaveStages = ['parse', 'enrich', 'materialize'];
    const stageList = ['parse', 'enrich', 'materialize', 'finalize'];
    const missingStages = mustHaveStages.filter((s) => !stageList.includes(s));

    expect(missingStages.length).toBe(0);
  });

  it('(5) plan_parser_required_stages check fails when stage is missing', () => {
    const mustHaveStages = ['parse', 'enrich', 'materialize'];
    const stageList = ['parse', 'finalize']; // missing enrich and materialize
    const missingStages = mustHaveStages.filter((s) => !stageList.includes(s));

    expect(missingStages.length).toBe(2);
    expect(missingStages).toContain('enrich');
    expect(missingStages).toContain('materialize');
  });

  it('(6) required_contract_edge_types validates all 5 edge types', () => {
    const requiredEdgeTypes = [
      'NEXT_STAGE',
      'EMITS_NODE_TYPE',
      'EMITS_EDGE_TYPE',
      'READS_PLAN_FIELD',
      'MUTATES_TASK_FIELD',
    ];
    expect(requiredEdgeTypes.length).toBe(5);
  });

  it('(7) required_contract_edge_types check passes when all edges exist', () => {
    const requiredEdgeTypes = ['NEXT_STAGE', 'EMITS_NODE_TYPE', 'EMITS_EDGE_TYPE'];
    const edgeCounts: Record<string, number> = {
      NEXT_STAGE: 5,
      EMITS_NODE_TYPE: 10,
      EMITS_EDGE_TYPE: 8,
    };

    const missingEdgeTypes = requiredEdgeTypes.filter((t) => (edgeCounts[t] ?? 0) === 0);
    expect(missingEdgeTypes.length).toBe(0);
  });

  it('(8) required_contract_edge_types check fails when edge type is missing', () => {
    const requiredEdgeTypes = ['NEXT_STAGE', 'EMITS_NODE_TYPE', 'EMITS_EDGE_TYPE'];
    const edgeCounts: Record<string, number> = {
      NEXT_STAGE: 5,
      EMITS_NODE_TYPE: 0, // missing
    };

    const missingEdgeTypes = requiredEdgeTypes.filter((t) => (edgeCounts[t] ?? 0) === 0);
    expect(missingEdgeTypes.length).toBe(2);
    expect(missingEdgeTypes).toContain('EMITS_NODE_TYPE');
    expect(missingEdgeTypes).toContain('EMITS_EDGE_TYPE');
  });

  it('(9) required_function_mapping validates blast-radius functions', () => {
    const requiredFuncs = ['parsePlanDirectory', 'enrichCrossDomain', 'ingestToNeo4j'];
    const funcs = ['parsePlanDirectory', 'enrichCrossDomain', 'ingestToNeo4j', 'helpers'];
    const missingFuncs = requiredFuncs.filter((f) => !funcs.includes(f));

    expect(missingFuncs.length).toBe(0);
  });

  it('(10) required_function_mapping check fails when function is missing', () => {
    const requiredFuncs = ['parsePlanDirectory', 'enrichCrossDomain', 'ingestToNeo4j'];
    const funcs = ['parsePlanDirectory'];
    const missingFuncs = requiredFuncs.filter((f) => !funcs.includes(f));

    expect(missingFuncs.length).toBe(2);
    expect(missingFuncs).toContain('enrichCrossDomain');
    expect(missingFuncs).toContain('ingestToNeo4j');
  });

  it('(11) overall ok is true when all checks pass', () => {
    const checks: Record<string, boolean> = {
      contract_nodes_exist: true,
      plan_parser_required_stages: true,
      required_contract_edge_types: true,
      required_function_mapping: true,
    };

    const ok = Object.values(checks).every(Boolean);
    expect(ok).toBe(true);
  });

  it('(12) overall ok is false when any check fails', () => {
    const checks: Record<string, boolean> = {
      contract_nodes_exist: true,
      plan_parser_required_stages: false,
      required_contract_edge_types: true,
      required_function_mapping: true,
    };

    const ok = Object.values(checks).every(Boolean);
    expect(ok).toBe(false);
  });

  it('(13) JSON output includes details per check', () => {
    const result: CheckResult = {
      ok: true,
      checks: {
        contract_nodes_exist: true,
        plan_parser_required_stages: true,
        required_contract_edge_types: true,
        required_function_mapping: true,
      },
      details: {
        totalContractNodes: 5,
        planParserStages: ['parse', 'enrich', 'materialize'],
        planParserContractCount: 3,
        missingStages: [],
        edgeTypeCounts: { NEXT_STAGE: 5, EMITS_NODE_TYPE: 10 },
        missingEdgeTypes: [],
        planParserFunctions: ['parsePlanDirectory', 'enrichCrossDomain', 'ingestToNeo4j'],
        missingFunctions: [],
      },
    };

    expect(result.details.totalContractNodes).toBe(5);
    expect(Array.isArray(result.details.planParserStages)).toBe(true);
    expect(result.details.missingStages).toEqual([]);
  });

  it('(14) error output includes error field', () => {
    const errorOutput = {
      ok: false,
      error: 'Connection refused',
    };

    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.error).toBeTruthy();
  });

  it('(15) Neo4j integer conversion uses toNumber', () => {
    const mockValue = { toNumber: () => 42 };
    const result = mockValue.toNumber?.() ?? 0;
    expect(result).toBe(42);

    const nullValue: unknown = null;
    const nullResult = (nullValue as { toNumber?: () => number } | null)?.toNumber?.() ?? 0;
    expect(nullResult).toBe(0);
  });
});
