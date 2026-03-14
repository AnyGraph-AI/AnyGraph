/**
 * Network Guard — Block Ambient Network Access in Tests
 *
 * Overrides Socket.prototype.connect (writable even in ESM) to reject
 * connections to non-whitelisted destinations. All higher-level APIs
 * (http.request, https.get, net.createConnection) flow through Socket.connect.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N2, Task 3
 */

import * as net from 'node:net';

// ============================================================================
// TYPES
// ============================================================================

export interface NetworkGuardConfig {
  /** Allowed hostnames (default: ['localhost', '127.0.0.1', '::1']) */
  allowedHosts?: string[];
  /** Allowed ports (default: [7687, 7474] for Neo4j bolt + HTTP) */
  allowedPorts?: number[];
}

interface NetworkGuardState {
  originalConnect: typeof net.Socket.prototype.connect;
  blocked: Array<{ host: string; port: number; timestamp: number }>;
  config: Required<NetworkGuardConfig>;
  active: boolean;
}

let state: NetworkGuardState | null = null;

// ============================================================================
// CORE
// ============================================================================

/**
 * Block ambient network access. Only whitelisted hosts/ports are allowed.
 * By default, allows localhost:7687 (Neo4j bolt) and localhost:7474 (Neo4j HTTP).
 */
export function blockNetwork(config: NetworkGuardConfig = {}): void {
  if (state?.active) {
    unblockNetwork();
  }

  const resolvedConfig: Required<NetworkGuardConfig> = {
    allowedHosts: config.allowedHosts ?? ['localhost', '127.0.0.1', '::1'],
    allowedPorts: config.allowedPorts ?? [7687, 7474],
  };

  const originalConnect = net.Socket.prototype.connect;

  state = {
    originalConnect,
    blocked: [],
    config: resolvedConfig,
    active: true,
  };

  const guardState = state;

  net.Socket.prototype.connect = function guardedConnect(
    this: net.Socket,
    ...args: Parameters<typeof net.Socket.prototype.connect>
  ): net.Socket {
    const opts = extractConnectOpts(args);
    if (opts && !isAllowed(opts.host, opts.port, resolvedConfig)) {
      const entry = {
        host: opts.host ?? 'unknown',
        port: opts.port ?? 0,
        timestamp: Date.now(),
      };
      guardState.blocked.push(entry);

      // Emit error on next tick instead of throwing (Socket contract)
      const err = new Error(
        `[network-guard] Blocked connection to ${entry.host}:${entry.port}. ` +
        `Only allowed: ${resolvedConfig.allowedHosts.join(',')}:${resolvedConfig.allowedPorts.join(',')}`
      );
      process.nextTick(() => {
        this.destroy(err);
      });
      return this;
    }
    return originalConnect.apply(this, args);
  } as typeof net.Socket.prototype.connect;
}

/**
 * Restore original network access.
 */
export function unblockNetwork(): void {
  if (!state) return;
  net.Socket.prototype.connect = state.originalConnect;
  state.active = false;
  state = null;
}

/**
 * Get list of blocked network requests (for diagnostics).
 */
export function getBlockedRequests(): Array<{ host: string; port: number; timestamp: number }> {
  return state?.blocked ?? [];
}

/**
 * Guard: ensure network is blocked before running test logic.
 */
export function requireNetworkBlocked(): void {
  if (!state?.active) {
    throw new Error(
      'Test requires network guard but network is not blocked. ' +
      'Call blockNetwork() before running this test.'
    );
  }
}

// ============================================================================
// INTERNALS
// ============================================================================

function isAllowed(
  host: string | undefined,
  port: number | undefined,
  config: Required<NetworkGuardConfig>
): boolean {
  const resolvedHost = host ?? 'localhost';
  const resolvedPort = port ?? 80;

  const hostAllowed = config.allowedHosts.includes(resolvedHost);
  const portAllowed = config.allowedPorts.length === 0 || config.allowedPorts.includes(resolvedPort);

  return hostAllowed && portAllowed;
}

function extractConnectOpts(args: unknown[]): { host?: string; port?: number } | null {
  const first = args[0];

  // net.connect(port, host?)
  if (typeof first === 'number') {
    return { port: first, host: (args[1] as string) ?? undefined };
  }

  // net.connect({host, port})
  if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
    const opts = first as Record<string, unknown>;
    // Skip Unix domain sockets
    if ('path' in opts && typeof opts.path === 'string') return null;
    return {
      host: (opts.host ?? opts.hostname) as string | undefined,
      port: opts.port as number | undefined,
    };
  }

  return null;
}
