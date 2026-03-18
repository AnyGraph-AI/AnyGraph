'use client';

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

interface SnapshotRow {
  timestamp: string;
  invariantViolations: number;
  interceptionRate: number;
  verificationRuns: number;
  gateFailures: number;
  regressions: number;
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function RiskOverTime({ data }: { data: SnapshotRow[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">
        No governance snapshots available. Run done-check to generate snapshots.
      </div>
    );
  }

  const chartData = data.map(row => ({
    ...row,
    label: formatDate(row.timestamp),
    interceptionPct: Math.round(row.interceptionRate * 100),
  }));

  return (
    <div>
      <p className="text-zinc-400 text-xs mb-3">
        Governance health over time. {data.length} snapshots.
      </p>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="label"
            stroke="#71717a"
            fontSize={10}
            interval={Math.max(0, Math.floor(chartData.length / 8))}
          />
          <YAxis stroke="#71717a" fontSize={11} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: '8px',
              color: '#e4e4e7',
              fontSize: '12px',
            }}
          />
          <Line
            type="monotone"
            dataKey="verificationRuns"
            stroke="#3b82f6"
            name="Verification Runs"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="invariantViolations"
            stroke="#ef4444"
            name="Violations"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="gateFailures"
            stroke="#f97316"
            name="Gate Failures"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="regressions"
            stroke="#eab308"
            name="Regressions"
            dot={false}
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
