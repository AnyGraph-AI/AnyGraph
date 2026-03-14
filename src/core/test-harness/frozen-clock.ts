/**
 * Frozen Clock — Hermetic Time Control
 *
 * Replaces ambient Date.now() / new Date() with deterministic,
 * reproducible time for test runs. Supports freeze, advance, and restore.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N2, S1 Minimum
 */

export interface FrozenClockState {
  /** ISO timestamp the clock is frozen at */
  frozenAt: string;
  /** Original Date constructor (for restore) */
  originalDate: DateConstructor;
  /** Original Date.now (for restore) */
  originalNow: () => number;
  /** Whether the clock is currently frozen */
  active: boolean;
}

let state: FrozenClockState | null = null;

/**
 * Freeze the clock at a specific ISO timestamp.
 * All calls to `Date.now()` and `new Date()` will return this time.
 *
 * @param isoTimestamp - ISO 8601 timestamp to freeze at (default: '2026-01-01T00:00:00.000Z')
 * @returns The frozen timestamp (for provenance recording)
 */
export function freezeClock(isoTimestamp = '2026-01-01T00:00:00.000Z'): string {
  if (state?.active) {
    restoreClock();
  }

  const frozenMs = new Date(isoTimestamp).getTime();
  if (isNaN(frozenMs)) {
    throw new Error(`Invalid ISO timestamp for frozen clock: ${isoTimestamp}`);
  }

  const OriginalDate = globalThis.Date;
  const originalNow = Date.now;

  state = {
    frozenAt: isoTimestamp,
    originalDate: OriginalDate,
    originalNow,
    active: true,
  };

  // Override Date.now()
  Date.now = () => frozenMs;

  // Override Date constructor
  const FrozenDate = function (this: Date, ...args: unknown[]) {
    if (args.length === 0) {
      return new OriginalDate(frozenMs);
    }
    // @ts-expect-error — variadic constructor forwarding
    return new OriginalDate(...args);
  } as unknown as DateConstructor;

  // Copy static methods
  FrozenDate.now = () => frozenMs;
  FrozenDate.parse = OriginalDate.parse;
  FrozenDate.UTC = OriginalDate.UTC;
  Object.defineProperty(FrozenDate, 'prototype', { value: OriginalDate.prototype });

  globalThis.Date = FrozenDate;

  return isoTimestamp;
}

/**
 * Advance the frozen clock by a number of milliseconds.
 * Only works when the clock is frozen.
 */
export function advanceClock(ms: number): string {
  if (!state?.active) {
    throw new Error('Cannot advance clock: not frozen');
  }

  const currentMs = new Date(state.frozenAt).getTime();
  const newMs = currentMs + ms;
  const newIso = new Date(newMs).toISOString();

  // Re-freeze at new time
  const originalDate = state.originalDate;
  const originalNow = state.originalNow;

  state.frozenAt = newIso;

  Date.now = () => newMs;

  const FrozenDate = function (this: Date, ...args: unknown[]) {
    if (args.length === 0) {
      return new originalDate(newMs);
    }
    // @ts-expect-error — variadic constructor forwarding
    return new originalDate(...args);
  } as unknown as DateConstructor;

  FrozenDate.now = () => newMs;
  FrozenDate.parse = originalDate.parse;
  FrozenDate.UTC = originalDate.UTC;
  Object.defineProperty(FrozenDate, 'prototype', { value: originalDate.prototype });

  globalThis.Date = FrozenDate;

  return newIso;
}

/**
 * Restore the original Date behavior.
 */
export function restoreClock(): void {
  if (!state) return;

  globalThis.Date = state.originalDate;
  Date.now = state.originalNow;
  state.active = false;
  state = null;
}

/**
 * Get the current frozen clock state (for provenance recording).
 */
export function getFrozenClockState(): { frozenAt: string; active: boolean } | null {
  if (!state) return null;
  return { frozenAt: state.frozenAt, active: state.active };
}

/**
 * Guard: ensure clock is frozen before running test logic.
 * Throws if clock is not frozen (prevents ambient time leakage).
 */
export function requireFrozenClock(): void {
  if (!state?.active) {
    throw new Error(
      'Test requires frozen clock but clock is not frozen. ' +
      'Call freezeClock() before running this test.'
    );
  }
}
