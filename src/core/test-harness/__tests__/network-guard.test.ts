/**
 * Network Guard — Smoke Tests
 *
 * Tests Socket.prototype.connect interception.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import {
  blockNetwork,
  unblockNetwork,
  getBlockedRequests,
} from '../network-guard.js';

/** Helper: try connecting and check if guard blocked it */
function tryConnect(host: string, port: number): Promise<{ guardBlocked: boolean }> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let guardBlocked = false;

    sock.on('error', (err) => {
      if (err.message.includes('[network-guard]')) {
        guardBlocked = true;
      }
      sock.destroy();
      resolve({ guardBlocked });
    });

    sock.on('connect', () => {
      sock.destroy();
      resolve({ guardBlocked: false });
    });

    sock.setTimeout(500, () => {
      sock.destroy();
      resolve({ guardBlocked });
    });

    sock.connect({ host, port });
  });
}

describe('Network Guard', () => {
  afterEach(() => {
    unblockNetwork();
  });

  it('blocks external connections', async () => {
    blockNetwork();
    const result = await tryConnect('example.com', 80);
    expect(result.guardBlocked).toBe(true);
  });

  it('allows localhost Neo4j bolt (7687)', async () => {
    blockNetwork();
    const result = await tryConnect('localhost', 7687);
    expect(result.guardBlocked).toBe(false);
  });

  it('allows 127.0.0.1 Neo4j HTTP (7474)', async () => {
    blockNetwork();
    const result = await tryConnect('127.0.0.1', 7474);
    expect(result.guardBlocked).toBe(false);
  });

  it('blocks localhost on non-whitelisted port', async () => {
    blockNetwork();
    const result = await tryConnect('localhost', 3000);
    expect(result.guardBlocked).toBe(true);
  });

  it('records blocked attempts', async () => {
    blockNetwork();
    await tryConnect('evil.com', 443);
    await tryConnect('bad.org', 80);
    const blocked = getBlockedRequests();
    expect(blocked).toHaveLength(2);
    expect(blocked[0].host).toBe('evil.com');
    expect(blocked[1].host).toBe('bad.org');
  });

  it('unblock restores connections', async () => {
    blockNetwork();
    unblockNetwork();
    const result = await tryConnect('localhost', 3000);
    expect(result.guardBlocked).toBe(false);
  });

  it('custom allowed hosts/ports', async () => {
    blockNetwork({ allowedHosts: ['localhost'], allowedPorts: [9999] });

    const r1 = await tryConnect('localhost', 9999);
    expect(r1.guardBlocked).toBe(false);

    const r2 = await tryConnect('localhost', 7687);
    expect(r2.guardBlocked).toBe(true);
  });
});
