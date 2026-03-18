'use client';

import React, { useMemo } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';

export interface HeatmapFile {
  name: string;
  filePath: string;
  adjustedPain: number;
  confidenceScore: number;
  painScore: number;
  fragility: number;
}

export interface PainHeatmapProps {
  data: HeatmapFile[];
  onCellClick?: (file: HeatmapFile) => void;
}

/** Map confidence 0–1 to a color: red (0%) → amber (50%) → green (100%) */
function confidenceColor(conf: number): string {
  if (conf >= 0.8) return '#059669';   // emerald-600
  if (conf >= 0.5) return '#d97706';   // amber-600
  if (conf >= 0.2) return '#ea580c';   // orange-600
  return '#dc2626';                     // red-600
}

/** Map adjustedPain to fill opacity: higher pain = more intense */
function painOpacity(pain: number, maxPain: number): number {
  if (maxPain === 0) return 0.3;
  return 0.3 + 0.7 * (pain / maxPain);
}

interface TreemapContentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  confidenceScore: number;
  adjustedPain: number;
  maxPain: number;
  isLowConfidence: boolean;
}

function CustomCell({
  x, y, width, height, name, confidenceScore, adjustedPain, maxPain, isLowConfidence,
}: TreemapContentProps) {
  const fill = confidenceColor(confidenceScore);
  const opacity = painOpacity(adjustedPain, maxPain);
  const patternId = `stripes-${name.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={opacity}
        stroke="#27272a"
        strokeWidth={2}
        aria-label={`${name}: pain ${adjustedPain.toFixed(2)}, confidence ${(confidenceScore * 100).toFixed(0)}%`}
      />
      {/* SVG stripe overlay for low-confidence cells */}
      {isLowConfidence && (
        <>
          <defs>
            <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
            </pattern>
          </defs>
          <rect x={x} y={y} width={width} height={height} fill={`url(#${patternId})`} />
        </>
      )}
      {width > 40 && height > 20 && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fafafa"
          fontSize={Math.min(12, width / name.length * 1.5)}
          className="pointer-events-none"
        >
          {name.length > width / 7 ? name.slice(0, Math.floor(width / 7)) + '…' : name}
        </text>
      )}
    </g>
  );
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: HeatmapFile & { size: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm shadow-xl">
      <div className="font-mono text-zinc-100 font-semibold mb-2">{d.name}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-zinc-300">
        <span className="text-zinc-500">Adjusted Pain</span>
        <span className="text-right">{d.adjustedPain?.toFixed(2)}</span>
        <span className="text-zinc-500">Raw Pain</span>
        <span className="text-right">{d.painScore?.toFixed(2)}</span>
        <span className="text-zinc-500">Confidence</span>
        <span className={`text-right ${d.confidenceScore >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
          {(d.confidenceScore * 100).toFixed(0)}%
        </span>
        <span className="text-zinc-500">Fragility</span>
        <span className={`text-right ${d.fragility > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          {d.fragility?.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export function PainHeatmap({ data, onCellClick }: PainHeatmapProps) {
  const maxPain = useMemo(
    () => Math.max(...data.map((d) => d.adjustedPain), 0),
    [data],
  );

  const treemapData = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        size: Math.max(d.adjustedPain, 0.01), // Recharts needs positive size
        maxPain,
        isLowConfidence: d.confidenceScore < 0.5,
      })),
    [data, maxPain],
  );

  if (data.length === 0) {
    return (
      <div className="text-zinc-500 text-center py-8">No files with pain scores found.</div>
    );
  }

  return (
    <div className="w-full" style={{ height: Math.max(300, Math.min(600, data.length * 8)) }}>
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={treemapData}
          dataKey="size"
          stroke="#27272a"
          content={<CustomCell x={0} y={0} width={0} height={0} name="" confidenceScore={0} adjustedPain={0} maxPain={maxPain} isLowConfidence={false} />}
          onClick={onCellClick ? (node: unknown) => onCellClick(node as HeatmapFile) : undefined}
        >
          <Tooltip content={<CustomTooltip />} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
