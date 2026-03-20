'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QUERIES } from '@/lib/queries';
import { fetchQuery } from '@/lib/fetchQuery';

async function fetchActiveContext(projectId: string): Promise<{ data: Record<string, unknown> }> {
  const res = await fetch(`/api/graph/active-context?projectId=${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error(`Active context failed: ${res.statusText}`);
  return res.json();
}

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';

type DashboardFilterParams = {
  projectId?: string;
  days?: number;
};

export function useDashboardData(params: DashboardFilterParams = {}) {
  const projectId = params.projectId ?? DEFAULT_PROJECT_ID;
  const days = Math.max(1, Math.min(30, params.days ?? 7));
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project-summary', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.projectSummary, { projectId }),
  });

  const { data: topFiles, isLoading: filesLoading } = useQuery({
    queryKey: ['god-files', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.godFiles, { projectId, limit: 10 }),
  });

  const { data: riskDist, isLoading: riskLoading } = useQuery({
    queryKey: ['risk-distribution', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.riskDistribution, { projectId }),
  });

  const { data: planHealth, isLoading: planLoading } = useQuery({
    queryKey: ['plan-health'],
    queryFn: () =>
      fetchQuery(QUERIES.planHealth, { projectId: 'plan_codegraph' }),
  });

  const { data: heatmapData, isLoading: heatmapLoading } = useQuery({
    queryKey: ['pain-heatmap', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.painHeatmap, { projectId, limit: 100 }),
  });

  const { data: fnHeatmapData, isLoading: fnHeatmapLoading } = useQuery({
    queryKey: ['function-heatmap', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.functionHeatmap, { projectId, limit: 100 }),
  });

  const { data: fnTableData, isLoading: fnTableLoading } = useQuery({
    queryKey: ['function-god-files', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.functionGodFiles, { projectId, limit: 50 }),
  });

  const { data: realityGapData } = useQuery({
    queryKey: ['reality-gap', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.realityGap, { projectId, limit: 50 }),
  });

  const { data: fragilityData } = useQuery({
    queryKey: ['fragility-index', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.fragilityIndex, { projectId, limit: 50 }),
  });

  const { data: safestData } = useQuery({
    queryKey: ['safest-action', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.safestAction, { projectId, limit: 10 }),
  });

  const { data: riskOverTimeData } = useQuery({
    queryKey: ['risk-over-time', projectId],
    queryFn: () =>
      fetchQuery(QUERIES.riskOverTime, { projectId, limit: 30 }),
  });

  const { data: milestoneData } = useQuery({
    queryKey: ['milestone-progress'],
    queryFn: () =>
      fetchQuery(QUERIES.milestoneProgress, { projectId: 'plan_' }),
  });

  const { data: recentlyDestabilized } = useQuery({
    queryKey: ['recently-destabilized', projectId, days],
    queryFn: () =>
      fetchQuery(QUERIES.recentlyDestabilized, {
        projectId,
        days,
        limit: 10,
      }),
  });

  const { data: activeContextData } = useQuery({
    queryKey: ['active-context', projectId],
    queryFn: () => fetchActiveContext(projectId),
  });

  const loading = projectLoading || filesLoading || riskLoading || planLoading || heatmapLoading || fnHeatmapLoading || fnTableLoading;

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

  return {
    // Raw query results
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
    activeContextData,
    // Computed
    loading,
    avgConfidence,
    criticalCount,
    fileCount,
    riskCounts,
  };
}
