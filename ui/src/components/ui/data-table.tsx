"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { PANEL } from "@/lib/tokens";

export interface ColumnDef<T> {
  readonly key: keyof T & string;
  readonly header: string;
  readonly render?: (value: T[keyof T], row: T) => React.ReactNode;
  readonly sortable?: boolean;
}

export interface DataTableProps<T> {
  readonly columns: ReadonlyArray<ColumnDef<T>>;
  readonly data: ReadonlyArray<T>;
  readonly onRowClick?: (row: T) => void;
  readonly rowBorderColor?: (row: T) => string;
}

type SortDir = "asc" | "desc";

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  rowBorderColor,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (data.length === 0) {
    return <EmptyState title="No data" icon="📭" />;
  }

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av === bv) return 0;
        const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
        return sortDir === "asc" ? cmp : -cmp;
      })
    : data;

  return (
    <div className={`overflow-auto max-h-[400px] ${PANEL.classes}`}>
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10 bg-zinc-900">
          <tr className="border-b border-zinc-800/40">
            {columns.map((col) => (
              <th
                key={col.key}
                className={[
                  "px-4 py-2.5 text-left text-zinc-300 font-medium whitespace-nowrap select-none",
                  col.sortable
                    ? "cursor-pointer hover:text-zinc-100 transition-colors"
                    : "",
                ].join(" ")}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key && (
                    <span className="text-zinc-400 text-xs">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                  {col.sortable && sortKey !== col.key && (
                    <span className="text-zinc-700 text-xs">⇅</span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const borderColor = rowBorderColor ? rowBorderColor(row) : undefined;
            return (
              <tr
                key={i}
                className={[
                  "border-b border-zinc-800/40 last:border-0",
                  "text-zinc-400 transition-colors",
                  onRowClick
                    ? "cursor-pointer hover:bg-zinc-800/50"
                    : "hover:bg-zinc-800/50",
                ].join(" ")}
                style={
                  borderColor
                    ? { borderLeft: `3px solid ${borderColor}` }
                    : undefined
                }
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                    {col.render
                      ? col.render(row[col.key], row)
                      : (row[col.key] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
