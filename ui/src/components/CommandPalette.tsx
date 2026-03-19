'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  COMMAND_REGISTRY,
  commandsByCategory,
  contextualCommands,
  deriveSelectionFromParams,
  type CommandDefinition,
} from '@/lib/command-registry';

function copyToClipboard(text: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return Promise.resolve(false);
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<ReturnType<typeof deriveSelectionFromParams>>(null);
  const grouped = useMemo(() => commandsByCategory(), []);
  const contextual = useMemo(
    () => (selection ? contextualCommands(selection.type, selection.value) : []),
    [selection],
  );

  useEffect(() => {
    const syncSelection = () => {
      const params = new URLSearchParams(window.location.search);
      setSelection(deriveSelectionFromParams(params));
    };

    syncSelection();
    window.addEventListener('popstate', syncSelection);

    return () => window.removeEventListener('popstate', syncSelection);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isModK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isModK) return;
      event.preventDefault();
      setOpen((prev) => !prev);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const runCommand = async (command: CommandDefinition) => {
    await copyToClipboard(command.command);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const params = new URLSearchParams(window.location.search);
          setSelection(deriveSelectionFromParams(params));
          setOpen(true);
        }}
        className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/[0.08]"
        aria-label="Open command palette"
      >
        Cmd+K
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 pt-24" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-2xl rounded-xl border border-white/15 bg-[#0a0c10] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <Command>
              <CommandInput placeholder="Search commands..." />
              <CommandList>
                <CommandEmpty>No matching command.</CommandEmpty>

                {contextual.length > 0 ? (
                  <>
                    <CommandGroup heading={`Context (${selection?.type})`}>
                      {contextual.map((command) => (
                        <CommandItem key={command.id} onSelect={() => void runCommand(command)}>
                          <div className="flex flex-col gap-0.5">
                            <span>{command.title}</span>
                            <span className="text-[11px] text-zinc-500">{command.description}</span>
                          </div>
                          <CommandShortcut>copy</CommandShortcut>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    <CommandSeparator />
                  </>
                ) : null}

                {Object.entries(grouped).map(([category, commands], index) => (
                  <div key={category}>
                    {index > 0 ? <CommandSeparator /> : null}
                    <CommandGroup heading={category}>
                      {commands.map((command) => (
                        <CommandItem key={command.id} onSelect={() => void runCommand(command)}>
                          <div className="flex flex-col gap-0.5">
                            <span>{command.title}</span>
                            <span className="text-[11px] text-zinc-500">{command.description}</span>
                          </div>
                          <CommandShortcut>copy</CommandShortcut>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </div>
                ))}
              </CommandList>
            </Command>
          </div>
        </div>
      ) : null}
    </>
  );
}

export const commandCount = COMMAND_REGISTRY.length;
