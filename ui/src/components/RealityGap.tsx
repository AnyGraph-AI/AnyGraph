'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { painTextClass, confidenceTextClass } from '@/lib/colors';

interface RealityGapRow {
  name: string;
  confidenceScore: number;
  evidenceCount: number;
  expectedEvidence: number;
  gapScore: number;
  adjustedPain: number;
  fragility: number;
  riskTier?: string;
}

type SeverityFilter = 'all' | 'critical-high';
type RiskFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type SortField = 'gapScore' | 'adjustedPain' | 'confidenceScore' | 'fragility';

function getGapColor(gap: number): string {
  return painTextClass(gap);
}

function getGapLabel(gap: number): string {
  if (gap >= 0.8) return 'SEVERE';
  if (gap >= 0.5) return 'MODERATE';
  return 'MINOR';
}

function riskTierColor(tier: string): string {
  switch (tier) {
    case 'CRITICAL': return 'bg-red-500/20 text-red-400';
    case 'HIGH': return 'bg-orange-500/20 text-orange-400';
    case 'MEDIUM': return 'bg-yellow-500/20 text-yellow-400';
    default: return 'bg-zinc-700/30 text-zinc-500';
  }
}

const SNOOZE_PREFIX = 'reality-gap-snooze:';
const SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function isSnoozed(fileName: string): boolean {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(`${SNOOZE_PREFIX}${fileName}`);
  if (!raw) return false;
  const expiry = Number(raw);
  if (Date.now() > expiry) {
    localStorage.removeItem(`${SNOOZE_PREFIX}${fileName}`);
    return false;
  }
  return true;
}

function snoozeFile(fileName: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${SNOOZE_PREFIX}${fileName}`, String(Date.now() + SNOOZE_DURATION_MS));
}

export function RealityGap({
  data,
  severityFilter: initialSeverity = 'critical-high',
  minGap: initialMinGap = 0,
  onRowClick,
}: {
  data: RealityGapRow[];
  severityFilter?: SeverityFilter;
  minGap?: number;
  onRowClick?: (row: RealityGapRow) => void;
}) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>(initialSeverity);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [minGap, setMinGap] = useState(initialMinGap);
  const [minPain, setMinPain] = useState(0);
  const [sortField, setSortField] = useState<SortField>('gapScore');
  const [sortDesc, setSortDesc] = useState(true);
  const [snoozedFiles, setSnoozedFiles] = useState<Set<string>>(new Set());

  // Compute maxPain for the slider range
  const maxPainInData = useMemo(() => {
    return Math.max(...data.map(d => d.adjustedPain), 1);
  }, [data]);

  useEffect(() => {
    const snoozed = new Set<string>();
    for (const row of data) {
      if (isSnoozed(row.name)) snoozed.add(row.name);
    }
    setSnoozedFiles(snoozed);
  }, [data]);

  const handleSnooze = useCallback((fileName: string) => {
    snoozeFile(fileName);
    setSnoozedFiles(prev => new Set([...prev, fileName]));
  }, []);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDesc(prev => !prev);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  }, [sortField]);

  const filtered = useMemo(() => {
    let rows = data.filter(row => {
      if (snoozedFiles.has(row.name)) return false;
      if (row.gapScore < minGap) return false;
      if (row.adjustedPain < minPain) return false;
      if (severityFilter === 'critical-high' && row.gapScore < 0.5) return false;
      if (riskFilter !== 'all') {
        const tier = (row.riskTier ?? 'LOW').toUpperCase();
        if (riskFilter === 'critical' && tier !== 'CRITICAL') return false;
        if (riskFilter === 'high' && tier !== 'HIGH' && tier !== 'CRITICAL') return false;
        if (riskFilter === 'medium' && tier !== 'MEDIUM' && tier !== 'HIGH' && tier !== 'CRITICAL') return false;
        // 'low' = show all (including LOW)
      }
      return true;
    });

    rows.sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      return sortDesc ? bv - av : av - bv;
    });

    return rows;
  }, [data, snoozedFiles, minGap, minPain, severityFilter, riskFilter, sortField, sortDesc]);

  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">
        No reality gaps detected — all files have sufficient evidence for their risk tier.
      </div>
    );
  }

  const sortArrow = (field: SortField) =>
    sortField === field ? (sortDesc ? ' ↓' : ' ↑') : '';

  return (
    <div className="space-y-1">
      {/* Filter controls — row 1: severity + risk tier */}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        {/* Severity filter */}
        <div className="flex gap-0.5 bg-zinc-800 rounded-lg p-0.5">
          {([
            { key: 'critical-high' as const, label: 'Crit+High' },
            { key: 'all' as const, label: 'All' },
          ]).map(opt => (
            <button
              key={opt.key}
              onClick={() => setSeverityFilter(opt.key)}
              className={`px-2 py-1 text-xs rounded-md transition-colors duration-150 ${
                severityFilter === opt.key
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Risk tier filter */}
        <div className="flex gap-0.5 bg-zinc-800 rounded-lg p-0.5">
          {([
            { key: 'all' as const, label: 'All Tiers' },
            { key: 'critical' as const, label: 'Critical' },
            { key: 'high' as const, label: '≥ High' },
            { key: 'medium' as const, label: '≥ Medium' },
          ]).map(opt => (
            <button
              key={opt.key}
              onClick={() => setRiskFilter(opt.key)}
              className={`px-2 py-1 text-xs rounded-md transition-colors duration-150 ${
                riskFilter === opt.key
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter controls — row 2: sliders */}
      <div className="flex items-center gap-6 mb-3">
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Min gap
          <input
            type="range"
            min={0}
            max={100}
            value={minGap * 100}
            onChange={(e) => setMinGap(Number(e.target.value) / 100)}
            className="w-16 accent-amber-500 h-1"
          />
          <span className="text-zinc-400 w-8 tabular-nums">{(minGap * 100).toFixed(0)}%</span>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Min pain
          <input
            type="range"
            min={0}
            max={Math.ceil(maxPainInData * 100)}
            value={minPain * 100}
            onChange={(e) => setMinPain(Number(e.target.value) / 100)}
            className="w-16 accent-red-500 h-1"
          />
          <span className="text-zinc-400 w-8 tabular-nums">{minPain.toFixed(1)}</span>
        </label>
        <span className="text-xs text-zinc-600 ml-auto">
          {filtered.length} of {data.length} files
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-zinc-500 text-sm py-4 text-center">
          No gaps match current filters.{' '}
          {snoozedFiles.size > 0 && (
            <span className="text-zinc-600">({snoozedFiles.size} snoozed)</span>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-900 z-10">
              <tr className="text-zinc-400 border-b border-zinc-800">
                <th className="text-left py-2 pr-2">File</th>
                <th className="text-center py-2 px-1 w-16">Tier</th>
                <th
                  className="text-right py-2 px-2 cursor-pointer hover:text-zinc-200 select-none"
                  onClick={() => handleSort('gapScore')}
                >
                  Gap{sortArrow('gapScore')}
                </th>
                <th className="text-right py-2 px-2">Ev.</th>
                <th className="text-right py-2 px-2">Exp.</th>
                <th
                  className="text-right py-2 px-2 cursor-pointer hover:text-zinc-200 select-none"
                  onClick={() => handleSort('confidenceScore')}
                >
                  Conf{sortArrow('confidenceScore')}
                </th>
                <th
                  className="text-right py-2 px-2 cursor-pointer hover:text-zinc-200 select-none"
                  onClick={() => handleSort('adjustedPain')}
                >
                  Pain{sortArrow('adjustedPain')}
                </th>
                <th
                  className="text-right py-2 px-2 cursor-pointer hover:text-zinc-200 select-none"
                  onClick={() => handleSort('fragility')}
                >
                  Frag{sortArrow('fragility')}
                </th>
                <th className="w-6"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.name}
                  className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onRowClick?.(row)}
                >
                  <td className="py-1.5 pr-2 font-mono text-zinc-200 text-xs truncate max-w-[180px]">
                    {row.name}
                  </td>
                  <td className="py-1.5 px-1 text-center">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${riskTierColor(row.riskTier ?? 'LOW')}`}>
                      {(row.riskTier ?? 'LOW').slice(0, 4)}
                    </span>
                  </td>
                  <td className={`text-right py-1.5 px-2 font-semibold ${getGapColor(row.gapScore)}`}>
                    {(row.gapScore * 100).toFixed(0)}%
                  </td>
                  <td className="text-right py-1.5 px-2 text-zinc-300 tabular-nums">
                    {row.evidenceCount}
                  </td>
                  <td className="text-right py-1.5 px-2 text-zinc-500 tabular-nums">
                    {row.expectedEvidence}
                  </td>
                  <td className="text-right py-1.5 px-2">
                    <span className={confidenceTextClass(row.confidenceScore)}>
                      {(row.confidenceScore * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="text-right py-1.5 px-2 text-zinc-300 tabular-nums">
                    {row.adjustedPain.toFixed(2)}
                  </td>
                  <td className="text-right py-1.5 px-2 text-zinc-300 tabular-nums">
                    {row.fragility.toFixed(2)}
                  </td>
                  <td className="text-right py-1.5 px-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSnooze(row.name);
                      }}
                      className="text-zinc-700 hover:text-zinc-400 text-xs"
                      title="Snooze for 7 days"
                    >
                      💤
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
