'use client';

import { useState, useEffect, useCallback } from 'react';

interface RealityGapRow {
  name: string;
  confidenceScore: number;
  evidenceCount: number;
  expectedEvidence: number;
  gapScore: number;
  adjustedPain: number;
  fragility: number;
}

type SeverityFilter = 'all' | 'critical-high';

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

const SNOOZE_PREFIX = 'reality-gap-snooze:';
const SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
}: {
  data: RealityGapRow[];
  severityFilter?: SeverityFilter;
  minGap?: number;
}) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>(initialSeverity);
  const [minGap, setMinGap] = useState(initialMinGap);
  const [snoozedFiles, setSnoozedFiles] = useState<Set<string>>(new Set());

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

  const filtered = data.filter(row => {
    if (snoozedFiles.has(row.name)) return false;
    if (row.gapScore < minGap) return false;
    if (severityFilter === 'critical-high' && row.gapScore < 0.5) return false;
    return true;
  });

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

      {/* Filter controls */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex gap-1 bg-zinc-800 rounded-lg p-0.5">
          <button
            onClick={() => setSeverityFilter('critical-high')}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
              severityFilter === 'critical-high'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Critical + High
          </button>
          <button
            onClick={() => setSeverityFilter('all')}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
              severityFilter === 'all'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          Min gap:
          <input
            type="range"
            min={0}
            max={100}
            value={minGap * 100}
            onChange={(e) => setMinGap(Number(e.target.value) / 100)}
            className="w-20 accent-amber-500"
          />
          <span className="text-zinc-300 w-8">{(minGap * 100).toFixed(0)}%</span>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="text-zinc-500 text-sm py-4 text-center">
          No gaps match current filters.{' '}
          {snoozedFiles.size > 0 && (
            <span className="text-zinc-600">({snoozedFiles.size} snoozed)</span>
          )}
        </div>
      ) : (
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
                <th className="text-right py-2 px-1"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
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
                  <td className="text-right py-2 px-1">
                    <button
                      onClick={() => handleSnooze(row.name)}
                      className="text-zinc-600 hover:text-zinc-400 text-xs"
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
