'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confidenceColor } from '@/lib/colors';
import { useDashboardData } from '@/hooks/useDashboardData';
import { KpiRow } from '@/components/KpiRow';
import { HeroTreemap } from '@/components/HeroTreemap';
import { ContextTabs } from '@/components/ContextTabs';
import { RealityGap } from '@/components/RealityGap';
import { GodFilesTable } from '@/components/GodFilesTable';
import { RecentlyDestabilizedAlert } from '@/components/RecentlyDestabilizedAlert';
import { ProgressRing } from '@/components/ProgressRing';
import { KpiSkeleton, TreemapSkeleton, PanelSkeleton } from '@/components/ui/loading-skeleton';
import { EmptyState } from '@/components/ui/empty-state';

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';
const DEFAULT_RISK = 'CRITICAL,HIGH';
const DEFAULT_MIN_CONFIDENCE = 0.4;
const DEFAULT_DAYS = 7;

function parseRiskParam(raw: string | null): string[] {
  const value = raw?.trim();
  if (!value) return DEFAULT_RISK.split(',');
  return value.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean);
}

function parseNumberParam(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const TIER_BY_NUM: Record<number, string> = {
  4: 'CRITICAL',
  3: 'HIGH',
  2: 'MEDIUM',
  1: 'LOW',
  0: 'UNKNOWN',
};

function normalizeTier(row: Record<string, unknown>): string {
  const direct = String(row.riskTier ?? row.maxTier ?? '').toUpperCase();
  if (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].includes(direct)) return direct;
  const num = Number(row.riskTierNum ?? row.maxTierNum ?? 0);
  return TIER_BY_NUM[num] ?? 'UNKNOWN';
}

type DashboardView = 'dashboard' | 'gaps' | 'fragility';

type DashboardUrlState = {
  projectId: string;
  riskFilter: string[];
  minConfidence: number;
  days: number;
  view: DashboardView;
};

function parseDashboardFilters(params: URLSearchParams): DashboardUrlState {
  const rawView = params.get('view');
  const view: DashboardView = rawView === 'gaps' || rawView === 'fragility' ? rawView : 'dashboard';

  return {
    projectId: params.get('project') ?? DEFAULT_PROJECT_ID,
    riskFilter: parseRiskParam(params.get('risk')),
    minConfidence: parseNumberParam(params.get('minConfidence'), DEFAULT_MIN_CONFIDENCE, 0, 1),
    days: parseNumberParam(params.get('days'), DEFAULT_DAYS, 1, 30),
    view,
  };
}

export default function Dashboard() {
  const router = useRouter();
  const [urlState, setUrlState] = useState<DashboardUrlState>({
    projectId: DEFAULT_PROJECT_ID,
    riskFilter: DEFAULT_RISK.split(','),
    minConfidence: DEFAULT_MIN_CONFIDENCE,
    days: DEFAULT_DAYS,
    view: 'dashboard',
  });

  useEffect(() => {
    const sync = () => setUrlState(parseDashboardFilters(new URLSearchParams(window.location.search)));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const { projectId, riskFilter, minConfidence, days, view } = urlState;

  const {
    project,
    topFiles,
    planHealth,
    heatmapData,
    fnHeatmapData,
    fnTableData,
    realityGapData,
    fragilityData,
    safestData,
    riskOverTimeData,
    milestoneData,
    recentlyDestabilized,
    loading,
    avgConfidence,
    criticalCount,
    fileCount,
    riskCounts,
  } = useDashboardData({ projectId, days });

  const setFilter = (patch: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    const nextUrl = `/?${next.toString()}`;
    window.history.replaceState({}, '', nextUrl);
    setUrlState(parseDashboardFilters(next));
    router.replace(nextUrl);
  };

  const openExplorer = (payload: { focus: string; focusType: 'file' | 'function'; filePath?: string }) => {
    const search = new URLSearchParams({
      focus: payload.focus,
      focusType: payload.focusType,
      project: projectId,
      risk: riskFilter.join(','),
      minConfidence: String(minConfidence),
      days: String(days),
      view,
    });
    if (payload.filePath) search.set('filePath', payload.filePath);
    router.push(`/explorer?${search.toString()}`);
  };

  const topFilesRows = (topFiles?.data ?? []) as Array<Record<string, unknown>>;
  const realityRows = (realityGapData?.data ?? []) as Array<Record<string, unknown>>;
  const fragilityRows = (fragilityData?.data ?? []) as Array<Record<string, unknown>>;
  const safestRows = (safestData?.data ?? []) as Array<Record<string, unknown>>;

  const byRiskAndConfidence = (row: Record<string, unknown>) => {
    const tier = normalizeTier(row);
    const confidence = Number(row.confidenceScore ?? 1);
    const riskPass = riskFilter.length === 0 ? true : riskFilter.includes(tier);
    return riskPass && confidence >= minConfidence;
  };

  const filteredTopFiles = useMemo(() => topFilesRows.filter(byRiskAndConfidence), [topFilesRows, riskFilter.join(','), minConfidence]);
  const filteredRealityRows = useMemo(() => realityRows.filter(byRiskAndConfidence), [realityRows, riskFilter.join(','), minConfidence]);
  const filteredFragilityRows = useMemo(() => fragilityRows.filter(byRiskAndConfidence), [fragilityRows, riskFilter.join(','), minConfidence]);
  const filteredSafestRows = useMemo(() => safestRows.filter(byRiskAndConfidence), [safestRows, riskFilter.join(','), minConfidence]);

  const filterSummary = `risk=${riskFilter.join(',')} · minConf=${Math.round(minConfidence * 100)}%`;
  const panelCounts = {
    topFiles: `${filteredTopFiles.length}/${topFilesRows.length}`,
    reality: `${filteredRealityRows.length}/${realityRows.length}`,
    fragility: `${filteredFragilityRows.length}/${fragilityRows.length}`,
  };

  useEffect(() => {
    if (view === 'dashboard') return;
    const id = view === 'gaps' ? 'gaps-view' : 'fragility-view';
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [view]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-7 bg-zinc-800 rounded w-48 mb-2 animate-pulse" />
          <div className="h-4 bg-zinc-800 rounded w-72 animate-pulse" />
        </div>
        <KpiSkeleton />
        <TreemapSkeleton />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PanelSkeleton lines={6} />
          <PanelSkeleton lines={6} />
        </div>
        <PanelSkeleton lines={4} />
      </div>
    );
  }

  const health = (planHealth?.data?.[0] as {
    totalMilestones: number;
    doneMilestones: number;
    totalTasks: number;
    doneTasks: number;
    readyTasks: number;
    blockedTasks: number;
  } | undefined);

  return (
    <div className="space-y-5">
      <div className="fade-up">
        <h1 className="text-[24px] font-bold leading-tight tracking-[-0.03em] text-zinc-100">AnythingGraph</h1>
        <p className="mt-1 font-mono text-[11px] text-zinc-500">
          {fileCount} files · {criticalCount} critical · avg confidence{' '}
          <span style={{ color: confidenceColor(avgConfidence) }}>{(avgConfidence * 100).toFixed(0)}%</span>
        </p>
      </div>

      <div className="fade-up rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-wrap items-center gap-3">
        <label className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Project</label>
        <input
          value={projectId}
          onChange={(e) => setFilter({ project: e.target.value })}
          className="h-8 rounded border border-white/10 bg-black/20 px-2 text-xs text-zinc-200 w-[220px]"
        />

        <label className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Risk</label>
        <select
          value={riskFilter.join(',')}
          onChange={(e) => setFilter({ risk: e.target.value })}
          className="h-8 rounded border border-white/10 bg-black/20 px-2 text-xs text-zinc-200"
        >
          <option value="CRITICAL,HIGH">CRITICAL,HIGH</option>
          <option value="CRITICAL,HIGH,MEDIUM">CRITICAL,HIGH,MEDIUM</option>
          <option value="CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN">ALL</option>
        </select>

        <label className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Min confidence</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(minConfidence * 100)}
          onChange={(e) => setFilter({ minConfidence: String(Number(e.target.value) / 100) })}
          className="w-28 accent-[#7ec8e3]"
        />
        <span className="font-mono text-xs text-zinc-400 w-10">{Math.round(minConfidence * 100)}%</span>

        <label className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Days</label>
        <select
          value={String(days)}
          onChange={(e) => setFilter({ days: e.target.value })}
          className="h-8 rounded border border-white/10 bg-black/20 px-2 text-xs text-zinc-200"
        >
          <option value="3">3</option>
          <option value="7">7</option>
          <option value="14">14</option>
          <option value="30">30</option>
        </select>

        <label className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">View</label>
        <select
          value={view}
          onChange={(e) => setFilter({ view: e.target.value })}
          className="h-8 rounded border border-white/10 bg-black/20 px-2 text-xs text-zinc-200"
        >
          <option value="dashboard">Dashboard</option>
          <option value="gaps">Gaps</option>
          <option value="fragility">Fragility</option>
        </select>
      </div>

      <div className="fade-up">
        <KpiRow
          maxPain={(project?.data?.[0]?.maxAdjustedPain as number) ?? null}
          maxFragility={(project?.data?.[0]?.maxFragility as number) ?? null}
          avgConfidence={avgConfidence}
          riskCounts={riskCounts}
        />
      </div>

      {health && (
        <div className="fade-up rounded-xl border border-white/10 bg-white/[0.025] px-5 py-3.5 flex flex-wrap items-center gap-7">
          <ProgressRing value={health.doneMilestones} max={health.totalMilestones} label="Milestones" />
          <ProgressRing value={health.doneTasks} max={health.totalTasks} label="Tasks" />
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-mono text-sm font-semibold text-emerald-400">{health.readyTasks}</span>
            <span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500">ready</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-orange-400" />
            <span className="font-mono text-sm font-semibold text-orange-400">{health.blockedTasks}</span>
            <span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500">blocked</span>
          </div>
        </div>
      )}

      <div className="fade-up">
        <RecentlyDestabilizedAlert
          data={(recentlyDestabilized?.data ?? []) as any}
          onRowClick={(row) =>
            openExplorer({
              focus: row.filePath || row.name,
              focusType: 'file',
              filePath: row.filePath,
            })
          }
        />
      </div>

      <div className="fade-up rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <HeroTreemap
          fileHeatmapData={(heatmapData?.data ?? []) as any}
          fnHeatmapData={(fnHeatmapData?.data ?? []) as any}
          godFilesData={filteredTopFiles as any}
          fnTableData={(fnTableData?.data ?? []) as any}
          onNavigateToExplorer={openExplorer}
        />
      </div>

      <div className="fade-up grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-zinc-100">Top Files</h2>
          <p className="mt-1 font-mono text-[10px] text-zinc-500">Ranked by adjusted pain — highest risk files first</p>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">Visible {panelCounts.topFiles} · {filterSummary}</p>
          <div className="mt-3">
            {filteredTopFiles.length > 0 ? (
              <GodFilesTable
                data={filteredTopFiles as any}
                onRowClick={(file) =>
                  openExplorer({
                    focus: file.filePath || file.name,
                    focusType: 'file',
                    filePath: file.filePath,
                  })
                }
              />
            ) : (
              <EmptyState title="No files match current filters" description="Try widening risk/min-confidence filters or include UNKNOWN tier." icon="📂" />
            )}
          </div>
        </div>

        <div id="gaps-view" className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-zinc-100">Reality Gap</h2>
          <p className="mt-1 font-mono text-[10px] text-zinc-500">Where confidence claims exceed actual evidence</p>
          <p className="mt-1 font-mono text-[10px] text-zinc-600">Visible {panelCounts.reality} · {filterSummary}</p>
          <div className="mt-3">
            {filteredRealityRows.length > 0 ? (
              <RealityGap
                data={filteredRealityRows as any}
                onRowClick={(row) =>
                  openExplorer({
                    focus: row.name,
                    focusType: 'file',
                  })
                }
              />
            ) : (
              <EmptyState title="No gaps match current filters" description="Try widening risk/min-confidence filters or include UNKNOWN tier." icon="✅" />
            )}
          </div>
        </div>
      </div>

      <div id="fragility-view" className="fade-up rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <p className="mb-2 font-mono text-[10px] text-zinc-600">Visible {panelCounts.fragility} · {filterSummary}</p>
        <ContextTabs
          fragilityData={filteredFragilityRows as any}
          safestData={filteredSafestRows as any}
          riskOverTimeData={(riskOverTimeData?.data ?? []) as any}
          milestoneData={(milestoneData?.data ?? []) as any}
          avgConfidence={avgConfidence}
          onFragilityClick={(row) =>
            openExplorer({
              focus: String(row.name ?? ''),
              focusType: 'file',
            })
          }
          onSafestClick={(row) =>
            openExplorer({
              focus: String(row.name ?? ''),
              focusType: 'file',
            })
          }
        />
      </div>

      <details className="fade-up rounded-xl border border-white/10 bg-white/[0.015]">
        <summary className="px-5 py-3 cursor-pointer text-zinc-500 hover:text-zinc-300 text-[11px] font-semibold tracking-[0.08em] uppercase">
          What do these metrics mean?
        </summary>
        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-[11px] leading-5">
          {[
            ['Pain', 'How much it hurts to change this file. 5-factor weighted: risk density, churn, coverage gaps, fan-out, co-change coupling.'],
            ['Adjusted Pain', 'Pain amplified by uncertainty. 0% confidence = 2× pain. Formula: pain × (1 + (1 − confidence)).'],
            ['Confidence', 'How well-tested and verified. 3-factor: effective confidence × 0.5 + evidence count × 0.3 + freshness × 0.2.'],
            ['Fragility', 'Compound risk: painful AND unprotected AND unstable. Formula: adjustedPain × (1 − confidence) × (1 + churn).'],
            ['Centrality', 'How connected in the call graph. High centrality = changes ripple further.'],
            ['Downstream', 'Log-damped count of CRITICAL/HIGH functions reachable. Measures blast radius.'],
            ['Risk Tiers', 'CRITICAL (top 15%), HIGH (next 20%), MEDIUM (next 30%), LOW (bottom 35%). Based on composite risk.'],
            ['Reality Gap', 'Where confidence exceeds evidence. High gap = false certainty.'],
          ].map(([term, desc]) => (
            <div key={term}>
              <span className="font-mono text-[#7ec8e3] font-semibold">{term}</span>
              <span className="text-zinc-600"> — </span>
              <span className="text-zinc-400">{desc}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
