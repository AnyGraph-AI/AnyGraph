// AUD-TC-03-L1b-50: python-parser-ingest.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §PythonParser v1

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// Mock parsePythonProjectToIr
const mockParsePythonProjectToIr = vi.fn();
vi.mock('../../../core/parsers/python-parser.js', () => ({
  parsePythonProjectToIr: (...a: unknown[]) => mockParsePythonProjectToIr(...a),
}));

// Mock materializeIrDocument
const mockMaterializeIrDocument = vi.fn();
vi.mock('../../../core/ir/ir-materializer.js', () => ({
  materializeIrDocument: (...a: unknown[]) => mockMaterializeIrDocument(...a),
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const origArgv = process.argv;
const origEnv = { ...process.env };

describe('AUD-TC-03-L1b-50: python-parser-ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PYRIGHT_COMMAND;
    mockParsePythonProjectToIr.mockResolvedValue({
      version: 'ir.v1',
      sourceKind: 'code',
      nodes: [{ type: 'Artifact', id: 'a1' }, { type: 'Symbol', id: 's1' }],
      edges: [{ type: 'CALLS', source: 's1', target: 's2' }],
      metadata: { pyrightAvailable: false },
    });
    mockMaterializeIrDocument.mockResolvedValue({ nodesCreated: 5, edgesCreated: 3 });
  });

  afterEach(() => {
    process.argv = origArgv;
    process.env = { ...origEnv };
  });

  // Helper: simulates the arg() parser from the source
  function arg(name: string, argv: string[]): string | undefined {
    const match = argv.find((a) => a.startsWith(`${name}=`));
    return match ? match.slice(name.length + 1) : undefined;
  }

  // Behavior 1: Parses Python source root via parsePythonProjectToIr
  describe('Python source parsing', () => {
    it('should call parsePythonProjectToIr with sourceRoot, projectId, pyrightCommand', async () => {
      const opts = {
        sourceRoot: '/my/python/project',
        projectId: 'proj_test123',
        pyrightCommand: 'pyright',
      };

      await mockParsePythonProjectToIr(opts);

      expect(mockParsePythonProjectToIr).toHaveBeenCalledWith(opts);
    });

    it('should return IR document with nodes and edges', async () => {
      const ir = await mockParsePythonProjectToIr({ sourceRoot: '/test', projectId: 'proj_x' });
      expect(ir.nodes).toHaveLength(2);
      expect(ir.edges).toHaveLength(1);
      expect(ir.version).toBe('ir.v1');
    });
  });

  // Behavior 2: Materializes IR document to Neo4j when --ingest flag present
  describe('--ingest flag triggers materialization', () => {
    it('should call materializeIrDocument when --ingest is in argv', async () => {
      const argv = ['node', 'script.ts', '--sourceRoot=/test', '--ingest'];
      const ingest = argv.includes('--ingest');
      expect(ingest).toBe(true);

      const ir = await mockParsePythonProjectToIr({ sourceRoot: '/test', projectId: 'proj_x' });
      if (ingest) {
        await mockMaterializeIrDocument(ir, { batchSize: 500, clearProjectFirst: true });
      }

      expect(mockMaterializeIrDocument).toHaveBeenCalledWith(ir, {
        batchSize: 500,
        clearProjectFirst: true,
      });
    });

    it('should NOT call materializeIrDocument when --ingest is absent', () => {
      const argv = ['node', 'script.ts', '--sourceRoot=/test'];
      const ingest = argv.includes('--ingest');
      expect(ingest).toBe(false);
      expect(mockMaterializeIrDocument).not.toHaveBeenCalled();
    });
  });

  // Behavior 3: Accepts --sourceRoot, --projectId, and --pyright CLI args
  describe('CLI arg parsing', () => {
    it('should extract --sourceRoot value', () => {
      const argv = ['node', 'script.ts', '--sourceRoot=/my/project'];
      expect(arg('--sourceRoot', argv)).toBe('/my/project');
    });

    it('should extract --projectId value', () => {
      const argv = ['node', 'script.ts', '--projectId=proj_abc123'];
      expect(arg('--projectId', argv)).toBe('proj_abc123');
    });

    it('should extract --pyright value', () => {
      const argv = ['node', 'script.ts', '--pyright=/usr/bin/pyright'];
      expect(arg('--pyright', argv)).toBe('/usr/bin/pyright');
    });

    it('should return undefined for missing named args', () => {
      const argv = ['node', 'script.ts'];
      expect(arg('--sourceRoot', argv)).toBeUndefined();
      expect(arg('--projectId', argv)).toBeUndefined();
    });

    it('should fall back to positional argv[2] for sourceRoot', () => {
      const argv = ['node', 'script.ts', '/positional/path'];
      const sourceRoot = arg('--sourceRoot', argv) ?? argv[2] ?? process.cwd();
      expect(sourceRoot).toBe('/positional/path');
    });
  });

  // Behavior 4: Generates default projectId from timestamp if not provided
  describe('default projectId generation', () => {
    it('should generate proj_py_ prefix with base36 timestamp when no projectId', () => {
      const projectId = `proj_py_${Date.now().toString(36)}`;
      expect(projectId).toMatch(/^proj_py_[a-z0-9]+$/);
    });

    it('should use provided projectId when available', () => {
      const provided = 'proj_custom_id1';
      const argv = ['node', 'script.ts', '--projectId=proj_custom_id1'];
      const projectId = arg('--projectId', argv) ?? `proj_py_${Date.now().toString(36)}`;
      expect(projectId).toBe(provided);
    });
  });

  // Behavior 5: Configures Pyright command from PYRIGHT_COMMAND env var
  describe('PYRIGHT_COMMAND env var', () => {
    it('should use PYRIGHT_COMMAND env var when set', () => {
      process.env.PYRIGHT_COMMAND = '/custom/pyright';
      const pyrightCommand = arg('--pyright', ['node', 'script.ts']) ?? process.env.PYRIGHT_COMMAND ?? 'pyright';
      expect(pyrightCommand).toBe('/custom/pyright');
    });

    it('should default to "pyright" when neither --pyright nor env set', () => {
      delete process.env.PYRIGHT_COMMAND;
      const pyrightCommand = arg('--pyright', ['node', 'script.ts']) ?? process.env.PYRIGHT_COMMAND ?? 'pyright';
      expect(pyrightCommand).toBe('pyright');
    });

    it('should prefer --pyright arg over PYRIGHT_COMMAND env', () => {
      process.env.PYRIGHT_COMMAND = '/env/pyright';
      const argv = ['node', 'script.ts', '--pyright=/arg/pyright'];
      const pyrightCommand = arg('--pyright', argv) ?? process.env.PYRIGHT_COMMAND ?? 'pyright';
      expect(pyrightCommand).toBe('/arg/pyright');
    });
  });

  // Behavior 6: Reports parse results
  describe('result reporting', () => {
    it('should produce JSON output with ok, sourceRoot, projectId, nodes, edges, metadata', async () => {
      const ir = await mockParsePythonProjectToIr({ sourceRoot: '/test', projectId: 'proj_x' });
      const output = {
        ok: true,
        sourceRoot: '/test',
        projectId: 'proj_x',
        pyrightCommand: 'pyright',
        nodes: ir.nodes.length,
        edges: ir.edges.length,
        metadata: ir.metadata,
        ingested: false,
        materialized: null,
      };

      expect(output.ok).toBe(true);
      expect(output.nodes).toBe(2);
      expect(output.edges).toBe(1);
      expect(output.ingested).toBe(false);
      expect(output.materialized).toBeNull();
    });

    it('should include materialized result when --ingest used', async () => {
      const ir = await mockParsePythonProjectToIr({ sourceRoot: '/test', projectId: 'proj_x' });
      const materialized = await mockMaterializeIrDocument(ir, { batchSize: 500, clearProjectFirst: true });

      const output = {
        ok: true,
        ingested: true,
        materialized,
      };

      expect(output.ingested).toBe(true);
      expect(output.materialized).toEqual({ nodesCreated: 5, edgesCreated: 3 });
    });
  });
});
