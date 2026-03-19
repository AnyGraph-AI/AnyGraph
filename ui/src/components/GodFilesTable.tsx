'use client';

import React, { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { confidenceColor, confidenceTextClass } from '@/lib/colors';

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
}

export function GodFilesTable({ data, onRowClick }: GodFilesTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'adjustedPain', desc: true },
  ]);

  const columns = useMemo<ColumnDef<GodFile>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'File',
        cell: (info) => (
          <span className="font-mono text-zinc-200">{info.getValue<string>()}</span>
        ),
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
    [],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
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
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${
                onRowClick ? 'cursor-pointer' : ''
              }`}
              onClick={() => onRowClick?.(row.original)}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
