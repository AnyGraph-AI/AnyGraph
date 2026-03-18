'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DiagnosisGrid } from '@/components/DiagnosisGrid';
import { RiskOverTime } from '@/components/RiskOverTime';
import { MilestoneProgress } from '@/components/MilestoneProgress';
import { QUERIES } from '@/lib/queries';
import { fetchQuery } from '@/lib/fetchQuery';

const DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200';

type Tab = 'diagnosis' | 'probes';

export default function DiagnosisPage() {
  const [tab, setTab] = useState<Tab>('diagnosis');

  const { data: diagnosisData, isLoading: diagnosisLoading } = useQuery({
    queryKey: ['diagnosis-grid'],
    queryFn: async () => {
      const res = await fetch('/api/graph/diagnosis');
      if (!res.ok) throw new Error(`Diagnosis API failed: ${res.status}`);
      return res.json();
    },
  });

  const { data: riskOverTimeData } = useQuery({
    queryKey: ['risk-over-time'],
    queryFn: () => fetchQuery(QUERIES.riskOverTime, { projectId: DEFAULT_PROJECT_ID, limit: 30 }),
  });

  const { data: milestoneData } = useQuery({
    queryKey: ['milestone-progress'],
    queryFn: () => fetchQuery(QUERIES.milestoneProgress, { projectId: 'plan_' }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Diagnosis</h1>
        <p className="text-zinc-400 mt-1">Operational checks and architecture probes.</p>
      </div>

      <div className="flex gap-2 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('diagnosis')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            tab === 'diagnosis' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Diagnosis Grid
        </button>
        <button
          onClick={() => setTab('probes')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
            tab === 'probes' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Architecture Probes
        </button>
      </div>

      {tab === 'diagnosis' ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          {diagnosisLoading ? (
            <div className="text-zinc-500 text-sm">Loading diagnosis...</div>
          ) : (
            <DiagnosisGrid data={diagnosisData?.data ?? []} />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold text-zinc-100 mb-3">Risk Over Time</h2>
            <RiskOverTime data={riskOverTimeData?.data ?? []} />
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold text-zinc-100 mb-3">Milestone Progress</h2>
            <MilestoneProgress data={milestoneData?.data ?? []} />
          </div>
        </div>
      )}
    </div>
  );
}
