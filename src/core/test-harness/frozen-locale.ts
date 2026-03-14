/**
 * Frozen Locale — Hermetic Timezone & Locale Control
 *
 * Forces deterministic timezone and locale for test runs.
 * Prevents locale-dependent formatting from causing flaky tests.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N2, S1 Minimum
 */

export interface FrozenLocaleState {
  timezone: string;
  locale: string;
  originalTZ: string | undefined;
  originalLANG: string | undefined;
  originalLC_ALL: string | undefined;
  active: boolean;
}

let state: FrozenLocaleState | null = null;

/**
 * Freeze timezone and locale to deterministic values.
 *
 * @param timezone - IANA timezone (default: 'UTC')
 * @param locale - BCP 47 locale (default: 'en-US')
 */
export function freezeLocale(timezone = 'UTC', locale = 'en-US'): { timezone: string; locale: string } {
  if (state?.active) {
    restoreLocale();
  }

  state = {
    timezone,
    locale,
    originalTZ: process.env.TZ,
    originalLANG: process.env.LANG,
    originalLC_ALL: process.env.LC_ALL,
    active: true,
  };

  // Set environment variables for timezone/locale
  process.env.TZ = timezone;
  process.env.LANG = locale;
  process.env.LC_ALL = locale;

  return { timezone, locale };
}

/**
 * Restore original timezone and locale.
 */
export function restoreLocale(): void {
  if (!state) return;

  if (state.originalTZ !== undefined) {
    process.env.TZ = state.originalTZ;
  } else {
    delete process.env.TZ;
  }

  if (state.originalLANG !== undefined) {
    process.env.LANG = state.originalLANG;
  } else {
    delete process.env.LANG;
  }

  if (state.originalLC_ALL !== undefined) {
    process.env.LC_ALL = state.originalLC_ALL;
  } else {
    delete process.env.LC_ALL;
  }

  state.active = false;
  state = null;
}

/**
 * Get the current frozen locale state (for provenance recording).
 */
export function getFrozenLocaleState(): { timezone: string; locale: string; active: boolean } | null {
  if (!state) return null;
  return { timezone: state.timezone, locale: state.locale, active: state.active };
}

/**
 * Guard: ensure locale is frozen before running test logic.
 */
export function requireFrozenLocale(): void {
  if (!state?.active) {
    throw new Error(
      'Test requires frozen locale but locale is not frozen. ' +
      'Call freezeLocale() before running this test.'
    );
  }
}
