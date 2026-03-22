'use client';

import { PANEL } from '@/lib/tokens';

/** KPI row skeleton — 4 cards with shimmer */
export function KpiSkeleton() {
  return (
    <div role="status" aria-label="Loading KPI metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
    <div role="status" aria-label="Loading treemap" className="animate-pulse bg-zinc-900/50 rounded-xl min-h-[60vh] border border-zinc-800/40" />
  );
}

/** Panel skeleton — generic card-shaped shimmer */
export function PanelSkeleton({ lines = 5 }: { readonly lines?: number }) {
  return (
    <div role="status" aria-label="Loading panel" className={`${PANEL.classes} ${PANEL.padding} animate-pulse`}>
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

/** Table skeleton — header + rows with varying widths */
export function TableSkeleton({ rows = 6 }: { readonly rows?: number }) {
  return (
    <div role="status" aria-label="Loading table" className="animate-pulse space-y-0">
      {/* Header row */}
      <div className="flex gap-4 py-2 border-b border-zinc-800 mb-1">
        <div className="h-3 bg-zinc-700 rounded w-1/3" />
        <div className="h-3 bg-zinc-700 rounded w-16 ml-auto" />
        <div className="h-3 bg-zinc-700 rounded w-16" />
        <div className="h-3 bg-zinc-700 rounded w-16" />
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-2 border-b border-zinc-800/50">
          <div className="h-3 bg-zinc-800 rounded" style={{ width: `${50 + (i % 3) * 10}%` }} />
          <div className="h-3 bg-zinc-800 rounded w-12 ml-auto" />
          <div className="h-3 bg-zinc-800 rounded w-12" />
          <div className="h-3 bg-zinc-800 rounded w-12" />
        </div>
      ))}
    </div>
  );
}

/** Chart skeleton — bar/area shaped placeholder */
export function ChartSkeleton({ height = 200 }: { readonly height?: number }) {
  return (
    <div role="status" aria-label="Loading chart" className="animate-pulse space-y-2">
      <div className="h-3 bg-zinc-800 rounded w-1/4 mb-4" />
      <div
        className="bg-zinc-900/50 rounded-lg border border-zinc-800/40 flex items-end gap-1 px-3 pb-3 pt-6"
        style={{ height: `${height}px` }}
      >
        {[65, 45, 80, 55, 70, 40, 90, 60, 75, 50, 85, 45].map((h, i) => (
          <div
            key={i}
            className="flex-1 bg-zinc-700 rounded-t"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Graph skeleton — node + edge shaped placeholder for ExplorerGraph */
export function GraphSkeleton() {
  return (
    <div role="status" aria-label="Loading graph" className="animate-pulse rounded-xl border border-zinc-800/40 bg-zinc-900/50 overflow-hidden" style={{ minHeight: '60vh' }}>
      {/* Toolbar strip */}
      <div className="border-b border-zinc-800/60 px-4 py-3 flex gap-3 items-center">
        <div className="h-7 bg-zinc-800 rounded w-40" />
        <div className="h-7 bg-zinc-800 rounded w-24" />
        <div className="h-7 bg-zinc-800 rounded w-24" />
        <div className="ml-auto h-7 bg-zinc-800 rounded w-32" />
      </div>
      {/* Graph canvas area with fake nodes */}
      <div className="relative flex-1 p-8" style={{ height: 'calc(60vh - 60px)' }}>
        {/* Simulated nodes */}
        {[
          { top: '30%', left: '20%', w: 80 },
          { top: '50%', left: '45%', w: 100 },
          { top: '20%', left: '60%', w: 70 },
          { top: '65%', left: '30%', w: 90 },
          { top: '40%', left: '70%', w: 75 },
          { top: '70%', left: '65%', w: 85 },
        ].map((n, i) => (
          <div
            key={i}
            className="absolute h-8 bg-zinc-700 rounded-full"
            style={{ top: n.top, left: n.left, width: `${n.w}px` }}
          />
        ))}
      </div>
    </div>
  );
}
