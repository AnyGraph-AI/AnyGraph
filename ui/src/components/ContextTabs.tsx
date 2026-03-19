'use client';

import { useEffect, useState } from 'react';
import { TabsPanel } from '@/components/ui/tabs-panel';
import { FragilityTable } from '@/components/FragilityTable';
import { SafestAction } from '@/components/SafestAction';
import { RiskOverTime } from '@/components/RiskOverTime';
import { MilestoneProgress } from '@/components/MilestoneProgress';

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
  readonly onFragilityClick?: (row: Record<string, unknown>) => void;
  readonly onSafestClick?: (row: Record<string, unknown>) => void;
}

export function ContextTabs({
  fragilityData,
  safestData,
  riskOverTimeData,
  milestoneData,
  avgConfidence,
  onFragilityClick,
  onSafestClick,
}: ContextTabsProps) {
  const [contextTab, setContextTab] = useState<ContextTab>('fragility');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === '1') setContextTab('fragility');
      if (e.key === '2') setContextTab('safest');
      if (e.key === '3') setContextTab('riskOverTime');
      if (e.key === '4') setContextTab('milestones');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <TabsPanel
      tabs={TABS}
      activeTab={contextTab}
      onTabChange={(key) => setContextTab(key as ContextTab)}
    >
      {contextTab === 'fragility' && (
        <FragilityTable data={fragilityData as any} avgConfidence={avgConfidence} onRowClick={onFragilityClick as any} />
      )}
      {contextTab === 'safest' && (
        <SafestAction data={safestData as any} onRowClick={onSafestClick as any} />
      )}
      {contextTab === 'riskOverTime' && (
        <RiskOverTime data={riskOverTimeData as any} />
      )}
      {contextTab === 'milestones' && (
        <MilestoneProgress data={milestoneData as any} />
      )}
    </TabsPanel>
  );
}
