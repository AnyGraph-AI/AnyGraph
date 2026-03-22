'use client';

import { useState, useCallback } from 'react';

export const REFRESH_STORAGE_KEY = 'dashboard-auto-refresh';
export const DEFAULT_REFRESH_INTERVAL = 30_000;

/**
 * UI-7: Auto-refresh toggle with localStorage persistence.
 *
 * Returns:
 * - enabled: whether auto-refresh is on
 * - toggle: flip the enabled state and persist to localStorage
 * - intervalMs: the interval to pass to React Query's refetchInterval
 *               (false when disabled, number when enabled)
 */
export function useAutoRefresh(intervalMs = DEFAULT_REFRESH_INTERVAL): {
  enabled: boolean;
  toggle: () => void;
  intervalMs: number | false;
} {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(REFRESH_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(REFRESH_STORAGE_KEY, String(next));
        } catch {
          // localStorage may be unavailable (privacy mode) — degrade gracefully
        }
      }
      return next;
    });
  }, []);

  return { enabled, toggle, intervalMs: enabled ? intervalMs : false };
}
