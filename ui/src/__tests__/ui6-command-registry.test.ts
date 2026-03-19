/**
 * UI-6 — command registry tests
 */
import { describe, expect, it } from 'vitest';
import {
  COMMAND_REGISTRY,
  commandsByCategory,
  contextualCommands,
  deriveSelectionFromParams,
  normalizeCommandTargetType,
} from '@/lib/command-registry';

describe('[UI-6] command registry', () => {
  it('contains required core command surfaces', () => {
    const ids = new Set(COMMAND_REGISTRY.map((c) => c.id));
    expect(ids.has('parse-project')).toBe(true);
    expect(ids.has('enforce-edit')).toBe(true);
    expect(ids.has('self-diagnosis')).toBe(true);
    expect(ids.has('probe-architecture')).toBe(true);
    expect(ids.has('done-check')).toBe(true);
  });

  it('groups commands by category', () => {
    const grouped = commandsByCategory();
    expect(grouped.Core.length).toBeGreaterThan(0);
    expect(grouped.Verification.length).toBeGreaterThan(0);
    expect(grouped.Planning.length).toBeGreaterThan(0);
    expect(grouped.Utilities.length).toBeGreaterThan(0);
  });

  it('creates contextual commands for SourceFile/Function/Task', () => {
    const sourceFile = contextualCommands('SourceFile', '/tmp/a.ts');
    const fn = contextualCommands('Function', 'runParse');
    const task = contextualCommands('Task', 'Install shadcn Command component');

    expect(sourceFile[0].command).toContain('enforce-edit.ts');
    expect(fn[0].command).toContain('MATCH (caller)-[:CALLS]');
    expect(task[0].command).toContain('HAS_CODE_EVIDENCE');
  });

  it('normalizes command target aliases and derives selection from query params', () => {
    expect(normalizeCommandTargetType('file')).toBe('SourceFile');
    expect(normalizeCommandTargetType('SourceFile')).toBe('SourceFile');
    expect(normalizeCommandTargetType('function')).toBe('Function');
    expect(normalizeCommandTargetType('task')).toBe('Task');
    expect(normalizeCommandTargetType('unknown')).toBeNull();

    const directSelection = deriveSelectionFromParams({
      get: (key: string) =>
        key === 'selectedType' ? 'Function' : key === 'selectedValue' ? 'resolveRootId' : null,
    });
    expect(directSelection).toEqual({ type: 'Function', value: 'resolveRootId' });

    const focusSelection = deriveSelectionFromParams({
      get: (key: string) => {
        if (key === 'focusType') return 'file';
        if (key === 'focus') return 'ui/src/app/page.tsx';
        return null;
      },
    });
    expect(focusSelection).toEqual({ type: 'SourceFile', value: 'ui/src/app/page.tsx' });
  });
});
