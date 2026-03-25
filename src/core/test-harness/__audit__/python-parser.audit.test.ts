// Spec source: plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md
//   §"Build PythonParser v1: ast extraction + Pyright sidecar" (line ~494)
//   §"Tier 1 — Compiler-grade" Python lane
//   §"IR v1 Schema" (lines 107–120)
//   §"Tier Metadata" (lines 73–80)
// AUD-TC-11a-L1-02: python-parser.ts (395 lines)

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { createHash } from 'node:crypto';

// ── Mocks must be declared before imports ──────────────────────────

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

vi.mock('glob', () => ({
  glob: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { readFile: vi.fn() },
  readFile: vi.fn(),
}));

import { PythonParser, parsePythonProjectToIr } from '../../parsers/python-parser.js';
import { spawnSync } from 'node:child_process';
import { glob } from 'glob';
import fs from 'fs/promises';
import { IrDocumentSchema } from '../../ir/ir-v1.schema.js';

// ── Helpers ────────────────────────────────────────────────────────

const PROJECT_ID = 'proj_test_python';
const SOURCE_ROOT = '/tmp/test-python-project';

function makeParser(overrides: Record<string, unknown> = {}): PythonParser {
  return new PythonParser({
    sourceRoot: SOURCE_ROOT,
    projectId: PROJECT_ID,
    ...overrides,
  });
}

/** Reproduce the id() algorithm from source to verify deterministic IDs */
function expectedId(prefix: string, value: string): string {
  const h = createHash('sha256').update(`${PROJECT_ID}:${value}`).digest('hex').slice(0, 16);
  return `${PROJECT_ID}:${prefix}:${h}`;
}

/** Build a mock python3 AST stdout for a single file */
function mockAstOutput(payload: {
  defs?: Array<{ kind: string; name: string; qualname?: string; line: number; col: number; endLine?: number; endCol?: number; parent?: string | null }>;
  calls?: Array<{ name: string; line: number; col: number }>;
  imports?: Array<{ module: string; alias?: string | null; line: number; col: number }>;
}): string {
  return JSON.stringify({
    defs: payload.defs ?? [],
    calls: payload.calls ?? [],
    imports: payload.imports ?? [],
    engine: 'python-ast',
  });
}

// ── Test suite ─────────────────────────────────────────────────────

describe('python-parser.ts — spec-derived audit tests (AUD-TC-11a-L1-02)', () => {
  const mockSpawnSync = spawnSync as unknown as Mock;
  const mockGlob = glob as unknown as Mock;
  const mockReadFile = fs.readFile as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Behavior 1: parseToIr returns valid IrDocument ───
  describe('B1: parseToIr returns valid IrDocument with version=ir.v1 and sourceKind=code', () => {
    it('produces an IrDocument that passes schema validation', async () => {
      mockGlob.mockResolvedValue([]);
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', error: null });

      const parser = makeParser();
      const ir = await parser.parseToIr();

      expect(ir.version).toBe('ir.v1');
      expect(ir.sourceKind).toBe('code');
      expect(ir.projectId).toBe(PROJECT_ID);

      // Validate against Zod schema
      const result = IrDocumentSchema.safeParse(ir);
      expect(result.success).toBe(true);
    });

    it('includes sourceRoot in the IrDocument', async () => {
      mockGlob.mockResolvedValue([]);
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      expect(ir.sourceRoot).toBe(SOURCE_ROOT);
    });
  });

  // ─── Behavior 2: file discovery via glob with defaults ───
  describe('B2: file discovery uses includeGlobs (default **/*.py) and excludes DEFAULT_EXCLUDES', () => {
    it('calls glob with default **/*.py pattern and excludes .venv, __pycache__, .git, node_modules', async () => {
      mockGlob.mockResolvedValue([]);
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', error: null });

      await makeParser().parseToIr();

      expect(mockGlob).toHaveBeenCalledWith(
        ['**/*.py'],
        expect.objectContaining({
          cwd: SOURCE_ROOT,
          absolute: true,
          nodir: true,
          ignore: expect.arrayContaining([
            '**/.venv/**',
            '**/__pycache__/**',
            '**/.git/**',
            '**/node_modules/**',
          ]),
        }),
      );
    });

    it('respects custom includeGlobs when provided', async () => {
      mockGlob.mockResolvedValue([]);
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', error: null });

      await makeParser({ includeGlobs: ['src/**/*.py'] }).parseToIr();

      expect(mockGlob).toHaveBeenCalledWith(
        ['src/**/*.py'],
        expect.objectContaining({ cwd: SOURCE_ROOT }),
      );
    });
  });

  // ─── Behavior 3: Python AST parsing via spawnSync ───
  describe('B3: parseViaPythonAst spawns python3 -c with ast module script', () => {
    it('spawns python3 for each discovered file and extracts defs/calls/imports', async () => {
      const filePath = `${SOURCE_ROOT}/main.py`;
      mockGlob.mockResolvedValue([filePath]);

      const astOutput = mockAstOutput({
        defs: [{ kind: 'function', name: 'hello', qualname: 'hello', line: 1, col: 0 }],
        calls: [{ name: 'print', line: 2, col: 4 }],
        imports: [{ module: 'os', alias: null, line: 3, col: 0 }],
      });

      // First call: python3 for AST. Second call: pyright.
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: astOutput, stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: '{"generalDiagnostics": []}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();

      // Verify python3 was called
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'python3',
        expect.arrayContaining(['-c']),
        expect.objectContaining({ encoding: 'utf-8' }),
      );

      // Should have Symbol, Entity (import), Site (call) nodes
      const symbolNodes = ir.nodes.filter((n) => n.type === 'Symbol' && n.kind === 'PythonFunction');
      expect(symbolNodes.length).toBe(1);
      expect(symbolNodes[0].name).toBe('hello');

      const importNodes = ir.nodes.filter((n) => n.kind === 'PythonImport');
      expect(importNodes.length).toBe(1);

      const callSiteNodes = ir.nodes.filter((n) => n.kind === 'PythonCallSite');
      expect(callSiteNodes.length).toBe(1);
    });
  });

  // ─── Behavior 4: regex fallback when AST fails ───
  describe('B4: regex fallback activates when Python AST fails', () => {
    it('falls back to regex when python3 exits non-zero', async () => {
      const filePath = `${SOURCE_ROOT}/broken.py`;
      mockGlob.mockResolvedValue([filePath]);

      // python3 fails
      mockSpawnSync
        .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'error', error: null })
        .mockReturnValueOnce({ status: 0, stdout: '{"generalDiagnostics": []}', stderr: '', error: null });

      // regex fallback reads file
      mockReadFile.mockResolvedValue('def my_func():\n    pass\nclass MyClass:\n    pass\nimport os\n');

      const ir = await makeParser().parseToIr();

      // Artifact node should have engine='regex-fallback' in properties
      const artifact = ir.nodes.find((n) => n.type === 'Artifact');
      expect(artifact).toBeDefined();
      expect(artifact!.properties?.parserEngine).toBe('regex-fallback');

      // Should still extract defs via regex
      const symbols = ir.nodes.filter((n) => n.type === 'Symbol' && (n.kind === 'PythonFunction' || n.kind === 'PythonClass'));
      expect(symbols.length).toBeGreaterThanOrEqual(2);
    });

    it('falls back to regex when python3 returns empty stdout', async () => {
      const filePath = `${SOURCE_ROOT}/empty_ast.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: '', stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      mockReadFile.mockResolvedValue('def fallback_test():\n    pass\n');

      const ir = await makeParser().parseToIr();

      const artifact = ir.nodes.find((n) => n.type === 'Artifact');
      expect(artifact!.properties?.parserEngine).toBe('regex-fallback');
    });
  });

  // ─── Behavior 5: AST confidence 0.95 vs regex 0.65 on Artifact ───
  describe('B5: AST engine produces confidence 0.95 on Artifact; regex fallback produces 0.65', () => {
    it('Artifact confidence is 0.95 when AST succeeds', async () => {
      const filePath = `${SOURCE_ROOT}/good.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: mockAstOutput({}), stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      const artifact = ir.nodes.find((n) => n.type === 'Artifact');
      expect(artifact!.confidence).toBe(0.95);
    });

    it('Artifact confidence is 0.65 when regex fallback activates', async () => {
      const filePath = `${SOURCE_ROOT}/fallback.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({ status: 1, stdout: '', stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      mockReadFile.mockResolvedValue('');

      const ir = await makeParser().parseToIr();
      const artifact = ir.nodes.find((n) => n.type === 'Artifact');
      expect(artifact!.confidence).toBe(0.65);
    });
  });

  // ─── Behavior 6: Symbol nodes confidence 0.9 and parserTier 1 ───
  describe('B6: Symbol nodes from defs have confidence 0.9 and parserTier 1', () => {
    it('function def Symbol has confidence 0.9 and parserTier 1', async () => {
      const filePath = `${SOURCE_ROOT}/funcs.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: mockAstOutput({
            defs: [{ kind: 'function', name: 'greet', qualname: 'greet', line: 1, col: 0 }],
          }),
          stderr: '',
          error: null,
        })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      const symbol = ir.nodes.find((n) => n.type === 'Symbol' && n.kind === 'PythonFunction');
      expect(symbol).toBeDefined();
      expect(symbol!.confidence).toBe(0.9);
      expect(symbol!.parserTier).toBe(1);
    });

    it('class def Symbol has confidence 0.9 and parserTier 1', async () => {
      const filePath = `${SOURCE_ROOT}/classes.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: mockAstOutput({
            defs: [{ kind: 'class', name: 'Foo', qualname: 'Foo', line: 1, col: 0 }],
          }),
          stderr: '',
          error: null,
        })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      const symbol = ir.nodes.find((n) => n.type === 'Symbol' && n.kind === 'PythonClass');
      expect(symbol).toBeDefined();
      expect(symbol!.confidence).toBe(0.9);
      expect(symbol!.parserTier).toBe(1);
    });
  });

  // ─── Behavior 7: CALLS edge confidence — resolved 0.8, unresolved 0.45 ───
  describe('B7: CALLS edges — resolved symbols 0.8, unresolved get PythonUnresolvedSymbol (0.4) with CALLS 0.45', () => {
    it('resolved call gets CALLS edge with confidence 0.8', async () => {
      const filePath = `${SOURCE_ROOT}/resolved.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: mockAstOutput({
            defs: [{ kind: 'function', name: 'target_fn', qualname: 'target_fn', line: 1, col: 0 }],
            calls: [{ name: 'target_fn', line: 5, col: 4 }],
          }),
          stderr: '',
          error: null,
        })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();

      const callsEdges = ir.edges.filter((e) => e.type === 'CALLS');
      expect(callsEdges.length).toBeGreaterThanOrEqual(1);
      const resolvedCall = callsEdges.find((e) => e.confidence === 0.8);
      expect(resolvedCall).toBeDefined();
    });

    it('unresolved call creates PythonUnresolvedSymbol with confidence 0.4 and CALLS edge at 0.45', async () => {
      const filePath = `${SOURCE_ROOT}/unresolved.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: mockAstOutput({
            defs: [],
            calls: [{ name: 'unknown_func', line: 1, col: 0 }],
          }),
          stderr: '',
          error: null,
        })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();

      const unresolvedNode = ir.nodes.find((n) => n.kind === 'PythonUnresolvedSymbol');
      expect(unresolvedNode).toBeDefined();
      expect(unresolvedNode!.confidence).toBe(0.4);

      const callsEdge = ir.edges.find((e) => e.type === 'CALLS' && e.to === unresolvedNode!.id);
      expect(callsEdge).toBeDefined();
      expect(callsEdge!.confidence).toBe(0.45);
    });
  });

  // ─── Behavior 8: PythonImport nodes ───
  describe('B8: import nodes (PythonImport) have confidence 0.92 with module/alias properties', () => {
    it('creates PythonImport Entity with confidence 0.92 and module property', async () => {
      const filePath = `${SOURCE_ROOT}/imports.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: mockAstOutput({
            imports: [{ module: 'json', alias: null, line: 1, col: 0 }],
          }),
          stderr: '',
          error: null,
        })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      const importNode = ir.nodes.find((n) => n.kind === 'PythonImport');
      expect(importNode).toBeDefined();
      expect(importNode!.type).toBe('Entity');
      expect(importNode!.confidence).toBe(0.92);
      expect(importNode!.properties?.module).toBe('json');
    });

    it('includes alias in properties and name when present', async () => {
      const filePath = `${SOURCE_ROOT}/alias_import.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: mockAstOutput({
            imports: [{ module: 'numpy', alias: 'np', line: 1, col: 0 }],
          }),
          stderr: '',
          error: null,
        })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      const importNode = ir.nodes.find((n) => n.kind === 'PythonImport');
      expect(importNode).toBeDefined();
      expect(importNode!.properties?.alias).toBe('np');
      expect(importNode!.name).toBe('numpy as np');
    });
  });

  // ─── Behavior 9: runPyright returns {available, exitCode, diagnostics} ───
  describe('B9: runPyright runs pyright and returns {available, exitCode, diagnostics}', () => {
    it('returns available=true with exitCode and diagnostics count when pyright succeeds', async () => {
      mockGlob.mockResolvedValue([]);

      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({ generalDiagnostics: [{}, {}] }),
        stderr: '',
        error: null,
      });

      const ir = await makeParser().parseToIr();
      expect(ir.metadata.pyrightAvailable).toBe(true);
      expect(ir.metadata.pyrightExitCode).toBe(0);
      expect(ir.metadata.pyrightDiagnostics).toBe(2);
    });

    it('returns available=false when pyright errors', async () => {
      mockGlob.mockResolvedValue([]);

      mockSpawnSync.mockReturnValueOnce({
        status: null,
        stdout: '',
        stderr: '',
        error: new Error('command not found'),
      });

      const ir = await makeParser().parseToIr();
      expect(ir.metadata.pyrightAvailable).toBe(false);
      expect(ir.metadata.pyrightExitCode).toBeNull();
      expect(ir.metadata.pyrightDiagnostics).toBe(0);
    });
  });

  // ─── Behavior 10: deterministic IDs via SHA256 ───
  describe('B10: deterministic IDs via id(prefix, value) use SHA256 of ${projectId}:${value}', () => {
    it('produces deterministic Artifact ID matching SHA256 of projectId:value', async () => {
      const filePath = `${SOURCE_ROOT}/det.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: mockAstOutput({}), stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      const artifact = ir.nodes.find((n) => n.type === 'Artifact');
      expect(artifact).toBeDefined();

      const relPath = 'det.py';
      const expected = expectedId('py:file', relPath);
      expect(artifact!.id).toBe(expected);
    });

    it('same input produces same ID across invocations (determinism)', async () => {
      const filePath = `${SOURCE_ROOT}/stable.py`;
      mockGlob.mockResolvedValue([filePath]);

      const astOut = mockAstOutput({});
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: astOut, stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: astOut, stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir1 = await makeParser().parseToIr();
      const ir2 = await makeParser().parseToIr();

      const id1 = ir1.nodes.find((n) => n.type === 'Artifact')!.id;
      const id2 = ir2.nodes.find((n) => n.type === 'Artifact')!.id;
      expect(id1).toBe(id2);
    });
  });

  // ─── Behavior 11: IrDocument metadata ───
  describe('B11: IrDocument metadata includes parser, parserTier, fileCount', () => {
    it('metadata contains parser=python-parser-v1, parserTier=1, correct fileCount', async () => {
      const files = [`${SOURCE_ROOT}/a.py`, `${SOURCE_ROOT}/b.py`];
      mockGlob.mockResolvedValue(files);

      const astOut = mockAstOutput({});
      mockSpawnSync
        .mockReturnValueOnce({ status: 0, stdout: astOut, stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: astOut, stderr: '', error: null })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      expect(ir.metadata.parser).toBe('python-parser-v1');
      expect(ir.metadata.parserTier).toBe(1);
      expect(ir.metadata.fileCount).toBe(2);
    });
  });

  // ─── Behavior 12: qualname for nested defs ───
  describe('B12: qualname is used for symbol names when available (nested defs)', () => {
    it('uses qualname for nested function symbol name', async () => {
      const filePath = `${SOURCE_ROOT}/nested.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: mockAstOutput({
            defs: [
              { kind: 'class', name: 'Outer', qualname: 'Outer', line: 1, col: 0 },
              { kind: 'function', name: 'inner', qualname: 'Outer.inner', line: 2, col: 4, parent: 'Outer' },
            ],
          }),
          stderr: '',
          error: null,
        })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      const innerSymbol = ir.nodes.find((n) => n.type === 'Symbol' && n.name === 'Outer.inner');
      expect(innerSymbol).toBeDefined();
      expect(innerSymbol!.name).toBe('Outer.inner');
    });

    it('falls back to plain name when qualname is absent', async () => {
      const filePath = `${SOURCE_ROOT}/plain.py`;
      mockGlob.mockResolvedValue([filePath]);

      mockSpawnSync
        .mockReturnValueOnce({
          status: 0,
          stdout: mockAstOutput({
            defs: [{ kind: 'function', name: 'standalone', line: 1, col: 0 }],
          }),
          stderr: '',
          error: null,
        })
        .mockReturnValueOnce({ status: 0, stdout: '{}', stderr: '', error: null });

      const ir = await makeParser().parseToIr();
      const symbol = ir.nodes.find((n) => n.type === 'Symbol' && n.kind === 'PythonFunction');
      expect(symbol).toBeDefined();
      expect(symbol!.name).toBe('standalone');
    });
  });

  // ─── Additional: parsePythonProjectToIr convenience function ───
  describe('parsePythonProjectToIr convenience wrapper', () => {
    it('returns a valid IrDocument via the convenience function', async () => {
      mockGlob.mockResolvedValue([]);
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '', error: null });

      const ir = await parsePythonProjectToIr({ sourceRoot: SOURCE_ROOT, projectId: PROJECT_ID });
      expect(ir.version).toBe('ir.v1');
      expect(ir.projectId).toBe(PROJECT_ID);
    });
  });

  // ─── FINDINGS ───
  // FIND-11a-01 (LOW): Spec §"Tier Metadata" says parserTier values are string enums
  //   ('compiler' | 'workspace-semantic' | 'structural'). Implementation uses numeric
  //   tiers (0 | 1 | 2) per IR v1 Zod schema. The IR schema is authoritative for
  //   implementation, but spec text is inconsistent with runtime representation.
  //
  // FIND-11a-02 (LOW): Task spec says id() hashes "${projectId}:${prefix}:${value}".
  //   Actual implementation hashes "${projectId}:${value}" (prefix excluded from hash
  //   input, only used in the output format "${projectId}:${prefix}:${hash}"). This is
  //   a spec-vs-implementation divergence. Tests follow implementation since the hash
  //   is deterministic and consistent — but the spec text should be corrected.
});
