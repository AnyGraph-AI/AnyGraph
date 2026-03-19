import { Suspense } from 'react';
import { ExplorerGraph } from '@/components/ExplorerGraph';

export default function ExplorerPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Graph Explorer</h1>
        <p className="text-zinc-400 mt-1">Neighbors mode + danger paths mode with graph-native filters and caps.</p>
      </div>

      <Suspense fallback={<div className="text-zinc-500 text-sm">Loading explorer...</div>}>
        <ExplorerGraph />
      </Suspense>
    </div>
  );
}
