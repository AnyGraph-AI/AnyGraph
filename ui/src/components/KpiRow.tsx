'use client';

import { KpiCard } from '@/components/ui/kpi-card';
import { RiskBadge, type RiskTier } from '@/components/ui/risk-badge';

export interface KpiRowProps {
  readonly maxPain: number | null;
  readonly maxFragility: number | null;
  readonly avgConfidence: number;
  readonly riskCounts: Record<string, number>;
}

const TIERS: RiskTier[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function KpiRow({ maxPain, maxFragility, avgConfidence, riskCounts }: KpiRowProps) {
  return (
    <div className="grid grid-cols-4 gap-3">
      <KpiCard
        value={maxPain?.toFixed(1) ?? '—'}
        label="Max Pain"
      />

      <KpiCard
        value={maxFragility?.toFixed(1) ?? '—'}
        label="Max Fragility"
      />

      <KpiCard
        value={`${(avgConfidence * 100).toFixed(0)}%`}
        label="Avg Confidence"
        indicator={
          avgConfidence < 0.55 ? (
            <span
              className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"
              title="Below 55% — scores dampened"
            />
          ) : undefined
        }
      />

      <KpiCard
        value=""
        label="Risk Tiers"
        indicator={
          <div className="flex items-center gap-1.5">
            {TIERS.map(tier => {
              const count = riskCounts[tier] ?? 0;
              if (count === 0) return null;
              return (
                <span key={tier} className="flex items-center gap-0.5">
                  <RiskBadge tier={tier} size="sm" />
                  <span className="text-xs text-zinc-400 tabular-nums">{count}</span>
                </span>
              );
            })}
          </div>
        }
      />
    </div>
  );
}
