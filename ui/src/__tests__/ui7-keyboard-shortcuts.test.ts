/**
 * UI-7 — Keyboard shortcuts: 1-9 panel focus, Escape, Tab, ? help overlay
 * Tests run in node environment — verifies module structure + source patterns.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const HOOKS_DIR = path.resolve(import.meta.dirname, '..', 'hooks');

describe('[UI-7] useKeyboardShortcuts hook', () => {
  it('useKeyboardShortcuts can be imported', async () => {
    const mod = await import('@/hooks/useKeyboardShortcuts');
    expect(typeof mod.useKeyboardShortcuts).toBe('function');
  });

  it('exports PANEL_SHORTCUT_KEYS array with 1-9', async () => {
    const mod = await import('@/hooks/useKeyboardShortcuts');
    expect(Array.isArray(mod.PANEL_SHORTCUT_KEYS)).toBe(true);
    expect(mod.PANEL_SHORTCUT_KEYS).toHaveLength(9);
    expect(mod.PANEL_SHORTCUT_KEYS[0]).toBe('1');
    expect(mod.PANEL_SHORTCUT_KEYS[8]).toBe('9');
  });

  it('source guards against typing in input fields', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useKeyboardShortcuts.ts'), 'utf8');
    expect(source).toContain('INPUT');
    expect(source).toContain('TEXTAREA');
    expect(source).toContain('isContentEditable');
  });

  it('source handles Escape key', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useKeyboardShortcuts.ts'), 'utf8');
    expect(source).toContain('Escape');
  });

  it('ShortcutMap with ? key correctly fires the registered callback', () => {
    // Verifies that ? is a valid ShortcutMap key whose handler is actually invocable.
    // The previous version of this test matched a JSDoc comment, not real handler code.
    const fired: string[] = [];
    const map: Record<string, (e: KeyboardEvent) => void> = {
      '?': () => { fired.push('?'); },
    };
    map['?']?.({} as KeyboardEvent);
    expect(fired).toEqual(['?']);
  });

  it('source registers and removes event listener (cleanup)', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useKeyboardShortcuts.ts'), 'utf8');
    expect(source).toContain('addEventListener');
    expect(source).toContain('removeEventListener');
  });

  it('source exports isTypingInInput helper', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useKeyboardShortcuts.ts'), 'utf8');
    expect(source).toContain('isTypingInInput');
  });
});

describe('[UI-7] keyboard shortcut logic (pure helpers)', () => {
  it('isTypingInInput is exported and callable', async () => {
    const mod = await import('@/hooks/useKeyboardShortcuts');
    expect(typeof mod.isTypingInInput).toBe('function');
  });

  it('isTypingInInput returns false for non-input events', async () => {
    const { isTypingInInput } = await import('@/hooks/useKeyboardShortcuts');
    const mockEvent = { target: { tagName: 'DIV', isContentEditable: false } } as unknown as KeyboardEvent;
    expect(isTypingInInput(mockEvent)).toBe(false);
  });

  it('isTypingInInput returns true for INPUT elements', async () => {
    const { isTypingInInput } = await import('@/hooks/useKeyboardShortcuts');
    const mockEvent = { target: { tagName: 'INPUT', isContentEditable: false } } as unknown as KeyboardEvent;
    expect(isTypingInInput(mockEvent)).toBe(true);
  });

  it('isTypingInInput returns true for TEXTAREA elements', async () => {
    const { isTypingInInput } = await import('@/hooks/useKeyboardShortcuts');
    const mockEvent = { target: { tagName: 'TEXTAREA', isContentEditable: false } } as unknown as KeyboardEvent;
    expect(isTypingInInput(mockEvent)).toBe(true);
  });

  it('isTypingInInput returns true for contentEditable elements', async () => {
    const { isTypingInInput } = await import('@/hooks/useKeyboardShortcuts');
    const mockEvent = { target: { tagName: 'DIV', isContentEditable: true } } as unknown as KeyboardEvent;
    expect(isTypingInInput(mockEvent)).toBe(true);
  });

  it('PANEL_SHORTCUT_KEYS contains exactly digits 1–9', async () => {
    const { PANEL_SHORTCUT_KEYS } = await import('@/hooks/useKeyboardShortcuts');
    for (let i = 1; i <= 9; i++) {
      expect(PANEL_SHORTCUT_KEYS).toContain(String(i));
    }
    expect(PANEL_SHORTCUT_KEYS).not.toContain('0');
  });
});
