'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QUERIES } from '@/lib/queries';
import { fetchQuery } from '@/lib/fetchQuery';

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';

export function useDashboardData() {
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
    // Computed
    loading,
    avgConfidence,
    criticalCount,
    fileCount,
    riskCounts,
  };
}
