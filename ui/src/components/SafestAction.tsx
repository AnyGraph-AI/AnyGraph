'use client';

interface SafestRow {
  name: string;
  confidenceScore: number;
  adjustedPain: number;
  fragility: number;
  centrality: number;
}

export function SafestAction({ data }: { data: SafestRow[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">
        No safe files found — all files have low confidence or high pain.
      </div>
    );
  }

  return (
    <div>
      <p className="text-zinc-400 text-xs mb-3">
        Lowest risk + highest confidence files. If you want to ship something safe, touch these.
      </p>
      <div className="space-y-2">
        {data.slice(0, 10).map((row) => (
          <div
            key={row.name}
            className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 rounded-lg hover:bg-zinc-800/80 transition-colors"
          >
            <span className="font-mono text-zinc-200 text-sm truncate max-w-[250px]">
              {row.name}
            </span>
            <div className="flex gap-4 text-xs">
              <span className="text-emerald-400">
                {(row.confidenceScore * 100).toFixed(0)}% conf
              </span>
              <span className="text-zinc-400">
                {row.adjustedPain.toFixed(2)} pain
              </span>
              <span className="text-zinc-500">
                {row.fragility.toFixed(2)} frag
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
