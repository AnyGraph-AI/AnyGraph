'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QUERIES } from '@/lib/queries';
import { fetchQuery } from '@/lib/fetchQuery';
import { PainHeatmap } from '@/components/PainHeatmap';
import { GodFilesTable } from '@/components/GodFilesTable';
import { RealityGap } from '@/components/RealityGap';
import { FragilityTable } from '@/components/FragilityTable';
import { RiskDistributionChart } from '@/components/RiskDistributionChart';
import { SafestAction } from '@/components/SafestAction';
import { RiskOverTime } from '@/components/RiskOverTime';
import { MilestoneProgress } from '@/components/MilestoneProgress';
import { RecentlyDestabilizedAlert } from '@/components/RecentlyDestabilizedAlert';
import { confidenceColor } from '@/lib/colors';
import { KPI, PANEL } from '@/lib/tokens';

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';

type ViewMode = 'treemap' | 'table';
type DataMode = 'files' | 'functions';
type ContextTab = 'fragility' | 'safest' | 'riskOverTime' | 'milestones';

export default function Dashboard() {
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project-summary'],
    queryFn: () =>
      fetchQuery(QUERIES.projectSummary, { projectId: DEFAULT_PROJECT_ID }),
  });

  const { data: topFiles, isLoading: filesLoading } = useQuery({
    queryKey: ['god-files'],
    queryFn: () =>
      fetchQuery(QUERIES.godFiles, { projectId: DEFAULT_PROJECT_ID, limit: 10 }),
  });

  const { data: riskDist, isLoading: riskLoading } = useQuery({
    queryKey: ['risk-distribution'],
    queryFn: () =>
      fetchQuery(QUERIES.riskDistribution, { projectId: DEFAULT_PROJECT_ID }),
  });

  const { data: planHealth, isLoading: planLoading } = useQuery({
    queryKey: ['plan-health'],
    queryFn: () =>
      fetchQuery(QUERIES.planHealth, { projectId: 'plan_codegraph' }),
  });

  const [viewMode, setViewMode] = useState<ViewMode>('treemap');
  const [dataMode, setDataMode] = useState<DataMode>('files');
  const [contextTab, setContextTab] = useState<ContextTab>('fragility');

  const { data: heatmapData, isLoading: heatmapLoading } = useQuery({
    queryKey: ['pain-heatmap'],
    queryFn: () =>
      fetchQuery(QUERIES.painHeatmap, { projectId: DEFAULT_PROJECT_ID, limit: 100 }),
  });

  const { data: fnHeatmapData, isLoading: fnHeatmapLoading } = useQuery({
    queryKey: ['function-heatmap'],
    queryFn: () =>
      fetchQuery(QUERIES.functionHeatmap, { projectId: DEFAULT_PROJECT_ID, limit: 100 }),
  });

  const { data: fnTableData, isLoading: fnTableLoading } = useQuery({
    queryKey: ['function-god-files'],
    queryFn: () =>
      fetchQuery(QUERIES.functionGodFiles, { projectId: DEFAULT_PROJECT_ID, limit: 50 }),
  });

  const { data: realityGapData } = useQuery({
    queryKey: ['reality-gap'],
    queryFn: () =>
      fetchQuery(QUERIES.realityGap, { projectId: DEFAULT_PROJECT_ID, limit: 50 }),
  });

  const { data: fragilityData } = useQuery({
    queryKey: ['fragility-index'],
    queryFn: () =>
      fetchQuery(QUERIES.fragilityIndex, { projectId: DEFAULT_PROJECT_ID, limit: 50 }),
  });

  const { data: safestData } = useQuery({
    queryKey: ['safest-action'],
    queryFn: () =>
      fetchQuery(QUERIES.safestAction, { projectId: DEFAULT_PROJECT_ID, limit: 10 }),
  });

  const { data: riskOverTimeData } = useQuery({
    queryKey: ['risk-over-time'],
    queryFn: () =>
      fetchQuery(QUERIES.riskOverTime, { projectId: DEFAULT_PROJECT_ID, limit: 30 }),
  });

  const { data: milestoneData } = useQuery({
    queryKey: ['milestone-progress'],
    queryFn: () =>
      fetchQuery(QUERIES.milestoneProgress, { projectId: 'plan_' }),
  });

  const { data: recentlyDestabilized } = useQuery({
    queryKey: ['recently-destabilized'],
    queryFn: () =>
      fetchQuery(QUERIES.recentlyDestabilized, {
        projectId: DEFAULT_PROJECT_ID,
        days: 7,
        limit: 10,
      }),
  });

  const loading = projectLoading || filesLoading || riskLoading || planLoading || heatmapLoading || fnHeatmapLoading || fnTableLoading;

  // Computed metrics
  const avgConfidence = useMemo(() => {
    const files = heatmapData?.data ?? [];
    if (files.length === 0) return 1;
    const sum = files.reduce((acc: number, f: Record<string, unknown>) => acc + (f.confidenceScore as number ?? 0), 0);
    return sum / files.length;
  }, [heatmapData]);

  const criticalCount = useMemo(() => {
    const tiers = (riskDist?.data ?? []) as Array<{ tier: string; count: number }>;
    return tiers.find(t => t.tier === 'CRITICAL')?.count ?? 0;
  }, [riskDist]);

  const fileCount = heatmapData?.data?.length ?? 0;

  const riskCounts = useMemo(() => {
    const map: Record<string, number> = {};
    const tiers = (riskDist?.data ?? []) as Array<{ tier: string; count: number }>;
    for (const t of tiers) {
      map[t.tier] = t.count;
    }
    return map;
  }, [riskDist]);

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton KPIs */}
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={`${PANEL.classes} ${PANEL.padding} animate-pulse`}>
              <div className="h-8 bg-zinc-800 rounded w-1/2 mb-2" />
              <div className="h-3 bg-zinc-800 rounded w-2/3" />
            </div>
          ))}
        </div>
        {/* Skeleton treemap */}
        <div className="animate-pulse bg-zinc-900/50 rounded-xl min-h-[60vh]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ════════════════════════════════════════════════════ */}
      {/* TIER 1: HERO — KPIs + Treemap                       */}
      {/* ════════════════════════════════════════════════════ */}

      {/* Header with dynamic subtitle */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">AnythingGraph</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {fileCount} files · {criticalCount} critical · avg confidence{' '}
          <span style={{ color: confidenceColor(avgConfidence) }}>
            {(avgConfidence * 100).toFixed(0)}%
          </span>
        </p>
      </div>

      {/* Recently destabilized alert — only shows when relevant */}
      <RecentlyDestabilizedAlert data={(recentlyDestabilized?.data ?? []) as any} />

      {/* KPI Row — 4 cards with risk distribution integrated */}
      <div className="grid grid-cols-4 gap-3">
        {/* Max Adjusted Pain */}
        <div className={`${PANEL.classes} ${PANEL.padding}`}>
          <div className={KPI.value}>
            {(project?.data?.[0]?.maxAdjustedPain as number)?.toFixed(1) ?? '—'}
          </div>
          <div className={KPI.label}>Max Pain</div>
        </div>

        {/* Max Fragility */}
        <div className={`${PANEL.classes} ${PANEL.padding}`}>
          <div className={KPI.value}>
            {(project?.data?.[0]?.maxFragility as number)?.toFixed(1) ?? '—'}
          </div>
          <div className={KPI.label}>Max Fragility</div>
        </div>

        {/* Avg Confidence — with subtle color indicator */}
        <div className={`${PANEL.classes} ${PANEL.padding}`}>
          <div className="flex items-baseline gap-2">
            <span className={KPI.value}>{(avgConfidence * 100).toFixed(0)}%</span>
            {avgConfidence < 0.55 && (
              <span
                className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"
                title="Below 55% — scores dampened"
              />
            )}
          </div>
          <div className={KPI.label}>Avg Confidence</div>
        </div>

        {/* Risk Distribution — inline badges */}
        <div className={`${PANEL.classes} ${PANEL.padding}`}>
          <div className="flex items-baseline gap-1.5">
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(tier => {
              const count = riskCounts[tier] ?? 0;
              if (count === 0) return null;
              const colors: Record<string, string> = {
                CRITICAL: 'bg-red-500/20 text-red-400',
                HIGH: 'bg-orange-500/20 text-orange-400',
                MEDIUM: 'bg-yellow-500/20 text-yellow-400',
                LOW: 'bg-emerald-500/20 text-emerald-400',
              };
              return (
                <span
                  key={tier}
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold tabular-nums ${colors[tier]}`}
                  title={tier}
                >
                  {count}
                </span>
              );
            })}
          </div>
          <div className={KPI.label}>Risk Tiers</div>
        </div>
      </div>

      {/* Project Health — compact bar */}
      {planHealth?.data?.[0] && (() => {
        const h = planHealth.data[0] as { totalMilestones: number; doneMilestones: number; totalTasks: number; doneTasks: number; readyTasks: number; blockedTasks: number };
        const milestonePct = h.totalMilestones > 0
          ? Math.round((h.doneMilestones / h.totalMilestones) * 100)
          : 0;
        const taskPct = h.totalTasks > 0
          ? Math.round((h.doneTasks / h.totalTasks) * 100)
          : 0;
        return (
          <div className={`${PANEL.classes} px-5 py-3 flex items-center gap-8`}>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 uppercase tracking-wide">Milestones</span>
              <span className="text-sm font-semibold text-zinc-200">{h.doneMilestones}/{h.totalMilestones}</span>
              <div className="w-16 bg-zinc-800 rounded-full h-1.5">
                <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-200" style={{ width: `${milestonePct}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 uppercase tracking-wide">Tasks</span>
              <span className="text-sm font-semibold text-zinc-200">{h.doneTasks}/{h.totalTasks}</span>
              <div className="w-16 bg-zinc-800 rounded-full h-1.5">
                <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-200" style={{ width: `${taskPct}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 text-sm font-semibold">{h.readyTasks}</span>
              <span className="text-xs text-zinc-500">ready</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-orange-400 text-sm font-semibold">{h.blockedTasks}</span>
              <span className="text-xs text-zinc-500">blocked</span>
            </div>
          </div>
        );
      })()}

      {/* ── TREEMAP: The Hero ─────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-zinc-200">
            {dataMode === 'files'
              ? viewMode === 'treemap' ? 'Pain Heatmap' : 'Files by Adjusted Pain'
              : viewMode === 'treemap' ? 'Risk Heatmap' : 'Functions by Composite Risk'}
          </h2>
          <div className="flex gap-2">
            <div className="flex gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
              {(['files', 'functions'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setDataMode(mode)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors duration-150 ${
                    dataMode === mode
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex gap-0.5 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
              {(['treemap', 'table'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors duration-150 ${
                    viewMode === mode
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {mode === 'treemap' ? 'Heatmap' : 'Table'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {heatmapData?.data && heatmapData.data.length > 500 && (
          <div className="text-amber-400/80 text-xs mb-2">
            ⚠ Showing top 500 of {heatmapData.data.length} files
          </div>
        )}

        {/* Treemap fills viewport — no card chrome */}
        <div className="min-h-[60vh] rounded-xl overflow-hidden border border-zinc-800/40 bg-zinc-950">
          {dataMode === 'files' ? (
            viewMode === 'treemap' ? (
              <PainHeatmap data={(heatmapData?.data ?? []) as any} />
            ) : (
              <div className="p-4">
                <GodFilesTable data={(topFiles?.data ?? []) as any} />
              </div>
            )
          ) : (
            viewMode === 'treemap' ? (
              <PainHeatmap
                data={(fnHeatmapData?.data ?? []).map((f: Record<string, unknown>) => ({
                  name: f.name as string,
                  filePath: f.filePath as string,
                  adjustedPain: f.compositeRisk as number,
                  confidenceScore: f.riskTier === 'CRITICAL' ? 0 : f.riskTier === 'HIGH' ? 0.3 : f.riskTier === 'MEDIUM' ? 0.6 : 1.0,
                  painScore: f.compositeRisk as number,
                  fragility: 0,
                }))}
              />
            ) : (
              <div className="p-4">
                <GodFilesTable
                  data={(fnTableData?.data ?? []).map((f: Record<string, unknown>) => ({
                    name: `${f.name} (${f.fileName})`,
                    filePath: '',
                    adjustedPain: f.compositeRisk as number,
                    fragility: 0,
                    confidenceScore: f.riskTier === 'CRITICAL' ? 0 : f.riskTier === 'HIGH' ? 0.3 : f.riskTier === 'MEDIUM' ? 0.6 : 1.0,
                    basePain: f.compositeRisk as number,
                    centrality: f.centrality as number,
                    downstreamImpact: f.downstreamImpact as number,
                  }))}
                />
              </div>
            )
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════ */}
      {/* TIER 2: ACTIONABLE — God Files + Reality Gap         */}
      {/* ════════════════════════════════════════════════════ */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${PANEL.classes} ${PANEL.padding}`}>
          <h2 className={PANEL.headerText}>Top Files</h2>
          <p className={PANEL.descText}>Ranked by adjusted pain — highest risk files first</p>
          <div className="mt-3">
            <GodFilesTable data={(topFiles?.data ?? []) as any} />
          </div>
        </div>

        <div className={`${PANEL.classes} ${PANEL.padding}`}>
          <h2 className={PANEL.headerText}>Reality Gap</h2>
          <p className={PANEL.descText}>Where confidence claims exceed actual evidence</p>
          <div className="mt-3">
            <RealityGap data={(realityGapData?.data ?? []) as any} />
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════ */}
      {/* TIER 3: CONTEXT — Tabbed panels                      */}
      {/* ════════════════════════════════════════════════════ */}

      <div className={`${PANEL.classes}`}>
        {/* Tab pills */}
        <div className="flex items-center gap-1 px-5 pt-4 pb-0 border-b border-zinc-800/40">
          {([
            { key: 'fragility' as const, label: 'Fragility' },
            { key: 'safest' as const, label: 'Safest Actions' },
            { key: 'riskOverTime' as const, label: 'Risk Trend' },
            { key: 'milestones' as const, label: 'Milestones' },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setContextTab(tab.key)}
              className={`px-3 py-2 text-xs font-medium rounded-t-md transition-colors duration-150 -mb-px ${
                contextTab === tab.key
                  ? 'bg-zinc-800/80 text-zinc-100 border-b-2 border-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className={PANEL.padding}>
          {contextTab === 'fragility' && (
            <FragilityTable data={(fragilityData?.data ?? []) as any} avgConfidence={avgConfidence} />
          )}
          {contextTab === 'safest' && (
            <SafestAction data={(safestData?.data ?? []) as any} />
          )}
          {contextTab === 'riskOverTime' && (
            <RiskOverTime data={(riskOverTimeData?.data ?? []) as any} />
          )}
          {contextTab === 'milestones' && (
            <MilestoneProgress data={(milestoneData?.data ?? []) as any} />
          )}
        </div>
      </div>

      {/* Legend — collapsible, below everything */}
      <details className={`${PANEL.classes}`}>
        <summary className="px-5 py-3 cursor-pointer text-zinc-500 hover:text-zinc-300 text-xs font-medium">
          What do these metrics mean?
        </summary>
        <div className="px-5 pb-4 grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
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
              <span className="text-zinc-300 font-medium">{term}</span>
              <span className="text-zinc-600"> — </span>
              <span className="text-zinc-500">{desc}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
