import { Suspense } from 'react';
import { ExplorerFocus } from '@/components/ExplorerFocus';

export default function ExplorerPage() {
  return (
    <Suspense fallback={<div className="text-zinc-500 text-sm">Loading explorer...</div>}>
      <ExplorerFocus />
    </Suspense>
  );
}
