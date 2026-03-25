// Spec source: plans/codegraph/ADAPTER_ROADMAP.md §Milestone 7 "Parser Self-Modeling (Meta-Graph)"
// Spec source: plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §Sprint 1 "Define IR v1 JSON schema and parser contract"
// AUD-TC-11a-L1-07: meta/parser-contract-emitter.ts (183 lines)
//
// FIND-11a-01: makePlanParserContractGraph is not exported, so behaviors 1-6 (pure graph
// construction) can only be tested indirectly via the Neo4j mock capturing session.run() args
// from emitPlanParserContracts. This is a spec gap — the spec says "model parsers as first-class
// graph structures" but doesn't specify whether the graph builder is a public API.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock neo4j-driver before importing the module under test
const mockRun = vi.fn().mockResolvedValue({ records: [] });
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockSession = {
  run: mockRun,
  close: mockClose,
};
const mockDriverClose = vi.fn().mockResolvedValue(undefined);
const mockDriver = {
  session: vi.fn(() => mockSession),
  close: mockDriverClose,
};

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => mockDriver),
    auth: {
      basic: vi.fn((user: string, pass: string) => ({ user, pass })),
    },
  },
}));

// Import after mock setup
import { emitPlanParserContracts } from '../../parsers/meta/parser-contract-emitter.js';

describe('emitPlanParserContracts — graph construction (behaviors 1-6, tested via Neo4j mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ records: [] });
  });

  it('(1) builds a ParserContractGraph with version=parser-contract.v1 and 3 stage nodes (parse, enrich, materialize)', async () => {
    await emitPlanParserContracts();

    // Extract all MERGE ParserContract calls (stage node upserts)
    const contractCalls = mockRun.mock.calls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes('MERGE (n:ParserContract:CodeNode'),
    );
    expect(contractCalls).toHaveLength(3);

    // Verify stages
    const stages = contractCalls.map(([, params]: [string, Record<string, unknown>]) => {
      const props = params.props as Record<string, unknown>;
      return props.stage;
    });
    expect(stages).toContain('parse');
    expect(stages).toContain('enrich');
    expect(stages).toContain('materialize');
  });

  it('(2) parse stage emits correct node types and edge types', async () => {
    await emitPlanParserContracts();

    const contractCalls = mockRun.mock.calls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes('MERGE (n:ParserContract:CodeNode'),
    );
    const parseCall = contractCalls.find(([, params]: [string, Record<string, unknown>]) => {
      const props = params.props as Record<string, unknown>;
      return props.stage === 'parse';
    });
    expect(parseCall).toBeDefined();

    const parseProps = parseCall![1].props as Record<string, unknown>;
    expect(parseProps.emitsNodeTypes).toEqual(
      expect.arrayContaining(['PlanProject', 'Milestone', 'Sprint', 'Task', 'Decision']),
    );
    expect(parseProps.emitsEdgeTypes).toEqual(
      expect.arrayContaining(['PART_OF', 'BLOCKS', 'DEPENDS_ON', 'MODIFIES', 'TARGETS', 'BASED_ON', 'SUPERSEDES']),
    );
  });

  it('(3) enrich stage emitsEdgeTypes=[HAS_CODE_EVIDENCE] and readsPlanFields=[task_name, status, crossRef]', async () => {
    await emitPlanParserContracts();

    const contractCalls = mockRun.mock.calls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes('MERGE (n:ParserContract:CodeNode'),
    );
    const enrichCall = contractCalls.find(([, params]: [string, Record<string, unknown>]) => {
      const props = params.props as Record<string, unknown>;
      return props.stage === 'enrich';
    });
    expect(enrichCall).toBeDefined();

    const enrichProps = enrichCall![1].props as Record<string, unknown>;
    expect(enrichProps.emitsEdgeTypes).toEqual(['HAS_CODE_EVIDENCE']);
    expect(enrichProps.readsPlanFields).toEqual(['task_name', 'status', 'crossRef']);
  });

  it('(4) materialize stage emitsEdgeTypes includes all parse edge types plus HAS_CODE_EVIDENCE', async () => {
    await emitPlanParserContracts();

    const contractCalls = mockRun.mock.calls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes('MERGE (n:ParserContract:CodeNode'),
    );
    const matCall = contractCalls.find(([, params]: [string, Record<string, unknown>]) => {
      const props = params.props as Record<string, unknown>;
      return props.stage === 'materialize';
    });
    expect(matCall).toBeDefined();

    const matProps = matCall![1].props as Record<string, unknown>;
    const matEdgeTypes = matProps.emitsEdgeTypes as string[];
    const expectedEdgeTypes = [
      'PART_OF', 'BLOCKS', 'DEPENDS_ON', 'MODIFIES', 'TARGETS', 'BASED_ON', 'SUPERSEDES', 'HAS_CODE_EVIDENCE',
    ];
    for (const et of expectedEdgeTypes) {
      expect(matEdgeTypes).toContain(et);
    }
  });

  it('(5) NEXT_STAGE edges chain parse→enrich→materialize', async () => {
    await emitPlanParserContracts();

    const nextStageCalls = mockRun.mock.calls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes(':NEXT_STAGE'),
    );
    expect(nextStageCalls).toHaveLength(2);

    // First: parse → enrich
    const firstEdge = nextStageCalls[0][1] as Record<string, unknown>;
    expect(firstEdge.from).toContain(':stage:parse');
    expect(firstEdge.to).toContain(':stage:enrich');

    // Second: enrich → materialize
    const secondEdge = nextStageCalls[1][1] as Record<string, unknown>;
    expect(secondEdge.from).toContain(':stage:enrich');
    expect(secondEdge.to).toContain(':stage:materialize');
  });

  it('(6) EMITS_NODE_TYPE/EMITS_EDGE_TYPE/READS_PLAN_FIELD/MUTATES_TASK_FIELD edges link stages to meta target nodes', async () => {
    await emitPlanParserContracts();

    const allCalls = mockRun.mock.calls;

    // Check for each meta edge type
    const emitsNodeTypeCalls = allCalls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes(':EMITS_NODE_TYPE'),
    );
    expect(emitsNodeTypeCalls.length).toBeGreaterThan(0);
    // parse stage emits 5 node types
    expect(emitsNodeTypeCalls).toHaveLength(5);

    const emitsEdgeTypeCalls = allCalls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes(':EMITS_EDGE_TYPE'),
    );
    expect(emitsEdgeTypeCalls.length).toBeGreaterThan(0);

    const readsPlanFieldCalls = allCalls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes(':READS_PLAN_FIELD'),
    );
    expect(readsPlanFieldCalls.length).toBeGreaterThan(0);

    const mutatesTaskFieldCalls = allCalls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes(':MUTATES_TASK_FIELD'),
    );
    expect(mutatesTaskFieldCalls.length).toBeGreaterThan(0);

    // Verify meta targets point to meta: namespaced IDs
    for (const call of emitsNodeTypeCalls) {
      const params = call[1] as Record<string, string>;
      expect(params.to).toMatch(/meta:nodeType:/);
    }
    for (const call of readsPlanFieldCalls) {
      const params = call[1] as Record<string, string>;
      expect(params.to).toMatch(/meta:planField:/);
    }
  });
});

describe('emitPlanParserContracts — Neo4j interaction (behaviors 7-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ records: [] });
  });

  it('(7) MERGEs ParserContract:CodeNode nodes to Neo4j with all stage properties', async () => {
    await emitPlanParserContracts();

    const contractMerges = mockRun.mock.calls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes('MERGE (n:ParserContract:CodeNode'),
    );
    expect(contractMerges).toHaveLength(3);

    for (const [query, params] of contractMerges) {
      expect(query).toContain('SET n +=');
      expect(query).toContain("n.coreType = 'ParserContract'");
      const props = (params as Record<string, unknown>).props as Record<string, unknown>;
      // All stage properties present
      expect(props).toHaveProperty('id');
      expect(props).toHaveProperty('parserName');
      expect(props).toHaveProperty('stage');
      expect(props).toHaveProperty('name');
      expect(props).toHaveProperty('emitsNodeTypes');
      expect(props).toHaveProperty('emitsEdgeTypes');
      expect(props).toHaveProperty('readsPlanFields');
      expect(props).toHaveProperty('mutatesTaskFields');
      expect(props).toHaveProperty('confidence');
      expect(props).toHaveProperty('updatedAt');
    }
  });

  it('(8) MERGEs ParserMeta:CodeNode meta target nodes', async () => {
    await emitPlanParserContracts();

    const metaMerges = mockRun.mock.calls.filter(
      ([query]: [string]) => typeof query === 'string' && query.includes('MERGE (n:ParserMeta:CodeNode'),
    );
    expect(metaMerges.length).toBeGreaterThan(0);

    for (const [query, params] of metaMerges) {
      expect(query).toContain("n.coreType = 'ParserMeta'");
      const p = params as Record<string, unknown>;
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('projectId');
      expect(p).toHaveProperty('name');
    }
  });

  it('(9) MERGEs typed relationship edges between contract and meta nodes', async () => {
    await emitPlanParserContracts();

    const edgeMerges = mockRun.mock.calls.filter(
      ([query]: [string]) =>
        typeof query === 'string' &&
        query.includes('MATCH (a:CodeNode') &&
        query.includes('MERGE (a)-[r:'),
    );
    expect(edgeMerges.length).toBeGreaterThan(0);

    // Each edge MERGE sets projectId and confidence
    for (const [query, params] of edgeMerges) {
      expect(query).toContain('r.projectId');
      expect(query).toContain('r.confidence');
      const p = params as Record<string, unknown>;
      expect(p).toHaveProperty('from');
      expect(p).toHaveProperty('to');
      expect(p).toHaveProperty('projectId');
      expect(p).toHaveProperty('confidence');
    }
  });

  it('(10) returns {nodesUpserted, edgesUpserted} counts', async () => {
    const result = await emitPlanParserContracts();
    expect(result).toHaveProperty('nodesUpserted');
    expect(result).toHaveProperty('edgesUpserted');
    expect(typeof result.nodesUpserted).toBe('number');
    expect(typeof result.edgesUpserted).toBe('number');
    expect(result.nodesUpserted).toBeGreaterThan(0);
    expect(result.edgesUpserted).toBeGreaterThan(0);
  });

  it('(11) function is idempotent — uses MERGE not CREATE', async () => {
    // Run twice
    await emitPlanParserContracts();
    const firstCallCount = mockRun.mock.calls.length;

    vi.clearAllMocks();
    mockRun.mockResolvedValue({ records: [] });
    await emitPlanParserContracts();
    const secondCallCount = mockRun.mock.calls.length;

    // Same number of calls both times (deterministic)
    expect(secondCallCount).toBe(firstCallCount);

    // All queries use MERGE, never CREATE
    for (const [query] of mockRun.mock.calls) {
      if (typeof query === 'string') {
        expect(query).not.toContain('CREATE');
        expect(query).toContain('MERGE');
      }
    }
  });

  it('closes session and driver in finally block', async () => {
    await emitPlanParserContracts();
    expect(mockClose).toHaveBeenCalled();
    expect(mockDriverClose).toHaveBeenCalled();
  });
});
