'use client';

import { useMemo, useState } from 'react';

export interface ProbeResult {
  id: string;
  name: string;
  category: string;
  status: 'pass' | 'warn' | 'info';
  summary: string;
  rows: Array<Record<string, unknown>>;
}

type HealthStatus = 'healthy' | 'warning' | 'critical';
type SortDir = 'asc' | 'desc';

const CATEGORY_ORDER = [
  'Code',
  'Plan↔Code',
  'Verification',
  'Claims',
  'Cross-Layer',
  'Summary',
  'State',
  'Risk',
  'Plan',
  'Confidence',
  'Governance',
] as const;

function toHealthStatus(probe: ProbeResult): HealthStatus {
  if (probe.status === 'pass') return 'healthy';
  if (probe.status === 'warn') {
    return probe.rows.length === 0 ? 'critical' : 'warning';
  }
  return 'healthy';
}

function healthStyles(status: HealthStatus): string {
  switch (status) {
    case 'healthy':
      return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/40';
    case 'warning':
      return 'text-amber-300 bg-amber-500/15 border-amber-500/40';
    case 'critical':
      return 'text-red-300 bg-red-500/15 border-red-500/40';
  }
}

function comparableValue(value: unknown): string | number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value.toLowerCase();
  if (value == null) return '';
  return JSON.stringify(value).toLowerCase();
}

function formatValue(value: unknown): string {
  if (value == null) return '-';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return JSON.stringify(value);
}

function isFileOrFunctionField(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('file') ||
    lower.includes('path') ||
    lower === 'name' ||
    lower.includes('function') ||
    lower.includes('handler')
  );
}

function getExplorerHref(
  key: string,
  value: unknown,
  row: Record<string, unknown>,
): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  if (!isFileOrFunctionField(key)) return null;

  const lower = key.toLowerCase();
  const focusType = lower.includes('file') || lower.includes('path') ? 'file' : 'function';
  const params = new URLSearchParams({
    focus: value,
    focusType,
  });

  const filePath = row.filePath ?? row.file ?? null;
  if (typeof filePath === 'string' && filePath.length > 0) {
    params.set('filePath', filePath);
  }

  return `/explorer?${params.toString()}`;
}

function collectColumns(rows: Array<Record<string, unknown>>): string[] {
  if (rows.length === 0) return [];
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  return Array.from(keys);
}

function sortRows(
  rows: Array<Record<string, unknown>>,
  sortKey: string,
  sortDir: SortDir,
): Array<Record<string, unknown>> {
  return [...rows].sort((a, b) => {
    const av = comparableValue(a[sortKey]);
    const bv = comparableValue(b[sortKey]);
    if (av === bv) return 0;
    const cmp = av < bv ? -1 : 1;
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

export function ProbeResultsGrid({ probes }: { probes: ProbeResult[] }) {
  const [expandedProbeId, setExpandedProbeId] = useState<string | null>(null);
  const [sortState, setSortState] = useState<Record<string, { key: string; dir: SortDir }>>({});

  const grouped = useMemo(() => {
    const map = new Map<string, ProbeResult[]>();
    for (const probe of probes) {
      if (!map.has(probe.category)) map.set(probe.category, []);
      map.get(probe.category)?.push(probe);
    }

    const ordered = Array.from(map.entries()).sort(([a], [b]) => {
      const ai = CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]);
      const bi = CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]);
      const aOrder = ai === -1 ? 999 : ai;
      const bOrder = bi === -1 ? 999 : bi;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    });

    return ordered;
  }, [probes]);

  if (!probes.length) {
    return <div className="text-zinc-500 text-sm">No probe results yet.</div>;
  }

  return (
    <div className="space-y-6">
      {grouped.map(([category, items]) => (
        <section key={category} className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-300">{category}</h3>
            <span className="text-xs text-zinc-500 font-mono">{items.length} probes</span>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {items.map((probe) => {
              const isExpanded = expandedProbeId === probe.id;
              const columns = collectColumns(probe.rows);
              const currentSort = sortState[probe.id] ?? (columns[0] ? { key: columns[0], dir: 'asc' as SortDir } : null);
              const sortedRows = currentSort ? sortRows(probe.rows, currentSort.key, currentSort.dir) : probe.rows;
              const status = toHealthStatus(probe);

              return (
                <article
                  key={probe.id}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <p className="text-xs text-zinc-500 font-mono">{probe.id}</p>
                      <h4 className="text-sm text-zinc-100 font-medium leading-snug">{probe.name}</h4>
                      <p className="text-xs text-zinc-400 line-clamp-2">{probe.summary}</p>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span
                        className={`text-[10px] uppercase tracking-wide border rounded-full px-2 py-1 ${healthStyles(status)}`}
                      >
                        {status}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-500">rows: {probe.rows.length}</span>
                      <button
                        className="text-[11px] rounded-md border border-zinc-700 hover:border-zinc-500 px-2 py-1 text-zinc-300"
                        onClick={() => setExpandedProbeId(isExpanded ? null : probe.id)}
                      >
                        {isExpanded ? 'Collapse' : 'Expand'}
                      </button>
                    </div>
                  </div>

                  {probe.rows.length > 0 ? (
                    <div className="rounded-lg border border-zinc-800/60 bg-zinc-950/70 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-zinc-900/80 text-zinc-400">
                          <tr>
                            {columns.slice(0, 4).map((key) => (
                              <th key={key} className="text-left px-2 py-1.5 font-medium">
                                {key}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {probe.rows.slice(0, 3).map((row, rowIdx) => (
                            <tr key={rowIdx} className="border-t border-zinc-800/50 text-zinc-300">
                              {columns.slice(0, 4).map((key) => {
                                const value = row[key];
                                const href = getExplorerHref(key, value, row);
                                return (
                                  <td key={key} className="px-2 py-1.5 align-top">
                                    {href ? (
                                      <a className="text-[#7ec8e3] hover:underline" href={href}>
                                        {formatValue(value)}
                                      </a>
                                    ) : (
                                      <span>{formatValue(value)}</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500 border border-zinc-800/60 rounded-lg px-2 py-2">
                      No rows returned.
                    </div>
                  )}

                  {isExpanded && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-zinc-400">Full result table</p>
                        {currentSort && (
                          <p className="text-[11px] font-mono text-zinc-500">
                            sort: {currentSort.key} ({currentSort.dir})
                          </p>
                        )}
                      </div>

                      <div className="overflow-auto max-h-[380px] rounded-lg border border-zinc-800/60 bg-zinc-950/60">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-zinc-900/90 text-zinc-300">
                            <tr>
                              {columns.map((key) => {
                                const active = currentSort?.key === key;
                                return (
                                  <th
                                    key={key}
                                    className="text-left px-2 py-1.5 cursor-pointer select-none whitespace-nowrap"
                                    onClick={() => {
                                      setSortState((prev) => {
                                        const existing = prev[probe.id];
                                        if (existing?.key === key) {
                                          return {
                                            ...prev,
                                            [probe.id]: {
                                              key,
                                              dir: existing.dir === 'asc' ? 'desc' : 'asc',
                                            },
                                          };
                                        }
                                        return { ...prev, [probe.id]: { key, dir: 'asc' } };
                                      });
                                    }}
                                  >
                                    <span className="inline-flex items-center gap-1">
                                      {key}
                                      {active ? <span>{currentSort?.dir === 'asc' ? '▲' : '▼'}</span> : <span className="text-zinc-600">⇅</span>}
                                    </span>
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {sortedRows.map((row, rowIdx) => (
                              <tr key={rowIdx} className="border-t border-zinc-800/40 text-zinc-200">
                                {columns.map((key) => {
                                  const value = row[key];
                                  const href = getExplorerHref(key, value, row);
                                  return (
                                    <td key={key} className="px-2 py-1.5 align-top whitespace-nowrap">
                                      {href ? (
                                        <a className="text-[#7ec8e3] hover:underline" href={href}>
                                          {formatValue(value)}
                                        </a>
                                      ) : (
                                        <span>{formatValue(value)}</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
