'use client';

import { useState } from 'react';
import { PainHeatmap } from '@/components/PainHeatmap';
import { GodFilesTable } from '@/components/GodFilesTable';

type ViewMode = 'treemap' | 'table';
type DataMode = 'files' | 'functions';

export interface HeroTreemapProps {
  readonly fileHeatmapData: Array<Record<string, unknown>>;
  readonly fnHeatmapData: Array<Record<string, unknown>>;
  readonly godFilesData: Array<Record<string, unknown>>;
  readonly fnTableData: Array<Record<string, unknown>>;
  readonly onNavigateToExplorer?: (payload: { focus: string; focusType: 'file' | 'function'; filePath?: string }) => void;
}

export function HeroTreemap({ fileHeatmapData, fnHeatmapData, godFilesData, fnTableData, onNavigateToExplorer }: HeroTreemapProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('treemap');
  const [dataMode, setDataMode] = useState<DataMode>('files');

  const mappedFnHeatmap = fnHeatmapData.map((f) => ({
    name: f.name as string,
    filePath: f.filePath as string,
    adjustedPain: f.compositeRisk as number,
    confidenceScore: f.riskTier === 'CRITICAL' ? 0 : f.riskTier === 'HIGH' ? 0.3 : f.riskTier === 'MEDIUM' ? 0.6 : 1.0,
    painScore: f.compositeRisk as number,
    fragility: 0,
  }));

  const mappedFnTable = fnTableData.map((f) => ({
    name: `${f.name} (${f.fileName})`,
    filePath: '',
    adjustedPain: f.compositeRisk as number,
    fragility: 0,
    confidenceScore: f.riskTier === 'CRITICAL' ? 0 : f.riskTier === 'HIGH' ? 0.3 : f.riskTier === 'MEDIUM' ? 0.6 : 1.0,
    basePain: f.compositeRisk as number,
    centrality: f.centrality as number,
    downstreamImpact: f.downstreamImpact as number,
  }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-100">
          {dataMode === 'files'
            ? viewMode === 'treemap' ? 'Pain Heatmap' : 'Files by Adjusted Pain'
            : viewMode === 'treemap' ? 'Risk Heatmap' : 'Functions by Composite Risk'}
        </h2>
        <div className="flex gap-2">
          <div className="flex gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
            {(['files', 'functions'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setDataMode(mode)}
                className={`px-3 py-1 text-xs rounded-md transition-colors duration-150 ${
                  dataMode === mode
                    ? 'bg-[#7ec8e3]/15 text-[#7ec8e3]'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
            {(['treemap', 'table'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-xs rounded-md transition-colors duration-150 ${
                  viewMode === mode
                    ? 'bg-[#7ec8e3]/15 text-[#7ec8e3]'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {mode === 'treemap' ? 'Heatmap' : 'Table'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {fileHeatmapData.length > 500 && (
        <div className="text-amber-400/80 text-xs mb-2">
          ⚠ Showing top 500 of {fileHeatmapData.length} files
        </div>
      )}

      <div className="min-h-[60vh] overflow-hidden rounded-xl border border-white/10 bg-[#0b0e13]">
        {dataMode === 'files' ? (
          viewMode === 'treemap' ? (
            <PainHeatmap
              data={fileHeatmapData as any}
              onCellClick={(file) =>
                onNavigateToExplorer?.({
                  focus: file.filePath || file.name,
                  focusType: 'file',
                  filePath: file.filePath,
                })
              }
            />
          ) : (
            <div className="p-4">
              <GodFilesTable
                data={godFilesData as any}
                onRowClick={(file) =>
                  onNavigateToExplorer?.({
                    focus: file.filePath || file.name,
                    focusType: 'file',
                    filePath: file.filePath,
                  })
                }
              />
            </div>
          )
        ) : (
          viewMode === 'treemap' ? (
            <PainHeatmap
              data={mappedFnHeatmap as any}
              onCellClick={(fn) =>
                onNavigateToExplorer?.({
                  focus: fn.name,
                  focusType: 'function',
                  filePath: fn.filePath,
                })
              }
            />
          ) : (
            <div className="p-4">
              <GodFilesTable
                data={mappedFnTable as any}
                onRowClick={(fn) =>
                  onNavigateToExplorer?.({
                    focus: fn.name,
                    focusType: 'function',
                    filePath: fn.filePath,
                  })
                }
              />
            </div>
          )
        )}
      </div>
    </div>
  );
}
