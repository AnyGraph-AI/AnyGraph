/**
 * UI-6 — Command Palette foundation tests
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('[UI-6] command primitive installation', () => {
  it('exports shadcn-style command primitives', async () => {
    const mod = await import('@/components/ui/command');

    expect(mod.Command).toBeDefined();
    expect(mod.CommandInput).toBeDefined();
    expect(mod.CommandList).toBeDefined();
    expect(mod.CommandEmpty).toBeDefined();
    expect(mod.CommandGroup).toBeDefined();
    expect(mod.CommandItem).toBeDefined();
    expect(mod.CommandShortcut).toBeDefined();
    expect(mod.CommandSeparator).toBeDefined();
  });

  it('wires CommandPalette with Cmd/Ctrl+K toggle behavior', async () => {
    const mod = await import('@/components/CommandPalette');
    expect(mod.CommandPalette).toBeDefined();

    const sourcePath = path.resolve(import.meta.dirname, '..', 'components', 'CommandPalette.tsx');
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain("event.key.toLowerCase() === 'k'");
    expect(source).toContain('event.metaKey || event.ctrlKey');
    expect(source).toContain('setOpen((prev) => !prev)');
    expect(source).toContain('deriveSelectionFromParams');
    expect(source).toContain('contextualCommands');
    expect(source).toContain('Context (');
  });
});
