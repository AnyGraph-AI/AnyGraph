'use client';

interface FragilityRow {
  name: string;
  fragility: number;
  confidenceScore: number;
  adjustedPain: number;
  painScore: number;
  centrality: number;
}

function getFragilityColor(f: number): string {
  if (f >= 3) return 'text-red-400';
  if (f >= 1) return 'text-amber-400';
  if (f > 0) return 'text-yellow-400';
  return 'text-emerald-400';
}

export function FragilityTable({ data }: { data: FragilityRow[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">
        No fragile files detected.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-zinc-400 text-xs mb-3">
        Files ranked by fragility: adjustedPain × (1 − confidence) × (1 + churn). High fragility = painful AND uncertain.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-400 border-b border-zinc-800">
              <th className="text-left py-2 pr-4">File</th>
              <th className="text-right py-2 px-2">Fragility</th>
              <th className="text-right py-2 px-2">Pain</th>
              <th className="text-right py-2 px-2">Confidence</th>
              <th className="text-right py-2 px-2">Centrality</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={row.name}
                className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
              >
                <td className="py-2 pr-4 font-mono text-zinc-200 truncate max-w-[200px]">
                  {row.name}
                </td>
                <td className={`text-right py-2 px-2 font-semibold ${getFragilityColor(row.fragility)}`}>
                  {row.fragility.toFixed(2)}
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
