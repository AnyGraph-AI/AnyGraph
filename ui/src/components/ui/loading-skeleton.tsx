'use client';

import { PANEL } from '@/lib/tokens';

/** KPI row skeleton — 4 cards with shimmer */
export function KpiSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className={`${PANEL.classes} p-4 animate-pulse`}>
          <div className="h-8 bg-zinc-800 rounded w-1/2 mb-2" />
          <div className="h-3 bg-zinc-800 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Treemap hero skeleton — large shimmering block */
export function TreemapSkeleton() {
  return (
    <div className="animate-pulse bg-zinc-900/50 rounded-xl min-h-[60vh] border border-zinc-800/40" />
  );
}

/** Panel skeleton — generic card-shaped shimmer */
export function PanelSkeleton({ lines = 5 }: { readonly lines?: number }) {
  return (
    <div className={`${PANEL.classes} ${PANEL.padding} animate-pulse`}>
      <div className="h-4 bg-zinc-800 rounded w-1/3 mb-3" />
      <div className="h-3 bg-zinc-800 rounded w-2/3 mb-4" />
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 bg-zinc-800 rounded" style={{ width: `${85 - i * 8}%` }} />
        ))}
      </div>
    </div>
  );
}
