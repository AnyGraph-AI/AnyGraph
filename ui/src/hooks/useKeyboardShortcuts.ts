'use client';

import { useEffect } from 'react';

/** Tags that indicate the user is typing — shortcuts are suppressed */
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Returns true if the keyboard event originated from an editable element.
 * Shortcuts must not fire while the operator is typing.
 */
export function isTypingInInput(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  return INPUT_TAGS.has(target.tagName) || target.isContentEditable;
}

/** Keys 1–9 for panel focus navigation */
export const PANEL_SHORTCUT_KEYS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export type ShortcutHandler = (event: KeyboardEvent) => void;

/**
 * Map of key names (as returned by event.key) to their handlers.
 * e.g. { 'Escape': closeModal, '?': openHelp, '1': focusPanel1 }
 */
export type ShortcutMap = Record<string, ShortcutHandler>;

/**
 * UI-7: Keyboard shortcut hook.
 *
 * Binds a ShortcutMap to the global keydown listener.
 * Shortcuts are suppressed when the operator is typing in an input/textarea.
 *
 * Standard bindings to wire at the page level:
 * - '1'–'9' : scroll to nth dashboard panel
 * - 'Escape' : close any open modal / overlay / command palette
 * - '?'      : open keyboard shortcut help overlay
 *
 * Tab navigation uses native browser focus order — no special wiring needed,
 * but ensure focus rings are visible (Tailwind's `focus-visible:ring` classes).
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingInInput(event)) return;
      const handler = shortcuts[event.key];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}
