import React, { Suspense } from 'react';
import { GraphSkeleton } from '@/components/ui/loading-skeleton';

const ExplorerGraph = React.lazy(() =>
  import('@/components/ExplorerGraph').then(m => ({ default: m.ExplorerGraph }))
);

export default function ExplorerPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Graph Explorer</h1>
        <p className="text-zinc-400 mt-1">Neighbors mode + danger paths mode with graph-native filters and caps.</p>
      </div>

      <Suspense fallback={<GraphSkeleton />}>
        <ExplorerGraph />
      </Suspense>
    </div>
  );
}
