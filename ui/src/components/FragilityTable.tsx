'use client';

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
  // Re-derive: fragility = adjustedPain × (1-conf) × (1+churn)
  // We only dampen the (1-conf) component
  // dampened = rawFragility × (dampenFactor × (1-conf)) / (1-conf)
  // But if conf=1, rawFragility is already 0, so no division issue
  if (confidence >= 1) return 0;
  return rawFragility * dampenFactor;
}

export function FragilityTable({
  data,
  avgConfidence = 1,
  onRowClick,
}: {
  data: FragilityRow[];
  avgConfidence?: number;
  onRowClick?: (row: FragilityRow) => void;
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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-400 border-b border-zinc-800">
              <th className="text-left py-2 pr-4">File</th>
              <th className="text-right py-2 px-2">Fragility{dampened ? ' (dampened)' : ''}</th>
              <th className="text-right py-2 px-2">Pain</th>
              <th className="text-right py-2 px-2">Confidence</th>
              <th className="text-right py-2 px-2">Centrality</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.name}
                className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={() => onRowClick?.(row)}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
