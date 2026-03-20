'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadPresets, deletePreset, type ViewPreset } from '@/lib/view-presets';

export function LoadViewDropdown() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<ViewPreset[]>([]);

  // Refresh presets whenever dropdown opens
  useEffect(() => {
    if (open) setPresets(loadPresets());
  }, [open]);

  const handleSelect = (preset: ViewPreset) => {
    const url = preset.params.startsWith('?') ? `/${preset.params}` : `/?${preset.params}`;
    router.push(url);
    setOpen(false);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deletePreset(id);
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/[0.08] transition-colors"
        aria-label="Load saved view"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        📂 Load View
      </button>

      {open && (
        <>
          {/* Backdrop to close on click outside */}
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />

          <div
            className="absolute right-0 top-full mt-1 z-[70] w-72 rounded-lg border border-white/15 bg-[#0a0c10] shadow-2xl overflow-hidden"
            role="listbox"
            aria-label="Saved view presets"
          >
            {presets.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-zinc-500">
                No saved views yet. Use 💾 Save View to create one.
              </div>
            ) : (
              <ul className="max-h-64 overflow-y-auto">
                {presets.map((preset) => (
                  <li
                    key={preset.id}
                    role="option"
                    tabIndex={0}
                    className="flex items-center justify-between px-3 py-2 hover:bg-white/[0.05] cursor-pointer transition-colors group"
                    onClick={() => handleSelect(preset)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSelect(preset);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-zinc-200 truncate">{preset.name}</div>
                      <div className="text-[10px] text-zinc-600 truncate font-mono">{preset.params}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, preset.id)}
                      className="ml-2 rounded p-1 text-zinc-600 hover:text-red-400 hover:bg-red-400/10 opacity-0 group-hover:opacity-100 transition-all"
                      aria-label={`Delete preset ${preset.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
