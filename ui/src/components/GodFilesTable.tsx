'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { confidenceColor, confidenceTextClass } from '@/lib/colors';
import { shortestUniqueSuffix } from '@/lib/filename-disambig';

export interface GodFile {
  name: string;
  filePath: string;
  adjustedPain: number;
  fragility: number;
  confidenceScore: number;
  basePain: number;
  centrality: number;
  downstreamImpact: number;
}

export interface GodFilesTableProps {
  data: GodFile[];
  onRowClick?: (file: GodFile) => void;
  containerHeight?: number;
}

export function GodFilesTable({ data, onRowClick, containerHeight = 400 }: GodFilesTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'adjustedPain', desc: true },
  ]);

  // Build display names with shortest unique suffix disambiguation
  const displayNames = useMemo(() => {
    const filePaths = data.map(d => d.filePath || d.name);
    return shortestUniqueSuffix(filePaths);
  }, [data]);

  const columns = useMemo<ColumnDef<GodFile>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'File',
        cell: (info) => {
          const row = info.row.original;
          const key = row.filePath || row.name;
          const displayName = displayNames.get(key) ?? row.name;
          return (
            <span className="font-mono text-zinc-200">{displayName}</span>
          );
        },
      },
      {
        accessorKey: 'adjustedPain',
        header: 'Pain',
        cell: (info) => info.getValue<number>()?.toFixed(2),
        meta: { align: 'right' },
      },
      {
        accessorKey: 'fragility',
        header: 'Fragility',
        cell: (info) => {
          const v = info.getValue<number>();
          return (
            <span className={v > 0 ? 'text-red-400' : 'text-emerald-400'}>
              {v?.toFixed(2)}
            </span>
          );
        },
        meta: { align: 'right' },
      },
      {
        accessorKey: 'confidenceScore',
        header: 'Confidence',
        cell: (info) => {
          const v = info.getValue<number>();
          return (
            <span className={confidenceTextClass(v)}>
              {(v * 100).toFixed(0)}%
            </span>
          );
        },
        meta: { align: 'right' },
      },
      {
        accessorKey: 'downstreamImpact',
        header: 'Downstream',
        cell: (info) => info.getValue<number>()?.toFixed(2) ?? '—',
        meta: { align: 'right' },
      },
      {
        accessorKey: 'centrality',
        header: 'Centrality',
        cell: (info) => info.getValue<number>()?.toFixed(3),
        meta: { align: 'right' },
      },
    ],
    [displayNames],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;

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
    <div className="overflow-x-auto">
      {/* Visual-only header — aria-hidden so screen readers use the sr-only thead in the body table */}
      <table aria-hidden="true" className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="text-zinc-400 border-b border-zinc-800">
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className={`py-2 px-2 cursor-pointer select-none hover:text-zinc-200 ${
                    (header.column.columnDef.meta as { align?: string })?.align === 'right'
                      ? 'text-right'
                      : 'text-left'
                  }`}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
      </table>
      <div
        ref={parentRef}
        className="overflow-y-auto"
        style={{ height: `${containerHeight}px` }}
      >
        <div style={{ height: `${totalSize}px`, position: 'relative' }}>
          <table className="w-full text-sm" aria-label="God files ranking">
            {/* sr-only thead so screen readers can associate headers with data cells */}
            <thead className="sr-only">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} scope="col">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {virtualItems.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <tr
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${
                      onRowClick ? 'cursor-pointer' : ''
                    }`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-label={onRowClick ? `View details for ${row.original.name}` : undefined}
                    onClick={() => onRowClick?.(row.original)}
                    onKeyDown={(e) => {
                      if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onRowClick(row.original);
                      }
                    }}
                  >
                    {row.getVisibleCells().map((cell, idx) => (
                      <td
                        key={cell.id}
                        className={`py-2 px-2 text-zinc-300 ${
                          (cell.column.columnDef.meta as { align?: string })?.align === 'right'
                            ? 'text-right'
                            : ''
                        }`}
                        style={idx === 0 ? {
                          borderLeft: `3px solid ${confidenceColor(row.original.confidenceScore)}`,
                        } : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
