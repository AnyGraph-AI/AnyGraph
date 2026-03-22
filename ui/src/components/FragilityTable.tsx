'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { painTextClass } from '@/lib/colors';

interface FragilityRow {
  name: string;
  fragility: number;
  confidenceScore: number;
  adjustedPain: number;
  painScore: number;
  centrality: number;
}

/** Fragility uses pain gradient — normalize to 0-1 for color. max ~5 in practice */
function getFragilityColor(f: number): string {
  return painTextClass(Math.min(f / 5, 1));
}

/**
 * Dampen the confidence penalty in fragility when global confidence is low.
 *
 * When avgConfidence is low (e.g. 0.1), every file has low confidence,
 * so the (1-conf) term inflates fragility uniformly — making the metric
 * noisy rather than discriminating. The dampening factor scales down
 * the confidence penalty proportionally.
 *
 * dampenFactor = min(1, avgConfidence / 0.55)
 * displayFragility = adjustedPain × ((1-conf) × dampenFactor) × (1+churn)
 *
 * When avg >= 0.55: no dampening (factor = 1.0)
 * When avg = 0.275: half dampening (factor = 0.5)
 * When avg = 0: full dampening (factor = 0, fragility = 0 for all)
 */
function dampenFragility(rawFragility: number, confidence: number, avgConfidence: number): number {
  if (avgConfidence >= 0.55) return rawFragility;
  const dampenFactor = Math.min(1, avgConfidence / 0.55);
  if (confidence >= 1) return 0;
  return rawFragility * dampenFactor;
}

export function FragilityTable({
  data,
  avgConfidence = 1,
  onRowClick,
  containerHeight = 360,
}: {
  data: FragilityRow[];
  avgConfidence?: number;
  onRowClick?: (row: FragilityRow) => void;
  containerHeight?: number;
}) {
  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">
        No fragile files detected.
      </div>
    );
  }

  const dampened = avgConfidence < 0.55;
  const rows = data.map(row => ({
    ...row,
    displayFragility: dampenFragility(row.fragility, row.confidenceScore, avgConfidence),
  })).sort((a, b) => b.displayFragility - a.displayFragility);

  return (
    <FragilityTableInner
      rows={rows}
      dampened={dampened}
      avgConfidence={avgConfidence}
      onRowClick={onRowClick}
      containerHeight={containerHeight}
    />
  );
}

function FragilityTableInner({
  rows,
  dampened,
  avgConfidence,
  onRowClick,
  containerHeight,
}: {
  rows: Array<FragilityRow & { displayFragility: number }>;
  dampened: boolean;
  avgConfidence: number;
  onRowClick?: (row: FragilityRow) => void;
  containerHeight: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 8,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div className="space-y-1">
      <p className="text-zinc-400 text-xs mb-3">
        Files ranked by fragility: adjustedPain × (1 − confidence) × (1 + churn). High fragility = painful AND uncertain.
        {dampened && (
          <span className="text-amber-400/70 ml-1">
            (dampened — global confidence {(avgConfidence * 100).toFixed(0)}% &lt; 55%)
          </span>
        )}
      </p>
      <div className="overflow-x-auto">
        {/* Visual-only header — aria-hidden so screen readers use the sr-only thead in the body table */}
        <table aria-hidden="true" className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr className="text-zinc-400 border-b border-zinc-800">
              <th className="text-left py-2 pr-4">File</th>
              <th className="text-right py-2 px-2">Fragility{dampened ? ' (dampened)' : ''}</th>
              <th className="text-right py-2 px-2">Pain</th>
              <th className="text-right py-2 px-2">Confidence</th>
              <th className="text-right py-2 px-2">Centrality</th>
            </tr>
          </thead>
        </table>
        <div
          ref={parentRef}
          className="overflow-y-auto"
          style={{ height: `${containerHeight}px` }}
        >
          <div style={{ height: `${totalSize}px`, position: 'relative' }}>
            <table className="w-full text-sm" aria-label="Fragility ranking">
              {/* sr-only thead so screen readers can associate headers with data cells */}
              <thead className="sr-only">
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Fragility{dampened ? ' (dampened)' : ''}</th>
                  <th scope="col">Pain</th>
                  <th scope="col">Confidence</th>
                  <th scope="col">Centrality</th>
                </tr>
              </thead>
              <tbody>
                {virtualItems.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  return (
                    <tr
                      key={row.name + virtualRow.index}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${onRowClick ? 'cursor-pointer' : ''}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      tabIndex={onRowClick ? 0 : undefined}
                      aria-label={onRowClick ? `View details for ${row.name}` : undefined}
                      onClick={() => onRowClick?.(row)}
                      onKeyDown={(e) => {
                        if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }}
                    >
                      <td className="py-2 pr-4 font-mono text-zinc-200 truncate max-w-[200px]">
                        {row.name}
                      </td>
                      <td className={`text-right py-2 px-2 font-semibold ${getFragilityColor(row.displayFragility)}`}>
                        {row.displayFragility.toFixed(2)}
                      </td>
                      <td className="text-right py-2 px-2 text-zinc-300">
                        {row.adjustedPain.toFixed(2)}
                      </td>
                      <td className="text-right py-2 px-2">
                        <span className={row.confidenceScore >= 0.5 ? 'text-emerald-400' : 'text-red-400'}>
                          {(row.confidenceScore * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="text-right py-2 px-2 text-zinc-300">
                        {row.centrality.toFixed(3)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
