'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface MilestoneRow {
  milestone: string;
  projectId: string;
  done: number;
  total: number;
  pct: number;
}

const PROJECT_COLORS: Record<string, string> = {
  plan_codegraph: '#3b82f6',
  plan_godspeed: '#22c55e',
  plan_bible_graph: '#a855f7',
  plan_plan_graph: '#f59e0b',
  plan_runtime_graph: '#ec4899',
  plan_hygiene_governance: '#06b6d4',
};

function shortName(milestone: string): string {
  // "Milestone UI-3: Reality Gap..." → "UI-3", "Milestone AUD-TC-06: IR..." → "AUD-TC-06"
  const match = milestone.match(/Milestone\s+([A-Z0-9]+(?:-[A-Z0-9]+)*):/i);
  return match ? match[1] : milestone.slice(0, 20);
}

export function MilestoneProgress({ data }: { data: MilestoneRow[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-4 text-center">
        No milestone data available.
      </div>
    );
  }

  // Group by project
  const byProject = new Map<string, MilestoneRow[]>();
  for (const row of data) {
    const existing = byProject.get(row.projectId) ?? [];
    existing.push(row);
    byProject.set(row.projectId, existing);
  }

  return (
    <div>
      <p className="text-zinc-400 text-xs mb-3">
        Milestone completion across {byProject.size} projects. {data.length} milestones total.
      </p>
      {Array.from(byProject.entries()).map(([projectId, milestones]) => (
        <div key={projectId} className="mb-4">
          <h3 className="text-zinc-300 text-xs font-medium mb-2">
            {projectId.replace('plan_', '')}
            <span className="text-zinc-500 ml-2">
              ({milestones.filter(m => m.pct === 100).length}/{milestones.length} complete)
            </span>
          </h3>
          <ResponsiveContainer width="100%" height={Math.max(120, milestones.length * 28)}>
            <BarChart
              data={milestones.map(m => ({ ...m, name: shortName(m.milestone) }))}
              layout="vertical"
              margin={{ left: 60, right: 30, top: 0, bottom: 0 }}
            >
              <XAxis type="number" domain={[0, 100]} stroke="#71717a" fontSize={10} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="name" stroke="#71717a" fontSize={10} width={55} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: '8px',
                  color: '#e4e4e7',
                  fontSize: '12px',
                }}
                formatter={(value: any, _name: any, props: any) => [
                  `${props.payload.done}/${props.payload.total} (${value}%)`,
                  props.payload.name,
                ]}
              />
              <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                {milestones.map((m) => (
                  <Cell
                    key={m.milestone}
                    fill={m.pct === 100
                      ? '#22c55e'
                      : m.pct > 0
                        ? PROJECT_COLORS[projectId] ?? '#71717a'
                        : '#3f3f46'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}
