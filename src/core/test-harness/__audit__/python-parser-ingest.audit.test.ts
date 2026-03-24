// AUD-TC-03-L1b-50 — B6 (Health Witness)
// Spec-derived audit tests for python-parser-ingest.ts
// Spec: plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §PythonParser v1

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

describe('AUD-TC-03-L1b-50 | python-parser-ingest.ts', () => {
  const origArgv = process.argv;
  const origEnv = { ...process.env };
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalExit = process.exit;
  let logOutput: string[] = [];
  let errorOutput: string[] = [];

  const defaultIr = {
    version: 'ir.v1',
    sourceKind: 'code',
    nodes: [{ type: 'Artifact', id: 'a1' }, { type: 'Symbol', id: 's1' }],
    edges: [{ type: 'CALLS', source: 's1', target: 's2' }],
    metadata: { pyrightAvailable: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    logOutput = [];
    errorOutput = [];
    console.log = (...args: unknown[]) => logOutput.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => errorOutput.push(args.map(String).join(' '));
    process.exit = vi.fn() as any;
    delete process.env.PYRIGHT_COMMAND;

    mockParsePythonProjectToIr.mockResolvedValue({ ...defaultIr });
    mockMaterializeIrDocument.mockResolvedValue({ nodesCreated: 5, edgesCreated: 3 });
  });

  afterEach(() => {
    process.argv = origArgv;
    process.env = { ...origEnv };
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalExit;
  });

  // ─── Behavior 1: Parses Python source root via parsePythonProjectToIr ───
  describe('Python source parsing via module execution', () => {
    it('calls parsePythonProjectToIr with sourceRoot, projectId, pyrightCommand', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/my/python', '--projectId=proj_test'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call).toHaveProperty('sourceRoot');
      expect(call).toHaveProperty('projectId', 'proj_test');
      expect(call).toHaveProperty('pyrightCommand');
    });

    it('returns IR document with nodes and edges in output', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ok).toBe(true);
      expect(parsed.nodes).toBe(2);
      expect(parsed.edges).toBe(1);
    });
  });

  // ─── Behavior 2: Materializes IR to Neo4j when --ingest present ───
  describe('--ingest flag triggers materialization', () => {
    it('calls materializeIrDocument when --ingest is in argv', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test', '--ingest'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockMaterializeIrDocument).toHaveBeenCalled(), { timeout: 2000 });

      expect(mockMaterializeIrDocument).toHaveBeenCalledWith(
        expect.objectContaining({ version: 'ir.v1' }),
        expect.objectContaining({ batchSize: 500, clearProjectFirst: true }),
      );
    });

    it('does NOT call materializeIrDocument when --ingest is absent', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      expect(mockMaterializeIrDocument).not.toHaveBeenCalled();

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ingested).toBe(false);
      expect(parsed.materialized).toBeNull();
    });

    it('includes materialized result in output when --ingest used', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test', '--ingest'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ingested).toBe(true);
      expect(parsed.materialized).toEqual({ nodesCreated: 5, edgesCreated: 3 });
    });
  });

  // ─── Behavior 3: Accepts --sourceRoot, --projectId, --pyright CLI args ───
  describe('CLI arg parsing', () => {
    it('parses --sourceRoot from argv', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/custom/root'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call.sourceRoot).toContain('/custom/root');
    });

    it('uses positional argv[2] as sourceRoot fallback', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '/positional/path'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call.sourceRoot).toContain('/positional/path');
    });

    it('parses --projectId from argv', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test', '--projectId=proj_arg_test'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call.projectId).toBe('proj_arg_test');
    });

    it('parses --pyright from argv', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test', '--pyright=/custom/pyright'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call.pyrightCommand).toBe('/custom/pyright');
    });
  });

  // ─── Behavior 4: Generates default projectId from timestamp ───
  describe('default projectId generation', () => {
    it('generates proj_py_ prefix with base36 timestamp when no --projectId', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call.projectId).toMatch(/^proj_py_[a-z0-9]+$/);
    });

    it('uses provided --projectId when available', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test', '--projectId=proj_explicit'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call.projectId).toBe('proj_explicit');
    });
  });

  // ─── Behavior 5: Configures Pyright from PYRIGHT_COMMAND env ───
  describe('PYRIGHT_COMMAND env var', () => {
    it('uses PYRIGHT_COMMAND env var when set', async () => {
      vi.resetModules();
      process.env.PYRIGHT_COMMAND = '/env/pyright';
      process.argv = ['node', 'script.ts', '--sourceRoot=/test'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call.pyrightCommand).toBe('/env/pyright');
    });

    it('defaults to "pyright" when neither --pyright nor env set', async () => {
      vi.resetModules();
      delete process.env.PYRIGHT_COMMAND;
      process.argv = ['node', 'script.ts', '--sourceRoot=/test'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call.pyrightCommand).toBe('pyright');
    });

    it('prefers --pyright arg over PYRIGHT_COMMAND env', async () => {
      vi.resetModules();
      process.env.PYRIGHT_COMMAND = '/env/pyright';
      process.argv = ['node', 'script.ts', '--sourceRoot=/test', '--pyright=/arg/pyright'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(mockParsePythonProjectToIr).toHaveBeenCalled(), { timeout: 2000 });

      const call = mockParsePythonProjectToIr.mock.calls[0][0];
      expect(call.pyrightCommand).toBe('/arg/pyright');
    });
  });

  // ─── Behavior 6: Reports parse results ───
  describe('result reporting', () => {
    it('outputs JSON with ok, sourceRoot, projectId, nodes, edges, metadata', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test', '--projectId=proj_report'];

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ok).toBe(true);
      expect(parsed.sourceRoot).toContain('/test');
      expect(parsed.projectId).toBe('proj_report');
      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('edges');
      expect(parsed).toHaveProperty('metadata');
    });

    it('catch handler exits with code 1 on parse failure', async () => {
      vi.resetModules();
      process.argv = ['node', 'script.ts', '--sourceRoot=/test'];
      mockParsePythonProjectToIr.mockRejectedValueOnce(new Error('parse failed'));

      await import('../../../utils/python-parser-ingest');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errJson = errorOutput.find((e) => e.includes('parse failed'));
      expect(errJson).toBeDefined();
    });
  });
});
