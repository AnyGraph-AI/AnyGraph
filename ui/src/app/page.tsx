'use client';

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

export default function Dashboard() {
  const router = useRouter();
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

  const openExplorer = (payload: { focus: string; focusType: 'file' | 'function'; filePath?: string }) => {
    const search = new URLSearchParams({
      focus: payload.focus,
      focusType: payload.focusType,
    });
    if (payload.filePath) search.set('filePath', payload.filePath);
    router.push(`/explorer?${search.toString()}`);
  };

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
          godFilesData={(topFiles?.data ?? []) as any}
          fnTableData={(fnTableData?.data ?? []) as any}
          onNavigateToExplorer={openExplorer}
        />
      </div>

      <div className="fade-up grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-zinc-100">Top Files</h2>
          <p className="mt-1 font-mono text-[10px] text-zinc-500">Ranked by adjusted pain — highest risk files first</p>
          <div className="mt-3">
            {(topFiles?.data ?? []).length > 0 ? (
              <GodFilesTable
                data={(topFiles?.data ?? []) as any}
                onRowClick={(file) =>
                  openExplorer({
                    focus: file.filePath || file.name,
                    focusType: 'file',
                    filePath: file.filePath,
                  })
                }
              />
            ) : (
              <EmptyState title="No files found" description="Run codegraph parse to ingest source files" icon="📂" />
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-zinc-100">Reality Gap</h2>
          <p className="mt-1 font-mono text-[10px] text-zinc-500">Where confidence claims exceed actual evidence</p>
          <div className="mt-3">
            {(realityGapData?.data ?? []).length > 0 ? (
              <RealityGap
                data={(realityGapData?.data ?? []) as any}
                onRowClick={(row) =>
                  openExplorer({
                    focus: row.name,
                    focusType: 'file',
                  })
                }
              />
            ) : (
              <EmptyState title="No gaps detected" description="All claims have adequate evidence coverage" icon="✅" />
            )}
          </div>
        </div>
      </div>

      <div className="fade-up rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <ContextTabs
          fragilityData={(fragilityData?.data ?? []) as any}
          safestData={(safestData?.data ?? []) as any}
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
