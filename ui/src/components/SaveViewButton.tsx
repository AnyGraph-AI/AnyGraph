'use client';

import { useState } from 'react';
import { savePreset } from '@/lib/view-presets';

export function SaveViewButton() {
  const [showDialog, setShowDialog] = useState(false);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const params = window.location.search || '?';
    savePreset(trimmed, params);
    setName('');
    setShowDialog(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowDialog((prev) => !prev)}
        className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/[0.08] transition-colors"
        aria-label="Save current view"
      >
        {saved ? '✓ Saved' : '💾 Save View'}
      </button>

      {showDialog && (
        <div className="absolute right-0 top-full mt-1 z-[70] w-64 rounded-lg border border-white/15 bg-[#0a0c10] p-3 shadow-2xl">
          <label className="block text-[10px] uppercase tracking-[0.08em] text-zinc-500 mb-1.5">
            Preset name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setShowDialog(false);
            }}
            placeholder="e.g. Critical files only"
            className="w-full h-8 rounded border border-white/10 bg-black/30 px-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-[#7ec8e3]/50"
            autoFocus
          />
          <div className="mt-2 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowDialog(false)}
              className="rounded px-2.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim()}
              className="rounded bg-[#7ec8e3]/15 px-2.5 py-1 text-[11px] font-medium text-[#7ec8e3] hover:bg-[#7ec8e3]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
