'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer } from 'recharts';

interface RiskTierRow {
  tier: string;
  count: number;
}

const TIER_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
};

const TIER_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function RiskDistributionChart({ data }: { data: RiskTierRow[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">
        No risk distribution data available.
      </div>
    );
  }

  // Sort by severity order
  const sorted = [...data].sort(
    (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier),
  );

  const total = sorted.reduce((sum, r) => sum + r.count, 0);

  return (
    <div>
      <p className="text-zinc-400 text-xs mb-3">
        Function risk distribution across {total} functions.
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={sorted} layout="vertical" margin={{ left: 70, right: 20, top: 5, bottom: 5 }}>
          <XAxis type="number" stroke="#71717a" fontSize={12} />
          <YAxis
            type="category"
            dataKey="tier"
            stroke="#71717a"
            fontSize={12}
            width={65}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              color: '#e4e4e7',
              fontSize: '13px',
            }}
            formatter={(value: number, _name: string, props: { payload: RiskTierRow }) => [
              `${value} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
              props.payload.tier,
            ]}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {sorted.map((entry) => (
              <Cell key={entry.tier} fill={TIER_COLORS[entry.tier] ?? '#71717a'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
