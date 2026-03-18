'use client';

interface RealityGapRow {
  name: string;
  confidenceScore: number;
  evidenceCount: number;
  expectedEvidence: number;
  gapScore: number;
  adjustedPain: number;
  fragility: number;
}

function getGapColor(gap: number): string {
  if (gap >= 0.8) return 'text-red-400';
  if (gap >= 0.5) return 'text-amber-400';
  return 'text-yellow-400';
}

function getGapLabel(gap: number): string {
  if (gap >= 0.8) return 'SEVERE';
  if (gap >= 0.5) return 'MODERATE';
  return 'MINOR';
}

export function RealityGap({ data }: { data: RealityGapRow[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">
        No reality gaps detected — all files have sufficient evidence for their risk tier.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-zinc-400 text-xs mb-3">
        Files where confidence claims exceed actual evidence depth. Higher gap = more false confidence.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-400 border-b border-zinc-800">
              <th className="text-left py-2 pr-4">File</th>
              <th className="text-right py-2 px-2">Gap</th>
              <th className="text-right py-2 px-2">Severity</th>
              <th className="text-right py-2 px-2">Evidence</th>
              <th className="text-right py-2 px-2">Expected</th>
              <th className="text-right py-2 px-2">Confidence</th>
              <th className="text-right py-2 px-2">Pain</th>
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
                <td className={`text-right py-2 px-2 font-semibold ${getGapColor(row.gapScore)}`}>
                  {(row.gapScore * 100).toFixed(0)}%
                </td>
                <td className={`text-right py-2 px-2 text-xs font-medium ${getGapColor(row.gapScore)}`}>
                  {getGapLabel(row.gapScore)}
                </td>
                <td className="text-right py-2 px-2 text-zinc-300">
                  {row.evidenceCount}
                </td>
                <td className="text-right py-2 px-2 text-zinc-400">
                  {row.expectedEvidence}
                </td>
                <td className="text-right py-2 px-2">
                  <span className={row.confidenceScore >= 0.5 ? 'text-emerald-400' : 'text-red-400'}>
                    {(row.confidenceScore * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="text-right py-2 px-2 text-zinc-300">
                  {row.adjustedPain.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
