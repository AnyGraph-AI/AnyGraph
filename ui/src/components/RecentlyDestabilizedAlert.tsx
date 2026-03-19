'use client';

interface DestabilizedRow {
  name: string;
  filePath: string;
  observedAt: string;
  compositeRisk: number;
}

function shortPath(filePath: string): string {
  const parts = filePath.split('/');
  return parts.slice(-3).join('/');
}

export function RecentlyDestabilizedAlert({
  data,
  onRowClick,
}: {
  data: DestabilizedRow[];
  onRowClick?: (row: DestabilizedRow) => void;
}) {
  if (!data || data.length === 0) return null;

  return (
    <div className="bg-red-950/40 border border-red-800/60 rounded-lg px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-red-200">Recently Destabilized</h2>
        <span className="text-xs text-red-300/80">{data.length} new CRITICAL nodes</span>
      </div>
      <ul className="space-y-1.5">
        {data.slice(0, 5).map((row) => (
          <li
            key={`${row.filePath}:${row.name}:${row.observedAt}`}
            className={`text-xs text-red-100/90 ${onRowClick ? 'cursor-pointer hover:text-red-200' : ''}`}
            onClick={() => onRowClick?.(row)}
          >
            <span className="font-mono">{row.name}</span>
            <span className="text-red-300/80"> — {shortPath(row.filePath)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
