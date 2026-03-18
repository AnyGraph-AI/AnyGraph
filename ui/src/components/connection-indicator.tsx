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

  return (
    <div className="flex items-center gap-2 text-sm">
      <div
        className={`w-2 h-2 rounded-full ${
          connected === null
            ? 'bg-zinc-500'
            : connected
            ? 'bg-emerald-500'
            : 'bg-red-500'
        }`}
      />
      <span className="text-zinc-400">
        {connected === null ? 'Checking...' : connected ? 'Neo4j' : 'Disconnected'}
      </span>
    </div>
  );
}
