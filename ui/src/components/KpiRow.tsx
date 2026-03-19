'use client';

import { confidenceColor } from '@/lib/colors';
import { KPI, PANEL } from '@/lib/tokens';

export interface KpiRowProps {
  readonly maxPain: number | null;
  readonly maxFragility: number | null;
  readonly avgConfidence: number;
  readonly riskCounts: Record<string, number>;
}

const TIER_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-500/20 text-red-400',
  HIGH: 'bg-orange-500/20 text-orange-400',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400',
  LOW: 'bg-emerald-500/20 text-emerald-400',
};

const TIERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export function KpiRow({ maxPain, maxFragility, avgConfidence, riskCounts }: KpiRowProps) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {/* Max Adjusted Pain */}
      <div className={`${PANEL.classes} ${PANEL.padding}`}>
        <div className={KPI.value}>
          {maxPain?.toFixed(1) ?? '—'}
        </div>
        <div className={KPI.label}>Max Pain</div>
      </div>

      {/* Max Fragility */}
      <div className={`${PANEL.classes} ${PANEL.padding}`}>
        <div className={KPI.value}>
          {maxFragility?.toFixed(1) ?? '—'}
        </div>
        <div className={KPI.label}>Max Fragility</div>
      </div>

      {/* Avg Confidence — with subtle color indicator */}
      <div className={`${PANEL.classes} ${PANEL.padding}`}>
        <div className="flex items-baseline gap-2">
          <span className={KPI.value}>{(avgConfidence * 100).toFixed(0)}%</span>
          {avgConfidence < 0.55 && (
            <span
              className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"
              title="Below 55% — scores dampened"
            />
          )}
        </div>
        <div className={KPI.label}>Avg Confidence</div>
      </div>

      {/* Risk Distribution — inline badges */}
      <div className={`${PANEL.classes} ${PANEL.padding}`}>
        <div className="flex items-baseline gap-1.5">
          {TIERS.map(tier => {
            const count = riskCounts[tier] ?? 0;
            if (count === 0) return null;
            return (
              <span
                key={tier}
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold tabular-nums ${TIER_COLORS[tier]}`}
                title={tier}
              >
                {count}
              </span>
            );
          })}
        </div>
        <div className={KPI.label}>Risk Tiers</div>
      </div>
    </div>
  );
}
