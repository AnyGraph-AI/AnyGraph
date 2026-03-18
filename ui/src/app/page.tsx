'use client';

import { useQuery } from '@tanstack/react-query';
import { QUERIES } from '@/lib/queries';

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';

async function fetchQuery(query: string, params: Record<string, unknown> = {}) {
  const res = await fetch('/api/graph/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });
  if (!res.ok) throw new Error(`Query failed: ${res.statusText}`);
  return res.json();
}

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

  const loading = projectLoading || filesLoading || riskLoading || planLoading;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
        <p className="text-zinc-400 mt-1">
          Code intelligence — pre-computed, flat reads, zero traversal.
        </p>
      </div>

      {loading ? (
        <div className="text-zinc-500">Loading graph data...</div>
      ) : (
        <>
          {/* Project Summary */}
          {project?.data?.[0] && (
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Project', value: project.data[0].name },
                { label: 'Nodes', value: project.data[0].nodeCount?.toLocaleString() },
                { label: 'Max Pain', value: project.data[0].maxAdjustedPain?.toFixed(1) },
                { label: 'Max Fragility', value: project.data[0].maxFragility?.toFixed(1) },
              ].map((card) => (
                <div key={card.label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                  <div className="text-zinc-400 text-sm">{card.label}</div>
                  <div className="text-xl font-bold text-zinc-100 mt-1">{card.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Risk Distribution */}
          {riskDist?.data && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-zinc-100 mb-3">Risk Distribution</h2>
              <div className="flex gap-4">
                {riskDist.data.map((tier: { tier: string; count: number }) => (
                  <div
                    key={tier.tier}
                    className={`flex-1 rounded-lg p-3 text-center ${
                      tier.tier === 'CRITICAL'
                        ? 'bg-red-950 border border-red-800 text-red-300'
                        : tier.tier === 'HIGH'
                        ? 'bg-orange-950 border border-orange-800 text-orange-300'
                        : tier.tier === 'MEDIUM'
                        ? 'bg-yellow-950 border border-yellow-800 text-yellow-300'
                        : 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                    }`}
                  >
                    <div className="text-2xl font-bold">{tier.count}</div>
                    <div className="text-sm mt-1">{tier.tier}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Project Health */}
          {planHealth?.data?.[0] && (() => {
            const h = planHealth.data[0];
            const milestonePct = h.totalMilestones > 0
              ? Math.round((h.doneMilestones / h.totalMilestones) * 100)
              : 0;
            const taskPct = h.totalTasks > 0
              ? Math.round((h.doneTasks / h.totalTasks) * 100)
              : 0;
            return (
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <h2 className="text-lg font-semibold text-zinc-100 mb-3">Project Health</h2>
                <div className="grid grid-cols-4 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-zinc-100">
                      {h.doneMilestones}/{h.totalMilestones}
                    </div>
                    <div className="text-sm text-zinc-400 mt-1">Milestones ({milestonePct}%)</div>
                    <div className="w-full bg-zinc-800 rounded-full h-1.5 mt-2">
                      <div
                        className="bg-emerald-500 h-1.5 rounded-full"
                        style={{ width: `${milestonePct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-zinc-100">
                      {h.doneTasks}/{h.totalTasks}
                    </div>
                    <div className="text-sm text-zinc-400 mt-1">Tasks ({taskPct}%)</div>
                    <div className="w-full bg-zinc-800 rounded-full h-1.5 mt-2">
                      <div
                        className="bg-emerald-500 h-1.5 rounded-full"
                        style={{ width: `${taskPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-emerald-400">{h.readyTasks}</div>
                    <div className="text-sm text-zinc-400 mt-1">Ready (unblocked)</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-400">{h.blockedTasks}</div>
                    <div className="text-sm text-zinc-400 mt-1">Blocked</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Legend */}
          <details className="bg-zinc-900 border border-zinc-800 rounded-lg">
            <summary className="px-4 py-3 cursor-pointer text-zinc-400 hover:text-zinc-200 text-sm font-medium">
              📖 What do these metrics mean?
            </summary>
            <div className="px-4 pb-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <div>
                <span className="text-zinc-200 font-medium">Pain</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-400">
                  How much it hurts to change this file. 5-factor weighted score: risk density, churn frequency, test coverage gaps, fan-out complexity, and co-change coupling. Higher = more painful to touch.
                </span>
              </div>
              <div>
                <span className="text-zinc-200 font-medium">Adjusted Pain</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-400">
                  Pain amplified by uncertainty. 0% confidence = 2× pain (unknown risk). 100% confidence = 1× pain (well-tested). Formula: pain × (1 + (1 − confidence)).
                </span>
              </div>
              <div>
                <span className="text-zinc-200 font-medium">Confidence</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-400">
                  How well-tested and verified this file is. 0% = no tests, no verification. 100% = fully covered. Currently binary (file-level); function-level gradient coming in RF-14.
                </span>
              </div>
              <div>
                <span className="text-zinc-200 font-medium">Fragility</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-400">
                  Compound risk: painful AND unprotected AND unstable. Formula: adjustedPain × (1 − confidence) × (1 + churn). Files with 100% confidence have 0 fragility.
                </span>
              </div>
              <div>
                <span className="text-zinc-200 font-medium">Centrality</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-400">
                  How connected this file is in the call graph. High centrality = many things depend on it. A change here ripples further.
                </span>
              </div>
              <div>
                <span className="text-zinc-200 font-medium">Downstream</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-400">
                  Log-damped count of CRITICAL/HIGH functions reachable from this file. Measures blast radius of a breaking change.
                </span>
              </div>
              <div>
                <span className="text-zinc-200 font-medium">Risk Tiers</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-400">
                  Function-level risk classification. CRITICAL = top 15%, HIGH = next 20%, MEDIUM = next 30%, LOW = bottom 35%. Based on composite risk scoring.
                </span>
              </div>
              <div>
                <span className="text-zinc-200 font-medium">Ready / Blocked</span>
                <span className="text-zinc-500"> — </span>
                <span className="text-zinc-400">
                  Plan tasks with all dependencies satisfied (ready) vs tasks waiting on incomplete prerequisites (blocked).
                </span>
              </div>
            </div>
          </details>

          {/* Top Files by Pain */}
          {topFiles?.data && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-zinc-100 mb-3">
                Top Files by Adjusted Pain
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-400 border-b border-zinc-800">
                      <th className="text-left py-2 pr-4">File</th>
                      <th className="text-right py-2 px-2">Pain</th>
                      <th className="text-right py-2 px-2">Fragility</th>
                      <th className="text-right py-2 px-2">Confidence</th>
                      <th className="text-right py-2 px-2">Downstream</th>
                      <th className="text-right py-2 px-2">Centrality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topFiles.data.map(
                      (file: {
                        name: string;
                        adjustedPain: number;
                        fragility: number;
                        confidenceScore: number;
                        downstreamImpact: number;
                        centrality: number;
                      }) => (
                        <tr key={file.name} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="py-2 pr-4 font-mono text-zinc-200">{file.name}</td>
                          <td className="text-right py-2 px-2 text-zinc-300">
                            {file.adjustedPain?.toFixed(2)}
                          </td>
                          <td className="text-right py-2 px-2">
                            <span
                              className={
                                file.fragility > 0
                                  ? 'text-red-400'
                                  : 'text-emerald-400'
                              }
                            >
                              {file.fragility?.toFixed(2)}
                            </span>
                          </td>
                          <td className="text-right py-2 px-2">
                            <span
                              className={
                                file.confidenceScore >= 0.5
                                  ? 'text-emerald-400'
                                  : 'text-red-400'
                              }
                            >
                              {(file.confidenceScore * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td className="text-right py-2 px-2 text-zinc-300">
                            {file.downstreamImpact?.toFixed(2) ?? '—'}
                          </td>
                          <td className="text-right py-2 px-2 text-zinc-300">
                            {file.centrality?.toFixed(3)}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
