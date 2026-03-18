'use client';

import { useState } from 'react';

export interface DiagResult {
  id: string;
  question: string;
  answer: string;
  healthy: boolean;
  nextStep: string;
}

function getDotColor(healthy: boolean): string {
  return healthy ? 'bg-emerald-500' : 'bg-red-500';
}

export function DiagnosisGrid({ data }: { data: DiagResult[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">
        No diagnosis data. Run the diagnosis API to populate.
      </div>
    );
  }

  const healthy = data.filter(d => d.healthy).length;
  const unhealthy = data.length - healthy;

  return (
    <div>
      {/* Summary bar */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
          <span className="text-emerald-400 text-sm font-medium">{healthy} healthy</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
          <span className="text-red-400 text-sm font-medium">{unhealthy} unhealthy</span>
        </div>
        <div className="text-zinc-500 text-xs">
          {data.length} total checks
        </div>
      </div>

      {/* Dot grid */}
      <div className="flex flex-wrap gap-2 mb-4">
        {data.map((d) => (
          <button
            key={d.id}
            onClick={() => setExpanded(expanded === d.id ? null : d.id)}
            className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-mono
              ${expanded === d.id ? 'ring-2 ring-zinc-400' : ''}
              ${d.healthy ? 'bg-emerald-950 hover:bg-emerald-900' : 'bg-red-950 hover:bg-red-900'}
              transition-colors`}
            title={`${d.id}: ${d.question}`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${getDotColor(d.healthy)}`} />
          </button>
        ))}
      </div>

      {/* Expanded detail */}
      {expanded && (() => {
        const d = data.find(x => x.id === expanded);
        if (!d) return null;
        return (
          <div className="bg-zinc-800/50 rounded-lg p-4 text-sm space-y-2">
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${getDotColor(d.healthy)}`} />
              <span className="text-zinc-100 font-medium">{d.id}: {d.question}</span>
            </div>
            <p className="text-zinc-300">{d.answer}</p>
            <div className="border-t border-zinc-700 pt-2">
              <p className="text-zinc-400 text-xs">
                <span className="text-zinc-500 font-medium">Next step: </span>
                {d.nextStep}
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
