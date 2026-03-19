'use client';

import { useState } from 'react';
import { FragilityTable } from '@/components/FragilityTable';
import { SafestAction } from '@/components/SafestAction';
import { RiskOverTime } from '@/components/RiskOverTime';
import { MilestoneProgress } from '@/components/MilestoneProgress';
import { PANEL } from '@/lib/tokens';

type ContextTab = 'fragility' | 'safest' | 'riskOverTime' | 'milestones';

const TABS: Array<{ key: ContextTab; label: string }> = [
  { key: 'fragility', label: 'Fragility' },
  { key: 'safest', label: 'Safest Actions' },
  { key: 'riskOverTime', label: 'Risk Trend' },
  { key: 'milestones', label: 'Milestones' },
];

export interface ContextTabsProps {
  readonly fragilityData: Array<Record<string, unknown>>;
  readonly safestData: Array<Record<string, unknown>>;
  readonly riskOverTimeData: Array<Record<string, unknown>>;
  readonly milestoneData: Array<Record<string, unknown>>;
  readonly avgConfidence: number;
}

export function ContextTabs({
  fragilityData,
  safestData,
  riskOverTimeData,
  milestoneData,
  avgConfidence,
}: ContextTabsProps) {
  const [contextTab, setContextTab] = useState<ContextTab>('fragility');

  return (
    <div className={PANEL.classes}>
      {/* Tab pills */}
      <div className="flex items-center gap-1 px-5 pt-4 pb-0 border-b border-zinc-800/40">
        {TABS.map(tab => (
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
          <FragilityTable data={fragilityData as any} avgConfidence={avgConfidence} />
        )}
        {contextTab === 'safest' && (
          <SafestAction data={safestData as any} />
        )}
        {contextTab === 'riskOverTime' && (
          <RiskOverTime data={riskOverTimeData as any} />
        )}
        {contextTab === 'milestones' && (
          <MilestoneProgress data={milestoneData as any} />
        )}
      </div>
    </div>
  );
}
