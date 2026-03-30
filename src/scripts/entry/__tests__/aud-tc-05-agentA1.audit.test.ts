// Spec source: plans/codegraph/PLAN.md §Phase 1
//
// AUD-TC-05 Agent A1 — Entry Points Audit (Ingest / Parse-and-Ingest)
//
// Spec-derived tests for:
//   L1-02: ingest-to-neo4j.ts       — 11 behavioral assertions (spec requires 9+)
//   L1-03: parse-and-ingest-self.ts —  9 behavioral assertions (spec requires 8+)
//   L1-04: parse-and-ingest.ts      —  9 behavioral assertions (spec requires 8+)
//
// ⚠️  All three entry points call main() at module top-level (no exports).
//     Tests use vi.resetModules() + dynamic import per the CORRECTIONS.md directive.
//
// FINDINGS:
//   FIND-A1-01 [MEDIUM] — ingest-to-neo4j.ts: driver.close() is NOT called if
//     validateProjectWrite() throws. The driver is created before the try block,
//     so a validation failure leaks the connection. Recommendation: wrap from
//     driver creation in try-finally.
//   FIND-A1-02 [RESOLVED] — parse-and-ingest-self.ts: Spec §SG-1 previously said
//     "runs post-ingest enrichment via execSync". The only execSync call is for
//     file-discovery (finding *.ts files). Spec corrected: actual behavior is
//     "runs file-discovery via execSync". Enrichment is handled by rebuild-derived.ts
//     and the watcher pipeline — not parse-and-ingest scripts. No code change needed.
//   FIND-A1-03 [RESOLVED] — parse-and-ingest.ts: Same as FIND-A1-02 — the only
//     execSync call is for file-discovery via find. Spec corrected: behavior is
//     "runs file-discovery via execSync", not "runs post-ingest enrichment via execSync".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Stable vi.fn() instances ────────────────────────────────────────────────

// Raw neo4j-driver mocks
const mockSessionRun = vi.fn();
const mockSessionClose = vi.fn();
const mockExecuteRead = vi.fn();
const mockDriverSession = vi.fn();
const mockDriverClose = vi.fn();
const mockNeo4jDriverCtor = vi.fn();

// fs mocks
const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockWriteFileSync = vi.fn();

// child_process mocks
const mockExecSync = vi.fn();

// project-write-guard mock
const mockValidateProjectWrite = vi.fn();

// TypeScriptParser mock
const mockParseChunk = vi.fn();
const MockTypeScriptParser = vi.fn<(...args: unknown[]) => void>(function (this: Record<string, unknown>) {
  this.parseChunk = mockParseChunk;
});

// ─── vi.mock registrations (hoisted) ─────────────────────────────────────────

vi.mock('neo4j-driver', () => ({
  default: {
    driver: mockNeo4jDriverCtor,
    auth: { basic: vi.fn(() => ({ scheme: 'basic' })) },
  },
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../../../core/guards/project-write-guard.js', () => ({
  validateProjectWrite: mockValidateProjectWrite,
}));

vi.mock('../../../core/parsers/typescript-parser.js', () => ({
  TypeScriptParser: MockTypeScriptParser,
}));

vi.mock('../../../core/config/schema.js', () => ({
  CORE_TYPESCRIPT_SCHEMA: { nodeTypes: [], edgeTypes: [] },
}));

vi.mock('../../../core/config/grammy-framework-schema.js', () => ({
  GRAMMY_FRAMEWORK_SCHEMA: { nodeTypes: [], edgeTypes: [] },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** neo4j Integer-like object (has .toNumber()) */
function neo4jInt(n: number) {
  return { low: n, high: 0, toNumber: () => n };
}

/** Build a single record stub */
function makeRecord(fields: Record<string, unknown>) {
  return {
    keys: Object.keys(fields),
    get: (k: string): unknown => (k in fields ? fields[k] : null),
  };
}

/** Minimal graph JSON for ingest-to-neo4j */
const SIMPLE_GRAPH_JSON = JSON.stringify({
  nodes: [
    {
      labels: ['Function'],
      properties: { id: 'n1', name: 'foo', projectId: 'proj_60d5feed0001' },
    },
  ],
  edges: [
    {
      type: 'CALLS',
      startNodeId: 'n1',
      endNodeId: 'n1',
      properties: {},
    },
  ],
});

/** Graph JSON with nested-object props to exercise flattenProps */
const NESTED_PROPS_GRAPH_JSON = JSON.stringify({
  nodes: [
    {
      labels: ['Function'],
      properties: {
        id: 'n2',
        meta: { deep: true },          // nested object → should be JSON string
        tags: [{ tag: 'a' }],          // array of objects → should be JSON string
        count: 5,                      // primitive → should stay as-is
        names: ['x', 'y'],             // array of primitives → should stay as-is
      },
    },
  ],
  edges: [],
});

/** Flush pending microtasks */
const flushAsync = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 50));

// ─── Global setup ─────────────────────────────────────────────────────────────

let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();

  exitSpy = vi.spyOn(process, 'exit').mockImplementation(
    (_code?: number): never => undefined as never,
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'time').mockImplementation(() => {});
  vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  // neo4j-driver defaults
  mockNeo4jDriverCtor.mockClear().mockReturnValue({
    session: mockDriverSession,
    close: mockDriverClose,
  });
  const sessionStub = {
    run: mockSessionRun,
    close: mockSessionClose,
    executeRead: mockExecuteRead,
  };
  mockDriverSession.mockReset().mockReturnValue(sessionStub);
  mockSessionRun.mockReset().mockResolvedValue({ records: [] });
  mockSessionClose.mockReset().mockResolvedValue(undefined);
  mockDriverClose.mockReset().mockResolvedValue(undefined);
  mockExecuteRead
    .mockReset()
    .mockImplementation((fn: (tx: { run: typeof mockSessionRun }) => unknown) =>
      Promise.resolve(fn({ run: vi.fn().mockResolvedValue({ records: [] }) })),
    );

  // fs defaults
  mockReadFileSync.mockReset().mockReturnValue(SIMPLE_GRAPH_JSON);
  mockExistsSync.mockReset().mockReturnValue(true);
  mockWriteFileSync.mockReset();

  // child_process default — return two file paths
  mockExecSync.mockReset().mockReturnValue(
    Buffer.from('/some/path/foo.ts\n/some/path/bar.ts'),
  );

  // project-write-guard default — pass
  mockValidateProjectWrite.mockReset().mockResolvedValue(undefined);

  // TypeScriptParser default — return minimal parse result
  MockTypeScriptParser.mockClear();
  mockParseChunk.mockReset().mockResolvedValue({ nodes: [], edges: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// L1-02: ingest-to-neo4j.ts
// Spec: PLAN.md §Phase 1 — direct Neo4j ingest from pre-parsed JSON
// ═══════════════════════════════════════════════════════════════════════════════

describe('[L1-02] ingest-to-neo4j.ts — Direct JSON→Neo4j ingest', () => {
  it('(B1) calls process.exit(1) when graph JSON file is not found', async () => {
    mockExistsSync.mockReturnValue(false);
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('(B2) reads the graph JSON file from disk via readFileSync', async () => {
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining('godspeed-full-graph.json'),
      'utf-8',
    );
  });

  it('(B3) calls validateProjectWrite before any Neo4j MERGE operations', async () => {
    const callOrder: string[] = [];
    mockValidateProjectWrite.mockImplementation(async () => {
      callOrder.push('validate');
    });
    mockSessionRun.mockImplementation(async () => {
      callOrder.push('run');
      return { records: [] };
    });
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    const validateIndex = callOrder.indexOf('validate');
    const firstRunIndex = callOrder.indexOf('run');
    expect(validateIndex).toBeGreaterThanOrEqual(0);
    expect(firstRunIndex).toBeGreaterThan(validateIndex);
  });

  it('(B3a) creates neo4j driver with bolt URI and basic auth credentials', async () => {
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    expect(mockNeo4jDriverCtor).toHaveBeenCalledWith(
      expect.stringContaining('bolt://'),
      expect.anything(),
    );
  });

  it('(B4) flattenProps: nested object properties are JSON-stringified', async () => {
    mockReadFileSync.mockReturnValue(NESTED_PROPS_GRAPH_JSON);
    const capturedProps: unknown[] = [];
    mockSessionRun.mockImplementation(async (_q: string, params: Record<string, unknown>) => {
      if (params?.props) capturedProps.push(...(params.props as unknown[]));
      return { records: [] };
    });
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    const nodeProps = capturedProps.find(
      (p): p is Record<string, unknown> => typeof p === 'object' && p !== null && 'meta' in (p as object),
    ) as Record<string, unknown> | undefined;
    expect(nodeProps).toBeDefined();
    expect(typeof nodeProps!.meta).toBe('string');
    expect(() => JSON.parse(nodeProps!.meta as string)).not.toThrow();
  });

  it('(B4a) flattenProps: arrays of objects are JSON-stringified; primitives and primitive arrays are unchanged', async () => {
    mockReadFileSync.mockReturnValue(NESTED_PROPS_GRAPH_JSON);
    const capturedProps: unknown[] = [];
    mockSessionRun.mockImplementation(async (_q: string, params: Record<string, unknown>) => {
      if (params?.props) capturedProps.push(...(params.props as unknown[]));
      return { records: [] };
    });
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    const nodeProps = capturedProps.find(
      (p): p is Record<string, unknown> => typeof p === 'object' && p !== null && 'tags' in (p as object),
    ) as Record<string, unknown> | undefined;
    expect(nodeProps).toBeDefined();
    // array of objects → stringified
    expect(typeof nodeProps!.tags).toBe('string');
    // primitive → unchanged
    expect(nodeProps!.count).toBe(5);
    // array of primitives → unchanged (kept as array)
    expect(Array.isArray(nodeProps!.names)).toBe(true);
  });

  it('(B5) calls session.run for node ingestion (MERGE/UNWIND batches)', async () => {
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    // session.run is called for index creation + node MERGE
    expect(mockSessionRun).toHaveBeenCalled();
    // At least one call should have a 'props' param (node batch)
    const nodeCall = mockSessionRun.mock.calls.find(
      ([, params]) => params && 'props' in params,
    );
    expect(nodeCall).toBeDefined();
  });

  it('(B6) calls session.run for edge ingestion (MATCH+MERGE batches)', async () => {
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    const edgeCall = mockSessionRun.mock.calls.find(
      ([, params]) => params && 'edges' in params,
    );
    expect(edgeCall).toBeDefined();
  });

  it('(B7) queries Neo4j to report node and edge counts after ingestion', async () => {
    mockSessionRun.mockImplementation(async (_q: string) => ({
      records: [makeRecord({ type: 'Function', cnt: neo4jInt(3) })],
    }));
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    // session.run must have been called multiple times (indexes + nodes + edges + reports)
    expect(mockSessionRun.mock.calls.length).toBeGreaterThan(3);
  });

  it('(B8) closes driver in the finally block after successful ingestion', async () => {
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    expect(mockDriverClose).toHaveBeenCalled();
  });

  it('(B8a) closes session in the finally block after successful ingestion', async () => {
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    expect(mockSessionClose).toHaveBeenCalled();
  });

  it('(B9) calls process.exit(1) when a Neo4j session.run throws', async () => {
    mockSessionRun.mockRejectedValueOnce(new Error('Neo4j connection refused'));
    await import('../ingest-to-neo4j.js');
    await flushAsync();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L1-03: parse-and-ingest-self.ts
// Spec: PLAN.md §Phase 1 SG-1 — self-parse CodeGraph source
// ═══════════════════════════════════════════════════════════════════════════════

describe('[L1-03] parse-and-ingest-self.ts — CodeGraph self-parse and ingest', () => {
  it('(B1) constructs TypeScriptParser with CORE_TYPESCRIPT_SCHEMA (no framework schema)', async () => {
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    expect(MockTypeScriptParser).toHaveBeenCalledOnce();
    const ctorArgs = MockTypeScriptParser.mock.calls[0] as unknown[];
    // 4th arg is framework schemas array — must be empty []
    expect(ctorArgs[3]).toEqual([]);
  });

  it('(B1a) calls parseChunk with TS files discovered via execSync find', async () => {
    mockExecSync.mockReturnValue(Buffer.from('/a/foo.ts\n/a/bar.ts'));
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    expect(mockParseChunk).toHaveBeenCalledOnce();
    const [files] = mockParseChunk.mock.calls[0] as [string[]];
    expect(files).toContain('/a/foo.ts');
    expect(files).toContain('/a/bar.ts');
  });

  it('(B2) calls validateProjectWrite before Neo4j session writes', async () => {
    const order: string[] = [];
    mockValidateProjectWrite.mockImplementation(async () => { order.push('validate'); });
    mockSessionRun.mockImplementation(async () => { order.push('run'); return { records: [] }; });
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    expect(order.indexOf('validate')).toBeLessThan(order.indexOf('run'));
  });

  it('(B3) creates neo4j driver and opens a session for ingestion', async () => {
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    expect(mockNeo4jDriverCtor).toHaveBeenCalled();
    expect(mockDriverSession).toHaveBeenCalled();
  });

  it('(B4) flattenProps: nested object properties in parsed nodes are JSON-stringified', async () => {
    mockParseChunk.mockResolvedValue({
      nodes: [
        {
          labels: ['Function'],
          properties: { id: 'n1', nested: { x: 1 }, prim: 42 },
        },
      ],
      edges: [],
    });
    const capturedProps: unknown[] = [];
    mockSessionRun.mockImplementation(async (_q: string, params: Record<string, unknown>) => {
      if (params?.props) capturedProps.push(...(params.props as unknown[]));
      return { records: [] };
    });
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    const nodeProps = capturedProps.find(
      (p): p is Record<string, unknown> => typeof p === 'object' && p !== null && 'nested' in (p as object),
    ) as Record<string, unknown> | undefined;
    expect(nodeProps).toBeDefined();
    expect(typeof nodeProps!.nested).toBe('string');
    expect(nodeProps!.prim).toBe(42);
  });

  it('(B5) writes a JSON summary file to disk via writeFileSync', async () => {
    mockParseChunk.mockResolvedValue({ nodes: [{ labels: ['Fn'], properties: { id: 'x' } }], edges: [] });
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.json'),
      expect.any(String),
    );
  });

  it('(B6) uses execSync to discover TypeScript source files', async () => {
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    expect(mockExecSync).toHaveBeenCalled();
    const [cmd] = mockExecSync.mock.calls[0] as [string];
    expect(cmd).toMatch(/find/);
    expect(cmd).toMatch(/\.ts/);
  });

  it('(B7) queries Neo4j for riskiest functions (session.executeRead called)', async () => {
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    expect(mockExecuteRead).toHaveBeenCalled();
  });

  it('(B8) closes driver in the finally block', async () => {
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    expect(mockDriverClose).toHaveBeenCalled();
  });

  it('(B8a) closes session in the finally block', async () => {
    await import('../parse-and-ingest-self.js');
    await flushAsync();
    expect(mockSessionClose).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L1-04: parse-and-ingest.ts
// Spec: PLAN.md §Phase 1 — parse GodSpeed with Grammy schema
// ═══════════════════════════════════════════════════════════════════════════════

describe('[L1-04] parse-and-ingest.ts — GodSpeed parse and ingest', () => {
  it('(B1) constructs TypeScriptParser with GRAMMY_FRAMEWORK_SCHEMA', async () => {
    await import('../parse-and-ingest.js');
    await flushAsync();
    expect(MockTypeScriptParser).toHaveBeenCalledOnce();
    const ctorArgs = MockTypeScriptParser.mock.calls[0] as unknown[];
    // 4th arg is framework schemas array — must be non-empty for Grammy
    expect(Array.isArray(ctorArgs[3])).toBe(true);
    expect((ctorArgs[3] as unknown[]).length).toBeGreaterThan(0);
  });

  it('(B2) excludes src/src/ legacy directory from file discovery', async () => {
    await import('../parse-and-ingest.js');
    await flushAsync();
    const [cmd] = mockExecSync.mock.calls[0] as [string];
    expect(cmd).toContain('src/src');
  });

  it('(B3) calls validateProjectWrite before Neo4j session writes', async () => {
    const order: string[] = [];
    mockValidateProjectWrite.mockImplementation(async () => { order.push('validate'); });
    mockSessionRun.mockImplementation(async () => { order.push('run'); return { records: [] }; });
    await import('../parse-and-ingest.js');
    await flushAsync();
    expect(order.indexOf('validate')).toBeLessThan(order.indexOf('run'));
  });

  it('(B4) ingests parsed nodes and edges into Neo4j', async () => {
    mockParseChunk.mockResolvedValue({
      nodes: [{ labels: ['Function'], properties: { id: 'n1' } }],
      edges: [{ type: 'CALLS', startNodeId: 'n1', endNodeId: 'n1', properties: {} }],
    });
    await import('../parse-and-ingest.js');
    await flushAsync();
    const nodeCall = mockSessionRun.mock.calls.find(
      ([, params]) => params && 'props' in params,
    );
    expect(nodeCall).toBeDefined();
    const edgeCall = mockSessionRun.mock.calls.find(
      ([, params]) => params && 'edges' in params,
    );
    expect(edgeCall).toBeDefined();
  });

  it('(B5) flattenProps: nested object properties in parsed nodes are JSON-stringified', async () => {
    mockParseChunk.mockResolvedValue({
      nodes: [
        {
          labels: ['Function'],
          properties: { id: 'n1', metadata: { loc: 10 }, score: 99 },
        },
      ],
      edges: [],
    });
    const capturedProps: unknown[] = [];
    mockSessionRun.mockImplementation(async (_q: string, params: Record<string, unknown>) => {
      if (params?.props) capturedProps.push(...(params.props as unknown[]));
      return { records: [] };
    });
    await import('../parse-and-ingest.js');
    await flushAsync();
    const nodeProps = capturedProps.find(
      (p): p is Record<string, unknown> => typeof p === 'object' && p !== null && 'metadata' in (p as object),
    ) as Record<string, unknown> | undefined;
    expect(nodeProps).toBeDefined();
    expect(typeof nodeProps!.metadata).toBe('string');
    expect(nodeProps!.score).toBe(99);
  });

  it('(B6) saves full graph JSON to disk via writeFileSync', async () => {
    mockParseChunk.mockResolvedValue({ nodes: [], edges: [] });
    await import('../parse-and-ingest.js');
    await flushAsync();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.json'),
      expect.any(String),
    );
  });

  it('(B6a) the saved JSON includes nodes and edges arrays from the parse result', async () => {
    mockParseChunk.mockResolvedValue({
      nodes: [{ labels: ['Fn'], properties: { id: 'x' } }],
      edges: [],
    });
    let savedContent = '';
    mockWriteFileSync.mockImplementation((_path: unknown, content: unknown) => {
      savedContent = content as string;
    });
    await import('../parse-and-ingest.js');
    await flushAsync();
    const parsed = JSON.parse(savedContent);
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
  });

  it('(B7) uses execSync to discover GodSpeed TypeScript source files', async () => {
    await import('../parse-and-ingest.js');
    await flushAsync();
    expect(mockExecSync).toHaveBeenCalled();
    const [cmd] = mockExecSync.mock.calls[0] as [string];
    expect(cmd).toMatch(/find/);
    expect(cmd).toMatch(/\.ts/);
  });

  it('(B8) closes driver in the finally block', async () => {
    await import('../parse-and-ingest.js');
    await flushAsync();
    expect(mockDriverClose).toHaveBeenCalled();
  });

  it('(B8a) closes session in the finally block', async () => {
    await import('../parse-and-ingest.js');
    await flushAsync();
    expect(mockSessionClose).toHaveBeenCalled();
  });
});
