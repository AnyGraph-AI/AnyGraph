'use client';

import { confidenceColor } from '@/lib/colors';
import { PANEL } from '@/lib/tokens';
import { useDashboardData } from '@/hooks/useDashboardData';
import { KpiRow } from '@/components/KpiRow';
import { HeroTreemap } from '@/components/HeroTreemap';
import { ContextTabs } from '@/components/ContextTabs';
import { RealityGap } from '@/components/RealityGap';
import { GodFilesTable } from '@/components/GodFilesTable';
import { RecentlyDestabilizedAlert } from '@/components/RecentlyDestabilizedAlert';
import { KpiSkeleton, TreemapSkeleton, PanelSkeleton } from '@/components/ui/loading-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';

export default function Dashboard() {
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
  } = useDashboardData();

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

  return (
    <div className="space-y-6">

      {/* ═══ HEADER ═══ */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">AnythingGraph</h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          {fileCount} files · {criticalCount} critical · avg confidence{' '}
          <span style={{ color: confidenceColor(avgConfidence) }}>
            {(avgConfidence * 100).toFixed(0)}%
          </span>
        </p>
      </div>

      <RecentlyDestabilizedAlert data={(recentlyDestabilized?.data ?? []) as any} />

      {/* ═══ TIER 1: KPIs ═══ */}
      <KpiRow
        maxPain={(project?.data?.[0]?.maxAdjustedPain as number) ?? null}
        maxFragility={(project?.data?.[0]?.maxFragility as number) ?? null}
        avgConfidence={avgConfidence}
        riskCounts={riskCounts}
      />

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

      {/* ═══ TIER 1: HERO TREEMAP ═══ */}
      <HeroTreemap
        fileHeatmapData={(heatmapData?.data ?? []) as any}
        fnHeatmapData={(fnHeatmapData?.data ?? []) as any}
        godFilesData={(topFiles?.data ?? []) as any}
        fnTableData={(fnTableData?.data ?? []) as any}
      />

      {/* ═══ TIER 2: ACTIONABLE ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={`${PANEL.classes} ${PANEL.padding}`}>
          <h2 className={PANEL.headerText}>Top Files</h2>
          <p className={PANEL.descText}>Ranked by adjusted pain — highest risk files first</p>
          <div className="mt-3">
            {(topFiles?.data ?? []).length > 0 ? (
              <GodFilesTable data={(topFiles?.data ?? []) as any} />
            ) : (
              <EmptyState title="No files found" description="Run codegraph parse to ingest source files" icon="📂" />
            )}
          </div>
        </div>
        <div className={`${PANEL.classes} ${PANEL.padding}`}>
          <h2 className={PANEL.headerText}>Reality Gap</h2>
          <p className={PANEL.descText}>Where confidence claims exceed actual evidence</p>
          <div className="mt-3">
            {(realityGapData?.data ?? []).length > 0 ? (
              <RealityGap data={(realityGapData?.data ?? []) as any} />
            ) : (
              <EmptyState title="No gaps detected" description="All claims have adequate evidence coverage" icon="✅" />
            )}
          </div>
        </div>
      </div>

      {/* ═══ TIER 3: CONTEXT ═══ */}
      <ContextTabs
        fragilityData={(fragilityData?.data ?? []) as any}
        safestData={(safestData?.data ?? []) as any}
        riskOverTimeData={(riskOverTimeData?.data ?? []) as any}
        milestoneData={(milestoneData?.data ?? []) as any}
        avgConfidence={avgConfidence}
      />

      {/* Legend */}
      <details className={PANEL.classes}>
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
