'use client';

import { useSearchParams } from 'next/navigation';

export function ExplorerFocus() {
  const params = useSearchParams();
  const focus = params.get('focus') ?? 'unknown';
  const focusType = params.get('focusType') ?? 'node';
  const filePath = params.get('filePath');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Graph Explorer</h1>
        <p className="text-zinc-400 mt-1">Focused node context (UI-4 bridge into UI-5 explorer).</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
        <div className="flex flex-wrap gap-2 text-xs font-mono">
          <span className="rounded-full border border-[#7ec8e3]/40 bg-[#7ec8e3]/10 text-[#7ec8e3] px-2 py-1">
            type: {focusType}
          </span>
          <span className="rounded-full border border-zinc-700 text-zinc-300 px-2 py-1">
            focus: {focus}
          </span>
          {filePath ? (
            <span className="rounded-full border border-zinc-700 text-zinc-400 px-2 py-1">file: {filePath}</span>
          ) : null}
        </div>

        <p className="text-sm text-zinc-400">
          UI-5 will replace this bridge view with full Cytoscape neighbors/danger-paths visualization.
        </p>
      </div>
    </div>
  );
}
