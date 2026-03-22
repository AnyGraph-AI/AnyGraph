'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QUERIES } from '@/lib/queries';
import { fetchQuery } from '@/lib/fetchQuery';
import { classifyError, type ErrorKind } from '@/lib/errorUtils';

async function fetchActiveContext(projectId: string): Promise<{ data: Record<string, unknown> }> {
  const res = await fetch(`/api/graph/active-context?projectId=${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error(`Active context failed: ${res.statusText}`);
  return res.json();
}

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';

type DashboardFilterParams = {
  projectId?: string;
  days?: number;
  refetchInterval?: number | false;
};

export function useDashboardData(params: DashboardFilterParams = {}) {
  const projectId = params.projectId ?? DEFAULT_PROJECT_ID;
  const days = Math.max(1, Math.min(30, params.days ?? 7));
  const refetchInterval = params.refetchInterval ?? false;

  const projectQuery = useQuery({
    queryKey: ['project-summary', projectId],
    queryFn: () => fetchQuery(QUERIES.projectSummary, { projectId }),
    refetchInterval,
  });

  const topFilesQuery = useQuery({
    queryKey: ['god-files', projectId],
    queryFn: () => fetchQuery(QUERIES.godFiles, { projectId, limit: 10 }),
    refetchInterval,
  });

  const riskDistQuery = useQuery({
    queryKey: ['risk-distribution', projectId],
    queryFn: () => fetchQuery(QUERIES.riskDistribution, { projectId }),
    refetchInterval,
  });

  const planHealthQuery = useQuery({
    queryKey: ['plan-health'],
    queryFn: () => fetchQuery(QUERIES.planHealth, { projectId: 'plan_codegraph' }),
    refetchInterval,
  });

  const heatmapQuery = useQuery({
    queryKey: ['pain-heatmap', projectId],
    queryFn: () => fetchQuery(QUERIES.painHeatmap, { projectId, limit: 100 }),
    refetchInterval,
  });

  const fnHeatmapQuery = useQuery({
    queryKey: ['function-heatmap', projectId],
    queryFn: () => fetchQuery(QUERIES.functionHeatmap, { projectId, limit: 100 }),
    refetchInterval,
  });

  const fnTableQuery = useQuery({
    queryKey: ['function-god-files', projectId],
    queryFn: () => fetchQuery(QUERIES.functionGodFiles, { projectId, limit: 50 }),
    refetchInterval,
  });

  const realityGapQuery = useQuery({
    queryKey: ['reality-gap', projectId],
    queryFn: () => fetchQuery(QUERIES.realityGap, { projectId, limit: 50 }),
    refetchInterval,
  });

  const fragilityQuery = useQuery({
    queryKey: ['fragility-index', projectId],
    queryFn: () => fetchQuery(QUERIES.fragilityIndex, { projectId, limit: 50 }),
    refetchInterval,
  });

  const safestQuery = useQuery({
    queryKey: ['safest-action', projectId],
    queryFn: () => fetchQuery(QUERIES.safestAction, { projectId, limit: 10 }),
    refetchInterval,
  });

  const riskOverTimeQuery = useQuery({
    queryKey: ['risk-over-time', projectId],
    queryFn: () => fetchQuery(QUERIES.riskOverTime, { projectId, limit: 30 }),
    refetchInterval,
  });

  const milestoneQuery = useQuery({
    queryKey: ['milestone-progress'],
    queryFn: () => fetchQuery(QUERIES.milestoneProgress, { projectId: 'plan_' }),
    refetchInterval,
  });

  const recentlyDestabilizedQuery = useQuery({
    queryKey: ['recently-destabilized', projectId, days],
    queryFn: () =>
      fetchQuery(QUERIES.recentlyDestabilized, { projectId, days, limit: 10 }),
    refetchInterval,
  });

  const activeContextQuery = useQuery({
    queryKey: ['active-context', projectId],
    queryFn: () => fetchActiveContext(projectId),
    refetchInterval,
  });

  // Unified loading state
  const loading =
    projectQuery.isLoading ||
    topFilesQuery.isLoading ||
    riskDistQuery.isLoading ||
    planHealthQuery.isLoading ||
    heatmapQuery.isLoading ||
    fnHeatmapQuery.isLoading ||
    fnTableQuery.isLoading;

  // Unified error state — first error wins for kind classification
  const firstError =
    projectQuery.error ??
    topFilesQuery.error ??
    riskDistQuery.error ??
    planHealthQuery.error ??
    heatmapQuery.error ??
    fnHeatmapQuery.error ??
    fnTableQuery.error ??
    realityGapQuery.error ??
    fragilityQuery.error ??
    null;

  const isError =
    projectQuery.isError ||
    topFilesQuery.isError ||
    riskDistQuery.isError ||
    planHealthQuery.isError ||
    heatmapQuery.isError ||
    fnHeatmapQuery.isError ||
    fnTableQuery.isError;

  const errorKind: ErrorKind | null = isError ? classifyError(firstError) : null;

  // Per-query error map for granular panel handling
  const errors = {
    project: projectQuery.error,
    topFiles: topFilesQuery.error,
    riskDist: riskDistQuery.error,
    planHealth: planHealthQuery.error,
    heatmap: heatmapQuery.error,
    fnHeatmap: fnHeatmapQuery.error,
    fnTable: fnTableQuery.error,
    realityGap: realityGapQuery.error,
    fragility: fragilityQuery.error,
    safest: safestQuery.error,
    riskOverTime: riskOverTimeQuery.error,
    milestone: milestoneQuery.error,
    recentlyDestabilized: recentlyDestabilizedQuery.error,
    activeContext: activeContextQuery.error,
  };

  // Refetch all primary queries
  const refetchAll = () => {
    void projectQuery.refetch();
    void topFilesQuery.refetch();
    void riskDistQuery.refetch();
    void planHealthQuery.refetch();
    void heatmapQuery.refetch();
    void fnHeatmapQuery.refetch();
    void fnTableQuery.refetch();
    void realityGapQuery.refetch();
    void fragilityQuery.refetch();
    void safestQuery.refetch();
    void riskOverTimeQuery.refetch();
    void milestoneQuery.refetch();
    void recentlyDestabilizedQuery.refetch();
    void activeContextQuery.refetch();
  };

  const avgConfidence = useMemo(() => {
    const files = heatmapQuery.data?.data ?? [];
    if (files.length === 0) return 1;
    const sum = files.reduce((acc: number, f: Record<string, unknown>) => acc + (f.confidenceScore as number ?? 0), 0);
    return sum / files.length;
  }, [heatmapQuery.data]);

  const criticalCount = useMemo(() => {
    const tiers = (riskDistQuery.data?.data ?? []) as Array<{ tier: string; count: number }>;
    return tiers.find(t => t.tier === 'CRITICAL')?.count ?? 0;
  }, [riskDistQuery.data]);

  const fileCount = heatmapQuery.data?.data?.length ?? 0;

  const riskCounts = useMemo(() => {
    const map: Record<string, number> = {};
    const tiers = (riskDistQuery.data?.data ?? []) as Array<{ tier: string; count: number }>;
    for (const t of tiers) {
      map[t.tier] = t.count;
    }
    return map;
  }, [riskDistQuery.data]);

  return {
    // Raw query results
    project: projectQuery.data,
    topFiles: topFilesQuery.data,
    planHealth: planHealthQuery.data,
    heatmapData: heatmapQuery.data,
    fnHeatmapData: fnHeatmapQuery.data,
    fnTableData: fnTableQuery.data,
    realityGapData: realityGapQuery.data,
    fragilityData: fragilityQuery.data,
    safestData: safestQuery.data,
    riskOverTimeData: riskOverTimeQuery.data,
    milestoneData: milestoneQuery.data,
    recentlyDestabilized: recentlyDestabilizedQuery.data,
    activeContextData: activeContextQuery.data,
    // Computed
    loading,
    avgConfidence,
    criticalCount,
    fileCount,
    riskCounts,
    // Error surface
    isError,
    errorKind,
    errors,
    refetchAll,
  };
}
