// Spec source: plans/codegraph/PLAN.md §Phase 1
//
// AUD-TC-05 Agent A2 — Entry Points Audit (Parser Validation Scripts)
//
// Spec-derived tests for:
//   L1-10: test-parse-godspeed.ts — 8 behavioral assertions
//   L1-11: test-resolves-to.ts   — 7 behavioral assertions
//
// ⚠️  Both entry points auto-execute main() on import (no exports).
//     Tests use vi.resetModules() + dynamic import per CORRECTIONS.md.
//
// FINDINGS:
//   FIND-A2-01 [LOW] — test-resolves-to.ts: Imports TypeScriptParser,
//     CORE_TYPESCRIPT_SCHEMA, GRAMMY_FRAMEWORK_SCHEMA but none of these are
//     used inside main(). The file resolves symbols entirely via ts-morph
//     Project without invoking the TypeScriptParser. Spec says "uses
//     TypeScriptParser + schemas" but the code doesn't.
//     Spec gap: either remove unused imports or document the intended usage.
//   FIND-A2-02 [LOW] — test-parse-godspeed.ts: GODSPEED_PATH is hardcoded to
//     '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/' with no fallback. If the
//     path does not exist on the machine, discoverSourceFiles() returns an
//     empty array and the script produces misleading "0 nodes / 0 edges" output
//     instead of failing clearly. Spec says "exits cleanly" but silent no-op is
//     not a meaningful validation pass.
//   FIND-A2-03 [INFO] — test-resolves-to.ts: process.exit(1) is only called
//     via .catch() at the bottom; any unhandled rejection inside the Project
//     mock setup (before the async boundary) could bypass it. Not a test-
//     blocking issue but worth noting for production hardening.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Stable vi.fn() instances (reused across vi.resetModules() cycles) ────────

// TypeScriptParser mock internals
const mockDiscoverSourceFiles = vi.fn();
const mockParseChunk          = vi.fn();
const mockResolveDeferredEdges = vi.fn();

// ts-morph Project mock internals
const mockAddSourceFilesAtPaths = vi.fn();
const mockGetImportDeclarations  = vi.fn();

// fs mock
const mockWriteFileSync = vi.fn();

// process.exit spy (replaced per test)
let mockProcessExit: ReturnType<typeof vi.fn>;

// ─── vi.mock registrations (hoisted) ─────────────────────────────────────────

vi.mock('../../../../src/core/parsers/typescript-parser.js', () => ({
  TypeScriptParser: vi.fn(function MockTypeScriptParser(
    this: Record<string, unknown>,
  ) {
    this.discoverSourceFiles  = mockDiscoverSourceFiles;
    this.parseChunk           = mockParseChunk;
    this.resolveDeferredEdges = mockResolveDeferredEdges;
  }),
}));

vi.mock('../../../../src/core/config/schema.js', () => ({
  CORE_TYPESCRIPT_SCHEMA: { name: 'core', nodeTypes: [], edgeTypes: [] },
}));

vi.mock('../../../../src/core/config/grammy-framework-schema.js', () => ({
  GRAMMY_FRAMEWORK_SCHEMA: { name: 'grammy', nodeTypes: [], edgeTypes: [] },
}));

vi.mock('fs', () => ({
  default: { writeFileSync: mockWriteFileSync },
  writeFileSync: mockWriteFileSync,
}));

// ts-morph mock — Project constructor + addSourceFilesAtPaths
vi.mock('ts-morph', () => {
  const mockSf = {
    getFilePath: vi.fn(() => '/GodSpeed/src/bot/index.ts'),
    getImportDeclarations: mockGetImportDeclarations,
  };

  return {
    Project: vi.fn(function MockProject(this: Record<string, unknown>) {
      this.addSourceFilesAtPaths = mockAddSourceFilesAtPaths;
    }),
    Node: {},
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal parsed result returned by mockParseChunk */
function makeParseResult() {
  return {
    nodes: [
      {
        labels: ['Function'],
        properties: {
          id: 'node_001',
          name: 'createBot',
          coreType: 'FunctionDeclaration',
          filePath: '/GodSpeed/src/bot/index.ts',
          startLine: 10,
          endLine: 50,
          semanticType: 'BotFactory',
        },
      },
      {
        labels: ['Function'],
        properties: {
          id: 'node_002',
          name: 'onStart',
          coreType: 'MethodDeclaration',
          filePath: '/GodSpeed/src/handlers/start.ts',
          startLine: 1,
          endLine: 20,
          context: {
            registrationKind: 'command',
            registrationTrigger: 'start',
          },
        },
      },
      {
        labels: ['Entrypoint'],
        properties: {
          id: 'ep_001',
          name: '/start',
          context: {
            entrypointKind: 'command',
            trigger: 'start',
          },
        },
      },
    ],
    edges: [
      { type: 'CALLS',         startNodeId: 'node_001', endNodeId: 'node_002' },
      { type: 'REGISTERED_BY', startNodeId: 'node_002', endNodeId: 'ep_001'  },
    ],
  };
}

/** Minimal named-import stub for ts-morph resolution tests */
function makeNamedImport(
  name: string,
  resolved: boolean,
  selfPath = '/GodSpeed/src/bot/index.ts',
) {
  const symbol = resolved
    ? {
        getAliasedSymbol: vi.fn(() => ({
          getDeclarations: vi.fn(() => [
            {
              getKindName:      vi.fn(() => 'FunctionDeclaration'),
              getName:          vi.fn(() => name),
              getStartLineNumber: vi.fn(() => 5),
              getSourceFile:    vi.fn(() => ({
                getFilePath: vi.fn(() => '/GodSpeed/src/utils/helpers.ts'),
              })),
            },
          ]),
        })),
        getDeclarations: vi.fn(() => [
          {
            getKindName:      vi.fn(() => 'FunctionDeclaration'),
            getName:          vi.fn(() => name),
            getStartLineNumber: vi.fn(() => 5),
            getSourceFile:    vi.fn(() => ({
              getFilePath: vi.fn(() => '/GodSpeed/src/utils/helpers.ts'),
            })),
          },
        ]),
      }
    : null;

  return {
    getName:        vi.fn(() => name),
    getAliasNode:   vi.fn(() => null),
    isTypeOnly:     vi.fn(() => false),
    getSymbol:      vi.fn(() => symbol),
  };
}

/** Minimal import-declaration stub */
function makeImportDecl(moduleSpec: string, namedImports: ReturnType<typeof makeNamedImport>[]) {
  return {
    getModuleSpecifierValue: vi.fn(() => moduleSpec),
    getNamedImports:         vi.fn(() => namedImports),
    getDefaultImport:        vi.fn(() => null),
    getNamespaceImport:      vi.fn(() => null),
  };
}

// ─── Suite A: test-parse-godspeed.ts ─────────────────────────────────────────

describe('L1-10: test-parse-godspeed.ts', () => {
  beforeEach(() => {
    vi.resetModules();

    mockProcessExit = vi.fn();
    vi.stubGlobal('process', { ...process, exit: mockProcessExit });

    const result = makeParseResult();
    mockDiscoverSourceFiles.mockResolvedValue([
      '/GodSpeed/src/bot/index.ts',
      '/GodSpeed/src/handlers/start.ts',
    ]);
    mockParseChunk.mockResolvedValue(result);
    mockResolveDeferredEdges.mockResolvedValue([
      { type: 'CALLS', startNodeId: 'node_002', endNodeId: 'node_003' },
    ]);
    mockWriteFileSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('B1: constructs TypeScriptParser with Grammy schema and Core schema', async () => {
    const { TypeScriptParser } = await import(
      '../../../../src/core/parsers/typescript-parser.js'
    );
    await import('../test-parse-godspeed.js');

    expect(TypeScriptParser).toHaveBeenCalledOnce();

    const args = vi.mocked(TypeScriptParser).mock.calls[0] as unknown[];
    // arg[0] = GODSPEED_PATH
    expect(typeof args[0]).toBe('string');
    expect(args[0]).toContain('GodSpeed');
    // arg[2] = CORE_TYPESCRIPT_SCHEMA (truthy object)
    expect(args[2]).toBeTruthy();
    expect(typeof args[2]).toBe('object');
    // arg[3] = array containing GRAMMY_FRAMEWORK_SCHEMA
    const frameworkSchemas = args[3] as unknown[];
    expect(Array.isArray(frameworkSchemas)).toBe(true);
    expect(frameworkSchemas.length).toBeGreaterThanOrEqual(1);
    expect(frameworkSchemas[0]).toBeTruthy();
  });

  it('B2: calls discoverSourceFiles to locate GodSpeed source tree', async () => {
    await import('../test-parse-godspeed.js');

    expect(mockDiscoverSourceFiles).toHaveBeenCalledOnce();
  });

  it('B3: calls parseChunk with the discovered (filtered) file list', async () => {
    await import('../test-parse-godspeed.js');

    expect(mockParseChunk).toHaveBeenCalledOnce();
    const [files] = mockParseChunk.mock.calls[0] as [string[]];
    expect(Array.isArray(files)).toBe(true);
    // Files not containing src/src/ duplicates (filter applied)
    const hasSrcSrc = files.some((f: string) => f.includes('/src/src/'));
    expect(hasSrcSrc).toBe(false);
  });

  it('B4: calls resolveDeferredEdges to collect cross-file edges', async () => {
    await import('../test-parse-godspeed.js');

    expect(mockResolveDeferredEdges).toHaveBeenCalledOnce();
  });

  it('B5: writes JSON output to godspeed-fork-parse.json via fs.writeFileSync', async () => {
    await import('../test-parse-godspeed.js');

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [filename, content] = mockWriteFileSync.mock.calls[0] as [string, string];
    expect(filename).toBe('godspeed-fork-parse.json');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed).toHaveProperty('summary');
    const summary = parsed.summary as Record<string, unknown>;
    expect(summary).toHaveProperty('nodes');
    expect(summary).toHaveProperty('edges');
    // Spike baseline embedded in output
    const spike = summary.spike_comparison as Record<string, number>;
    expect(spike).toHaveProperty('spike_nodes', 214);
    expect(spike).toHaveProperty('spike_edges', 5161);
  });

  it('B6: output summary reflects actual node/edge counts from parser result', async () => {
    await import('../test-parse-godspeed.js');

    const [, content] = mockWriteFileSync.mock.calls[0] as [string, string];
    const parsed = JSON.parse(content) as { summary: { nodes: number; edges: number } };
    // 3 nodes from parseChunk + 2 direct edges + 1 deferred = 3 total edges
    expect(parsed.summary.nodes).toBe(3);
    expect(parsed.summary.edges).toBe(3);
  });

  it('B7: does NOT call process.exit(1) on successful parse (exits cleanly)', async () => {
    await import('../test-parse-godspeed.js');

    // process.exit should not be called on happy path
    const exitCalls = mockProcessExit.mock.calls.filter(
      (c: unknown[]) => c[0] === 1,
    );
    expect(exitCalls).toHaveLength(0);
  });

  it('B8: calls process.exit(1) when parseChunk throws an error', async () => {
    mockParseChunk.mockRejectedValueOnce(new Error('parser exploded'));

    await import('../test-parse-godspeed.js');
    // Allow the rejection to propagate through the .catch handler
    await new Promise(resolve => setTimeout(resolve, 50));

    const exitWith1 = mockProcessExit.mock.calls.some(
      (c: unknown[]) => c[0] === 1,
    );
    expect(exitWith1).toBe(true);
  });
});

// ─── Suite B: test-resolves-to.ts ────────────────────────────────────────────

describe('L1-11: test-resolves-to.ts', () => {
  beforeEach(() => {
    vi.resetModules();

    mockProcessExit = vi.fn();
    vi.stubGlobal('process', { ...process, exit: mockProcessExit });

    // Build a minimal source file with 2 named imports (1 resolved, 1 not)
    const namedImports = [
      makeNamedImport('createBot', true),
      makeNamedImport('UnresolvedFoo', false),
    ];
    const importDecl = makeImportDecl('./handlers/start.js', namedImports);

    const mockSf = {
      getFilePath:          vi.fn(() => '/GodSpeed/src/bot/index.ts'),
      getImportDeclarations: vi.fn(() => [importDecl]),
    };

    // addSourceFilesAtPaths returns our mock source file
    mockAddSourceFilesAtPaths.mockReturnValue([mockSf]);
    // Also expose on the prototype for the summary loop
    mockGetImportDeclarations.mockReturnValue([importDecl]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('B1: constructs ts-morph Project with compiler options', async () => {
    const { Project } = await import('ts-morph');
    await import('../test-resolves-to.js');

    expect(Project).toHaveBeenCalledOnce();
    const [opts] = (Project as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { compilerOptions: Record<string, unknown> },
    ];
    expect(opts).toHaveProperty('compilerOptions');
    const co = opts.compilerOptions;
    expect(co).toHaveProperty('allowJs', true);
    expect(co).toHaveProperty('noEmit', true);
  });

  it('B2: calls addSourceFilesAtPaths with GodSpeed source glob patterns', async () => {
    await import('../test-resolves-to.js');

    expect(mockAddSourceFilesAtPaths).toHaveBeenCalledOnce();
    const [patterns] = mockAddSourceFilesAtPaths.mock.calls[0] as [string[]];
    expect(Array.isArray(patterns)).toBe(true);
    // Must include the GodSpeed src tree
    const hasGodSpeed = patterns.some((p: string) => p.includes('GodSpeed'));
    expect(hasGodSpeed).toBe(true);
    // Must exclude src/src/ duplicates
    const hasSrcSrcExclusion = patterns.some(
      (p: string) => p.startsWith('!') && p.includes('/src/src/'),
    );
    expect(hasSrcSrcExclusion).toBe(true);
  });

  it('B3: iterates import declarations on each source file', async () => {
    const mockSf = {
      getFilePath:          vi.fn(() => '/GodSpeed/src/bot/index.ts'),
      getImportDeclarations: vi.fn(() => [
        makeImportDecl('./handlers.js', [makeNamedImport('foo', true)]),
      ]),
    };
    mockAddSourceFilesAtPaths.mockReturnValue([mockSf]);

    await import('../test-resolves-to.js');

    expect(mockSf.getImportDeclarations).toHaveBeenCalled();
  });

  it('B4: attempts symbol resolution on named imports via getSymbol()', async () => {
    const named = makeNamedImport('someExport', true);
    const importDecl = makeImportDecl('./utils.js', [named]);
    const mockSf = {
      getFilePath:          vi.fn(() => '/GodSpeed/src/bot/index.ts'),
      getImportDeclarations: vi.fn(() => [importDecl]),
    };
    mockAddSourceFilesAtPaths.mockReturnValue([mockSf]);

    await import('../test-resolves-to.js');

    expect(named.getSymbol).toHaveBeenCalled();
  });

  it('B5: reports resolution rate in console output (RESOLUTION SUMMARY block)', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await import('../test-resolves-to.js');
      await new Promise(resolve => setTimeout(resolve, 50));

      const output = consoleSpy.mock.calls.map((c: unknown[]) => String(c[0]));
      const hasSummary = output.some(line => line.includes('RESOLUTION SUMMARY'));
      expect(hasSummary).toBe(true);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('B6: does NOT call process.exit(1) on successful resolution', async () => {
    await import('../test-resolves-to.js');
    await new Promise(resolve => setTimeout(resolve, 50));

    const exitWith1 = mockProcessExit.mock.calls.some(
      (c: unknown[]) => c[0] === 1,
    );
    expect(exitWith1).toBe(false);
  });

  it('B7: calls process.exit(1) when Project construction throws', async () => {
    const { Project } = await import('ts-morph');
    (Project as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('ts-morph init failed');
    });

    await import('../test-resolves-to.js');
    await new Promise(resolve => setTimeout(resolve, 50));

    const exitWith1 = mockProcessExit.mock.calls.some(
      (c: unknown[]) => c[0] === 1,
    );
    expect(exitWith1).toBe(true);
  });
});
