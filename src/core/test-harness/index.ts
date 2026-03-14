/**
 * Test Harness — Hermetic Environment Control
 *
 * Single entry point for freezing all ambient sources of non-determinism.
 * Every governed test should call `setupHermeticEnv()` before execution
 * and `teardownHermeticEnv()` after.
 *
 * Records all hermetic state in a provenance-compatible format for
 * the test provenance schema (see N1 schemas).
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N2
 */

import { freezeClock, restoreClock, getFrozenClockState } from './frozen-clock.js';
import { freezeLocale, restoreLocale, getFrozenLocaleState } from './frozen-locale.js';
import { seedRNG, restoreRNG, getRNGState } from './seeded-rng.js';
import { blockNetwork, unblockNetwork, getBlockedRequests, type NetworkGuardConfig } from './network-guard.js';

export { freezeClock, advanceClock, restoreClock, getFrozenClockState, requireFrozenClock } from './frozen-clock.js';
export { freezeLocale, restoreLocale, getFrozenLocaleState, requireFrozenLocale } from './frozen-locale.js';
export { seedRNG, restoreRNG, getRNGState, requireSeededRNG } from './seeded-rng.js';
export { blockNetwork, unblockNetwork, getBlockedRequests, requireNetworkBlocked, type NetworkGuardConfig } from './network-guard.js';
export {
  createEphemeralGraph,
  codeGraphFixture,
  planGraphFixture,
  type EphemeralGraphConfig,
  type EphemeralGraphRuntime,
  type TestFixture,
} from './ephemeral-graph.js';

// ============================================================================
// HERMETIC ENVIRONMENT — ALL-IN-ONE
// ============================================================================

export interface HermeticEnvConfig {
  /** ISO timestamp for frozen clock (default: '2026-01-01T00:00:00.000Z') */
  frozenClock?: string;
  /** IANA timezone (default: 'UTC') */
  timezone?: string;
  /** BCP 47 locale (default: 'en-US') */
  locale?: string;
  /** RNG seed string (default: 'test-seed-0') */
  rngSeed?: string;
  /** Override Math.random (default: true) */
  overrideMathRandom?: boolean;
  /** Block ambient network access (default: true) */
  blockNetwork?: boolean;
  /** Network guard config (hosts/ports whitelist) */
  networkGuard?: NetworkGuardConfig;
}

export interface HermeticEnvState {
  clock: { frozenAt: string; active: boolean } | null;
  locale: { timezone: string; locale: string; active: boolean } | null;
  rng: { seed: string; active: boolean } | null;
  network: { blocked: boolean; blockedRequests: number } | null;
}

/**
 * Set up a fully hermetic test environment.
 * Freezes clock, locale, and RNG in one call.
 *
 * @returns Hermetic state (for provenance recording)
 */
export function setupHermeticEnv(config: HermeticEnvConfig = {}): HermeticEnvState {
  const {
    frozenClock = '2026-01-01T00:00:00.000Z',
    timezone = 'UTC',
    locale = 'en-US',
    rngSeed = 'test-seed-0',
    overrideMathRandom = true,
    blockNetwork: shouldBlockNetwork = true,
    networkGuard,
  } = config;

  freezeClock(frozenClock);
  freezeLocale(timezone, locale);
  seedRNG(rngSeed, overrideMathRandom);
  if (shouldBlockNetwork) {
    blockNetwork(networkGuard);
  }

  return getHermeticState();
}

/**
 * Tear down the hermetic environment, restoring all original behavior.
 */
export function teardownHermeticEnv(): void {
  unblockNetwork();
  restoreRNG();
  restoreLocale();
  restoreClock();
}

/**
 * Get current hermetic state snapshot (for provenance ExternalParameters).
 */
export function getHermeticState(): HermeticEnvState {
  const blockedReqs = getBlockedRequests();
  return {
    clock: getFrozenClockState(),
    locale: getFrozenLocaleState(),
    rng: getRNGState(),
    network: blockedReqs !== undefined ? { blocked: true, blockedRequests: blockedReqs.length } : null,
  };
}

/**
 * Convert hermetic state to provenance ExternalParameters format.
 * Compatible with TestProvenanceRecord.externalParameters.
 */
export function hermeticStateToProvenance(
  state: HermeticEnvState,
  lane: string,
  fixtureTier: 'micro' | 'scenario' | 'sampled' | 'stress' = 'micro'
): {
  lane: string;
  fixtureTier: string;
  seed?: string;
  frozenClock?: string;
  timezone?: string;
  locale?: string;
} {
  return {
    lane,
    fixtureTier,
    ...(state.rng?.seed ? { seed: state.rng.seed } : {}),
    ...(state.clock?.frozenAt ? { frozenClock: state.clock.frozenAt } : {}),
    ...(state.locale?.timezone ? { timezone: state.locale.timezone } : {}),
    ...(state.locale?.locale ? { locale: state.locale.locale } : {}),
  };
}
