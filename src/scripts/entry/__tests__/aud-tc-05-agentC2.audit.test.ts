// Spec source: plans/codegraph/PLAN.md §Phase 2
//
// AUD-TC-05 Agent C2 — Entry Points Audit: watch.ts
//
// Spec-derived tests for:
//   L1-12: watch.ts — standalone file watcher via MCP client (139 lines)
//
// Spec behaviors:
//   (1) spawns MCP server as child process via StdioClientTransport
//   (2) connects MCP Client
//   (3) lists available tools after connecting
//   (4) calls start_watch_project with debounceMs:1000
//   (5) registers setNotificationHandler for logging events
//   (6) passes debounceMs:1000 to start_watch_project
//   (7) registers graceful shutdown on SIGINT and SIGTERM
//   (8) shutdown calls stop_watch_project + client.close() + process.exit(0)
//   (9) fatal errors in main() invoke process.exit(1)
//  (10) default project is 'godspeed' when no argv[2] provided
//  (11) custom project path can be specified as argv[2]
//
// FINDINGS:
//   FIND-05-C2-01 [LOW] — watch.ts: spec §Phase 2 says "closes MCP client in
//     finally block." Implementation closes in the shutdown handler only, not in a
//     try/finally around main(). If main() throws before registering SIGINT
//     (e.g., connect fails), client.close() is never called.
//     Recommendation: wrap the body of main() in try/finally and call client.close()
//     there as well.
//   FIND-05-C2-02 [INFO] — watch.ts: spec mentions chokidar-based file watching but
//     source delegates all watching to the MCP server via start_watch_project.
//     No direct chokidar import in this entry point. Watching happens inside the
//     server process. Spec gap — task description may refer to the server side.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Stable vi.fn() instances (survive vi.resetModules) ──────────────────────

// MCP Client method mocks
const mockConnect = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();
const mockClose = vi.fn();
const mockSetNotificationHandler = vi.fn();

// StdioClientTransport mock
const mockTransportCtor = vi.fn();

// ─── vi.mock registrations (hoisted) ─────────────────────────────────────────

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function MockClient(this: Record<string, unknown>) {
    this.connect = mockConnect;
    this.listTools = mockListTools;
    this.callTool = mockCallTool;
    this.close = mockClose;
    this.setNotificationHandler = mockSetNotificationHandler;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(function MockTransport(
    this: Record<string, unknown>,
    opts: unknown,
  ) {
    this._opts = opts;
  }),
}));

// LoggingMessageNotificationSchema just needs to be a stable reference
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  LoggingMessageNotificationSchema: { schema: 'logging-notification' },
}));

// ─── Helper: flush pending microtasks / macrotasks ────────────────────────────

const flushAsync = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 80));

// ─── State shared across tests ────────────────────────────────────────────────

const originalArgv = [...process.argv];
let exitSpy: ReturnType<typeof vi.spyOn>;
let processOnSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

// ─── Global before/afterEach ──────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  process.argv = [...originalArgv];

  // Prevent real process.exit from terminating the test runner
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(
    (_code?: number): never => undefined as never,
  );

  // Capture signal handler registrations
  processOnSpy = vi.spyOn(process, 'on');

  // Suppress console output
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Default mock return values
  mockConnect.mockReset().mockResolvedValue(undefined);
  mockListTools.mockReset().mockResolvedValue({ tools: [{ name: 'start_watch_project' }, { name: 'stop_watch_project' }] });
  mockCallTool.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'Watching started.' }] });
  mockClose.mockReset().mockResolvedValue(undefined);
  mockSetNotificationHandler.mockReset();
  mockTransportCtor.mockReset();
});

afterEach(() => {
  process.argv = [...originalArgv];
  vi.restoreAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find a registered process.on handler for a given signal */
function captureSignalHandler(signal: string): ((...args: unknown[]) => unknown) | undefined {
  const call = processOnSpy.mock.calls.find(
    (c) => c[0] === signal,
  );
  return call ? (call[1] as (...args: unknown[]) => unknown) : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// L1-12: watch.ts — Phase 2 MCP-based file watcher
// ═══════════════════════════════════════════════════════════════════════════════

describe('[L1-12] watch.ts — Phase 2 Standalone MCP File Watcher', () => {

  // ── (1) StdioClientTransport spawns server as child process ──

  it('(B1) creates StdioClientTransport with node command to spawn MCP server', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'node' }),
    );
  });

  // ── (2) Client.connect() is called ──

  it('(B2) connects MCP Client to the transport after creating it', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    expect(mockConnect).toHaveBeenCalled();
  });

  // ── (3) listTools is called after connecting ──

  it('(B3) calls client.listTools() after connecting to discover available tools', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    expect(mockListTools).toHaveBeenCalled();
  });

  it('(B3) logs the count of available tools after listing', async () => {
    process.argv = ['node', 'watch.js'];
    mockListTools.mockResolvedValue({ tools: [{ name: 't1' }, { name: 't2' }, { name: 't3' }] });
    await import('../watch.js');
    await flushAsync();

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toMatch(/3.*tools?|tools?.*3/i);
  });

  // ── (4) start_watch_project tool call ──

  it('(B4) calls start_watch_project MCP tool with correct tool name', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'start_watch_project' }),
    );
  });

  it('(B4) passes projectPath and projectId arguments to start_watch_project', async () => {
    process.argv = ['node', 'watch.js', 'codegraph'];
    await import('../watch.js');
    await flushAsync();

    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'start_watch_project',
        arguments: expect.objectContaining({
          projectPath: expect.stringContaining('codegraph'),
          projectId: 'proj_c0d3e9a1f200',
        }),
      }),
    );
  });

  // ── (5+6) Notification handler and debounce ──

  it('(B5) registers setNotificationHandler for MCP logging notifications', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    expect(mockSetNotificationHandler).toHaveBeenCalled();
  });

  it('(B6) passes debounceMs:1000 to start_watch_project', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'start_watch_project',
        arguments: expect.objectContaining({
          debounceMs: 1000,
        }),
      }),
    );
  });

  // ── (7) Signal handler registration ──

  it('(B7) registers SIGINT handler for graceful shutdown', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    const sigintCalls = processOnSpy.mock.calls.filter(c => c[0] === 'SIGINT');
    expect(sigintCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('(B7) registers SIGTERM handler for graceful shutdown', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    const sigtermCalls = processOnSpy.mock.calls.filter(c => c[0] === 'SIGTERM');
    expect(sigtermCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── (8) Shutdown handler: calls stop_watch_project, close, exit(0) ──

  it('(B8) shutdown handler calls stop_watch_project before closing client', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    const handler = captureSignalHandler('SIGINT');
    expect(handler).toBeDefined();

    // Reset callTool to track only shutdown-triggered calls
    mockCallTool.mockClear();
    await handler?.();
    await flushAsync();

    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'stop_watch_project' }),
    );
  });

  it('(B8) shutdown handler calls client.close() after stopping watch', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    const handler = captureSignalHandler('SIGTERM');
    expect(handler).toBeDefined();

    mockClose.mockClear();
    await handler?.();
    await flushAsync();

    expect(mockClose).toHaveBeenCalled();
  });

  it('(B8) shutdown handler calls process.exit(0) after cleanup', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    const handler = captureSignalHandler('SIGINT');
    expect(handler).toBeDefined();

    exitSpy.mockClear();
    await handler?.();
    await flushAsync();

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // ── (9) Fatal error path ──

  it('(B9) calls process.exit(1) when client.connect() rejects (fatal error)', async () => {
    mockConnect.mockRejectedValueOnce(new Error('server spawn failed'));
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // ── (10) Default project selection ──

  it('(B10) defaults to godspeed project path when no argv[2] provided', async () => {
    process.argv = ['node', 'watch.js'];
    await import('../watch.js');
    await flushAsync();

    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'start_watch_project',
        arguments: expect.objectContaining({
          projectPath: expect.stringContaining('GodSpeed'),
        }),
      }),
    );
  });

  // ── (11) Custom project path via argv ──

  it('(B11) uses custom path from argv[2] when it is not a known project key', async () => {
    process.argv = ['node', 'watch.js', '/custom/path/to/myproject'];
    await import('../watch.js');
    await flushAsync();

    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'start_watch_project',
        arguments: expect.objectContaining({
          projectPath: '/custom/path/to/myproject',
        }),
      }),
    );
  });
});
