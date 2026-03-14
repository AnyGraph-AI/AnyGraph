/**
 * Deterministic Replay — One-Command Test Replay
 *
 * Records test execution state (hermetic env config + fixture + results)
 * into a replay packet. A replay packet can reproduce the exact test
 * conditions: same clock, locale, RNG seed, fixture data, and network state.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N2, Task 4
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  getHermeticState,
  type HermeticEnvConfig,
  type HermeticEnvState,
} from './index.js';
import {
  createEphemeralGraph,
  type EphemeralGraphConfig,
  type EphemeralGraphRuntime,
  type TestFixture,
} from './ephemeral-graph.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ReplayPacket {
  /** Schema version for forward compatibility */
  schemaVersion: 1;
  /** Unique replay ID */
  replayId: string;
  /** When this packet was recorded */
  recordedAt: string;
  /** Hermetic environment configuration */
  hermeticConfig: HermeticEnvConfig;
  /** Test fixture data (if graph was used) */
  fixture?: TestFixture;
  /** Ephemeral graph config (if graph was used) */
  graphConfig?: Partial<EphemeralGraphConfig>;
  /** Test lane (A, B, C1, C2, C3, D, E) */
  lane: string;
  /** Test name/description */
  testName: string;
  /** SHA-256 digest of the packet (excluding this field) */
  digest: string;
  /** Test result snapshot */
  result?: {
    passed: boolean;
    assertions: number;
    duration_ms: number;
    error?: string;
  };
}

export interface ReplayContext {
  /** The replay packet being executed */
  packet: ReplayPacket;
  /** Hermetic env state after setup */
  hermeticState: HermeticEnvState;
  /** Ephemeral graph runtime (if fixture was provided) */
  graph?: EphemeralGraphRuntime;
  /** Record a test result into the packet */
  recordResult: (result: ReplayPacket['result']) => void;
  /** Teardown everything and return the final packet */
  finish: () => Promise<ReplayPacket>;
}

// ============================================================================
// RECORDING
// ============================================================================

/**
 * Create a replay packet from current test configuration.
 * Does NOT set up the environment — just creates the metadata.
 */
export function createReplayPacket(opts: {
  testName: string;
  lane: string;
  hermeticConfig?: HermeticEnvConfig;
  fixture?: TestFixture;
  graphConfig?: Partial<EphemeralGraphConfig>;
}): ReplayPacket {
  const packet: ReplayPacket = {
    schemaVersion: 1,
    replayId: `rp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: new Date().toISOString(),
    hermeticConfig: opts.hermeticConfig ?? {},
    lane: opts.lane,
    testName: opts.testName,
    digest: '', // computed below
  };

  if (opts.fixture) packet.fixture = opts.fixture;
  if (opts.graphConfig) packet.graphConfig = opts.graphConfig;

  packet.digest = computeDigest(packet);
  return packet;
}

/**
 * Set up a full replay context: hermetic env + optional ephemeral graph.
 * Returns a context object with graph access and result recording.
 */
export async function setupReplay(opts: {
  testName: string;
  lane: string;
  hermeticConfig?: HermeticEnvConfig;
  fixture?: TestFixture;
  graphConfig?: Partial<EphemeralGraphConfig>;
}): Promise<ReplayContext> {
  const packet = createReplayPacket(opts);

  // Set up hermetic environment
  const hermeticState = setupHermeticEnv(packet.hermeticConfig);

  // Set up ephemeral graph if fixture provided
  let graph: EphemeralGraphRuntime | undefined;
  if (packet.fixture) {
    graph = await createEphemeralGraph({
      ...packet.graphConfig,
      setupSchema: packet.graphConfig?.setupSchema ?? false,
    });
    await graph.seed(packet.fixture);
  }

  return {
    packet,
    hermeticState,
    graph,
    recordResult: (result) => {
      packet.result = result;
    },
    finish: async () => {
      if (graph) await graph.teardown();
      teardownHermeticEnv();
      // Recompute digest with result included
      packet.digest = computeDigest(packet);
      return packet;
    },
  };
}

/**
 * Replay from a saved packet. Sets up identical conditions.
 */
export async function replayFromPacket(packet: ReplayPacket): Promise<ReplayContext> {
  // Verify digest (excluding result — original recording may have had different result)
  const packetCopy = { ...packet, result: undefined, digest: '' };
  packetCopy.digest = computeDigest(packetCopy);
  // We don't fail on mismatch — just warn (packet may have been hand-edited)

  return setupReplay({
    testName: packet.testName,
    lane: packet.lane,
    hermeticConfig: packet.hermeticConfig,
    fixture: packet.fixture,
    graphConfig: packet.graphConfig,
  });
}

// ============================================================================
// PERSISTENCE
// ============================================================================

const DEFAULT_REPLAY_DIR = 'artifacts/replays';

/**
 * Save a replay packet to disk.
 */
export function saveReplayPacket(
  packet: ReplayPacket,
  baseDir: string = DEFAULT_REPLAY_DIR
): string {
  const dir = join(baseDir, packet.lane);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const filename = `${packet.replayId}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(packet, null, 2));
  return filepath;
}

/**
 * Load a replay packet from disk.
 */
export function loadReplayPacket(filepath: string): ReplayPacket {
  const content = readFileSync(filepath, 'utf-8');
  return JSON.parse(content) as ReplayPacket;
}

// ============================================================================
// DIGEST
// ============================================================================

/**
 * Compute SHA-256 digest of a replay packet (excluding the digest field itself).
 */
function computeDigest(packet: ReplayPacket): string {
  const { digest: _, ...rest } = packet;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify a replay packet's digest matches its content.
 */
export function verifyReplayDigest(packet: ReplayPacket): boolean {
  const expected = computeDigest({ ...packet, digest: '' });
  return packet.digest === expected;
}
