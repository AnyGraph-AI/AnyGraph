/**
 * Network Guard — Smoke Tests
 *
 * Tests Socket.prototype.connect interception.
 */

import * as net from 'node:net';
import {
  blockNetwork,
  unblockNetwork,
  getBlockedRequests,
} from '../network-guard.js';

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

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

    // Timeout for unresolvable hosts
    sock.setTimeout(500, () => {
      sock.destroy();
      resolve({ guardBlocked });
    });

    sock.connect({ host, port });
  });
}

async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const tests: [string, () => Promise<void>][] = [
    ['blocks external connections', async () => {
      blockNetwork();
      const result = await tryConnect('example.com', 80);
      assert(result.guardBlocked, 'should have blocked example.com:80');
      unblockNetwork();
    }],

    ['allows localhost Neo4j bolt (7687)', async () => {
      blockNetwork();
      const result = await tryConnect('localhost', 7687);
      assert(!result.guardBlocked, 'should NOT block localhost:7687');
      unblockNetwork();
    }],

    ['allows 127.0.0.1 Neo4j HTTP (7474)', async () => {
      blockNetwork();
      const result = await tryConnect('127.0.0.1', 7474);
      assert(!result.guardBlocked, 'should NOT block 127.0.0.1:7474');
      unblockNetwork();
    }],

    ['blocks localhost on non-whitelisted port', async () => {
      blockNetwork();
      const result = await tryConnect('localhost', 3000);
      assert(result.guardBlocked, 'should block localhost:3000');
      unblockNetwork();
    }],

    ['records blocked attempts', async () => {
      blockNetwork();
      await tryConnect('evil.com', 443);
      await tryConnect('bad.org', 80);
      const blocked = getBlockedRequests();
      assert(blocked.length === 2, `expected 2 blocked, got ${blocked.length}`);
      assert(blocked[0].host === 'evil.com', `wrong host[0]: ${blocked[0].host}`);
      assert(blocked[1].host === 'bad.org', `wrong host[1]: ${blocked[1].host}`);
      unblockNetwork();
    }],

    ['unblock restores connections', async () => {
      blockNetwork();
      unblockNetwork();
      const result = await tryConnect('localhost', 3000);
      assert(!result.guardBlocked, 'should not guard after unblock');
    }],

    ['custom allowed hosts/ports', async () => {
      blockNetwork({ allowedHosts: ['localhost'], allowedPorts: [9999] });

      // Allowed
      const r1 = await tryConnect('localhost', 9999);
      assert(!r1.guardBlocked, 'should allow custom port');

      // Not allowed
      const r2 = await tryConnect('localhost', 7687);
      assert(r2.guardBlocked, 'should block non-whitelisted port');

      unblockNetwork();
    }],
  ];

  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`  ✅ ${name}`);
    } catch (e) {
      failed++;
      console.error(`  ❌ ${name}: ${(e as Error).message}`);
    }
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

runTests();
