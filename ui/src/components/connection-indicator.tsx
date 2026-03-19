'use client';

import { useEffect, useState } from 'react';

export function ConnectionIndicator() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch('/api/graph/query');
        const data = await res.json();
        setConnected(data.connected);
      } catch {
        setConnected(false);
      }
    }
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  const dotClass =
    connected === null
      ? 'bg-zinc-500'
      : connected
      ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)] animate-pulse'
      : 'bg-red-500';

  return (
    <div className="flex items-center gap-2.5 text-xs font-mono text-zinc-400">
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span>{connected === false ? 'Disconnected' : 'Neo4j'}</span>
    </div>
  );
}
